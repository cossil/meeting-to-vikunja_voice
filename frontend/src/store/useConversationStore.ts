import { create } from 'zustand';
import type { ConversationSummary, ConversationDetail } from '../types/schema';
import { conversationsApi } from '../api/conversations';

interface ConversationState {
    status: 'idle' | 'loading' | 'error';
    items: ConversationSummary[];
    selectedDetail: ConversationDetail | null;
    detailLoading: boolean;
    error: string | null;
    searchQuery: string;
    filterAgent: 'all' | 'live' | 'standard';

    fetchList: () => Promise<void>;
    fetchDetail: (id: string) => Promise<void>;
    setSearchQuery: (query: string) => void;
    setFilterAgent: (filter: 'all' | 'live' | 'standard') => void;
    clearSelection: () => void;
}

export const useConversationStore = create<ConversationState>((set) => ({
    status: 'idle',
    items: [],
    selectedDetail: null,
    detailLoading: false,
    error: null,
    searchQuery: '',
    filterAgent: 'all',

    fetchList: async () => {
        set({ status: 'loading', error: null });
        try {
            const items = await conversationsApi.list();
            set({ items, status: 'idle' });
        } catch (err: any) {
            set({
                status: 'error',
                error: err?.response?.data?.detail || err.message || 'Falha ao carregar diálogos',
            });
        }
    },

    fetchDetail: async (id: string) => {
        set({ detailLoading: true, error: null });
        try {
            const detail = await conversationsApi.getById(id);
            set({ selectedDetail: detail, detailLoading: false });
        } catch (err: any) {
            set({
                detailLoading: false,
                error: err?.response?.data?.detail || err.message || 'Falha ao carregar diálogo',
            });
        }
    },

    setSearchQuery: (query: string) => {
        set({ searchQuery: query });
    },

    setFilterAgent: (filter: 'all' | 'live' | 'standard') => {
        set({ filterAgent: filter });
    },

    clearSelection: () => {
        set({ selectedDetail: null });
    },
}));
