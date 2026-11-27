import { create } from 'zustand';
import type { AuthUser } from '../types/api';

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isInitialized: boolean;
  setSession: (payload: {
    user: AuthUser;
    accessToken: string;
    refreshToken?: string | null;
  }) => void;
  setUser: (user: AuthUser | null) => void;
  setInitialized: (initialized: boolean) => void;
  logout: () => void;
}

const STORAGE_KEY = 'meecargo_auth_session';

function readStoredSession(): {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { user: null, accessToken: null, refreshToken: null };
    const parsed = JSON.parse(raw) as {
      user?: AuthUser;
      accessToken?: string;
      refreshToken?: string | null;
    };
    if (
      parsed?.user &&
      parsed?.accessToken &&
      (parsed.user.role === 'SHIPPER' || parsed.user.role === 'DRIVER')
    ) {
      return {
        user: parsed.user,
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken ?? null,
      };
    }
    return { user: null, accessToken: null, refreshToken: null };
  } catch {
    return { user: null, accessToken: null, refreshToken: null };
  }
}

const initial = readStoredSession();

export const useAuthStore = create<AuthState>((set, get) => ({
  user: initial.user,
  accessToken: initial.accessToken,
  refreshToken: initial.refreshToken,
  isInitialized: !initial.accessToken,
  setSession: ({ user, accessToken, refreshToken }) => {
    const nextRefresh =
      refreshToken !== undefined ? refreshToken : get().refreshToken;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ user, accessToken, refreshToken: nextRefresh })
    );
    set({
      user,
      accessToken,
      refreshToken: nextRefresh,
      isInitialized: true,
    });
  },
  setUser: (user) => {
    const { accessToken, refreshToken } = get();
    if (user && accessToken) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ user, accessToken, refreshToken })
      );
    } else if (!user) {
      localStorage.removeItem(STORAGE_KEY);
    }
    set({ user, isInitialized: true });
  },
  setInitialized: (isInitialized) => set({ isInitialized }),
  logout: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      isInitialized: true,
    });
  },
}));
