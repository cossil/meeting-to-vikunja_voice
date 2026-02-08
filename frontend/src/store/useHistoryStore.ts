import { create } from 'zustand';
import type { HistorySummary, HistoryDetail } from '../types/schema';
import { historyApi } from '../api/history';

interface HistoryState {
    status: 'idle' | 'loading' | 'error';
    items: HistorySummary[];
    selectedDetail: HistoryDetail | null;
    detailLoading: boolean;
    error: string | null;
    searchQuery: string;

    fetchList: () => Promise<void>;
    fetchDetail: (id: string) => Promise<void>;
    setSearchQuery: (query: string) => void;
    clearSelection: () => void;
}

export const useHistoryStore = create<HistoryState>((set) => ({
    status: 'idle',
    items: [],
    selectedDetail: null,
    detailLoading: false,
    error: null,
    searchQuery: '',

    fetchList: async () => {
        set({ status: 'loading', error: null });
        try {
            const items = await historyApi.list();
            set({ items, status: 'idle' });
        } catch (err: any) {
            set({
                status: 'error',
                error: err?.response?.data?.detail || err.message || 'Failed to load history',
            });
        }
    },

    fetchDetail: async (id: string) => {
        set({ detailLoading: true, error: null });
        try {
            const detail = await historyApi.getById(id);
            set({ selectedDetail: detail, detailLoading: false });
        } catch (err: any) {
            set({
                detailLoading: false,
                error: err?.response?.data?.detail || err.message || 'Failed to load analysis',
            });
        }
    },

    setSearchQuery: (query: string) => {
        set({ searchQuery: query });
    },

    clearSelection: () => {
        set({ selectedDetail: null });
    },
}));
