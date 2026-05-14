/** Compatibility shim — superseded by useOverviewQuery.
 *
 *  Old call sites use `invalidateFresh(key)` from mutations to mark an
 *  overview's cache stale. Under the new model that's the same as
 *  asking every mounted overview for that key to refetch, so this just
 *  re-exports `invalidateOverview` under the old name.
 *
 *  Don't add new callers of useFreshOnMount — use useOverviewQuery on
 *  the overview side instead. */
export { invalidateOverview as invalidateFresh } from './useOverviewQuery';
