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

  // Audio
  isStreaming: boolean;
  isModelSpeaking: boolean;
  userVolume: number;
  modelVolume: number;

  // Content
  messages: LiveMessage[];
  currentTask: VoiceState;

  // Actions
  connect: () => Promise<void>;
  disconnect: () => void;
  reset: () => void;
  updateCurrentTask: (updates: Partial<VoiceState>) => void;
  resetCurrentTask: () => void;
  syncToVikunja: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal refs (not reactive — stored outside Zustand to avoid re-renders)
// ---------------------------------------------------------------------------

let _connection: LiveConnection | null = null;
let _capture: AudioCapture | null = null;
let _playback: AudioPlayback | null = null;

// Transcript aggregation state (mirrors reference geminiLiveClient.ts:25-26)
let _currentUserTranscript = '';
let _currentModelTranscript = '';

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useLiveStore = create<LiveStoreState>((set, get) => ({
  connectionState: 'disconnected',
  error: null,
  isStreaming: false,
  isModelSpeaking: false,
  userVolume: 0,
  modelVolume: 0,
  messages: [],
  currentTask: INITIAL_TASK_STATE,

  // ----- connect() — full session lifecycle -----
  connect: async () => {
    // Guard against double-connect
    if (get().connectionState === 'connecting' || get().connectionState === 'connected') {
      return;
    }

    set({ connectionState: 'connecting', error: null });

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
            _currentUserTranscript += text;
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
            _currentModelTranscript += text;
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
          // Finalize any pending transcripts (safety net)
          if (_currentUserTranscript.trim()) {
            set((state) => ({
              messages: [...state.messages, { role: 'user', content: _currentUserTranscript.trim() }],
            }));
            _currentUserTranscript = '';
          }
          if (_currentModelTranscript.trim()) {
            set((state) => ({
              messages: [...state.messages, { role: 'agent', content: _currentModelTranscript.trim() }],
            }));
            _currentModelTranscript = '';
          }
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

        onClose: () => {
          set({ connectionState: 'disconnected', isStreaming: false, isModelSpeaking: false });
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

  // ----- syncToVikunja() — same pattern as useVoiceStore -----
  syncToVikunja: async () => {
    const { currentTask } = get();
    if (!currentTask.title) return;

    set({ error: null });
    try {
      const taskToSync = {
        title: currentTask.title,
        description: currentTask.description,
        assignee_name: currentTask.assignee,
        assignee_id: null,
        priority: currentTask.priority || 3,
        due_date: currentTask.dueDate,
      };

      const { batchApi } = await import('../api/batch');
      const result = await batchApi.syncTasks([taskToSync]);

      if (result.success > 0) {
        set((state) => ({
          messages: [
            ...state.messages,
            { role: 'agent', content: 'Tarefa enviada com sucesso para o Vikunja!' },
          ],
        }));
        get().resetCurrentTask();
      } else {
        throw new Error(result.details[0]?.error || 'Erro ao sincronizar');
      }
    } catch (err: any) {
      set({ error: err?.message || 'Falha ao sincronizar' });
    }
  },
}));
