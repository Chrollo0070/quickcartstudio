import { create } from 'zustand';
import type { AuthUser } from './api-client';

/**
 * Session state: access token in memory only (survives page navigations via
 * the SPA, not reloads — a reload triggers the httpOnly-cookie refresh flow
 * instead, which is strictly safer than persisting the token).
 */
interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  setSession: (accessToken: string, user: AuthUser) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setSession: (accessToken, user) => set({ accessToken, user }),
  clearSession: () => set({ accessToken: null, user: null }),
}));
