/** Per-user WebSocket — one connection per session, mounted in
 *  AppShell post-login.
 *
 *  Receives events the backend fans out from /ws/user for any
 *  mutation that touches a resource the current user can see:
 *  notes / lists / list-items / shares (and, as backend coverage
 *  expands, recipes + notifications). Dispatches each event to the
 *  matching overview-cache invalidation so the next render of that
 *  overview shows fresh data.
 *
 *  Reconnect: exponential backoff with a 30 s ceiling, same shape
 *  as useListWebSocket. On every reconnect we invalidate ALL
 *  mounted overviews — the simplest "what did I miss?" recovery.
 *
 *  Echo suppression: the connection ships its client_id query
 *  param; the backend skips broadcasts that match (the tab that
 *  made the change doesn't get an echo back, avoiding refetch
 *  loops).
 */
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { getClientId } from '@/lib/clientId';
import {
  invalidateAllOverviews,
  invalidateOverview,
} from '@/hooks/useOverviewQuery';
import { toast } from '@/components/Toast';

const MAX_BACKOFF_MS = 30_000;

export interface UserEvent {
  event: string;
  resource_type:
    | 'note'
    | 'list'
    | 'list_item'
    | 'recipe'
    | 'share'
    | 'notification';
  resource_id: number;
  parent_id: number | null;
  actor_id: number;
  timestamp: string;
  payload: Record<string, unknown> | null;
}

function dispatchEvent(ev: UserEvent): void {
  const log = (msg: string) => {
    // Dev-mode trace, same channel useOverviewQuery uses so the
    // browser console tells one story across mechanisms.
    try {
      if (import.meta.env?.DEV) {
        // eslint-disable-next-line no-console
        console.log(`[user-ws] ${msg}`, ev);
      }
    } catch {
      /* prod */
    }
  };

  switch (ev.resource_type) {
    case 'note':
      log(`${ev.event} note=${ev.resource_id}`);
      // The notes overview keys under `notes:<scope>:<folder>:<tag>`;
      // invalidateOverview('notes') prefix-matches them all.
      invalidateOverview('notes');
      // The /tasks aggregator surfaces note-task rows too; an
      // editor save that changed task text wants the global view
      // to refresh.
      invalidateOverview('tasks');
      // Detail: deep-linked-archived-note fallback subscribers under
      // `note:${id}` re-fetch — without this the fallback note went
      // stale after the first paint.
      invalidateOverview(`note:${ev.resource_id}`);
      if (ev.event === 'note.updated') {
        // Fan a CustomEvent at the editor pane(s). The note-conflict
        // banner subscribes via window.addEventListener — it filters
        // by noteId + actorId so a save bouncing back from another
        // device of the same user (X-Client-Id collision misses)
        // doesn't trigger a false "Neu laden?" prompt.
        try {
          window.dispatchEvent(
            new CustomEvent('lyst:note-updated', {
              detail: {
                noteId: ev.resource_id,
                actorId: ev.actor_id,
              },
            }),
          );
        } catch {
          /* CustomEvent unsupported — rare; banner just won't appear */
        }
      }
      if (ev.event === 'note.deleted') {
        // No targeted "got deleted" handler yet — the open note's
        // detail page will hit a 404 on its next refetch and route
        // back to /notes via existing error handling.
      }
      break;

    case 'list':
      log(`${ev.event} list=${ev.resource_id}`);
      invalidateOverview('lists');
      invalidateOverview('templates');
      // Detail page: if the user has /lists/<resource_id> open, refresh
      // its metadata. Prefix-match catches the parameterized subscriber.
      invalidateOverview(`list-detail:${ev.resource_id}`);
      // Meal planner sidebar has a recipes overview, not lists —
      // skip it.
      break;

    case 'list_item':
      log(`${ev.event} list_item=${ev.resource_id} parent=${ev.parent_id}`);
      // The lists overview shows per-list progress; any item
      // change can shift the counter. Invalidate to keep cards
      // current.
      invalidateOverview('lists');
      invalidateOverview('tasks');
      // Detail page: per-list /ws/lists/{id} channel handles the
      // incremental DOM update, but if the user reached this list via
      // an offline-replay on another device the per-list channel may
      // not have been live yet. Ping the detail subscriber so it
      // re-fetches authoritative items.
      if (ev.parent_id != null) {
        invalidateOverview(`list-detail:${ev.parent_id}`);
      }
      break;

    case 'recipe':
      log(`${ev.event} recipe=${ev.resource_id}`);
      invalidateOverview('recipes');
      invalidateOverview('mealplans');
      // Detail: open recipe page refreshes if it matches.
      invalidateOverview(`recipe:${ev.resource_id}`);
      break;

    case 'share':
      // A share was created/revoked. The recipient (the only audience
      // for this event) wants the relevant overview refreshed so the
      // new (or removed) item appears. payload.title carries the
      // resource title for the toast.
      log(`${ev.event} ${ev.resource_id}`);
      if (ev.event === 'share.created') {
        const actorName = (ev.payload?.actor_name as string) || 'Jemand';
        const title = (ev.payload?.title as string) || '';
        toast.info(`${actorName} hat „${title}" mit dir geteilt`);
      }
      // We don't know which exact overview the resource belongs to
      // without inspecting more payload data — invalidating the
      // notes + recipes + lists overviews is cheap and covers the
      // surface.
      invalidateOverview('notes');
      invalidateOverview('recipes');
      invalidateOverview('lists');
      break;

    case 'notification':
      log(`${ev.event} notification ${ev.resource_id}`);
      // Backend (notification_service.create_notification) ships the
      // freshly inserted row inside payload — same shape as the
      // GET /notifications response. Push it onto the bell store so
      // the badge + dropdown update without a refetch.
      {
        const row = ev.payload as
          | {
              id?: number;
              kind?: string;
              payload?: Record<string, unknown>;
              created_at?: string;
              read_at?: string | null;
            }
          | null;
        if (row && typeof row.id === 'number' && typeof row.kind === 'string') {
          import('@/store/notifications')
            .then(({ useNotificationsStore }) => {
              useNotificationsStore.getState().prepend({
                id: row.id!,
                kind: row.kind!,
                payload: row.payload ?? {},
                created_at: row.created_at ?? new Date().toISOString(),
                read_at: row.read_at ?? null,
              });
            })
            .catch(() => {
              /* dynamic-import failure is harmless; next mount refetch will catch up */
            });
        }
      }
      break;

    default:
      log(`unhandled ${(ev as { resource_type: string }).resource_type}`);
  }
}

export function useUserWebSocket(): boolean {
  const [connected, setConnected] = useState(false);

  // Track whether we've ever connected — so the FIRST connect doesn't
  // fire a "what did I miss?" sweep (mount-fetch in each overview
  // already handles initial load).
  const everConnected = useRef(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let cancelled = false;
    let attempt = 0;

    const connect = () => {
      if (cancelled) return;
      const token = useAuthStore.getState().accessToken;
      if (!token) {
        // Auth not bootstrapped yet — wait and retry. Same dance as
        // the per-list WS hook.
        reconnectTimer = window.setTimeout(connect, 1000);
        return;
      }
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url =
        `${proto}//${window.location.host}/ws/user` +
        `?token=${encodeURIComponent(token)}` +
        `&client_id=${encodeURIComponent(getClientId())}`;
      try {
        ws = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        if (everConnected.current) {
          // Recovery sweep: events we missed while disconnected are
          // lost — refetch every mounted overview so state catches up.
          // No-op on initial connect since each overview's mount-
          // fetch already handles the first paint.
          try {
            invalidateAllOverviews();
          } catch {
            /* dev-only logging in invalidateOverview swallows its own errors */
          }
        }
        everConnected.current = true;
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as UserEvent;
          dispatchEvent(msg);
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        scheduleReconnect();
      };
      ws.onerror = () => {
        // close handler runs after — let it drive recovery.
      };
    };

    const scheduleReconnect = () => {
      attempt += 1;
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempt, 5));
      reconnectTimer = window.setTimeout(connect, delay);
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  return connected;
}
