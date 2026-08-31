/** "Mehr" dropdown in the desktop nav — holds the destinations the user has
 *  switched off in Konto → Navigation. Nothing is ever unreachable, it just
 *  costs one click.
 *
 *  Dropdown only, no BottomSheet variant: the desktop nav renders from `lg`
 *  up, and below that the hamburger lists the same entries under its own
 *  "Mehr" group. Outside-click/Escape handling mirrors AccountMenu. */
import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import type { NavPath } from '@/store/navPrefs';

interface Props {
  items: readonly (readonly [NavPath, string])[];
  /** Same `end` rule the main nav uses, so "/" doesn't match everything. */
  linkEnd: (to: string) => boolean;
}

export function NavMoreMenu({ items, linkEnd }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const loc = useLocation();

  // The current route may live inside "Mehr" — mark the button active so the
  // user can still see where they are.
  const holdsActive = items.some(([to]) =>
    linkEnd(to) ? loc.pathname === to : loc.pathname.startsWith(to),
  );

  useEffect(() => setOpen(false), [loc.pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={clsx(
          'px-3 py-1.5 rounded-lg text-sm font-medium inline-flex items-center gap-1',
          holdsActive ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-page',
        )}
      >
        Mehr
        <ChevronDown size={14} className={clsx('transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1 z-30 min-w-[180px] card p-1 shadow-flat border border-line bg-surface"
        >
          {items.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={linkEnd(to)}
              role="menuitem"
              className={({ isActive }) =>
                clsx(
                  'block px-3 py-2 rounded text-sm font-medium transition',
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-ink hover:bg-page',
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
