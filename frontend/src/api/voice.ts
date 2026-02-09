import client from './client';
import type { VoiceState, VoiceTurnResponse, SaveConversationRequest, SaveConversationResponse } from '../types/schema';

interface TurnResult {
    updatedState: VoiceState;
    audioUrl: string;
    replyText?: string;
    userTranscript?: string;
}

export const voiceApi = {
    warmup: async (): Promise<void> => {
        await client.get('/voice/warmup');
    },

    getGreeting: async (): Promise<string> => {
        const response = await client.get('/voice/greeting', {
            responseType: 'blob',
        });
        return URL.createObjectURL(response.data);
    },

    sendTurn: async (audioBlob: Blob, currentState: VoiceState): Promise<TurnResult> => {
        const formData = new FormData();
        formData.append('file', audioBlob, 'input.wav');
        formData.append('state', JSON.stringify(currentState));

        const response = await client.post<VoiceTurnResponse>('/voice/turn', formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });

        const audioUrl = decodeBase64Audio(response.data.reply_audio);

        return {
            updatedState: response.data.updated_state,
            audioUrl,
            replyText: response.data.reply_text,
            userTranscript: response.data.user_transcript,
        };
    },

    sendTextTurn: async (text: string, currentState: VoiceState): Promise<TurnResult> => {
        const formData = new FormData();
        formData.append('text', text);
        formData.append('state', JSON.stringify(currentState));

        const response = await client.post<VoiceTurnResponse>('/voice/turn', formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });

        const audioUrl = decodeBase64Audio(response.data.reply_audio);

        return {
            updatedState: response.data.updated_state,
            audioUrl,
            replyText: response.data.reply_text,
            userTranscript: response.data.user_transcript,
        };
    },

    saveConversation: async (req: SaveConversationRequest): Promise<SaveConversationResponse> => {
        const response = await client.post<SaveConversationResponse>('/voice/standard/save', req);
        return response.data;
    },
};

/** Convert Base64-encoded audio to a Blob URL */
function decodeBase64Audio(b64: string): string {
    const byteCharacters = atob(b64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return URL.createObjectURL(new Blob([byteArray], { type: 'audio/wav' }));
}
