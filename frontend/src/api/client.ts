import axios from 'axios';
import { useAuthStore } from '../store/useAuthStore';

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";

export const client = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// --- Request interceptor: inject Bearer token ---
client.interceptors.request.use((config) => {
    const token = useAuthStore.getState().token;
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// --- Response interceptor: catch 401 → logout ---
client.interceptors.response.use(
    (response) => response,
    (error) => {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
            // Token expired or invalid — clear auth and redirect
            const { isAuthenticated, logout } = useAuthStore.getState();
            console.error("401 Unauthorized - redirecting to login", error);
            if (isAuthenticated) {
                logout();
            }
        }
        return Promise.reject(error);
    },
);

export default client;
