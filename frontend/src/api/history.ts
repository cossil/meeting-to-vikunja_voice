import client from './client';
import type { HistorySummary, HistoryDetail } from '../types/schema';

export const historyApi = {
    list: async (): Promise<HistorySummary[]> => {
        const response = await client.get<HistorySummary[]>('/history');
        return response.data;
    },
    getById: async (id: string): Promise<HistoryDetail> => {
        const response = await client.get<HistoryDetail>(`/history/${id}`);
        return response.data;
    },
};
