/** Network-first overview refresh hook.
 *
 *  Lyst doesn't use react-query — parents own their data state. This hook
 *  just orchestrates *when* the parent's fetcher should run so every
 *  overview behaves the same way:
 *
 *    1. **Mount**: always fetch fresh from the server. Any cached data
 *       the parent already has in state stays visible during the fetch
 *       (no flash of empty), then gets reconciled on success.
 *    2. **Window focus / tab becomes visible**: refetch (debounced to
 *       avoid storms when focus + visibilitychange both fire).
 *    3. **Cross-component invalidation** via `invalidateOverview(key)`:
 *       every mounted subscriber for that key refetches. Use this from
 *       mutations in a different component / page (delete on detail
 *       page → notes overview refetches when re-mounted, AND the live
 *       overview-while-editor case where the overview never unmounts).
 *    4. **Back-navigation**: handled automatically by (1) — react-router
 *       unmounts inactive routes, so navigating back re-mounts the
 *       overview which re-runs the mount fetch.
 *
 *  Replaces useFreshOnMount; old `invalidateFresh` is re-exported as an
 *  alias so existing call sites keep working unchanged.
 */
import { useCallback, useEffect, useRef } from 'react';

type Fetcher = () => Promise<void> | void;

const subscribers = new Map<string, Set<Fetcher>>();

/** Fetcher runs on mount, on focus/visibility return, and whenever
 *  someone calls `invalidateOverview(key)`. The returned function lets
 *  the caller refetch on demand (e.g. after a manual "reload" tap). */
export function useOverviewQuery(key: string, fetcher: Fetcher): () => void {
  // Stable ref so we don't re-subscribe every render — capture latest
  // fetcher closure so it sees the current props/state.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refetch = useCallback(() => {
    void fetcherRef.current();
  }, []);

  useEffect(() => {
    // 1. Mount fetch — always network-first.
    refetch();

    // 3. Register so cross-component invalidation can ping us.
    let set = subscribers.get(key);
    if (!set) {
      set = new Set();
      subscribers.set(key, set);
    }
    set.add(refetch);

    // 2. Focus / visibility refetch — debounced because focus + the
    //    visibility event often fire within a few ms of each other.
    let lastTriggered = 0;
    const trigger = () => {
      if (Date.now() - lastTriggered < 1500) return;
      lastTriggered = Date.now();
      refetch();
    };
    const onFocus = () => trigger();
    const onVis = () => {
      if (document.visibilityState === 'visible') trigger();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);

    return () => {
      const s = subscribers.get(key);
      s?.delete(refetch);
      if (s && s.size === 0) subscribers.delete(key);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [key, refetch]);

  return refetch;
}

/** Trigger a refetch on every mounted overview registered under `key`.
 *  Call from mutations on detail pages so that when the user navigates
 *  back, the overview already reflects the change — and the mounted-
 *  parallel case (master-detail in one route) updates immediately. */
export function invalidateOverview(key: string): void {
  const set = subscribers.get(key);
  if (!set) return;
  for (const fn of set) {
    try {
      void fn();
    } catch {
      // Subscriber threw — keep iterating; the fetcher's own error
      // handling (toast) is responsible for surfacing.
    }
  }
}

/** Invalidate every key currently registered. Used by the offline sync
 *  queue after replay since one queued op can touch multiple resource
 *  types (e.g. list-item add → list summaries' counters update too). */
export function invalidateAllOverviews(): void {
  for (const set of subscribers.values()) {
    for (const fn of set) {
      try {
        void fn();
      } catch {
        // Same rationale as invalidateOverview.
      }
    }
  }
}
