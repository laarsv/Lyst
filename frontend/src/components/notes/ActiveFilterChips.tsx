/** Row of active-filter chips shown directly below the mobile search bar.
 *  Tapping a chip's X clears that single filter; the row hides itself when
 *  no filters remain. */
import { Archive, Folder, FolderOpen, Tag, Users, X } from 'lucide-react';
import type { NoteFolder } from '@/types';
import { useNotesFilters, type NotesScope } from '@/store/notesFilters';

interface Props {
  folders: NoteFolder[];
}

export function ActiveFilterChips({ folders }: Props) {
  const { scope, tagFilter, setScope, setTagFilter } = useNotesFilters();

  const chips: { key: string; label: string; color?: string; icon: React.ReactNode; clear: () => void }[] = [];

  if (scope.kind === 'folder') {
    const f = folders.find((x) => x.id === scope.folderId);
    chips.push({
      key: `folder-${scope.folderId}`,
      label: f?.name ?? 'Ordner',
      color: f?.color || undefined,
      icon: <Folder size={12} />,
      clear: () => setScope({ kind: 'all' }),
    });
  } else if (scope.kind === 'uncategorized') {
    chips.push({
      key: 'uncategorized',
      label: 'Ohne Ordner',
      icon: <FolderOpen size={12} />,
      clear: () => setScope({ kind: 'all' }),
    });
  } else if (scope.kind === 'archive') {
    chips.push({
      key: 'archive',
      label: 'Archiv',
      icon: <Archive size={12} />,
      clear: () => setScope({ kind: 'all' }),
    });
  } else if (scope.kind === 'shared') {
    chips.push({
      key: 'shared',
      label: 'Mit mir geteilt',
      icon: <Users size={12} />,
      clear: () => setScope({ kind: 'all' }),
    });
  }

  if (tagFilter) {
    chips.push({
      key: `tag-${tagFilter}`,
      label: `#${tagFilter}`,
      icon: <Tag size={12} />,
      clear: () => setTagFilter(null),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-line bg-surface">
      {chips.map((c) => (
        <Chip key={c.key} label={c.label} color={c.color} icon={c.icon} onClear={c.clear} />
      ))}
    </div>
  );
}

function Chip({
  label,
  color,
  icon,
  onClear,
}: {
  label: string;
  color?: string;
  icon: React.ReactNode;
  onClear: () => void;
}) {
  // Coloured chips (folder filter) inherit the folder's accent on the dot;
  // others fall back to the muted surface treatment.
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs pl-2 pr-1 py-1 rounded-full bg-page border border-line text-ink"
    >
      {color ? (
        <span className="size-2 rounded-full shrink-0" style={{ background: color }} />
      ) : (
        <span className="text-muted shrink-0">{icon}</span>
      )}
      <span className="truncate max-w-[160px]">{label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Filter „${label}" entfernen`}
        className="size-5 inline-flex items-center justify-center rounded-full text-muted/80 hover:text-ink hover:bg-surface"
      >
        <X size={12} />
      </button>
    </span>
  );
}

/** Convenience selector — kept here so call sites don't need to know the
 *  shape of the store. */
export { hasActiveFilters as filtersAreActive } from '@/store/notesFilters';
export type { NotesScope };
