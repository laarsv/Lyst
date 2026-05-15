import axios, { AxiosError, type AxiosInstance } from 'axios';
import { useAuthStore } from '@/store/auth';
import { getClientId } from '@/lib/clientId';

const API_BASE = '/api';

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Tag every request with this tab's client id so the backend's WebSocket
  // broadcaster can skip echoing the change back to us.
  config.headers['X-Client-Id'] = getClientId();
  return config;
});

let refreshPromise: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const r = await axios.post<{ data: { access_token: string }; error: string | null }>(
        `${API_BASE}/auth/refresh`,
        {},
        { withCredentials: true },
      );
      const token = r.data.data?.access_token ?? null;
      if (token) useAuthStore.getState().setAccessToken(token);
      return token;
    } catch {
      useAuthStore.getState().clear();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

/** Invalidate Service Worker cache entries for a given API path family.
 * After a mutation (POST/PATCH/DELETE) the stale-while-revalidate cache
 * would otherwise hand stale rows to the next GET on the same collection,
 * making deletions/edits "stick" only after a manual reload.
 */
async function invalidateSwCacheFor(url: string): Promise<void> {
  if (typeof caches === 'undefined') return;
  // Anchor on the collection prefix: /api/lists/123 -> /api/lists, /api/notes/4 -> /api/notes
  const m = url.match(/^(\/api\/[^/?#]+)/);
  if (!m) return;
  const prefix = m[1];
  try {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith('lyst-'))
        .map(async (name) => {
          const cache = await caches.open(name);
          const keys = await cache.keys();
          await Promise.all(
            keys
              .filter((req) => new URL(req.url).pathname.startsWith(prefix))
              .map((req) => cache.delete(req)),
          );
        }),
    );
  } catch {
    // Cache invalidation is a best-effort optimization.
  }
}

api.interceptors.response.use(
  async (r) => {
    // Await SW-cache invalidation BEFORE resolving the response. Fire-and-
    // forget (void) lost a race against StaleWhileRevalidate: the calling
    // mutation handler proceeded to navigate/invalidate-overview while
    // /api/lists or /api/notes was still cached. The next GET then hit the
    // stale SW response and the UI showed pre-mutation data. Awaiting
    // here closes that window — by the time `await ListsApi.remove(...)`
    // resolves, the SW cache is guaranteed purged for that collection.
    const method = r.config.method?.toUpperCase();
    if (method && method !== 'GET' && r.config.url) {
      await invalidateSwCacheFor(r.config.url);
    }
    return r;
  },
  async (error: AxiosError) => {
    const cfg: any = error.config;
    if (
      error.response?.status === 401 &&
      cfg &&
      !cfg._retry &&
      !cfg.url?.includes('/auth/login') &&
      !cfg.url?.includes('/auth/refresh')
    ) {
      cfg._retry = true;
      const token = await tryRefresh();
      if (token) {
        cfg.headers = cfg.headers ?? {};
        cfg.headers.Authorization = `Bearer ${token}`;
        return api.request(cfg);
      }
    }
    return Promise.reject(error);
  },
);

export function getApiError(e: unknown, fallback = 'Etwas ist schiefgelaufen'): string {
  if (axios.isAxiosError(e)) {
    const detail = e.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    const err = e.response?.data?.error;
    if (typeof err === 'string') return err;
    return e.message || fallback;
  }
  return fallback;
}
