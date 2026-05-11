import { openDB, type IDBPDatabase } from 'idb';
import { ItemsApi } from '@/api/endpoints';

interface QueuedOp {
  id?: number;
  kind: 'toggle' | 'update';
  list_id: number;
  item_id: number;
  payload: { is_checked?: boolean; text?: string; quantity?: number | null; unit?: string | null };
  ts: number;
}

const DB_NAME = 'lyst-offline';
const STORE = 'ops';

let dbPromise: Promise<IDBPDatabase> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

export async function enqueue(op: Omit<QueuedOp, 'id' | 'ts'>) {
  const d = await db();
  await d.add(STORE, { ...op, ts: Date.now() } as QueuedOp);
}

export async function flush(): Promise<{ ok: number; fail: number }> {
  const d = await db();
  const all = (await d.getAll(STORE)) as QueuedOp[];
  let ok = 0;
  let fail = 0;
  for (const op of all) {
    try {
      await ItemsApi.update(op.list_id, op.item_id, op.payload);
      if (op.id !== undefined) await d.delete(STORE, op.id);
      ok++;
    } catch {
      fail++;
    }
  }
  return { ok, fail };
}

export function setupAutoFlush() {
  const tryFlush = () => {
    if (navigator.onLine) void flush();
  };
  window.addEventListener('online', tryFlush);
  if (navigator.onLine) tryFlush();
}
