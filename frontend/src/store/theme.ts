import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'lyst-theme';

function detectInitial(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  // Also nudge the browser theme-color so the address bar matches
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) {
    meta.content = theme === 'dark' ? '#141414' : '#2947c9';
  }
}

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: detectInitial(),
  setTheme: (t) => {
    localStorage.setItem(STORAGE_KEY, t);
    apply(t);
    set({ theme: t });
  },
  toggle: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },
}));

// Apply the chosen theme immediately on import so we don't get a flash
// of light content before React mounts.
if (typeof document !== 'undefined') apply(detectInitial());
