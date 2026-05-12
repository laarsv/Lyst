/** Sync-status store. Drives the navbar offline badge, the reconnect
 *  toasts, and the "Sync-Probleme" panel. */
import { create } from 'zustand';

interface State {
  online: boolean;
  /** Number of operations sitting in the offline queue (ALL, including failed). */
  pending: number;
  /** Number of operations that failed at least once and need user attention. */
  failed: number;
  /** True while the worker is currently flushing the queue. */
  syncing: boolean;
  set: (patch: Partial<Omit<State, 'set'>>) => void;
}

export const useSyncStatus = create<State>((set) => ({
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  pending: 0,
  failed: 0,
  syncing: false,
  set: (patch) => set(patch),
}));

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => useSyncStatus.getState().set({ online: true }));
  window.addEventListener('offline', () => useSyncStatus.getState().set({ online: false }));
}
