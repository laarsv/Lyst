/**
 * Start page preference — which view the app opens on.
 *
 * Stored per browser (localStorage), not per account: the two people using a
 * household instance are on their own devices and want different landing
 * views. No schema change, no /me round-trip.
 *
 * The redirect fires ONCE per browsing session (sessionStorage flag), so
 * clicking "Listen" in the nav still reaches `/` normally afterwards —
 * only a fresh app start (PWA launch, new tab) lands on the chosen page.
 */

export type StartPage =
  | '/'
  | '/tasks'
  | '/recipes'
  | '/plants'
  | '/fitness'
  | '/meal-planner'
  | '/notes';

/** Label pairs for the settings dropdown — order matches the nav. */
export const START_PAGE_OPTIONS: [StartPage, string][] = [
  ['/', 'Listen'],
  ['/tasks', 'Aufgaben'],
  ['/recipes', 'Rezepte'],
  ['/plants', 'Pflanzen'],
  ['/fitness', 'Fitness'],
  ['/meal-planner', 'Wochenplan'],
  ['/notes', 'Notizen'],
];

const STORAGE_KEY = 'lyst-start-page';
const SESSION_FLAG = 'lyst-start-page-applied';

const VALID = new Set<string>(START_PAGE_OPTIONS.map(([p]) => p));

export function getStartPage(): StartPage {
  if (typeof window === 'undefined') return '/';
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored && VALID.has(stored) ? (stored as StartPage) : '/';
}

export function setStartPage(p: StartPage) {
  localStorage.setItem(STORAGE_KEY, p);
}

/**
 * Returns the page to redirect to, or null when we should just render the
 * default (`/` = Listen). Consumes the once-per-session flag, so navigating
 * back to `/` later in the same session shows Listen as usual.
 */
export function consumeStartRedirect(): StartPage | null {
  if (typeof window === 'undefined') return null;
  try {
    if (sessionStorage.getItem(SESSION_FLAG)) return null;
    sessionStorage.setItem(SESSION_FLAG, '1');
  } catch {
    // Private mode / storage blocked — never redirect rather than loop.
    return null;
  }
  const p = getStartPage();
  return p === '/' ? null : p;
}
