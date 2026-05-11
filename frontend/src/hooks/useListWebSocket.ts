import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { getClientId } from '@/lib/clientId';
import type { ListItem } from '@/types';

export type WsMessage =
  | { type: 'item_created'; payload: ListItem }
  | { type: 'item_updated'; payload: ListItem }
  | { type: 'item_deleted'; payload: { id: number } }
  | { type: 'item_reordered'; payload: Array<{ id: number; position: number }> }
  | { type: 'list_reset'; payload: Record<string, never> };

interface Options {
  onMessage: (msg: WsMessage) => void;
  /** Called every 10 s while the WebSocket is disconnected. Use it to
   *  refetch as a fallback so users still see eventually-consistent data. */
  onPollWhileDisconnected?: () => void;
}

const POLL_INTERVAL_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;

export function useListWebSocket(listId: number, opts: Options): boolean {
  const [connected, setConnected] = useState(false);

  // Keep callbacks in refs so the WebSocket effect doesn't reconnect on
  // every render of the parent.
  const onMessageRef = useRef(opts.onMessage);
  const onPollRef = useRef(opts.onPollWhileDisconnected);
  useEffect(() => {
    onMessageRef.current = opts.onMessage;
  }, [opts.onMessage]);
  useEffect(() => {
    onPollRef.current = opts.onPollWhileDisconnected;
  }, [opts.onPollWhileDisconnected]);

  useEffect(() => {
    if (!Number.isFinite(listId)) return;

    let ws: WebSocket | null = null;
    let pollTimer: number | null = null;
    let reconnectTimer: number | null = null;
    let cancelled = false;
    let attempt = 0;

    const startPolling = () => {
      if (pollTimer != null) return;
      pollTimer = window.setInterval(() => {
        onPollRef.current?.();
      }, POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      if (pollTimer != null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const connect = () => {
      if (cancelled) return;
      const token = useAuthStore.getState().accessToken;
      if (!token) {
        // Auth not bootstrapped yet — try again shortly.
        reconnectTimer = window.setTimeout(connect, 1000);
        return;
      }
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url =
        `${proto}//${window.location.host}/ws/lists/${listId}` +
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
        stopPolling();
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as WsMessage;
          onMessageRef.current(msg);
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        startPolling();
        scheduleReconnect();
      };
      ws.onerror = () => {
        // close handler will run after error — let that drive the recovery
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
      stopPolling();
      if (ws) {
        // Detach handlers so the close handler doesn't try to reconnect.
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        try { ws.close(); } catch { /* ignore */ }
      }
    };
  }, [listId]);

  return connected;
}
