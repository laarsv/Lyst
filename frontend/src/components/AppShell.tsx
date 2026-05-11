import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { AuthApi } from '@/api/endpoints';
import clsx from 'clsx';

const USER_LINKS: [string, string][] = [
  ['/', 'Listen'],
  ['/recipes', 'Rezepte'],
  ['/templates', 'Vorlagen'],
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

  // Close the mobile menu whenever the route changes (e.g. user picks a link)
  useEffect(() => {
    setMenuOpen(false);
  }, [loc.pathname]);

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
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-zinc-100">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          {/* Burger — only visible on small screens */}
          <button
            type="button"
            className="md:hidden -ml-2 p-2 rounded-lg hover:bg-zinc-100 active:bg-zinc-200"
            aria-label={menuOpen ? 'Menü schließen' : 'Menü öffnen'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <CloseIcon /> : <BurgerIcon />}
          </button>

          <Link
            to={role === 'admin' ? '/admin' : '/'}
            className="text-xl font-semibold text-brand"
          >
            Lyst
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
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-zinc-600 hover:bg-zinc-100',
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm text-zinc-600 hidden sm:inline truncate max-w-[140px]">
              {name}
            </span>
            <button onClick={onLogout} className="btn-ghost text-sm">
              Abmelden
            </button>
          </div>
        </div>

        {/* Mobile dropdown */}
        {menuOpen && (
          <div className="md:hidden border-t border-zinc-100 bg-white">
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
                        : 'text-zinc-700 active:bg-zinc-100',
                    )
                  }
                >
                  {label}
                </NavLink>
              ))}
              {name && (
                <div className="px-3 pt-3 mt-1 border-t border-zinc-100 text-xs text-zinc-500">
                  Angemeldet als <span className="text-zinc-700 font-medium">{name}</span>
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
          className="md:hidden fixed inset-0 top-[60px] z-20 bg-black/20"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-4 py-4 sm:py-6">
          <Outlet />
        </div>
      </main>
    </div>
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
