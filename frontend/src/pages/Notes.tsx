import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { NoteFoldersApi, NotesApi, SearchApi, TagsApi } from '@/api/endpoints';
import type { Note, NoteFolder, Tag } from '@/types';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { remarkWikilinks, parseWikilinkUrl } from '@/lib/wikilinks';
import { VersionHistoryPanel } from '@/components/notes/VersionHistoryPanel';
import { NoteToolbar } from '@/components/notes/NoteToolbar';
import { NoteActionsMenu } from '@/components/notes/NoteActionsMenu';
import { NoteMobileLayout } from '@/components/notes/NoteMobileLayout';
import { useConfirm } from '@/components/Dialogs';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useNoteEditingState } from '@/hooks/useNoteEditingState';
import MDEditor from '@uiw/react-md-editor';

type Scope =
  | { kind: 'all' }
  | { kind: 'folder'; folderId: number }
  | { kind: 'uncategorized' }
  | { kind: 'archive' };

const NOTE_DRAG_TYPE = 'application/x-lyst-note-id';

export function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>({ kind: 'all' });
  const [loading, setLoading] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [folderModal, setFolderModal] = useState<{ open: boolean; edit?: NoteFolder | null }>({
    open: false,
  });
  const [params, setParams] = useSearchParams();
  const confirmDialog = useConfirm();

  // Deep link from search modal / wikilinks: /notes?focus=<id>
  useEffect(() => {
    const focus = params.get('focus');
    if (!focus) return;
    const id = Number(focus);
    if (!Number.isFinite(id)) return;
    setActiveId(id);
    // If the focused note isn't in the current scope's list (e.g. search hit
    // an archived note), broaden to "all" so the editor can fetch it.
    if (!notes.some((n) => n.id === id)) {
      setScope({ kind: 'all' });
    }
    // Strip the param so back-navigation doesn't keep re-focusing.
    params.delete('focus');
    setParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // Navigate by note title — used by wikilink clicks in the markdown preview.
  const openByTitle = async (title: string) => {
    const found = notes.find((n) => n.title === title);
    if (found) {
      setActiveId(found.id);
      return;
    }
    // Look it up via the title-search endpoint. Fall back to a toast.
    try {
      const r = await SearchApi.noteTitles(title);
      const exact = r.find((x) => x.title === title) ?? r[0];
      if (!exact) {
        toast.info(`Notiz „${title}" nicht gefunden`);
        return;
      }
      setActiveId(exact.id);
      if (!notes.some((n) => n.id === exact.id)) {
        // Switch to "all" so subsequent reload pulls this note in
        setScope({ kind: 'all' });
      }
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const loadFolders = async () => {
    try {
      setFolders(await NoteFoldersApi.list());
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const loadNotes = async () => {
    try {
      const params: Parameters<typeof NotesApi.list>[0] = {
        q: q || undefined,
        tag: tagFilter || undefined,
      };
      if (scope.kind === 'folder') params.folder_id = scope.folderId;
      else if (scope.kind === 'uncategorized') params.uncategorized = true;
      else if (scope.kind === 'archive') params.archived = true;
      setNotes(await NotesApi.list(params));
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFolders();
    void (async () => {
      try {
        setTags(await TagsApi.list());
      } catch (e) {
        toast.error(getApiError(e));
      }
    })();
  }, []);

  useEffect(() => {
    void loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagFilter, scope.kind, scope.kind === 'folder' ? scope.folderId : null]);

  const inList = useMemo(() => notes.find((n) => n.id === activeId) ?? null, [notes, activeId]);
  const [activeFallback, setActiveFallback] = useState<Note | null>(null);
  const active = inList ?? activeFallback;

  // If the focused note isn't visible in the currently scoped list (e.g. deep
  // link to an archived note), fetch it directly so the editor still opens.
  useEffect(() => {
    if (!activeId) {
      setActiveFallback(null);
      return;
    }
    if (inList) {
      setActiveFallback(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const n = await NotesApi.get(activeId);
        if (!cancelled) setActiveFallback(n);
      } catch {
        if (!cancelled) {
          setActiveFallback(null);
          toast.info('Notiz nicht gefunden');
          setActiveId(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId, inList]);

  const create = async () => {
    try {
      const folder_id =
        scope.kind === 'folder' ? scope.folderId : scope.kind === 'uncategorized' ? null : null;
      const n = await NotesApi.create({
        title: 'Neue Notiz',
        folder_id,
      });
      setNotes((cur) => [n, ...cur]);
      setActiveId(n.id);
      void loadFolders();
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const updateNote = async (n: Note, patch: Partial<Note>) => {
    try {
      const upd = await NotesApi.update(n.id, patch);
      // If the note's archive flag flipped or the folder changed and we're in a
      // restricted scope, the note may need to disappear from the current list.
      const stillVisible =
        (scope.kind !== 'archive' ? !upd.is_archived : upd.is_archived) &&
        (scope.kind === 'folder'
          ? upd.folder_id === scope.folderId
          : scope.kind === 'uncategorized'
            ? upd.folder_id === null
            : true);
      if (!stillVisible) {
        setNotes((cur) => cur.filter((x) => x.id !== upd.id));
        if (activeId === upd.id) setActiveId(null);
      } else {
        setNotes((cur) =>
          [...cur.map((x) => (x.id === upd.id ? upd : x))].sort(sortNotes),
        );
      }
      void loadFolders();
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const removeNote = async (n: Note) => {
    if (
      !(await confirmDialog({
        title: 'Notiz löschen?',
        message: 'Diese Aktion kann nicht rückgängig gemacht werden.',
        confirmLabel: 'Löschen',
        variant: 'danger',
      }))
    )
      return;
    try {
      await NotesApi.remove(n.id);
      setNotes((cur) => cur.filter((x) => x.id !== n.id));
      if (activeId === n.id) setActiveId(null);
      void loadFolders();
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const moveNoteToFolder = async (noteId: number, folderId: number | null) => {
    const note = notes.find((n) => n.id === noteId);
    if (!note || note.folder_id === folderId) return;
    await updateNote(note, { folder_id: folderId });
  };

  const togglePin = async (n: Note) => {
    if (n.is_archived) return; // Archived notes can't be pinned
    await updateNote(n, { is_pinned: !n.is_pinned });
  };

  const toggleArchive = async (n: Note) => {
    await updateNote(n, { is_archived: !n.is_archived });
  };

  const pinned = notes.filter((n) => n.is_pinned);
  const others = notes.filter((n) => !n.is_pinned);

  const scopeLabel = (() => {
    if (scope.kind === 'all') return 'Alle Notizen';
    if (scope.kind === 'archive') return 'Archiv';
    if (scope.kind === 'uncategorized') return 'Ohne Ordner';
    const f = folders.find((x) => x.id === scope.folderId);
    return f ? f.name : 'Ordner';
  })();

  // On mobile (< 768px), once a note is open we hand off to the full-screen
  // NoteMobileLayout — sidebar/list disappear entirely until the user backs out.
  const isMobile = useMediaQuery('(max-width: 767.98px)');
  const showMobileFullScreen = isMobile && !!active;

  if (showMobileFullScreen) {
    return (
      <MobileNoteShell
        note={active!}
        availableTags={tags}
        folders={folders}
        onChange={(patch) => updateNote(active!, patch)}
        onDelete={() => removeNote(active!)}
        onTogglePin={() => togglePin(active!)}
        onToggleArchive={() => toggleArchive(active!)}
        onBack={() => setActiveId(null)}
        onOpenByTitle={openByTitle}
        onRestored={(n) => {
          setNotes((cur) => cur.map((x) => (x.id === n.id ? n : x)));
          setActiveFallback(n);
        }}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 min-h-[60vh]">
      <aside className="card p-3 flex flex-col gap-3 max-h-[78vh] sticky top-20">
        <div className="flex gap-2">
          <input
            className="input flex-1 py-1.5 text-sm"
            placeholder="Suche…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadNotes()}
          />
          <button className="btn-primary text-sm" onClick={create} title="Neue Notiz">+</button>
        </div>

        {/* Folders */}
        <div>
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Ordner
            </span>
            <button
              onClick={() => setFolderModal({ open: true, edit: null })}
              className="text-xs text-brand-700 hover:underline"
            >
              + Neuer Ordner
            </button>
          </div>
          <ul className="space-y-0.5">
            <SidebarRow
              active={scope.kind === 'all'}
              onClick={() => setScope({ kind: 'all' })}
              dot="#888884"
              label="Alle Notizen"
            />
            <SidebarRow
              active={scope.kind === 'uncategorized'}
              onClick={() => setScope({ kind: 'uncategorized' })}
              dot={null}
              label="Ohne Ordner"
              acceptDrop
              onDrop={(noteId) => void moveNoteToFolder(noteId, null)}
            />
            {folders.map((f) => (
              <SidebarRow
                key={f.id}
                active={scope.kind === 'folder' && scope.folderId === f.id}
                onClick={() => setScope({ kind: 'folder', folderId: f.id })}
                dot={f.color || '#00c896'}
                label={f.name}
                count={f.note_count}
                onEdit={() => setFolderModal({ open: true, edit: f })}
                acceptDrop
                onDrop={(noteId) => void moveNoteToFolder(noteId, f.id)}
              />
            ))}
          </ul>
        </div>

        {/* Tags */}
        <div>
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Tags
            </span>
            <button onClick={() => setTagsOpen(true)} className="text-xs text-muted hover:text-ink">
              ⚙
            </button>
          </div>
          <div className="flex flex-wrap gap-1 px-1">
            <button
              onClick={() => setTagFilter(null)}
              className={`text-xs px-2 py-1 rounded-full ${tagFilter === null ? 'bg-brand text-surface' : 'bg-page text-muted'}`}
            >
              alle
            </button>
            {tags.map((t) => (
              <button
                key={t.id}
                onClick={() => setTagFilter(tagFilter === t.name ? null : t.name)}
                className={`text-xs px-2 py-1 rounded-full ${tagFilter === t.name ? 'text-surface' : 'bg-page text-muted'}`}
                style={tagFilter === t.name ? { background: t.color || '#00c896' } : undefined}
              >
                #{t.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1" />

        {/* Archive toggle */}
        <button
          onClick={() => setScope(scope.kind === 'archive' ? { kind: 'all' } : { kind: 'archive' })}
          className={`text-sm px-3 py-2 rounded-ctl border transition ${
            scope.kind === 'archive'
              ? 'border-brand bg-brand-50 text-brand-700'
              : 'border-line text-muted hover:text-ink'
          }`}
        >
          {scope.kind === 'archive' ? '← Archiv schließen' : 'Archiv anzeigen'}
        </button>
      </aside>

      <section className="card p-4 flex flex-col gap-3 min-w-0">
        {loading ? (
          <div className="text-muted/70">Lade…</div>
        ) : active ? (
          <NoteEditor
            key={active.id}
            note={active}
            availableTags={tags}
            folders={folders}
            onChange={(patch) => updateNote(active, patch)}
            onDelete={() => removeNote(active)}
            onTogglePin={() => togglePin(active)}
            onToggleArchive={() => toggleArchive(active)}
            onBack={() => setActiveId(null)}
            onOpenByTitle={openByTitle}
            onRestored={(n) => {
              // Replace in the current list if present, else use the
              // fallback slot so the editor sees the new content.
              setNotes((cur) => cur.map((x) => (x.id === n.id ? n : x)));
              setActiveFallback(n);
            }}
          />
        ) : (
          <NoteList
            scopeLabel={scopeLabel}
            archive={scope.kind === 'archive'}
            pinned={pinned}
            others={others}
            onSelect={(n) => setActiveId(n.id)}
            onTogglePin={togglePin}
            onToggleArchive={toggleArchive}
            onCreate={create}
          />
        )}
      </section>

      <ManageTagsModal
        open={tagsOpen}
        tags={tags}
        onClose={() => setTagsOpen(false)}
        onChange={(t) => setTags(t)}
      />
      <FolderModal
        open={folderModal.open}
        edit={folderModal.edit ?? null}
        onClose={() => setFolderModal({ open: false })}
        onSaved={(f, deleted) => {
          if (deleted) {
            setFolders((cur) => cur.filter((x) => x.id !== f.id));
            if (scope.kind === 'folder' && scope.folderId === f.id) setScope({ kind: 'all' });
          } else {
            setFolders((cur) => {
              const without = cur.filter((x) => x.id !== f.id);
              return [...without, f].sort((a, b) => a.name.localeCompare(b.name));
            });
          }
          setFolderModal({ open: false });
          void loadNotes();
        }}
      />
    </div>
  );
}

// ---------- Note list with pinned section ----------

function NoteList({
  scopeLabel,
  archive,
  pinned,
  others,
  onSelect,
  onTogglePin,
  onToggleArchive,
  onCreate,
}: {
  scopeLabel: string;
  archive: boolean;
  pinned: Note[];
  others: Note[];
  onSelect: (n: Note) => void;
  onTogglePin: (n: Note) => void;
  onToggleArchive: (n: Note) => void;
  onCreate: () => void;
}) {
  if (pinned.length === 0 && others.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center text-muted/70 py-12 gap-3">
        <div>{archive ? 'Keine archivierten Notizen.' : 'Noch keine Notizen.'}</div>
        {!archive && (
          <button className="btn-secondary text-sm" onClick={onCreate}>
            Erste Notiz anlegen
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 overflow-auto -mx-1 px-1 max-h-[78vh]">
      <div className="text-sm text-muted px-1">{scopeLabel}</div>
      {pinned.length > 0 && (
        <>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted px-1">
            Angepinnt
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {pinned.map((n) => (
              <NoteCard
                key={n.id}
                note={n}
                onClick={() => onSelect(n)}
                onTogglePin={() => onTogglePin(n)}
                onToggleArchive={() => onToggleArchive(n)}
              />
            ))}
          </div>
          {others.length > 0 && <div className="border-t border-line my-1" />}
        </>
      )}
      {others.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {others.map((n) => (
            <NoteCard
              key={n.id}
              note={n}
              onClick={() => onSelect(n)}
              onTogglePin={() => onTogglePin(n)}
              onToggleArchive={() => onToggleArchive(n)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NoteCard({
  note,
  onClick,
  onTogglePin,
  onToggleArchive,
}: {
  note: Note;
  onClick: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(NOTE_DRAG_TYPE, String(note.id));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onClick}
      className="group relative card p-3 cursor-pointer hover:border-brand/60"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium truncate flex-1">{note.title || '(ohne Titel)'}</div>
        <button
          type="button"
          aria-label={note.is_pinned ? 'Pin entfernen' : 'Anpinnen'}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          disabled={note.is_archived}
          className={`text-sm transition ${
            note.is_pinned
              ? 'opacity-100 text-brand-700'
              : 'opacity-0 group-hover:opacity-100 text-muted/70 hover:text-ink'
          } ${note.is_archived ? 'cursor-not-allowed opacity-30' : ''}`}
        >
          📌
        </button>
      </div>
      <div className="text-xs text-muted truncate mt-0.5">
        {note.content.replace(/[#*_>`-]/g, '').slice(0, 80) || 'leer'}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="flex flex-wrap gap-1 min-w-0">
          {note.tags.slice(0, 4).map((t) => (
            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-page text-muted">
              #{t}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleArchive();
          }}
          className="text-[11px] text-muted/70 hover:text-ink opacity-0 group-hover:opacity-100"
          title={note.is_archived ? 'Wiederherstellen' : 'Archivieren'}
        >
          {note.is_archived ? '↩' : '🗄'}
        </button>
      </div>
    </div>
  );
}

// ---------- Sidebar row ----------

function SidebarRow({
  label,
  active,
  onClick,
  dot,
  count,
  onEdit,
  acceptDrop,
  onDrop,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  dot: string | null;
  count?: number;
  onEdit?: () => void;
  acceptDrop?: boolean;
  onDrop?: (noteId: number) => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <li>
      <div
        onClick={onClick}
        onDragOver={
          acceptDrop
            ? (e) => {
                if (e.dataTransfer.types.includes(NOTE_DRAG_TYPE)) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setHover(true);
                }
              }
            : undefined
        }
        onDragLeave={() => setHover(false)}
        onDrop={
          acceptDrop && onDrop
            ? (e) => {
                e.preventDefault();
                setHover(false);
                const id = Number(e.dataTransfer.getData(NOTE_DRAG_TYPE));
                if (Number.isFinite(id)) onDrop(id);
              }
            : undefined
        }
        className={`group flex items-center gap-2 px-2 py-1.5 rounded-ctl cursor-pointer text-sm ${
          active ? 'bg-brand-50 text-brand-700' : 'hover:bg-page'
        } ${hover ? 'ring-2 ring-brand/40' : ''}`}
      >
        <span
          className="size-2.5 rounded-full shrink-0"
          style={{ background: dot ?? 'transparent', border: dot ? undefined : '1px dashed currentColor' }}
        />
        <span className="flex-1 truncate">{label}</span>
        {typeof count === 'number' && (
          <span className="text-[11px] text-muted tabular-nums">{count}</span>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="text-[11px] text-muted/70 hover:text-ink opacity-0 group-hover:opacity-100"
            aria-label="Ordner bearbeiten"
          >
            ⋯
          </button>
        )}
      </div>
    </li>
  );
}

// ---------- Editor ----------

function NoteEditor({
  note,
  availableTags,
  folders,
  onChange,
  onDelete,
  onTogglePin,
  onToggleArchive,
  onBack,
  onOpenByTitle,
  onRestored,
}: {
  note: Note;
  availableTags: Tag[];
  folders: NoteFolder[];
  onChange: (patch: Partial<Note>) => void;
  onDelete: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onBack: () => void;
  onOpenByTitle: (title: string) => void;
  onRestored: (n: Note) => void;
}) {
  const state = useNoteEditingState(note, onChange);
  const [tagInput, setTagInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <>
      {/* Slim header: back, title, folder, pin, kebab. Archivieren / Verlauf
          / Löschen all live in the kebab now — they're rare, never need to
          be visible on every screen. */}
      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-ghost text-sm" onClick={onBack}>← Zurück</button>
        <input
          className="input flex-1 text-lg font-semibold min-w-[180px]"
          value={state.title}
          onChange={(e) => state.setTitle(e.target.value)}
          placeholder="Titel"
        />
        <select
          className="input py-1.5 w-36"
          value={note.folder_id ?? ''}
          onChange={(e) =>
            onChange({ folder_id: e.target.value === '' ? null : Number(e.target.value) })
          }
        >
          <option value="">— ohne Ordner —</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label={note.is_pinned ? 'Pin entfernen' : 'Anpinnen'}
          aria-pressed={note.is_pinned}
          disabled={note.is_archived}
          onClick={onTogglePin}
          className={`size-9 inline-flex items-center justify-center rounded-ctl transition ${
            note.is_pinned ? 'text-brand-700' : 'text-muted hover:text-ink'
          } ${note.is_archived ? 'opacity-30 cursor-not-allowed' : ''}`}
        >
          <PinIcon filled={note.is_pinned} />
        </button>
        <NoteActionsMenu
          isPinned={note.is_pinned}
          isArchived={note.is_archived}
          onTogglePin={onTogglePin}
          onChangeFolder={() => {
            // Surface a quick prompt — desktop also has the inline select,
            // so this entry mostly mirrors mobile behavior. Focus the select.
            const sel = document.querySelector<HTMLSelectElement>('select.input');
            sel?.focus();
          }}
          onToggleArchive={onToggleArchive}
          onShowHistory={() => setHistoryOpen(true)}
          onDelete={onDelete}
          buttonClassName="size-9"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {state.tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 text-xs bg-page px-2 py-1 rounded-full">
            #{t}
            <button
              onClick={() => state.setTags(state.tags.filter((x) => x !== t))}
              className="text-muted/70 hover:text-danger"
            >
              ×
            </button>
          </span>
        ))}
        <input
          list="tag-suggestions"
          className="px-2 py-1 text-xs border border-line rounded-full bg-surface outline-none focus:border-brand"
          placeholder="+ tag"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              const v = tagInput.trim().replace(/^#/, '');
              if (v && !state.tags.includes(v)) state.setTags([...state.tags, v]);
              setTagInput('');
            }
          }}
        />
        <datalist id="tag-suggestions">
          {availableTags.map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>
      </div>

      {/* Compact icon-only toolbar — replaces the lib's built-in toolbar
          and matches the mobile bottom toolbar for consistency. */}
      <NoteToolbar
        variant="desktop"
        content={state.content}
        setContent={state.setContent}
        getTextarea={state.getTextarea}
      />

      <div
        data-color-mode="light"
        className="flex-1 min-h-[400px] relative"
        ref={state.editorWrapRef}
      >
        <MDEditor
          value={state.content}
          onChange={(v) => {
            const next = v ?? '';
            state.setContent(next);
            state.detectAutocomplete(next);
          }}
          height={500}
          preview="live"
          hideToolbar
          textareaProps={{
            onKeyDown: state.onTextareaKeyDown,
            onClick: () => state.detectAutocomplete(state.content),
            onKeyUp: () => state.detectAutocomplete(state.content),
            placeholder: 'Inhalt… Tippe [[ um eine andere Notiz zu verlinken.',
          }}
          previewOptions={{
            remarkPlugins: [remarkWikilinks],
            components: {
              a: ({ href, children, ...rest }: any) => {
                const linked = parseWikilinkUrl(href);
                if (linked !== null) {
                  return (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        onOpenByTitle(linked);
                      }}
                      className="inline text-brand-700 underline decoration-dotted underline-offset-2 hover:decoration-solid"
                    >
                      {children}
                    </button>
                  );
                }
                return (
                  <a href={href} {...rest} target="_blank" rel="noreferrer noopener">
                    {children}
                  </a>
                );
              },
            },
          }}
        />
        {state.autocomplete && state.titleSuggestions.length > 0 && (
          (() => {
            // Snapshot so TS narrows `ac` cleanly inside callbacks.
            const ac = state.autocomplete;
            return (
              <div className="absolute z-20 left-2 right-2 sm:right-auto sm:max-w-sm bottom-2 card p-1 shadow-flat border border-line bg-surface">
                <div className="text-[11px] text-muted px-2 py-1">
                  Notiz verlinken — ↑/↓ wählen, Enter einfügen, Esc abbrechen
                </div>
                <ul className="max-h-48 overflow-auto">
                  {state.titleSuggestions.map((s, i) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault(); // keep textarea focus
                          state.insertWikilink(s.title);
                        }}
                        onMouseEnter={() =>
                          state.setAutocomplete({ ...ac, index: i })
                        }
                        className={`w-full text-left px-2 py-1.5 text-sm rounded ${
                          i === ac.index ? 'bg-brand-50 text-brand-700' : 'hover:bg-page'
                        }`}
                      >
                        {s.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()
        )}
      </div>

      {state.backlinks.length > 0 && (
        <section className="border border-line rounded-card p-3 mt-2">
          <div className="text-xs uppercase tracking-wide text-muted mb-2">
            Wird erwähnt in ({state.backlinks.length})
          </div>
          <ul className="space-y-1">
            {state.backlinks.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => onOpenByTitle(b.title)}
                  className="text-sm text-brand-700 hover:underline"
                >
                  {b.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <VersionHistoryPanel
        noteId={note.id}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onRestored={onRestored}
      />
    </>
  );
}

/** Pin icon — shared between desktop header and mobile title row. Filled
 *  state matches the spec ("filled when pinned"). */
function PinIcon({ filled }: { filled: boolean }) {
  // Inline SVG so we don't pull two pin variants from lucide just for this.
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path
        d="M12 17v5M9 10.76V6h6v4.76l3 3.24v2H6v-2l3-3.24z"
        fill={filled ? 'currentColor' : 'none'}
      />
    </svg>
  );
}

/** Mobile shell — owns the version history panel state so it can sit on top
 *  of the full-screen layout, otherwise the panel would be trapped inside
 *  the same fixed container and the backdrop wouldn't cover the topbar. */
function MobileNoteShell({
  note,
  availableTags,
  folders,
  onChange,
  onDelete,
  onTogglePin,
  onToggleArchive,
  onBack,
  onOpenByTitle,
  onRestored,
}: {
  note: Note;
  availableTags: Tag[];
  folders: NoteFolder[];
  onChange: (patch: Partial<Note>) => void;
  onDelete: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onBack: () => void;
  onOpenByTitle: (title: string) => void;
  onRestored: (n: Note) => void;
}) {
  const state = useNoteEditingState(note, onChange);
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <>
      <NoteMobileLayout
        note={note}
        state={state}
        availableTags={availableTags}
        folders={folders}
        onChange={onChange}
        onDelete={onDelete}
        onTogglePin={onTogglePin}
        onToggleArchive={onToggleArchive}
        onShowHistory={() => setHistoryOpen(true)}
        onBack={onBack}
        onOpenByTitle={onOpenByTitle}
      />
      <VersionHistoryPanel
        noteId={note.id}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onRestored={onRestored}
      />
    </>
  );
}

// ---------- Folder modal ----------

function FolderModal({
  open,
  edit,
  onClose,
  onSaved,
}: {
  open: boolean;
  edit: NoteFolder | null;
  onClose: () => void;
  onSaved: (folder: NoteFolder, deleted: boolean) => void;
}) {
  const [name, setName] = useState(edit?.name ?? '');
  const [color, setColor] = useState(edit?.color ?? '#00c896');
  const [busy, setBusy] = useState(false);
  const confirmDialog = useConfirm();

  useEffect(() => {
    if (open) {
      setName(edit?.name ?? '');
      setColor(edit?.color ?? '#00c896');
    }
  }, [open, edit]);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const folder = edit
        ? await NoteFoldersApi.update(edit.id, { name: name.trim(), color })
        : await NoteFoldersApi.create(name.trim(), color);
      onSaved(folder, false);
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!edit) return;
    if (
      !(await confirmDialog({
        title: `Ordner „${edit.name}" löschen?`,
        message: 'Notizen darin bleiben erhalten und werden „Ohne Ordner" zugeordnet.',
        confirmLabel: 'Löschen',
        variant: 'danger',
      }))
    )
      return;
    setBusy(true);
    try {
      await NoteFoldersApi.remove(edit.id);
      onSaved(edit, true);
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={edit ? 'Ordner bearbeiten' : 'Neuer Ordner'}>
      <div className="space-y-3">
        <div>
          <label className="label">Name</label>
          <input
            className="input"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Farbe</label>
          <input
            type="color"
            className="h-[42px] w-16 rounded-xl border border-line cursor-pointer"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
        <div className="flex justify-between pt-2 gap-2">
          {edit ? (
            <button type="button" className="btn-ghost text-sm text-danger" disabled={busy} onClick={remove}>
              Ordner löschen
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
              Abbrechen
            </button>
            <button type="button" className="btn-primary" disabled={busy || !name.trim()} onClick={save}>
              {busy ? 'Speichern…' : 'Speichern'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Tags modal ----------

function ManageTagsModal({
  open,
  tags,
  onClose,
  onChange,
}: {
  open: boolean;
  tags: Tag[];
  onClose: () => void;
  onChange: (t: Tag[]) => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#00c896');

  const create = async () => {
    if (!name.trim()) return;
    try {
      const t = await TagsApi.create(name.trim(), color);
      onChange([...tags, t].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const remove = async (t: Tag) => {
    try {
      await TagsApi.remove(t.id);
      onChange(tags.filter((x) => x.id !== t.id));
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Tags verwalten">
      <div className="space-y-3">
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="Neuer Tag" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="color" className="h-[42px] w-14 rounded-xl border border-line" value={color} onChange={(e) => setColor(e.target.value)} />
          <button className="btn-primary" onClick={create}>+</button>
        </div>
        {tags.length === 0 ? (
          <div className="text-sm text-muted">Keine Tags.</div>
        ) : (
          <ul className="divide-y divide-line">
            {tags.map((t) => (
              <li key={t.id} className="py-2 flex items-center justify-between">
                <span className="inline-flex items-center gap-2">
                  <span className="size-3 rounded-full" style={{ background: t.color || '#00c896' }} />
                  #{t.name}
                </span>
                <button className="text-xs text-danger hover:underline" onClick={() => remove(t)}>Löschen</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

// ---------- helpers ----------

function sortNotes(a: Note, b: Note): number {
  if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
  return b.updated_at.localeCompare(a.updated_at);
}
