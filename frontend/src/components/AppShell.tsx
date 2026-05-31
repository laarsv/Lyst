import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { AuthApi } from '@/api/endpoints';
import { ThemeToggle } from '@/components/ThemeToggle';
import { SearchModal } from '@/components/SearchModal';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';
import { LiveIndicator } from '@/components/LiveIndicator';
import { NotificationBell } from '@/components/NotificationBell';
import { useOverviewRouteRefresh } from '@/hooks/useOverviewQuery';
import { useUserWebSocket } from '@/hooks/useUserWebSocket';
import clsx from 'clsx';

const USER_LINKS: [string, string][] = [
  ['/', 'Listen'],
  ['/tasks', 'Aufgaben'],
  ['/recipes', 'Rezepte'],
  ['/plants', 'Pflanzen'],
  ['/meal-planner', 'Wochenplan'],
  ['/notes', 'Notizen'],
  ['/settings', 'Konto'],
];

const ADMIN_LINKS: [string, string][] = [
  ['/admin', 'Benutzer'],
  ['/admin/settings', 'Einstellungen'],
];

export function AppShell() {
  const { name, role, clear } = useAuthStore();
  const nav = useNavigate();
  const loc = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Close the mobile menu whenever the route changes (e.g. user picks a link)
  useEffect(() => {
    setMenuOpen(false);
  }, [loc.pathname]);

  // Belt-and-suspenders for cache invalidation: when the user navigates
  // onto an overview route (/, /notes, /recipes, /meal-planner) we ping
  // every subscriber under the matching key. The overview's own mount-
  // fetch covers the common case; this guards future refactors that
  // might keep an overview mounted across route changes.
  useOverviewRouteRefresh(loc.pathname);

  // One WebSocket per session — receives every mutation that touches
  // a resource this user can see and invalidates the matching
  // overview cache. Drives the green "Live" dot in the header.
  // Disconnects automatically when AppShell unmounts (logout).
  const liveConnected = useUserWebSocket();

  // Cmd/Ctrl+K → open global search; Esc handled inside the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen]);

  const onLogout = async () => {
    try {
      await AuthApi.logout();
    } finally {
      clear();
      nav('/login');
    }
  };

  const links = role === 'admin' ? ADMIN_LINKS : USER_LINKS;
  const linkEnd = (to: string) => to === '/' || to === '/admin';

  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-30 bg-surface/90 backdrop-blur border-b border-line">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          {/* Burger — only visible on small screens */}
          <button
            type="button"
            className="md:hidden -ml-2 p-2 rounded-lg hover:bg-page active:bg-line"
            aria-label={menuOpen ? 'Menü schließen' : 'Menü öffnen'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <CloseIcon /> : <BurgerIcon />}
          </button>

          <Link
            to={role === 'admin' ? '/admin' : '/'}
            className="flex items-center gap-2"
          >
            <img
              src="/logo.png"
              alt=""
              width="32"
              height="32"
              className="size-8 rounded-md"
            />
            <span className="wordmark text-xl">lyst</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex gap-1 ml-4">
            {links.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end={linkEnd(to)}
                className={({ isActive }) =>
                  clsx(
                    'px-3 py-1.5 rounded-lg text-sm font-medium',
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-page',
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2 ml-auto">
            {/* Live dot — reflects the per-user WebSocket. Replaces
                the per-list LiveIndicator's UI role here; that one
                still mounts inside ListDetail for the per-list
                channel (kept as parallel sync for now). */}
            <LiveIndicator connected={liveConnected} />
            <NotificationBell />
            <SyncStatusBadge />
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Suchen"
              title="Suchen (Cmd+K)"
              className="p-2 rounded-lg text-muted hover:bg-page hover:text-ink transition"
            >
              <SearchIcon />
            </button>
            <span className="text-sm text-muted hidden sm:inline truncate max-w-[140px]">
              {name}
            </span>
            <ThemeToggle />
            <button onClick={onLogout} className="btn-ghost text-sm">
              Abmelden
            </button>
          </div>
        </div>

        {/* Mobile dropdown */}
        {menuOpen && (
          <div className="md:hidden border-t border-line bg-surface">
            <nav className="max-w-5xl mx-auto px-2 py-2 flex flex-col">
              {links.map(([to, label]) => (
                <NavLink
                  key={to}
                  to={to}
                  end={linkEnd(to)}
                  className={({ isActive }) =>
                    clsx(
                      'px-3 py-3 rounded-lg text-base font-medium',
                      isActive
                        ? 'bg-brand-50 text-brand-700'
                        : 'text-ink active:bg-page',
                    )
                  }
                >
                  {label}
                </NavLink>
              ))}
              {name && (
                <div className="px-3 pt-3 mt-1 border-t border-line text-xs text-muted">
                  Angemeldet als <span className="text-ink font-medium">{name}</span>
                </div>
              )}
            </nav>
          </div>
        )}
      </header>

      {/* Backdrop closes the menu */}
      {menuOpen && (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          className="md:hidden fixed inset-0 top-[60px] z-20 bg-ink/20"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-4 py-4 sm:py-6">
          <Outlet />
        </div>
      </main>

      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function BurgerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}
