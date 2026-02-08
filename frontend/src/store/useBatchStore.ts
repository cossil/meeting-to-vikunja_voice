import { create } from 'zustand';
import type { Task, SyncResponse } from '../types/schema';
import { batchApi } from '../api/batch';

interface BatchState {
    status: 'idle' | 'staging' | 'uploading' | 'analyzing' | 'reviewing' | 'syncing' | 'completed' | 'error';
    selectedFiles: File[];
    fileNames: string[];
    tasks: Task[];
    syncResult: SyncResponse | null;
    error: string | null;

    // File staging actions
    addFiles: (files: File[]) => void;
    removeFile: (index: number) => void;
    clearFiles: () => void;

    // Processing actions
    processFiles: () => Promise<void>;
    uploadFiles: (files: File[]) => Promise<void>;
    updateTask: (index: number, updates: Partial<Task>) => void;
    removeTask: (index: number) => void;
    syncToVikunja: () => Promise<void>;
    reset: () => void;
}

export const useBatchStore = create<BatchState>((set, get) => ({
    status: 'idle',
    selectedFiles: [],
    fileNames: [],
    tasks: [],
    syncResult: null,
    error: null,

    addFiles: (files: File[]) => {
        set((state) => {
            const combined = [...state.selectedFiles, ...files];
            return {
                selectedFiles: combined,
                status: combined.length > 0 ? 'staging' : 'idle',
                error: null,
            };
        });
    },

    removeFile: (index: number) => {
        set((state) => {
            const next = state.selectedFiles.filter((_, i) => i !== index);
            return {
                selectedFiles: next,
                status: next.length > 0 ? 'staging' : 'idle',
            };
        });
    },

    clearFiles: () => {
        set({ selectedFiles: [], status: 'idle', error: null });
    },

    processFiles: async () => {
        const { selectedFiles } = get();
        if (selectedFiles.length === 0) return;
        set({ status: 'uploading', error: null });
        try {
            const response = await batchApi.uploadFiles(selectedFiles);
            set({
                tasks: response.tasks,
                fileNames: response.file_names ?? selectedFiles.map((f) => f.name),
                status: 'reviewing',
            });
        } catch (err: any) {
            set({
                status: 'error',
                error: err?.response?.data?.detail || err.message || 'Failed to process files',
            });
        }
    },

    // Legacy compat — auto-stage then process
    uploadFiles: async (files: File[]) => {
        set({ selectedFiles: files, status: 'uploading', error: null });
        try {
            const response = await batchApi.uploadFiles(files);
            set({
                tasks: response.tasks,
                fileNames: response.file_names ?? files.map((f) => f.name),
                status: 'reviewing',
            });
        } catch (err: any) {
            set({
                status: 'error',
                error: err?.response?.data?.detail || err.message || 'Failed to upload files',
            });
        }
    },

    updateTask: (index, updates) => {
        set((state) => {
            const newTasks = [...state.tasks];
            newTasks[index] = { ...newTasks[index], ...updates };
            return { tasks: newTasks };
        });
    },

    removeTask: (index) => {
        set((state) => ({
            tasks: state.tasks.filter((_, i) => i !== index),
        }));
    },

    syncToVikunja: async () => {
        const { tasks } = get();
        if (tasks.length === 0) return;

        set({ status: 'syncing', error: null });
        try {
            const result = await batchApi.syncTasks(tasks);
            set({
                status: 'completed',
                syncResult: result,
            });
        } catch (err: any) {
            set({
                status: 'error',
                error: err.message || 'Failed to sync tasks',
            });
        }
    },

    reset: () => {
        set({
            status: 'idle',
            selectedFiles: [],
            fileNames: [],
            tasks: [],
            syncResult: null,
            error: null,
        });
    },
}));
