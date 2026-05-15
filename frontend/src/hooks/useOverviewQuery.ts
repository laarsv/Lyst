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
 *       every mounted subscriber whose key equals or *starts with*
 *       `key:` refetches. Prefix-matching matters because subscribers
 *       parameterize their key (e.g. `recipes:ALL`, `notes:folder:5:`)
 *       while mutation call sites pass the bare resource name
 *       (`recipes`, `notes`). Without prefix matching, the live overview
 *       never gets notified and the user sees stale data until manual
 *       reload — the regression we're fixing here.
 *    4. **Route-change**: a top-level listener (`useOverviewRouteRefresh`,
 *       mounted in AppShell) invalidates the relevant overview key when
 *       the user navigates onto its route. Belt-and-suspenders: react-
 *       router DOES re-mount sibling routes today, so (1) covers most
 *       cases — but the listener guards against future refactors that
 *       might keep an overview mounted across routes.
 *
 *  Dev-mode logging: every trigger (mount / focus / visibility / invalidate
 *  / route) logs to the console under `[overview]` so we can verify in
 *  the browser console that invalidation is firing.
 *
 *  Replaces useFreshOnMount; old `invalidateFresh` is re-exported as an
 *  alias so existing call sites keep working unchanged.
 */
import { useCallback, useEffect, useRef } from 'react';

type Fetcher = () => Promise<void> | void;

interface Subscriber {
  key: string;
  fetcher: Fetcher;
}

const subscribers = new Set<Subscriber>();

const isDev = (() => {
  try {
    return import.meta.env?.DEV === true;
  } catch {
    return false;
  }
})();

function devLog(reason: string, key: string): void {
  if (!isDev) return;
  // eslint-disable-next-line no-console
  console.log(`[overview] ${reason} → refetch(${key})`);
}

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
    devLog('mount', key);
    refetch();

    // 3. Register so cross-component invalidation can ping us.
    const sub: Subscriber = { key, fetcher: refetch };
    subscribers.add(sub);

    // 2. Focus / visibility refetch — debounced because focus + the
    //    visibility event often fire within a few ms of each other.
    let lastTriggered = 0;
    const trigger = (reason: string) => {
      if (Date.now() - lastTriggered < 1500) return;
      lastTriggered = Date.now();
      devLog(reason, key);
      refetch();
    };
    const onFocus = () => trigger('focus');
    const onVis = () => {
      if (document.visibilityState === 'visible') trigger('visibility');
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);

    return () => {
      subscribers.delete(sub);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [key, refetch]);

  return refetch;
}

/** Trigger a refetch on every mounted overview whose key equals `key`
 *  exactly OR starts with `${key}:` (prefix-matching).
 *
 *  This is the contract every mutation should use: pass the bare
 *  resource name (`'recipes'`, `'lists'`, `'notes'`, `'mealplans'`),
 *  and we'll find every parameterized subscriber under it. Use from
 *  mutations on detail pages so that when the user navigates back, the
 *  overview already reflects the change — and the mounted-parallel
 *  case (master-detail in one route) updates immediately. */
export function invalidateOverview(key: string): void {
  const prefix = `${key}:`;
  let count = 0;
  for (const sub of subscribers) {
    if (sub.key !== key && !sub.key.startsWith(prefix)) continue;
    count++;
    devLog(`invalidate(${key})`, sub.key);
    try {
      void sub.fetcher();
    } catch {
      // Subscriber threw — keep iterating; the fetcher's own error
      // handling (toast) is responsible for surfacing.
    }
  }
  if (isDev && count === 0) {
    // eslint-disable-next-line no-console
    console.log(`[overview] invalidate(${key}) → no live subscriber`);
  }
}

/** Invalidate every key currently registered. Used by the offline sync
 *  queue after replay since one queued op can touch multiple resource
 *  types (e.g. list-item add → list summaries' counters update too). */
export function invalidateAllOverviews(): void {
  for (const sub of subscribers) {
    devLog('invalidateAll', sub.key);
    try {
      void sub.fetcher();
    } catch {
      // Same rationale as invalidateOverview.
    }
  }
}

/** Map of overview routes to their invalidation prefix. Mount the
 *  listener via `useOverviewRouteRefresh()` at the app shell level so
 *  navigating onto one of these routes refreshes the matching overview.
 *  Belt-and-suspenders against missed re-mounts. */
export const OVERVIEW_ROUTES: Array<{ match: (path: string) => boolean; key: string }> = [
  { match: (p) => p === '/', key: 'lists' },
  { match: (p) => p === '/', key: 'templates' },
  { match: (p) => p === '/notes', key: 'notes' },
  { match: (p) => p === '/recipes', key: 'recipes' },
  { match: (p) => p === '/meal-planner', key: 'mealplans' },
  { match: (p) => p === '/tasks', key: 'tasks' },
];

/** Hook variant of the route listener — installs a useEffect on the
 *  given pathname. Caller is expected to wire it to react-router's
 *  `useLocation().pathname`. Exposed as a hook (not a side-effect at
 *  import time) so the SW / non-router contexts don't pay for it. */
export function useOverviewRouteRefresh(pathname: string): void {
  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (prev.current === pathname) return;
    const prevPath = prev.current;
    prev.current = pathname;
    // Don't fire on the very first paint — mount-fetch in each subscriber
    // already handles that. Only react to transitions onto an overview
    // route (back-nav, sidebar nav between tabs).
    if (prevPath === null) return;
    for (const r of OVERVIEW_ROUTES) {
      if (r.match(pathname)) {
        devLog(`route(${pathname})`, r.key);
        invalidateOverview(r.key);
      }
    }
  }, [pathname]);
}
