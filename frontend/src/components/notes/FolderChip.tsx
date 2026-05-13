/** Folder chip — sits in the note's metadata row alongside tag chips.
 *
 *  Visually similar to a tag chip (same height/radius/border) but with a
 *  folder icon to set it apart. Opens FolderPicker on click; the picker
 *  positions itself below the chip on desktop and as a bottom sheet on
 *  mobile. Controlled `open` so the kebab menu can pop the same picker. */
import { Folder } from 'lucide-react';
import type { NoteFolder } from '@/types';
import { FolderPicker } from './FolderPicker';

interface Props {
  folders: NoteFolder[];
  currentFolderId: number | null;
  onChange: (folderId: number | null) => void;
  /** Optional — when set, the picker shows a "+ Neuer Ordner" entry that
   *  defers to this callback (typically opens the parent's folder modal). */
  onCreateFolder?: () => void;
  /** Controlled open state so an external trigger (e.g. the kebab menu)
   *  can pop the same picker as a chip click would. */
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

export function FolderChip({
  folders,
  currentFolderId,
  onChange,
  onCreateFolder,
  open,
  onOpenChange,
}: Props) {
  const current = currentFolderId !== null
    ? folders.find((f) => f.id === currentFolderId) ?? null
    : null;
  const label = current?.name ?? '— ohne Ordner';
  const dotColor = current?.color || (current ? '#00c896' : null);

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 text-xs pl-2 pr-2.5 py-1 rounded-full border transition ${
          open ? 'border-brand bg-brand-50 text-brand-700' : 'border-line bg-surface hover:bg-page'
        }`}
      >
        <Folder size={12} className="text-muted shrink-0" />
        {dotColor ? (
          <span className="size-2 rounded-full shrink-0" style={{ background: dotColor }} />
        ) : (
          <span
            className="size-2 rounded-full shrink-0"
            style={{ border: '1px dashed currentColor' }}
            aria-hidden
          />
        )}
        <span className="truncate max-w-[180px]">{label}</span>
      </button>

      <FolderPicker
        open={open}
        onClose={() => onOpenChange(false)}
        folders={folders}
        currentFolderId={currentFolderId}
        onPick={(id) => onChange(id)}
        onCreateFolder={onCreateFolder}
      />
    </div>
  );
}
