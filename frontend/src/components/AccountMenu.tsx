/** Account menu in the AppShell header — an initials-avatar button that opens
 *  a dropdown (desktop) / BottomSheet (mobile), mirroring NoteActionsMenu's
 *  pattern. Holds the account actions that used to sit loose in the bar:
 *  Konto, Nachtmodus (dark-mode toggle), Abmelden. This is the SINGLE place
 *  for account actions — the mobile hamburger stays nav-only. */
import { useEffect, useRef, useState } from 'react';
import { LogOut, Moon, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BottomSheet } from '@/components/BottomSheet';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useThemeStore } from '@/store/theme';

function initials(name: string | null): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AccountMenu({ name, onLogout }: { name: string | null; onLogout: () => void }) {
  const isMobile = useMediaQuery('(max-width: 767.98px)');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const nav = useNavigate();
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const dark = theme === 'dark';

  // Close on outside click / Escape — dropdown mode only (the sheet has its own).
  useEffect(() => {
    if (!open || isMobile) return;
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
  }, [open, isMobile]);

  const goKonto = () => {
    setOpen(false);
    nav('/settings');
  };
  const doLogout = () => {
    setOpen(false);
    onLogout();
  };

  const rows = (variant: 'sheet' | 'dropdown') => {
    const base =
      variant === 'sheet'
        ? 'w-full flex items-center gap-3 px-5 py-3.5 text-[15px] text-left transition active:bg-page'
        : 'w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-left hover:bg-page transition';
    const sz = variant === 'sheet' ? 20 : 16;
    return (
      <>
        <button type="button" role="menuitem" onClick={goKonto} className={`${base} text-ink`}>
          <User size={sz} className="shrink-0" />
          <span className="flex-1">Konto</span>
        </button>
        {/* Nachtmodus — toggles dark mode in place; menu stays open so the
            switch visibly flips. */}
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={dark}
          onClick={toggleTheme}
          className={`${base} text-ink`}
        >
          <Moon size={sz} className="shrink-0" />
          <span className="flex-1">Nachtmodus</span>
          <span
            className={`relative h-5 w-9 shrink-0 rounded-full transition ${dark ? 'bg-brand' : 'bg-line'}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition ${
                dark ? 'translate-x-4' : ''
              }`}
            />
          </span>
        </button>
        <button type="button" role="menuitem" onClick={doLogout} className={`${base} text-danger`}>
          <LogOut size={sz} className="shrink-0" />
          <span className="flex-1">Abmelden</span>
        </button>
      </>
    );
  };

  const header = (variant: 'sheet' | 'dropdown') =>
    name ? (
      <div
        className={`${
          variant === 'sheet' ? 'px-5 py-3' : 'px-3 py-2'
        } text-xs text-muted border-b border-line`}
      >
        Angemeldet als <span className="text-ink font-medium">{name}</span>
      </div>
    ) : null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Konto-Menü"
        aria-haspopup="menu"
        aria-expanded={open}
        className="size-10 inline-flex items-center justify-center rounded-full bg-brand-50 text-brand-700 text-sm font-semibold hover:bg-brand-100 transition"
      >
        {initials(name)}
      </button>

      {isMobile ? (
        <BottomSheet open={open} onClose={() => setOpen(false)} maxHeightClass="max-h-[60vh]" ariaLabel="Konto">
          {header('sheet')}
          <ul className="py-1">{rows('sheet')}</ul>
        </BottomSheet>
      ) : (
        open && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-1 z-30 min-w-[220px] card p-1 shadow-flat border border-line bg-surface"
          >
            {header('dropdown')}
            <div className="pt-1">{rows('dropdown')}</div>
          </div>
        )
      )}
    </div>
  );
}
