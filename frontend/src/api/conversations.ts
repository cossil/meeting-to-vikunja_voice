import client from './client';
import type { ConversationSummary, ConversationDetail } from '../types/schema';

export const conversationsApi = {
    list: async (): Promise<ConversationSummary[]> => {
        const response = await client.get<ConversationSummary[]>('/conversations');
        return response.data;
    },

    getById: async (id: string): Promise<ConversationDetail> => {
        const response = await client.get<ConversationDetail>(`/conversations/${id}`);
        return response.data;
    },
};
