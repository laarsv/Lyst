/** Stale-aware fetch-on-mount.
 *
 *  Lyst doesn't use react-query, so cache "invalidation" boils down to
 *  re-running the fetch. This hook tracks the last successful fetch
 *  timestamp per cache key and refetches on mount only when the data is
 *  older than a TTL — by default 10 seconds.
 *
 *  Use case: the user navigates Detail → deletes an item → back to
 *  overview. The overview's useEffect already fetches on mount, but with
 *  no TTL we'd refetch even on the cheap "tap title to enter detail and
 *  immediately back" case. With TTL we skip the redundant call.
 *
 *  Mutation flow:
 *    1. Mutation runs (delete / update title / etc.)
 *    2. Caller invokes `invalidateFresh('lists')`
 *    3. Caller navigates to /
 *    4. Overview mounts → useFreshOnMount sees the timestamp is gone
 *       → calls fetcher → marks fresh again on success
 *
 *  The store is a plain module-level Map — no React state, no zustand
 *  subscription. It survives across navigations within the SPA but is
 *  cleared on a full page reload (which is exactly what you want).
 */
import { useEffect } from 'react';

const lastFetched = new Map<string, number>();

/** Fetch on mount, but only when the cached timestamp for `key` is older
 *  than `ttlMs`. The fetcher's success marks the key fresh; a thrown
 *  error leaves the timestamp untouched so the next mount retries. */
export function useFreshOnMount(
  key: string,
  fetcher: () => void | Promise<unknown>,
  ttlMs = 10_000,
): void {
  useEffect(() => {
    const last = lastFetched.get(key) ?? 0;
    if (Date.now() - last < ttlMs) return;

    let cancelled = false;
    void Promise.resolve(fetcher())
      .then(() => {
        if (!cancelled) lastFetched.set(key, Date.now());
      })
      .catch(() => {
        // Intentionally don't mark fresh on failure — next mount retries.
      });
    return () => {
      cancelled = true;
    };
    // The fetcher captured here is the one at mount time; we deliberately
    // ignore changes to avoid refiring on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** Drop the cached timestamp for `key` so the next overview mount refetches.
 *  Call this from mutations that change what the overview shows
 *  (delete list, rename note, archive recipe, etc.). */
export function invalidateFresh(key: string): void {
  lastFetched.delete(key);
}

/** Manually mark a key fresh — useful when the parent already has the
 *  current data in memory (e.g. after an optimistic create) and wants to
 *  prevent the next mount from re-fetching for the TTL window. */
export function markFresh(key: string): void {
  lastFetched.set(key, Date.now());
}

/** Drop every cached timestamp. Mostly useful in tests or after auth flips. */
export function clearAllFreshness(): void {
  lastFetched.clear();
}
