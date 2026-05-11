import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Role } from '@/types';

interface AuthState {
  accessToken: string | null;
  userId: number | null;
  email: string | null;
  name: string | null;
  role: Role | null;
  setAuth: (payload: {
    accessToken: string;
    userId: number;
    email: string;
    name: string;
    role: Role;
  }) => void;
  setAccessToken: (token: string) => void;
  setProfile: (payload: { name?: string; email?: string }) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      userId: null,
      email: null,
      name: null,
      role: null,
      setAuth: (p) =>
        set({
          accessToken: p.accessToken,
          userId: p.userId,
          email: p.email,
          name: p.name,
          role: p.role,
        }),
      setAccessToken: (token) => set({ accessToken: token }),
      setProfile: ({ name, email }) =>
        set((s) => ({ name: name ?? s.name, email: email ?? s.email })),
      clear: () =>
        set({ accessToken: null, userId: null, email: null, name: null, role: null }),
    }),
    {
      name: 'lyst-auth',
      partialize: (s) => ({
        userId: s.userId,
        email: s.email,
        name: s.name,
        role: s.role,
      }),
    },
  ),
);
