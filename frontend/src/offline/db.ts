/** Dexie-backed local store for offline writes.
 *
 *  Holds a queue of mutations the user performed while offline. Each entry
 *  stores enough information for the sync worker to replay the call once
 *  connectivity is back. We intentionally do NOT cache GET responses here
 *  — Workbox's stale-while-revalidate already handles that.
 *
 *  Conflict resolution: last-write-wins. The server is authoritative; if
 *  a queued write fails because the resource was deleted server-side,
 *  we drop the queued entry rather than re-uploading.
 */
import Dexie, { type Table } from 'dexie';

export type QueuedOpKind =
  | 'item_create'
  | 'item_update'
  | 'item_delete'
  | 'list_reset';

export interface QueuedOp {
  id?: number;
  kind: QueuedOpKind;
  list_id: number;
  /** Item id for *_update / *_delete; for item_create this is the negative
   *  placeholder id assigned client-side so the optimistic list item can
   *  be reconciled with the server response. */
  item_id?: number | null;
  payload: Record<string, unknown>;
  ts: number;
  /** Set when the worker tried this entry and the server rejected it (4xx /
   *  5xx that's not just a transient network error). The user can retry or
   *  discard from the sync-problems UI. */
  failed_reason?: string | null;
  failed_at?: number | null;
  retry_count: number;
}

class LystOfflineDB extends Dexie {
  ops!: Table<QueuedOp, number>;

  constructor() {
    super('lyst-offline');
    this.version(1).stores({
      ops: '++id, kind, list_id, ts, failed_at',
    });
  }
}

export const db = new LystOfflineDB();
