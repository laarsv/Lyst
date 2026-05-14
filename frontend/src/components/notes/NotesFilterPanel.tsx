/** Bottom-sheet filter panel for the mobile notes overview.
 *
 *  Auto-applies on selection (no explicit "Anwenden" button) — same UX as
 *  the desktop sidebar where each click already triggers a refetch. The
 *  user closes the sheet via backdrop tap or the X icon.
 *
 *  Folder management lives here too: each folder row carries a small edit
 *  affordance, plus a "+ Neuer Ordner" button below the list. */
import { Pencil, Plus, Users, X } from 'lucide-react';
import type { NoteFolder, Tag } from '@/types';
import { BottomSheet } from '@/components/BottomSheet';
import { useNotesFilters } from '@/store/notesFilters';

interface Props {
  open: boolean;
  onClose: () => void;
  folders: NoteFolder[];
  tags: Tag[];
  onCreateFolder: () => void;
  onEditFolder: (folder: NoteFolder) => void;
}

export function NotesFilterPanel({
  open,
  onClose,
  folders,
  tags,
  onCreateFolder,
  onEditFolder,
}: Props) {
  const { scope, tagFilter, setScope, setTagFilter } = useNotesFilters();

  const archiveOn = scope.kind === 'archive';

  return (
    <BottomSheet open={open} onClose={onClose} maxHeightClass="max-h-[80vh]" ariaLabel="Filter">
      <header className="px-4 py-1 flex items-center justify-between shrink-0">
        <h2 className="text-base font-semibold">Filter</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Schließen"
          className="size-9 inline-flex items-center justify-center rounded-ctl text-muted hover:text-ink hover:bg-page"
        >
          <X size={18} />
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-5">
        {/* Folders */}
        <section>
          <SectionLabel>Ordner</SectionLabel>
          <ul className="border border-line rounded-card divide-y divide-line bg-surface">
            <FolderRow
              label="Alle Notizen"
              dot={null}
              active={scope.kind === 'all'}
              onClick={() => setScope({ kind: 'all' })}
            />
            <FolderRow
              label="Ohne Ordner"
              dot={null}
              dashed
              active={scope.kind === 'uncategorized'}
              onClick={() => setScope({ kind: 'uncategorized' })}
            />
            {folders.map((f) => (
              <FolderRow
                key={f.id}
                label={f.name}
                dot={f.color || '#00c896'}
                count={f.note_count}
                active={scope.kind === 'folder' && scope.folderId === f.id}
                onClick={() => setScope({ kind: 'folder', folderId: f.id })}
                onEdit={() => onEditFolder(f)}
              />
            ))}
          </ul>
          <button
            type="button"
            onClick={onCreateFolder}
            className="mt-2 inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline"
          >
            <Plus size={16} /> Neuer Ordner
          </button>
        </section>

        {/* Tags */}
        <section>
          <SectionLabel>Tags</SectionLabel>
          {tags.length === 0 ? (
            <div className="text-sm text-muted/80">Keine Tags angelegt.</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <TagChip
                active={tagFilter === null}
                onClick={() => setTagFilter(null)}
                label="alle"
              />
              {tags.map((t) => (
                <TagChip
                  key={t.id}
                  active={tagFilter === t.name}
                  // Toggling the same tag clears the filter — saves a tap.
                  onClick={() => setTagFilter(tagFilter === t.name ? null : t.name)}
                  label={`#${t.name}`}
                  color={t.color || '#00c896'}
                />
              ))}
            </div>
          )}
        </section>

        {/* Shared */}
        <section>
          <SectionLabel>Sichtbarkeit</SectionLabel>
          <label className="flex items-center justify-between gap-3 px-3 py-3 border border-line rounded-card bg-surface cursor-pointer">
            <span className="text-sm inline-flex items-center gap-2">
              <Users size={14} className="text-brand-700" />
              Nur „Mit mir geteilt"
            </span>
            <Switch
              checked={scope.kind === 'shared'}
              onChange={(next) => setScope(next ? { kind: 'shared' } : { kind: 'all' })}
            />
          </label>
        </section>

        {/* Archive */}
        <section>
          <SectionLabel>Archiv</SectionLabel>
          <label className="flex items-center justify-between gap-3 px-3 py-3 border border-line rounded-card bg-surface cursor-pointer">
            <span className="text-sm">Archivierte Notizen anzeigen</span>
            <Switch
              checked={archiveOn}
              onChange={(next) => setScope(next ? { kind: 'archive' } : { kind: 'all' })}
            />
          </label>
        </section>
      </div>
    </BottomSheet>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-wide text-muted mb-2">
      {children}
    </div>
  );
}

function FolderRow({
  label,
  dot,
  dashed,
  count,
  active,
  onClick,
  onEdit,
}: {
  label: string;
  dot: string | null;
  dashed?: boolean;
  count?: number;
  active: boolean;
  onClick: () => void;
  onEdit?: () => void;
}) {
  return (
    <li className="flex items-center">
      <button
        type="button"
        onClick={onClick}
        className={`flex-1 flex items-center gap-3 px-3 py-3 text-left text-[15px] transition ${
          active ? 'text-brand-700 bg-brand-50' : 'hover:bg-page'
        }`}
      >
        <span
          className="size-3 rounded-full shrink-0"
          style={{
            background: dot ?? 'transparent',
            border: dot ? undefined : `1px ${dashed ? 'dashed' : 'solid'} currentColor`,
          }}
        />
        <span className="flex-1 truncate">{label}</span>
        {typeof count === 'number' && (
          <span className="text-xs text-muted tabular-nums">{count}</span>
        )}
      </button>
      {onEdit && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          aria-label={`Ordner „${label}" bearbeiten`}
          className="size-11 inline-flex items-center justify-center text-muted/70 hover:text-ink"
        >
          <Pencil size={16} />
        </button>
      )}
    </li>
  );
}

function TagChip({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-2.5 py-1.5 rounded-full transition ${
        active ? 'text-surface' : 'bg-page text-muted hover:text-ink'
      }`}
      style={active && color ? { background: color } : undefined}
    >
      {label}
    </button>
  );
}

function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition shrink-0 ${
        checked ? 'bg-brand' : 'bg-line'
      }`}
    >
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-surface transition ${
          checked ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}
