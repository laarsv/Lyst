/** Controlled folder picker. Renders as an anchored popover on desktop and
 *  as a bottom sheet on mobile.
 *
 *  Single source of truth so both the FolderChip click and the kebab menu's
 *  "Ordner ändern" entry pop up the exact same UI. The desktop popover
 *  positions itself absolutely under its anchor — wrap it in a `relative`
 *  container at the call site (FolderChip already does this). */
import { useEffect, useRef } from 'react';
import { Folder, FolderOpen, Plus } from 'lucide-react';
import type { NoteFolder } from '@/types';
import { BottomSheet } from '@/components/BottomSheet';
import { useMediaQuery } from '@/hooks/useMediaQuery';

interface Props {
  open: boolean;
  onClose: () => void;
  folders: NoteFolder[];
  currentFolderId: number | null;
  onPick: (folderId: number | null) => void;
  onCreateFolder?: () => void;
}

export function FolderPicker({
  open,
  onClose,
  folders,
  currentFolderId,
  onPick,
  onCreateFolder,
}: Props) {
  const isMobile = useMediaQuery('(max-width: 767.98px)');
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Desktop popover: close on outside click. The mobile sheet uses its own
  // backdrop, so we skip this listener there.
  useEffect(() => {
    if (!open || isMobile) return;
    const onDown = (e: MouseEvent) => {
      // Walk up — the chip button is the trigger and lives above this
      // popover in the same `relative` wrapper. Clicks on it would
      // otherwise close + re-open immediately.
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      const wrap = popoverRef.current?.parentElement;
      if (wrap?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, isMobile, onClose]);

  const list = (
    <ul className="flex-1 overflow-y-auto" role="listbox">
      <li>
        <FolderRow
          icon={<FolderOpen size={16} className="text-muted" />}
          label="Ohne Ordner"
          active={currentFolderId === null}
          onClick={() => {
            onPick(null);
            onClose();
          }}
        />
      </li>
      {folders.map((f) => (
        <li key={f.id}>
          <FolderRow
            icon={<span className="size-3 rounded-full" style={{ background: f.color || '#00c896' }} />}
            label={f.name}
            count={f.note_count}
            active={currentFolderId === f.id}
            onClick={() => {
              onPick(f.id);
              onClose();
            }}
          />
        </li>
      ))}
      {onCreateFolder && (
        <li className="border-t border-line mt-1 pt-1">
          <button
            type="button"
            onClick={() => {
              onClose();
              onCreateFolder();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-brand-700 hover:bg-brand-50 transition"
          >
            <Plus size={16} />
            <span>Neuer Ordner</span>
          </button>
        </li>
      )}
    </ul>
  );

  if (isMobile) {
    return (
      <BottomSheet open={open} onClose={onClose} maxHeightClass="max-h-[70vh]" ariaLabel="Ordner wählen">
        <div className="px-4 pt-1 pb-1 shrink-0">
          <h3 className="font-semibold flex items-center gap-2">
            <Folder size={16} className="text-muted" /> Ordner
          </h3>
        </div>
        {list}
      </BottomSheet>
    );
  }

  if (!open) return null;
  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Ordner wählen"
      className="absolute left-0 top-full mt-1 z-30 min-w-[220px] max-w-[320px] max-h-[60vh] overflow-hidden flex flex-col card p-1 border border-line bg-surface shadow-flat"
    >
      {list}
    </div>
  );
}

function FolderRow({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left rounded transition ${
        active ? 'bg-brand-50 text-brand-700' : 'hover:bg-page'
      }`}
    >
      <span className="shrink-0 inline-flex items-center justify-center w-4">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {typeof count === 'number' && (
        <span className="text-xs text-muted tabular-nums">{count}</span>
      )}
    </button>
  );
}
