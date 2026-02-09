import client from './client';
import type { SaveConversationRequest, SaveConversationResponse } from '../types/schema';

// Re-export shared types for backward compatibility
export type { SaveConversationRequest, SaveConversationResponse };

export const liveApi = {
  saveConversation: async (req: SaveConversationRequest): Promise<SaveConversationResponse> => {
    const response = await client.post<SaveConversationResponse>('/voice/live/save', req);
    return response.data;
  },
};
