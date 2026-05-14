/** Sync-queue worker.
 *
 *  - `enqueue()` is called by the API layer when an item mutation is made
 *    while we believe we're offline (or when a request just failed with
 *    a network-style error).
 *  - On `online`, the worker drains the queue in insertion order.
 *  - Each op is replayed via the live API client; success → removed from
 *    queue. 4xx other than 401 means "permanent fail" → leave with
 *    failed_reason for the UI; transient errors leave the entry alone so
 *    a future flush retries it.
 */
import { api } from '@/api/client';
import { invalidateAllOverviews } from '@/hooks/useOverviewQuery';
import { db, type QueuedOp, type QueuedOpKind } from './db';
import { useSyncStatus } from './status';

type ToastFn = (text: string) => void;

let toaster: { success: ToastFn; error: ToastFn; info: ToastFn } = {
  success: () => undefined,
  error: () => undefined,
  info: () => undefined,
};

let inFlight = false;

export function setToaster(t: typeof toaster) {
  toaster = t;
}

async function refreshCounters(): Promise<void> {
  const all = await db.ops.toArray();
  useSyncStatus.getState().set({
    pending: all.length,
    failed: all.filter((o) => o.failed_reason).length,
  });
}

export async function enqueue(
  op: Omit<QueuedOp, 'id' | 'ts' | 'retry_count' | 'failed_reason' | 'failed_at'>,
): Promise<number> {
  const id = await db.ops.add({
    ...op,
    ts: Date.now(),
    retry_count: 0,
    failed_reason: null,
    failed_at: null,
  } as QueuedOp);
  await refreshCounters();
  return id as number;
}

export async function listQueue(): Promise<QueuedOp[]> {
  return db.ops.orderBy('ts').toArray();
}

export async function discard(id: number): Promise<void> {
  await db.ops.delete(id);
  await refreshCounters();
}

export async function discardAllFailed(): Promise<void> {
  await db.ops.filter((o) => !!o.failed_reason).delete();
  await refreshCounters();
}

export async function retry(id: number): Promise<void> {
  await db.ops.update(id, { failed_reason: null, failed_at: null });
  await flush();
}

const PATHS: Record<QueuedOpKind, (op: QueuedOp) => { method: string; url: string; body?: unknown }> = {
  item_create: (op) => ({
    method: 'POST',
    url: `/lists/${op.list_id}/items`,
    body: op.payload,
  }),
  item_update: (op) => ({
    method: 'PATCH',
    url: `/lists/${op.list_id}/items/${op.item_id}`,
    body: op.payload,
  }),
  item_delete: (op) => ({
    method: 'DELETE',
    url: `/lists/${op.list_id}/items/${op.item_id}`,
  }),
  list_reset: (op) => ({ method: 'POST', url: `/lists/${op.list_id}/reset` }),
};

async function replay(op: QueuedOp): Promise<{ ok: boolean; permanentFail?: string; data?: any }> {
  const desc = PATHS[op.kind](op);
  try {
    const res = await api.request({
      method: desc.method,
      url: desc.url,
      data: desc.body,
    });
    return { ok: true, data: res.data?.data };
  } catch (e: any) {
    const status = e?.response?.status;
    // 4xx (except 401, which the auth interceptor refreshes) means the
    // server permanently rejects this op. 401 / network errors stay
    // pending so a future flush retries them.
    if (status && status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429) {
      return { ok: false, permanentFail: e?.response?.data?.detail || `HTTP ${status}` };
    }
    return { ok: false };
  }
}

export async function flush(): Promise<{ replayed: number; failed: number }> {
  if (inFlight) return { replayed: 0, failed: 0 };
  inFlight = true;
  useSyncStatus.getState().set({ syncing: true });
  let replayed = 0;
  let failed = 0;
  try {
    const ops = await db.ops.orderBy('ts').toArray();
    for (const op of ops) {
      // Skip ops that are already marked as permanently failed unless the
      // user explicitly retried them (which clears failed_reason).
      if (op.failed_reason) continue;
      const r = await replay(op);
      if (r.ok) {
        if (op.id !== undefined) await db.ops.delete(op.id);
        replayed++;
      } else if (r.permanentFail) {
        failed++;
        if (op.id !== undefined) {
          await db.ops.update(op.id, {
            failed_reason: r.permanentFail,
            failed_at: Date.now(),
            retry_count: (op.retry_count ?? 0) + 1,
          });
        }
      } else {
        // Transient error — bail out and try again next time the queue is flushed.
        break;
      }
    }
  } finally {
    inFlight = false;
    useSyncStatus.getState().set({ syncing: false });
    await refreshCounters();
  }
  if (replayed > 0) {
    toaster.success('Alle Änderungen gespeichert');
    // A queued op can affect any overview (list summary counters,
    // recipe ingredient counts, etc.) — easiest correct thing is to
    // refetch every mounted overview instead of guessing which keys
    // might be stale.
    invalidateAllOverviews();
  }
  if (failed > 0) toaster.error(`${failed} Änderung${failed === 1 ? '' : 'en'} konnten nicht synchronisiert werden`);
  return { replayed, failed };
}

export function setupAutoFlush(): void {
  // Initial: load counters so the badge is right immediately on app boot.
  void refreshCounters();
  const tryFlush = () => {
    if (navigator.onLine) {
      // Tiny delay so the network stack settles.
      setTimeout(() => {
        void flush();
      }, 250);
      toaster.info('Wieder online — Änderungen werden synchronisiert');
    }
  };
  window.addEventListener('online', tryFlush);
  if (navigator.onLine) {
    // Don't toast on app boot, just attempt a quiet flush.
    setTimeout(() => {
      void flush();
    }, 800);
  }
}

/** Allocate a placeholder id for an optimistic item insert. Negative so it
 *  can never collide with a server-assigned positive int.
 *  The returned number stays stable for that op so we can reconcile when
 *  the real id comes back. */
let nextTempId = -1;
export function nextTempItemId(): number {
  return nextTempId--;
}
