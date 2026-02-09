import { create } from 'zustand';
import { voiceApi } from '../api/voice';
import type { VoiceState } from '../types/schema';

interface Message {
    role: 'user' | 'agent';
    content: string | null; // Text transcript if available, or just placeholder
    audioUrl?: string; // For playback history
}

interface VoiceStoreState {
    isRecording: boolean;
    isProcessing: boolean;
    isPlaying: boolean;
    isSaving: boolean;
    sessionId: string;
    messages: Message[];
    currentTask: VoiceState;
    error: string | null;

    // Actions
    setIsRecording: (isRecording: boolean) => void;
    initSession: () => Promise<void>;
    processUserAudio: (audioBlob: Blob) => Promise<void>;
    sendTextMessage: (text: string) => Promise<void>;
    playAudio: (url: string) => Promise<void>;
    reset: () => void;
    updateCurrentTask: (updates: Partial<VoiceState>) => void;
    resetCurrentTask: () => void;
    saveConversation: (syncToVikunja: boolean) => Promise<void>;
}

const INITIAL_TASK_STATE: VoiceState = {
    title: null,
    description: null,
    dueDate: null,
    assignee: null,
    status: 'draft',
    priority: 3
};

export const useVoiceStore = create<VoiceStoreState>((set, get) => ({
    isRecording: false,
    isProcessing: false,
    isPlaying: false,
    isSaving: false,
    sessionId: crypto.randomUUID(),
    messages: [],
    currentTask: INITIAL_TASK_STATE,
    error: null,

    setIsRecording: (isRecording) => set({ isRecording }),

    playAudio: async (url: string) => {
        set({ isPlaying: true });
        const audio = new Audio(url);

        audio.onended = () => {
            set({ isPlaying: false });
        };

        audio.onerror = () => {
            set({ isPlaying: false, error: "Failed to play audio" });
        };

        try {
            await audio.play();
        } catch (e) {
            console.error("Audio playback failed", e);
            set({ isPlaying: false });
        }
    },

    initSession: async () => {
        set({ isProcessing: true, error: null, messages: [] });
        try {
            await voiceApi.warmup();
            const greetingUrl = await voiceApi.getGreeting();

            set((state) => ({
                messages: [...state.messages, { role: 'agent', content: "Olá! Sou o assistente de tarefas do Vikunja. Como posso ajudar você hoje?", audioUrl: greetingUrl }],
                isProcessing: false
            }));

            await get().playAudio(greetingUrl);

        } catch (err: any) {
            set({ error: err.message || "Failed to initialize voice session", isProcessing: false });
        }
    },

    processUserAudio: async (audioBlob: Blob) => {
        set({ isProcessing: true, error: null });
        const { currentTask } = get();

        // Add user placeholder (will be updated with real transcript after response)
        const userAudioUrl = URL.createObjectURL(audioBlob);
        set((state) => ({
            messages: [...state.messages, { role: 'user', content: null, audioUrl: userAudioUrl }]
        }));

        try {
            const { updatedState, audioUrl, replyText, userTranscript } = await voiceApi.sendTurn(audioBlob, currentTask);

            set((state) => {
                const msgs = [...state.messages];
                // Update the last user message with the real transcript
                if (userTranscript) {
                    for (let i = msgs.length - 1; i >= 0; i--) {
                        if (msgs[i].role === 'user') {
                            msgs[i] = { ...msgs[i], content: userTranscript };
                            break;
                        }
                    }
                }
                // Add agent message with real text
                msgs.push({ role: 'agent', content: replyText || null, audioUrl });
                return { currentTask: updatedState, messages: msgs, isProcessing: false };
            });

            await get().playAudio(audioUrl);

        } catch (err: any) {
            set({ error: err.message || "Failed to process audio", isProcessing: false });
        }
    },

    sendTextMessage: async (text: string) => {
        if (!text.trim()) return;
        set({ isProcessing: true, error: null });
        const { currentTask } = get();

        // Add user text message
        set((state) => ({
            messages: [...state.messages, { role: 'user', content: text }]
        }));

        try {
            const { updatedState, audioUrl, replyText } = await voiceApi.sendTextTurn(text, currentTask);

            set((state) => ({
                currentTask: updatedState,
                messages: [...state.messages, { role: 'agent', content: replyText || null, audioUrl }],
                isProcessing: false
            }));

            await get().playAudio(audioUrl);

        } catch (err: any) {
            set({ error: err.message || "Failed to process message", isProcessing: false });
        }
    },



    resetCurrentTask: () => {
        set({ currentTask: INITIAL_TASK_STATE });
    },

    updateCurrentTask: (updates) => {
        set((state) => ({
            currentTask: { ...state.currentTask, ...updates }
        }));
    },

    saveConversation: async (syncToVikunja: boolean) => {
        const { currentTask, messages, sessionId } = get();
        if (!messages.length) return;

        set({ isSaving: true, error: null });
        try {
            const result = await voiceApi.saveConversation({
                session_id: sessionId,
                transcript: messages.map(m => ({
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

    reset: () => {
        set({
            isRecording: false,
            isProcessing: false,
            isPlaying: false,
            isSaving: false,
            sessionId: crypto.randomUUID(),
            messages: [],
            currentTask: INITIAL_TASK_STATE,
            error: null
        });
    }
}));
