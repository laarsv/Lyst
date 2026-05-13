/** Notes-page filter state, persisted across navigation within a session.
 *
 *  Lives in zustand (not the page's local state) so the user's selected
 *  folder, tag, and archive toggle survive a trip to /lists and back —
 *  same reason the recipe filters are not stored locally to a page mount. */
import { create } from 'zustand';

export type NotesScope =
  | { kind: 'all' }
  | { kind: 'folder'; folderId: number }
  | { kind: 'uncategorized' }
  | { kind: 'archive' };

interface State {
  q: string;
  scope: NotesScope;
  tagFilter: string | null;
  setQ: (q: string) => void;
  setScope: (s: NotesScope) => void;
  setTagFilter: (t: string | null) => void;
  /** Reset to "Alle Notizen" — used by the "alle Filter entfernen" affordance
   *  and the chip-row "X" buttons when the last chip is removed. */
  reset: () => void;
}

export const useNotesFilters = create<State>((set) => ({
  q: '',
  scope: { kind: 'all' },
  tagFilter: null,
  setQ: (q) => set({ q }),
  setScope: (scope) => set({ scope }),
  setTagFilter: (tagFilter) => set({ tagFilter }),
  reset: () => set({ q: '', scope: { kind: 'all' }, tagFilter: null }),
}));

/** True when at least one non-default filter is set (search box ignored — the
 *  user can see the search input value directly). Drives the dot indicator
 *  on the filter button. */
export function hasActiveFilters(state: Pick<State, 'scope' | 'tagFilter'>): boolean {
  return state.scope.kind !== 'all' || state.tagFilter !== null;
}
