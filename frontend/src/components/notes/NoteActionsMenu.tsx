/** Kebab/3-dot actions menu for a note.
 *
 *  Mobile: bottom sheet sliding up from the viewport bottom.
 *  Desktop: positioned dropdown anchored under the trigger.
 *
 *  Renders the trigger inside, since the open/close state and animation
 *  belong together. Parent only supplies the action handlers. */
import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  FolderOpen,
  History,
  MoreVertical,
  Pin,
  PinOff,
  Sparkles,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { BottomSheet } from '@/components/BottomSheet';
import { useMediaQuery } from '@/hooks/useMediaQuery';

interface Props {
  isPinned: boolean;
  isArchived: boolean;
  onTogglePin: () => void;
  onChangeFolder: () => void;
  onToggleArchive: () => void;
  onShowHistory: () => void;
  onDelete: () => void;
  /** Optional — when provided, the menu shows a "Zusammenfassen (KI)"
   *  entry that calls this callback. Disabled when the note is empty. */
  onSummarize?: () => void;
  /** Disable the summarize entry when there's nothing to summarize. */
  canSummarize?: boolean;
  buttonClassName?: string;
}

interface Item {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function NoteActionsMenu({
  isPinned,
  isArchived,
  onTogglePin,
  onChangeFolder,
  onToggleArchive,
  onShowHistory,
  onDelete,
  onSummarize,
  canSummarize = true,
  buttonClassName = '',
}: Props) {
  const isMobile = useMediaQuery('(max-width: 767.98px)');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape — only in dropdown mode (the bottom sheet
  // has its own backdrop).
  useEffect(() => {
    if (!open || isMobile) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

  const items: Item[] = [
    {
      key: 'pin',
      label: isPinned ? 'Pin entfernen' : 'Anpinnen',
      icon: isPinned ? PinOff : Pin,
      onClick: onTogglePin,
      disabled: isArchived,
    },
    { key: 'folder', label: 'Ordner ändern', icon: FolderOpen, onClick: onChangeFolder },
    {
      key: 'archive',
      label: isArchived ? 'Wiederherstellen' : 'Archivieren',
      icon: isArchived ? ArchiveRestore : Archive,
      onClick: onToggleArchive,
    },
    { key: 'history', label: 'Verlauf', icon: History, onClick: onShowHistory },
    ...(onSummarize
      ? [
          {
            key: 'summarize',
            label: 'Zusammenfassen (KI)',
            icon: Sparkles,
            onClick: onSummarize,
            disabled: !canSummarize,
          },
        ]
      : []),
    { key: 'delete', label: 'Löschen', icon: Trash2, onClick: onDelete, danger: true },
  ];

  const fire = (it: Item) => {
    if (it.disabled) return;
    setOpen(false);
    it.onClick();
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Mehr Aktionen"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center justify-center rounded-ctl text-muted hover:text-ink hover:bg-page transition ${
          buttonClassName || 'size-10'
        }`}
      >
        <MoreVertical size={20} />
      </button>

      {isMobile && (
        <BottomSheet
          open={open}
          onClose={() => setOpen(false)}
          maxHeightClass="max-h-[60vh]"
          ariaLabel="Aktionen"
        >
          <ul className="py-1 overflow-y-auto">
            {items.map((it) => (
              <li key={it.key}>
                <ActionRow item={it} onClick={() => fire(it)} variant="sheet" />
              </li>
            ))}
          </ul>
        </BottomSheet>
      )}

      {open && !isMobile && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-30 min-w-[200px] card p-1 shadow-flat border border-line bg-surface"
        >
          {items.map((it) => (
            <ActionRow key={it.key} item={it} onClick={() => fire(it)} variant="dropdown" />
          ))}
        </div>
      )}
    </div>
  );
}

function ActionRow({
  item,
  onClick,
  variant,
}: {
  item: Item;
  onClick: () => void;
  variant: 'sheet' | 'dropdown';
}) {
  const Icon = item.icon;
  const sheetClasses =
    'w-full flex items-center gap-3 px-5 py-3.5 text-[15px] text-left transition active:bg-page disabled:opacity-40';
  const dropdownClasses =
    'w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-left hover:bg-page transition disabled:opacity-40';
  const tone = item.danger ? 'text-danger' : 'text-ink';
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={item.disabled}
      className={`${variant === 'sheet' ? sheetClasses : dropdownClasses} ${tone}`}
    >
      <Icon size={variant === 'sheet' ? 20 : 16} className="shrink-0" />
      <span className="flex-1">{item.label}</span>
    </button>
  );
}

