/** Network-first refresh hook for resource fetches.
 *
 *  Lyst doesn't use react-query — parents own their data state. This hook
 *  just orchestrates *when* the parent's fetcher should run so every
 *  resource read behaves the same way:
 *
 *    1. **Mount**: always fetch fresh from the server. Any cached data
 *       the parent already has in state stays visible during the fetch
 *       (no flash of empty), then gets reconciled on success.
 *    2. **Window focus / tab becomes visible**: refetch (debounced to
 *       avoid storms when focus + visibilitychange both fire).
 *    3. **Cross-component invalidation** via `invalidateOverview(key)`:
 *       every mounted subscriber whose key equals or *starts with*
 *       `key:` refetches. Prefix-matching matters because subscribers
 *       parameterize their key (e.g. `recipes:ALL`, `list-items:123`)
 *       while mutation call sites often pass the bare resource name
 *       (`recipes`, `list-items`). Without prefix matching, the live
 *       subscriber never gets notified and the user sees stale data
 *       until manual reload — the regression we're fixing here.
 *    4. **Route-change**: a top-level listener (`useOverviewRouteRefresh`,
 *       mounted in AppShell) invalidates the relevant overview key when
 *       the user navigates onto its route. Belt-and-suspenders: react-
 *       router DOES re-mount sibling routes today, so (1) covers most
 *       cases — but the listener guards against future refactors that
 *       might keep an overview mounted across routes.
 *
 *  Two exported variants share the same impl:
 *
 *    - `useOverviewQuery`  — list views (notes overview, recipes list, …).
 *    - `useResourceQuery`  — detail views (one list, one recipe, …).
 *
 *  The only difference is the dev-console log prefix (`[overview]` vs
 *  `[detail]`) so a developer can tell at a glance which surface fired
 *  a refetch.
 *
 *  Dev-mode logging: every trigger (mount / focus / visibility / invalidate
 *  / route) logs to the console under `[overview]` or `[detail]` so we
 *  can verify in the browser console that invalidation is firing.
 */
import { useCallback, useEffect, useRef } from 'react';

type Fetcher = () => Promise<void> | void;
type Kind = 'overview' | 'detail';

interface Subscriber {
  key: string;
  fetcher: Fetcher;
  kind: Kind;
}

const subscribers = new Set<Subscriber>();

const isDev = (() => {
  try {
    return import.meta.env?.DEV === true;
  } catch {
    return false;
  }
})();

function devLog(kind: Kind, reason: string, key: string): void {
  if (!isDev) return;
  // eslint-disable-next-line no-console
  console.log(`[${kind}] ${reason} → refetch(${key})`);
}

/** Internal impl shared by `useOverviewQuery` and `useResourceQuery`.
 *  The `kind` arg only affects the dev-log prefix; subscription /
 *  invalidation semantics are identical so a single mutation can
 *  refresh both overviews AND open detail views in one call. */
function useResourceQueryImpl(key: string, fetcher: Fetcher, kind: Kind): () => void {
  // Stable ref so we don't re-subscribe every render — capture latest
  // fetcher closure so it sees the current props/state.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refetch = useCallback(() => {
    void fetcherRef.current();
  }, []);

  useEffect(() => {
    // 1. Mount fetch — always network-first.
    devLog(kind, 'mount', key);
    refetch();

    // 3. Register so cross-component invalidation can ping us.
    const sub: Subscriber = { key, fetcher: refetch, kind };
    subscribers.add(sub);

    // 2. Focus / visibility refetch — debounced because focus + the
    //    visibility event often fire within a few ms of each other.
    let lastTriggered = 0;
    const trigger = (reason: string) => {
      if (Date.now() - lastTriggered < 1500) return;
      lastTriggered = Date.now();
      devLog(kind, reason, key);
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
  }, [key, refetch, kind]);

  return refetch;
}

/** Network-first overview subscription. Fetcher runs on mount, on
 *  focus/visibility return, and whenever `invalidateOverview(key)`
 *  matches. Used by list-view pages (notes overview, recipes list, …). */
export function useOverviewQuery(key: string, fetcher: Fetcher): () => void {
  return useResourceQueryImpl(key, fetcher, 'overview');
}

/** Same contract as `useOverviewQuery`, surfaced under a different log
 *  prefix so detail-page refetches are visually distinct in the dev
 *  console. Use from detail pages (one-list, one-recipe, one-week of
 *  meal plan) where every mount should pull fresh server data —
 *  otherwise the SW SWR cache would feed React a stale snapshot. */
export function useResourceQuery(key: string, fetcher: Fetcher): () => void {
  return useResourceQueryImpl(key, fetcher, 'detail');
}

/** Trigger a refetch on every mounted subscriber whose key equals `key`
 *  exactly OR starts with `${key}:` (prefix-matching).
 *
 *  This is the contract every mutation should use: pass the bare
 *  resource name (`'recipes'`, `'lists'`, `'notes'`, `'mealplans'`,
 *  `'list-items'`), and we'll find every parameterized subscriber
 *  under it. Use from mutations on detail pages so that when the user
 *  navigates back, the overview already reflects the change — and the
 *  mounted-parallel case (master-detail in one route) updates
 *  immediately. */
export function invalidateOverview(key: string): void {
  const prefix = `${key}:`;
  let count = 0;
  for (const sub of subscribers) {
    if (sub.key !== key && !sub.key.startsWith(prefix)) continue;
    count++;
    devLog(sub.kind, `invalidate(${key})`, sub.key);
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
    devLog(sub.kind, 'invalidateAll', sub.key);
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
        devLog('overview', `route(${pathname})`, r.key);
        invalidateOverview(r.key);
      }
    }
  }, [pathname]);
}
