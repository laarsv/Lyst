/** Menu of secondary actions behind one trigger.
 *
 *  Dropdown on desktop, BottomSheet on mobile — the pattern AccountMenu and
 *  NoteActionsMenu already use, factored out so action rows stop growing a
 *  new icon per feature. Rows always carry icon AND text: a tooltip only
 *  helps a mouse, and these bars are used on phones.
 *
 *  The trigger is either an icon button ("Mehr", the usual case) or a filled
 *  button with a label.
 */
import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { BottomSheet } from '@/components/BottomSheet';
import { useMediaQuery } from '@/hooks/useMediaQuery';

export interface ActionMenuItem {
  label: string;
  icon: LucideIcon;
  run: () => void;
  danger?: boolean;
}

interface Props {
  items: ActionMenuItem[];
  /** Accessible name of the trigger, and the sheet's label. */
  label?: string;
  /** Filled button with visible text instead of the icon-only trigger. */
  triggerLabel?: string;
  triggerIcon?: LucideIcon;
}

export function ActionMenu({ items, label = 'Mehr', triggerLabel, triggerIcon }: Props) {
  const isMobile = useMediaQuery('(max-width: 767.98px)');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const TriggerIcon = triggerIcon ?? MoreHorizontal;

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

  if (items.length === 0) return null;

  const rows = (variant: 'sheet' | 'dropdown') => {
    const base =
      variant === 'sheet'
        ? 'w-full flex items-center gap-3 px-5 py-3.5 text-[15px] text-left transition active:bg-page'
        : 'w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-left hover:bg-page transition';
    const sz = variant === 'sheet' ? 20 : 16;
    return items.map(({ label: rowLabel, icon: Icon, run, danger }) => (
      <button
        key={rowLabel}
        type="button"
        role="menuitem"
        onClick={() => {
          setOpen(false);
          run();
        }}
        className={`${base} ${danger ? 'text-danger' : ''}`}
      >
        <Icon size={sz} className={`shrink-0 ${danger ? '' : 'text-muted'}`} />
        {rowLabel}
      </button>
    ));
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel ? undefined : label}
        title={triggerLabel ? undefined : label}
        className={
          triggerLabel
            ? 'btn-primary inline-flex items-center gap-1.5'
            : 'size-10 inline-flex items-center justify-center rounded-ctl border border-line text-ink hover:bg-page transition'
        }
      >
        <TriggerIcon size={triggerLabel ? 18 : 18} />
        {triggerLabel}
      </button>

      {isMobile ? (
        <BottomSheet
          open={open}
          onClose={() => setOpen(false)}
          maxHeightClass="max-h-[60vh]"
          ariaLabel={triggerLabel ?? label}
        >
          <div className="py-1">{rows('sheet')}</div>
        </BottomSheet>
      ) : (
        open && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-1 z-30 min-w-[220px] card p-1 shadow-flat border border-line bg-surface"
          >
            {rows('dropdown')}
          </div>
        )
      )}
    </div>
  );
}
