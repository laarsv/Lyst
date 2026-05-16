/** Notification feed store.
 *
 *  Holds the most recent 20 entries + the unread badge count.
 *  Two write paths feed it:
 *
 *    - Initial fetch + cross-component refresh via NotificationsApi.list
 *      (mount inside AppShell + on focus return).
 *    - Real-time push via useUserWebSocket: each notification event
 *      from the per-user channel calls `prepend` with the new row,
 *      which both adds it to the dropdown list and increments the
 *      badge.
 *
 *  Mark-read paths optimistically flip read_at + decrement the
 *  badge, with rollback on API failure. */
import { create } from 'zustand';
import type { NotificationRow } from '@/api/endpoints';

interface State {
  items: NotificationRow[];
  unreadCount: number;
  loaded: boolean;
  set: (rows: NotificationRow[], unreadCount: number) => void;
  prepend: (row: NotificationRow) => void;
  markRead: (id: number) => void;
  markAllRead: () => void;
}

export const useNotificationsStore = create<State>((set) => ({
  items: [],
  unreadCount: 0,
  loaded: false,
  set: (rows, unreadCount) =>
    set({ items: rows, unreadCount, loaded: true }),
  prepend: (row) =>
    set((s) => {
      // Dedup: if the same id already exists (e.g. a server-push that
      // races a fetch), drop the old copy.
      const without = s.items.filter((x) => x.id !== row.id);
      return {
        items: [row, ...without].slice(0, 20),
        unreadCount: row.read_at ? s.unreadCount : s.unreadCount + 1,
      };
    }),
  markRead: (id) =>
    set((s) => {
      const items = s.items.map((x) =>
        x.id === id && !x.read_at
          ? { ...x, read_at: new Date().toISOString() }
          : x,
      );
      const wasUnread = s.items.some((x) => x.id === id && !x.read_at);
      return {
        items,
        unreadCount: wasUnread ? Math.max(0, s.unreadCount - 1) : s.unreadCount,
      };
    }),
  markAllRead: () =>
    set((s) => ({
      items: s.items.map((x) =>
        x.read_at ? x : { ...x, read_at: new Date().toISOString() },
      ),
      unreadCount: 0,
    })),
}));
