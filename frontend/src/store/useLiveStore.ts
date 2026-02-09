/**
 * useLiveStore — Zustand state management for the Live Voice Agent.
 *
 * Orchestrates the full session lifecycle:
 *   connect()    → WS + mic capture + playback manager
 *   disconnect() → clean teardown of all resources
 *
 * Data flow:
 *   Mic → liveAudioStreamer.createAudioCapture → onPcmChunk → liveClient.sendAudio → backend
 *   Backend → liveClient.onAudioChunk → liveAudioStreamer.playback.enqueue → speaker
 *   Backend → liveClient.onTaskUpdate → store.currentTask (TaskDraftCard compatible)
 *   Backend → liveClient.onTranscript → store.messages (ChatInterface compatible)
 *
 * This store does NOT import from useVoiceStore or the Standard Agent's api modules.
 */

import { create } from 'zustand';
import type { VoiceState } from '../types/schema';
import {
  createAudioCapture,
  createAudioPlayback,
  type AudioCapture,
  type AudioPlayback,
} from '../utils/liveAudioStreamer';
import {
  createLiveConnection,
  type LiveConnection,
} from '../api/liveClient';

// ---------------------------------------------------------------------------
// Types — compatible with useVoiceStore's Message for ChatInterface reuse
// ---------------------------------------------------------------------------

export interface LiveMessage {
  role: 'user' | 'agent';
  content: string | null;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL_TASK_STATE: VoiceState = {
  title: null,
  description: null,
  dueDate: null,
  assignee: null,
  status: 'draft',
  priority: 3,
};

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface LiveStoreState {
  // Connection
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'error';
  error: string | null;
  sessionId: string;

  // Audio
  isStreaming: boolean;
  isModelSpeaking: boolean;
  userVolume: number;
  modelVolume: number;

  // Content
  messages: LiveMessage[];
  currentTask: VoiceState;

  // Save state
  isSaving: boolean;

  // Actions
  connect: () => Promise<void>;
  disconnect: () => void;
  reset: () => void;
  updateCurrentTask: (updates: Partial<VoiceState>) => void;
  resetCurrentTask: () => void;
  saveConversation: (syncToVikunja: boolean) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal refs (not reactive — stored outside Zustand to avoid re-renders)
// ---------------------------------------------------------------------------

let _connection: LiveConnection | null = null;
let _capture: AudioCapture | null = null;
let _playback: AudioPlayback | null = null;

// Transcript state — backend sends full accumulated text (replace semantic, not append)
let _currentUserTranscript = '';
let _currentModelTranscript = '';

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useLiveStore = create<LiveStoreState>((set, get) => ({
  connectionState: 'disconnected',
  error: null,
  sessionId: '',
  isStreaming: false,
  isModelSpeaking: false,
  userVolume: 0,
  modelVolume: 0,
  messages: [],
  currentTask: INITIAL_TASK_STATE,
  isSaving: false,

  // ----- connect() — full session lifecycle -----
  connect: async () => {
    // Guard against double-connect
    if (get().connectionState === 'connecting' || get().connectionState === 'connected') {
      return;
    }

    set({ connectionState: 'connecting', error: null, sessionId: crypto.randomUUID() });

    // Reset transcript aggregation
    _currentUserTranscript = '';
    _currentModelTranscript = '';

    try {
      // 1. Create playback manager (24kHz output)
      _playback = createAudioPlayback((level) => {
        set({ modelVolume: level });
      });

      // 2. Create WS connection with message handlers
      _connection = await createLiveConnection({
        onAudioChunk: (pcmBytes) => {
          _playback?.enqueue(pcmBytes);
          set({ isModelSpeaking: true });
        },

        onTaskUpdate: (data) => {
          set((state) => ({
            currentTask: {
              ...state.currentTask,
              title: data.title ?? state.currentTask.title,
              description: data.description ?? state.currentTask.description,
              dueDate: data.dueDate ?? state.currentTask.dueDate,
              assignee: data.assignee ?? state.currentTask.assignee,
              priority: data.priority ?? state.currentTask.priority,
              status: 'draft',
            },
          }));
        },

        onTranscript: (source, text, isComplete) => {
          if (source === 'user') {
            _currentUserTranscript = text;  // Replace — backend sends full accumulated text
            if (isComplete) {
              const finalText = _currentUserTranscript.trim();
              if (finalText) {
                set((state) => ({
                  messages: [...state.messages, { role: 'user', content: finalText }],
                }));
              }
              _currentUserTranscript = '';
            }
          } else {
            _currentModelTranscript = text;  // Replace — backend sends full accumulated text
            if (isComplete) {
              const finalText = _currentModelTranscript.trim();
              if (finalText) {
                set((state) => ({
                  messages: [...state.messages, { role: 'agent', content: finalText }],
                }));
              }
              _currentModelTranscript = '';
            }
          }
        },

        onTurnComplete: () => {
          // Transcripts are now flushed by isComplete:true from the backend.
          // Only reset audio state here.
          set({ isModelSpeaking: false });
        },

        onInterrupted: () => {
          _playback?.interrupt();
          _currentModelTranscript = '';
          set({ isModelSpeaking: false });
        },

        onError: (message) => {
          console.error('[LiveStore] Error:', message);
          set({ error: message, connectionState: 'error' });
          get().disconnect();
        },

        onClose: (code?: number, reason?: string) => {
          const wasConnected = get().connectionState === 'connected';
          set({
            connectionState: 'disconnected',
            isStreaming: false,
            isModelSpeaking: false,
            ...(wasConnected && code !== 1000 ? { error: reason || 'Connection lost unexpectedly' } : {}),
          });
        },
      });

      set({ connectionState: 'connected' });

      // 3. Start mic capture (16kHz input) — wired to send audio over WS
      _capture = await createAudioCapture(
        (pcmBuffer) => {
          _connection?.sendAudio(pcmBuffer);
        },
        (level) => {
          set({ userVolume: level });
        },
      );

      set({ isStreaming: true });
    } catch (err: any) {
      console.error('[LiveStore] Connection failed:', err);
      set({
        connectionState: 'error',
        error: err?.message || 'Failed to connect to Live Agent',
      });
      // Cleanup any partially initialized resources
      _playback?.stop();
      _playback = null;
      _connection?.close();
      _connection = null;
    }
  },

  // ----- disconnect() — clean teardown -----
  disconnect: () => {
    _capture?.stop();
    _capture = null;

    _playback?.stop();
    _playback = null;

    _connection?.close();
    _connection = null;

    _currentUserTranscript = '';
    _currentModelTranscript = '';

    set({
      connectionState: 'disconnected',
      isStreaming: false,
      isModelSpeaking: false,
      userVolume: 0,
      modelVolume: 0,
    });
  },

  // ----- reset() — disconnect + clear all content -----
  reset: () => {
    get().disconnect();
    set({
      messages: [],
      currentTask: INITIAL_TASK_STATE,
      error: null,
    });
  },

  updateCurrentTask: (updates) => {
    set((state) => ({
      currentTask: { ...state.currentTask, ...updates },
    }));
  },

  resetCurrentTask: () => {
    set({ currentTask: INITIAL_TASK_STATE });
  },

  // ----- saveConversation() — save transcript + draft, optionally sync to Vikunja -----
  saveConversation: async (syncToVikunja: boolean) => {
    const { currentTask, messages, sessionId } = get();
    if (!messages.length) return;

    set({ isSaving: true, error: null });
    try {
      const { liveApi } = await import('../api/liveApi');
      const result = await liveApi.saveConversation({
        session_id: sessionId,
        transcript: messages.map((m) => ({
          role: m.role === 'agent' ? 'agent' : 'user',
          content: m.content || '',
        })),
        task_draft: {
          title: currentTask.title,
          description: currentTask.description,
          assignee: currentTask.assignee,
          due_date: currentTask.dueDate,
          priority: currentTask.priority || 3,
        },
        sync_to_vikunja: syncToVikunja,
      });

      if (result.saved) {
        const msg = syncToVikunja
          ? (result.synced
              ? 'Tarefa criada e diálogo salvo com sucesso!'
              : `Diálogo salvo, mas erro ao sincronizar: ${result.sync_error}`)
          : 'Diálogo salvo com sucesso!';
        set((state) => ({
          messages: [...state.messages, { role: 'agent', content: msg }],
        }));
        if (syncToVikunja && result.synced) {
          get().resetCurrentTask();
        }
      } else {
        throw new Error('Falha ao salvar o diálogo');
      }
    } catch (err: any) {
      set({ error: err?.message || 'Falha ao salvar' });
    } finally {
      set({ isSaving: false });
    }
  },
}));
