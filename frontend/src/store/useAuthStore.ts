/**
 * useAuthStore — Zustand store for JWT authentication state.
 *
 * Persists token + user to localStorage so sessions survive page reloads.
 * Provides login() and logout() actions consumed by the rest of the app.
 */

import { create } from 'zustand';
import type { UserPublic } from '../types/schema';

// ---------------------------------------------------------------------------
// localStorage keys
// ---------------------------------------------------------------------------

const LS_TOKEN_KEY = 'mtv_auth_token';
const LS_USER_KEY = 'mtv_auth_user';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadPersistedToken(): string | null {
    try {
        return localStorage.getItem(LS_TOKEN_KEY);
    } catch {
        return null;
    }
}

function loadPersistedUser(): UserPublic | null {
    try {
        const raw = localStorage.getItem(LS_USER_KEY);
        return raw ? (JSON.parse(raw) as UserPublic) : null;
    } catch {
        return null;
    }
}

function persistAuth(token: string, user: UserPublic): void {
    localStorage.setItem(LS_TOKEN_KEY, token);
    localStorage.setItem(LS_USER_KEY, JSON.stringify(user));
}

function clearPersistedAuth(): void {
    localStorage.removeItem(LS_TOKEN_KEY);
    localStorage.removeItem(LS_USER_KEY);
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface AuthStoreState {
    token: string | null;
    user: UserPublic | null;
    isAuthenticated: boolean;

    /** Set auth state after a successful login API call. */
    login: (token: string, user: UserPublic) => void;

    /** Clear auth state and redirect to /login. */
    logout: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const initialToken = loadPersistedToken();
const initialUser = loadPersistedUser();

export const useAuthStore = create<AuthStoreState>((set) => ({
    token: initialToken,
    user: initialUser,
    isAuthenticated: !!(initialToken && initialUser),

    login: (token, user) => {
        persistAuth(token, user);
        set({ token, user, isAuthenticated: true });
    },

    logout: () => {
        clearPersistedAuth();
        set({ token: null, user: null, isAuthenticated: false });
        // Redirect to login — safe even if already on /login
        if (window.location.pathname !== '/login') {
            window.location.href = '/login';
        }
    },
}));
