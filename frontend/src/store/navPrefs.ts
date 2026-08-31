/**
 * Which nav entries sit in the main navigation and which move under "Mehr".
 *
 * Stored per browser (localStorage), like the start page in `store/startPage.ts`
 * and for the same reason: a household instance is used by different people on
 * their own devices, and a desktop has room for more entries than a phone. No
 * schema change, no /me round-trip.
 *
 * We persist the HIDDEN entries, not the visible ones — a module added in a
 * later release then shows up in the main nav instead of silently disappearing
 * into "Mehr" for everyone who has ever opened the settings.
 *
 * Nothing is ever removed from the app: hidden entries stay reachable under
 * the "Mehr" dropdown (desktop) and in the hamburger's "Mehr" group (mobile).
 */
import { create } from 'zustand';

/** Every content destination, in the order the nav renders them. */
export const NAV_ITEMS = [
  ['/', 'Listen'],
  ['/heute', 'Heute'],
  ['/tasks', 'Aufgaben'],
  ['/recipes', 'Rezepte'],
  ['/plants', 'Pflanzen'],
  ['/fitness', 'Fitness'],
  ['/meal-planner', 'Wochenplan'],
  ['/notes', 'Notizen'],
] as const satisfies readonly (readonly [string, string])[];

export type NavPath = (typeof NAV_ITEMS)[number][0];

const ALL: NavPath[] = NAV_ITEMS.map(([p]) => p);
const VALID = new Set<string>(ALL);

/** Default: the five everyday destinations stay, the rest move under "Mehr". */
const DEFAULT_HIDDEN: NavPath[] = ['/plants', '/fitness', '/meal-planner'];

const STORAGE_KEY = 'lyst-nav-hidden';

function load(): NavPath[] {
  if (typeof window === 'undefined') return DEFAULT_HIDDEN;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_HIDDEN;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_HIDDEN;
    // Drop anything unknown so a renamed route can't strand an entry.
    return parsed.filter((p): p is NavPath => typeof p === 'string' && VALID.has(p));
  } catch {
    return DEFAULT_HIDDEN;
  }
}

export type NavEntry = readonly [NavPath, string];

/** Split the canonical list into main nav and "Mehr", keeping the order. */
export function splitNav(hidden: NavPath[]): { visible: NavEntry[]; overflow: NavEntry[] } {
  const visible: NavEntry[] = [];
  const overflow: NavEntry[] = [];
  for (const entry of NAV_ITEMS) {
    (hidden.includes(entry[0]) ? overflow : visible).push(entry);
  }
  return { visible, overflow };
}

interface NavPrefsState {
  hidden: NavPath[];
  toggle: (path: NavPath) => void;
  reset: () => void;
}

const persist = (hidden: NavPath[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hidden));
  } catch {
    // Storage blocked (private mode) — keep the in-memory choice for this session.
  }
};

export const useNavPrefs = create<NavPrefsState>((set, get) => ({
  hidden: load(),
  toggle: (path) => {
    const hidden = get().hidden.includes(path)
      ? get().hidden.filter((p) => p !== path)
      : [...get().hidden, path];
    persist(hidden);
    set({ hidden });
  },
  reset: () => {
    persist(DEFAULT_HIDDEN);
    set({ hidden: DEFAULT_HIDDEN });
  },
}));
