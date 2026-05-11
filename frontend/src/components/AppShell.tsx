import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { AuthApi } from '@/api/endpoints';
import clsx from 'clsx';

export function AppShell() {
  const { name, role, clear } = useAuthStore();
  const nav = useNavigate();

  const onLogout = async () => {
    try {
      await AuthApi.logout();
    } finally {
      clear();
      nav('/login');
    }
  };

  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-zinc-100">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to={role === 'admin' ? '/admin' : '/'} className="text-xl font-semibold text-brand">
            Lyst
          </Link>
          {role === 'user' && (
            <nav className="flex gap-1">
              {[
                ['/', 'Listen'],
                ['/recipes', 'Rezepte'],
                ['/templates', 'Vorlagen'],
                ['/notes', 'Notizen'],
                ['/settings', 'Konto'],
              ].map(([to, label]) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
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
          )}
          {role === 'admin' && (
            <nav className="flex gap-1">
              {[
                ['/admin', 'Benutzer'],
                ['/admin/settings', 'Einstellungen'],
              ].map(([to, label]) => (
                <NavLink
                  key={to}
                  to={to}
                  end
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
          )}
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-600 hidden sm:inline">{name}</span>
            <button onClick={onLogout} className="btn-ghost text-sm">
              Abmelden
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
