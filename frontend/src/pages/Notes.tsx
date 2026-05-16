import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { NoteFoldersApi, NotesApi, SearchApi, TagsApi } from '@/api/endpoints';
import type { Note, NoteFolder, Tag } from '@/types';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { VersionHistoryPanel } from '@/components/notes/VersionHistoryPanel';
import { NoteEditor } from '@/components/notes/NoteEditor';
import { LegacyMarkdownView } from '@/components/notes/LegacyMarkdownView';
import { NoteActionsMenu } from '@/components/notes/NoteActionsMenu';
import { NoteMobileLayout } from '@/components/notes/NoteMobileLayout';
import { NoteSummaryModal } from '@/components/notes/NoteSummaryModal';
import { FolderChip } from '@/components/notes/FolderChip';
import { Loader2, Sparkles, Users } from 'lucide-react';
import { SharedChip } from '@/components/SharedChip';
import { ShareNotePanel } from '@/components/notes/ShareNotePanel';
import { NotesFilterButton } from '@/components/notes/NotesFilterButton';
import { NotesFilterPanel } from '@/components/notes/NotesFilterPanel';
import { ActiveFilterChips } from '@/components/notes/ActiveFilterChips';
import { useConfirm } from '@/components/Dialogs';
import { BackLink } from '@/components/BackLink';
import { SaveIndicator, useSaveIndicator } from '@/components/SaveIndicator';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useNoteEditingState } from '@/hooks/useNoteEditingState';
import { useNoteConflict } from '@/hooks/useNoteConflict';
import { NoteConflictBanner } from '@/components/notes/NoteConflictBanner';
import { hasActiveFilters, useNotesFilters } from '@/store/notesFilters';
import { invalidateOverview, useOverviewQuery, useResourceQuery } from '@/hooks/useOverviewQuery';
import { Plus, Search } from 'lucide-react';

const NOTE_DRAG_TYPE = 'application/x-lyst-note-id';

export function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const { q, scope, tagFilter, setQ, setScope, setTagFilter } = useNotesFilters();
  const filtersActive = useNotesFilters((s) => hasActiveFilters(s));
  const [loading, setLoading] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
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
    // Strip the focus param so back-navigation doesn't keep re-focusing.
    // KEEP `?task=…` for the separate pulse effect below — it gets
    // consumed once the TipTap doc has rendered the matching taskItem.
    params.delete('focus');
    setParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // Deep-link pulse for note tasks: /notes?focus=<n>&task=<t> scrolls
  // the matching <li data-task-id="…"> into view and pulses .task-pulse.
  // TipTap inserts the doc asynchronously, so we poll for the node up
  // to ~1.5s before giving up. Once we find it (or time out) we drop
  // the `?task=` param so a re-render can't re-pulse.
  useEffect(() => {
    const taskId = params.get('task');
    if (!taskId || activeId === null) return;
    const id = Number(taskId);
    if (!Number.isFinite(id)) return;
    let cancelled = false;
    let attempts = 0;
    let timer: number | null = null;
    const tryHighlight = () => {
      if (cancelled) return;
      const node = document.querySelector<HTMLElement>(
        `.ProseMirror [data-task-id="${id}"]`,
      );
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        node.classList.add('task-pulse');
        window.setTimeout(() => node.classList.remove('task-pulse'), 1600);
        params.delete('task');
        setParams(params, { replace: true });
        return;
      }
      attempts += 1;
      if (attempts > 15) {
        // Give up after ~1.5s of polling. Clear the param so we don't
        // get stuck pulsing on the next mount.
        params.delete('task');
        setParams(params, { replace: true });
        return;
      }
      timer = window.setTimeout(tryHighlight, 100);
    };
    tryHighlight();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, params.get('task')]);

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
      const all = await NotesApi.list(params);
      // Client-side narrowing for "Mit mir geteilt" — backend already
      // mixes own + shared rows so we just keep the share_source ones.
      setNotes(scope.kind === 'shared' ? all.filter((n) => n.share_source) : all);
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

  // Network-first refresh: refetches on mount, on focus, on cross-page
  // mutation invalidation, and whenever filter scope/tag changes (the
  // key encodes the filter so a different scope refetches as expected).
  useOverviewQuery(
    `notes:${scope.kind}:${
      scope.kind === 'folder' ? scope.folderId : ''
    }:${tagFilter ?? ''}`,
    () => loadNotes(),
  );

  const inList = useMemo(() => notes.find((n) => n.id === activeId) ?? null, [notes, activeId]);
  const [activeFallback, setActiveFallback] = useState<Note | null>(null);
  const active = inList ?? activeFallback;

  // Clear the fallback when activeId/inList means it's no longer needed
  // (e.g. the note showed up in the scoped list after a reload). The
  // actual fetch is handled by <NoteFallbackLoader> below so it can
  // subscribe to focus/visibility refetches via useResourceQuery —
  // otherwise a deep-linked archived note fetched once would never
  // pick up later remote edits.
  useEffect(() => {
    if (!activeId || inList) setActiveFallback(null);
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

  // Returns true on success / false on failure so the editor's autosave
  // hook can drive the SaveIndicator state. Errors still surface as toasts;
  // existing call sites (togglePin / toggleArchive / moveNoteToFolder) just
  // ignore the return value.
  const updateNote = async (n: Note, patch: Partial<Note>): Promise<boolean> => {
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
      // The Note row in the overview embeds `content`, `title`, `tags`,
      // `folder_id`, etc. — every update can change a sibling subscription
      // (e.g. user is in scope=all, edits the title, then navigates to
      // scope=folder which has its own cached state). Ping every notes:*
      // subscriber so its next render reflects the change.
      invalidateOverview('notes');
      void loadFolders();
      return true;
    } catch (e) {
      toast.error(getApiError(e));
      return false;
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
      // Prefix-match every notes subscriber (e.g. `notes:all::`,
      // `notes:folder:5:`) — without this the parameterized key never
      // matches the bare 'notes' name and the sibling list stays stale.
      invalidateOverview('notes');
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

  const leaveShare = async (n: Note) => {
    if (
      !(await confirmDialog({
        title: 'Diese Freigabe verlassen?',
        message:
          'Die Notiz verschwindet aus deiner Ansicht. Der Besitzer kann sie dir erneut freigeben.',
        confirmLabel: 'Verlassen',
        variant: 'danger',
      }))
    )
      return;
    try {
      await NotesApi.leaveShare(n.id);
      setNotes((cur) => cur.filter((x) => x.id !== n.id));
      if (activeId === n.id) setActiveId(null);
      invalidateOverview('notes');
      toast.success('Freigabe verlassen');
    } catch (e) {
      toast.error(getApiError(e));
    }
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
    if (scope.kind === 'shared') return 'Mit mir geteilt';
    const f = folders.find((x) => x.id === scope.folderId);
    return f ? f.name : 'Ordner';
  })();

  // On mobile (< 768px), once a note is open we hand off to the full-screen
  // NoteMobileLayout — sidebar/list disappear entirely until the user backs out.
  const isMobile = useMediaQuery('(max-width: 767.98px)');
  const showMobileFullScreen = isMobile && !!active;

  // Mounts the deep-link fallback fetcher only while needed (activeId
  // set + the note isn't already in the visible scope's list). Lives
  // in its own component so it can subscribe via useResourceQuery
  // unconditionally — the parent can't, because hook order is bound
  // to render order. Returns null; side-effects only.
  const fallbackNode = activeId && !inList ? (
    <NoteFallbackLoader
      key={activeId}
      noteId={activeId}
      onLoaded={setActiveFallback}
      onMissing={() => {
        setActiveFallback(null);
        toast.info('Notiz nicht gefunden');
        setActiveId(null);
      }}
    />
  ) : null;

  if (showMobileFullScreen) {
    return (
      <>
        {fallbackNode}
        <MobileNoteShell
          note={active!}
          availableTags={tags}
          folders={folders}
          onChange={(patch) => updateNote(active!, patch)}
          onDelete={() => removeNote(active!)}
          onTogglePin={() => togglePin(active!)}
          onToggleArchive={() => toggleArchive(active!)}
          onLeaveShare={() => leaveShare(active!)}
          onBack={() => setActiveId(null)}
          onOpenByTitle={openByTitle}
          onCreateFolder={() => setFolderModal({ open: true, edit: null })}
          onRestored={(n) => {
            setNotes((cur) => cur.map((x) => (x.id === n.id ? n : x)));
            setActiveFallback(n);
          }}
        />
      </>
    );
  }

  // Mobile overview (no note open). Compact sticky header + chips + list;
  // sidebar is replaced by the bottom-sheet filter panel.
  if (isMobile) {
    return (
      <div className="-mx-4 -my-4 sm:-my-6 flex flex-col min-h-[calc(100vh-56px)] bg-page">
        {fallbackNode}
        {/* Sticky search row — pinned under the AppShell header (~56px). */}
        <div className="sticky top-14 z-20 bg-surface border-b border-line px-3 py-2 flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/70 pointer-events-none"
            />
            <input
              className="input w-full pl-9 py-2 text-sm"
              placeholder="Suche…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadNotes()}
            />
          </div>
          <NotesFilterButton
            active={filtersActive}
            onClick={() => setFilterPanelOpen(true)}
          />
          <button
            type="button"
            onClick={create}
            aria-label="Neue Notiz"
            className="size-11 inline-flex items-center justify-center rounded-ctl bg-brand text-surface hover:bg-brand-700 transition"
          >
            <Plus size={20} />
          </button>
        </div>

        <ActiveFilterChips folders={folders} />

        <div className="flex-1 px-3 pt-3 pb-6">
          {loading ? (
            <div className="text-muted/70 py-8 text-center">Lade…</div>
          ) : (
            <NoteList
              scopeLabel={scopeLabel}
              archive={scope.kind === 'archive'}
              pinned={pinned}
              others={others}
              folders={folders}
              onSelect={(n) => setActiveId(n.id)}
              onTogglePin={togglePin}
              onToggleArchive={toggleArchive}
              onCreate={create}
            />
          )}
        </div>

        <NotesFilterPanel
          open={filterPanelOpen}
          onClose={() => setFilterPanelOpen(false)}
          folders={folders}
          tags={tags}
          onCreateFolder={() => {
            setFilterPanelOpen(false);
            setFolderModal({ open: true, edit: null });
          }}
          onEditFolder={(f) => {
            setFilterPanelOpen(false);
            setFolderModal({ open: true, edit: f });
          }}
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 min-h-[60vh]">
      {fallbackNode}
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
            <SidebarRow
              active={scope.kind === 'shared'}
              onClick={() => setScope({ kind: 'shared' })}
              dot="#7c5fff"
              label="Mit mir geteilt"
            />
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
          <NoteEditorPane
            key={active.id}
            note={active}
            availableTags={tags}
            folders={folders}
            onChange={(patch) => updateNote(active, patch)}
            onDelete={() => removeNote(active)}
            onTogglePin={() => togglePin(active)}
            onToggleArchive={() => toggleArchive(active)}
            onLeaveShare={() => leaveShare(active)}
            onBack={() => setActiveId(null)}
            onOpenByTitle={openByTitle}
            onCreateFolder={() => setFolderModal({ open: true, edit: null })}
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
            folders={folders}
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
  folders,
  onSelect,
  onTogglePin,
  onToggleArchive,
  onCreate,
}: {
  scopeLabel: string;
  archive: boolean;
  pinned: Note[];
  others: Note[];
  folders: NoteFolder[];
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
                folder={folders.find((f) => f.id === n.folder_id) ?? null}
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
              folder={folders.find((f) => f.id === n.folder_id) ?? null}
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
  folder,
  onClick,
  onTogglePin,
  onToggleArchive,
}: {
  note: Note;
  /** Looked up by parent so we don't index-by-id 100x in render. null
   *  when the note has no folder (Ohne Ordner). */
  folder: NoteFolder | null;
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
        <div className="font-medium truncate flex-1 flex items-center gap-1.5 min-w-0">
          {note.share_source && (
            <span
              title={`Geteilt von ${note.owner_name ?? 'jemandem'}`}
              className="shrink-0 text-brand-700"
            >
              <Users size={13} />
            </span>
          )}
          <span className="truncate">{note.title || '(ohne Titel)'}</span>
          {/* Unified share indicator — covers internal shares
              AND the public token, with a tooltip that names both.
              Recipient-side notes (share_source set) hide this; the
              "geteilt von …" banner above carries that signal. */}
          {!note.share_source && (
            <SharedChip state={note.share_state} className="shrink-0" />
          )}
        </div>
        <button
          type="button"
          aria-label={note.is_pinned ? 'Pin entfernen' : 'Anpinnen'}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          disabled={note.is_archived || !!note.share_source}
          className={`text-sm transition ${
            note.is_pinned
              ? 'opacity-100 text-brand-700'
              : 'opacity-0 group-hover:opacity-100 text-muted/70 hover:text-ink'
          } ${note.is_archived || note.share_source ? 'cursor-not-allowed opacity-30' : ''}`}
        >
          📌
        </button>
      </div>
      <div className="text-xs text-muted truncate mt-0.5">
        {/* Backend-computed snippet — stripped of HTML/markdown noise,
            collapsed whitespace, ~120 chars. Falls back to "leer" for
            empty notes. */}
        {note.snippet || 'leer'}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1 min-w-0">
          {/* Folder indicator — small color dot + name. Owner-side notes
              only (recipients can't see the owner's folder). Notes
              without a folder show nothing here to keep the row quiet. */}
          {folder && !note.share_source && (
            <span
              className="inline-flex items-center gap-1 text-[10px] text-muted truncate max-w-[120px]"
              title={`Ordner: ${folder.name}`}
            >
              <span
                className="inline-block size-2 rounded-full shrink-0"
                style={{ background: folder.color || '#00c896' }}
              />
              <span className="truncate">{folder.name}</span>
            </span>
          )}
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

// ---------- Editor pane (desktop split-view) ----------

function NoteEditorPane({
  note,
  availableTags,
  folders,
  onChange,
  onDelete,
  onTogglePin,
  onToggleArchive,
  onLeaveShare,
  onBack,
  onOpenByTitle,
  onRestored,
  onCreateFolder,
}: {
  note: Note;
  availableTags: Tag[];
  folders: NoteFolder[];
  onChange: (patch: Partial<Note>) => void | Promise<boolean | void>;
  onDelete: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onLeaveShare: () => void;
  onBack: () => void;
  onOpenByTitle: (title: string) => void;
  onRestored: (n: Note) => void;
  onCreateFolder: () => void;
}) {
  const save = useSaveIndicator();
  const state = useNoteEditingState(note, onChange, {
    onSaveStart: save.signalSaving,
    onSaveSuccess: save.signalSaved,
    onSaveError: save.signalError,
  });
  const conflict = useNoteConflict(note.id);
  const confirmReload = useConfirm();
  const reloadNote = async () => {
    if (
      state.isDirty &&
      !(await confirmReload({
        title: 'Lokale Änderungen verwerfen?',
        message:
          'Die Notiz wurde gerade von jemand anderem bearbeitet. Beim Neuladen gehen deine lokalen Änderungen verloren.',
        confirmLabel: 'Neu laden',
        variant: 'danger',
      }))
    ) {
      return;
    }
    try {
      const fresh = await NotesApi.get(note.id);
      onRestored(fresh);
      conflict.dismiss();
    } catch (e) {
      toast.error(getApiError(e));
    }
  };
  const [tagInput, setTagInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [titleSuggesting, setTitleSuggesting] = useState(false);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  // Recipients (note shared TO this user) get a permission-aware view:
  //   - VIEW recipients: read-only — no edit controls, no AI, no share, no metadata
  //   - EDIT recipients: can edit content + use AI; still no share/delete/folder/pin
  // `isRecipient` gates owner-only chrome; `canEdit` gates content edits.
  const isRecipient = note.share_source !== null;
  const canEdit = !isRecipient || note.share_permission === 'EDIT';
  const readOnly = !canEdit;
  // Lifted so both the chip and the kebab "Ordner ändern" entry pop the
  // same FolderPicker (one source of truth for the open state).
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);

  const suggestTitle = async () => {
    setTitleSuggesting(true);
    try {
      const r = await NotesApi.aiTitle(note.id);
      state.setTitle(r.title);
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setTitleSuggesting(false);
    }
  };

  const suggestTags = async () => {
    setTagsLoading(true);
    try {
      const r = await NotesApi.aiTags(note.id);
      // Filter against the live tag state (state.tags is the source of truth).
      setTagSuggestions(r.tags.filter((t) => !state.tags.includes(t)));
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setTagsLoading(false);
    }
  };

  return (
    <>
      {/* Slim header: back, title, save indicator, pin, kebab. Folder lives
          in the metadata row below — it was crowding the title and the
          dropdown was getting truncated. */}
      <div className="flex items-center gap-2 flex-wrap">
        <BackLink
          to="/notes"
          label="zu Notizen"
          // Notes' overview lives at the same /notes route — toggling activeId
          // back to null reveals it without an SPA navigation. Cancelling the
          // route nav avoids a wasted re-mount.
          onBeforeNavigate={() => {
            onBack();
            return false;
          }}
        />
        <div className="flex-1 min-w-[180px] relative">
          <input
            className="input w-full text-lg font-semibold pr-10"
            value={state.title}
            onChange={(e) => state.setTitle(e.target.value)}
            placeholder="Titel"
            readOnly={readOnly}
            title={readOnly ? 'Geteilte Notiz — schreibgeschützt' : undefined}
            // Mobile keyboard hints — sentence-case + autocorrect on so
            // tapping into the title behaves like any other text field.
            autoCapitalize="sentences"
            autoCorrect="on"
            spellCheck
          />
          {isRecipient && note.owner_name && (
            <div
              className="absolute -bottom-5 left-1 text-[11px] text-brand-700 inline-flex items-center gap-1"
              title="Geteilte Notiz"
            >
              <Users size={11} />
              <span>
                Geteilt von {note.owner_name}
                {canEdit ? ' · Bearbeitung erlaubt' : ' · schreibgeschützt'}
              </span>
            </div>
          )}
          {/* Title sparkles — visible whenever the user can edit content
              (owner OR EDIT recipient) and the title is empty. */}
          {canEdit && !state.title.trim() && state.content.trim() && (
            <button
              type="button"
              onClick={suggestTitle}
              disabled={titleSuggesting}
              title="Titel-Vorschlag (KI)"
              aria-label="Titel-Vorschlag (KI)"
              className="absolute right-2 top-1/2 -translate-y-1/2 size-7 inline-flex items-center justify-center rounded-ctl text-muted hover:text-brand-700 hover:bg-page transition disabled:opacity-50"
            >
              {titleSuggesting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
            </button>
          )}
        </div>
        <SaveIndicator state={save.state} onRetry={save.retry} />
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
          isRecipient={isRecipient}
          onTogglePin={onTogglePin}
          onChangeFolder={() => setFolderPickerOpen(true)}
          onToggleArchive={onToggleArchive}
          onShowHistory={isRecipient ? undefined : () => setHistoryOpen(true)}
          onDelete={isRecipient ? undefined : onDelete}
          // Summarize / AI tags = content-edit operation, allowed for EDIT.
          onSummarize={canEdit ? () => setSummaryOpen(true) : undefined}
          canSummarize={!!state.content.trim()}
          // Share-management = owner-only.
          onShare={isRecipient ? undefined : () => setShareOpen(true)}
          shareActive={note.share_enabled}
          onLeaveShare={isRecipient ? onLeaveShare : undefined}
          buttonClassName="size-9"
        />
      </div>

      {/* Metadata row: folder chip + tag chips + "+ tag" input — all chip-
          shaped so they read as related. Wraps cleanly when the user adds
          many tags. Folder is owner-only (recipients can't reorganise the
          owner's notes); tag editing follows canEdit. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {!isRecipient && (
          <FolderChip
            folders={folders}
            currentFolderId={note.folder_id}
            onChange={(id) => onChange({ folder_id: id })}
            onCreateFolder={onCreateFolder}
            open={folderPickerOpen}
            onOpenChange={setFolderPickerOpen}
          />
        )}
        {state.tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 text-xs bg-page px-2 py-1 rounded-full">
            #{t}
            {canEdit && (
              <button
                onClick={() => state.setTags(state.tags.filter((x) => x !== t))}
                className="text-muted/70 hover:text-danger"
              >
                ×
              </button>
            )}
          </span>
        ))}
        {canEdit && (
          <>
            <input
              list="tag-suggestions"
              className="px-2 py-1 text-xs border border-line rounded-full bg-surface outline-none focus:border-brand"
              placeholder="+ tag"
              value={tagInput}
              // inputMode=text + enterKeyHint=done switches the mobile
              // keyboard's return key label to "Fertig"/"Done" so the
              // user expects a commit, not a "go to next field" jump.
              inputMode="text"
              enterKeyHint="done"
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  // stopPropagation alongside preventDefault — the
                  // TipTap editor below installs document-level
                  // keymaps and was claiming the Enter, which moved
                  // focus to the contenteditable. Both calls are
                  // needed: preventDefault stops the browser's
                  // default form-submit-ish behavior, stopPropagation
                  // stops React's bubble to any ancestor handler.
                  e.preventDefault();
                  e.stopPropagation();
                  const v = tagInput.trim().replace(/^#/, '');
                  if (v && !state.tags.includes(v)) state.setTags([...state.tags, v]);
                  setTagInput('');
                  // Keep the caret in the input so the user can fire
                  // multiple tags in a row without re-tapping the
                  // field. No-op on the desktop browsers where the
                  // input stays focused naturally.
                  e.currentTarget.focus();
                }
              }}
            />
            <datalist id="tag-suggestions">
              {availableTags.map((t) => (
                <option key={t.id} value={t.name} />
              ))}
            </datalist>
            {/* Feature 8 — Sparkles button + AI tag suggestions as tappable chips. */}
            <button
              type="button"
              onClick={suggestTags}
              disabled={tagsLoading}
              title="Tags vorschlagen (KI)"
              aria-label="Tags vorschlagen (KI)"
              className="size-7 inline-flex items-center justify-center rounded-full text-muted hover:text-brand-700 hover:bg-page transition disabled:opacity-50"
            >
              {tagsLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
            </button>
            {tagSuggestions.length > 0 && (
              <span className="basis-full flex flex-wrap gap-1 mt-1">
                <span className="text-[10px] uppercase tracking-wider text-muted self-center">
                  Vorschläge:
                </span>
                {tagSuggestions.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      if (!state.tags.includes(t)) state.setTags([...state.tags, t]);
                      setTagSuggestions((cur) => cur.filter((x) => x !== t));
                    }}
                    className="inline-flex items-center gap-1 text-xs bg-brand-50 text-brand-700 hover:bg-brand-100 px-2 py-1 rounded-full transition"
                  >
                    + #{t}
                  </button>
                ))}
              </span>
            )}
          </>
        )}
      </div>

      {/* Soft-merge banner — appears when a remote edit lands on this
          note. Stays visible until the user reloads (replacing local
          state with the fresh server copy) or dismisses (keeping their
          edit; next autosave clobbers the remote change, same
          last-writer-wins behaviour we had before but now visible). */}
      <NoteConflictBanner
        visible={conflict.hasConflict}
        isDirty={state.isDirty}
        onReload={reloadNote}
        onDismiss={conflict.dismiss}
      />

      {/* TipTap WYSIWYG editor. Toolbar lives inside NoteEditor, hidden
          automatically when `editable=false` (VIEW recipients). Pre-
          migration markdown notes are detected via content_format and
          rendered through the legacy markdown viewer instead — once the
          one-shot migration script has run on production, that branch
          becomes dead code and can be removed alongside the column. */}
      <div className="flex-1 min-h-[400px] relative">
        {note.content_format === 'MARKDOWN' ? (
          <LegacyMarkdownView source={state.content} onOpenByTitle={onOpenByTitle} />
        ) : (
          <NoteEditor
            content={state.content}
            noteId={note.id}
            editable={canEdit}
            onChange={(html) => state.setContent(html)}
            onNavigate={onOpenByTitle}
          />
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

      {/* Feature 6: AI summarize. Triggered from the kebab menu. */}
      <NoteSummaryModal
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        noteId={note.id}
        onInsert={(summary) => {
          // Prepend as the note's intro paragraph; keep existing content
          // untouched after a blank-line separator. Autosave picks this
          // up via the existing 600ms debounce in useNoteEditingState.
          state.setContent(
            `${summary}\n\n${state.content}`.trimStart(),
          );
        }}
      />

      {/* Sharing — owner-only. Mounted regardless of `shareOpen` so the
          modal can animate; the panel itself bails when `open` is false. */}
      {!isRecipient && (
        <ShareNotePanel
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          note={note}
          onUpdate={(patch) => {
            // Forward share state changes through onChange so the parent's
            // notes list stays in sync. We bypass the autosave path —
            // share fields are already persisted server-side at /share/*.
            for (const [k, v] of Object.entries(patch)) {
              if (k === 'share_enabled' || k === 'share_token') {
                // Mutating the prop is normally a no-no; the parent
                // listens via the same updateNote pipeline, so we send
                // a partial through onChange instead.
                onChange({ [k]: v } as Partial<Note>);
              }
            }
          }}
        />
      )}
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
  onLeaveShare,
  onBack,
  onOpenByTitle,
  onRestored,
  onCreateFolder,
}: {
  note: Note;
  availableTags: Tag[];
  folders: NoteFolder[];
  onChange: (patch: Partial<Note>) => void | Promise<boolean | void>;
  onDelete: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onLeaveShare: () => void;
  onBack: () => void;
  onOpenByTitle: (title: string) => void;
  onRestored: (n: Note) => void;
  onCreateFolder: () => void;
}) {
  const save = useSaveIndicator();
  const state = useNoteEditingState(note, onChange, {
    onSaveStart: save.signalSaving,
    onSaveSuccess: save.signalSaved,
    onSaveError: save.signalError,
  });
  const conflict = useNoteConflict(note.id);
  const confirmReload = useConfirm();
  const reloadNote = async () => {
    if (
      state.isDirty &&
      !(await confirmReload({
        title: 'Lokale Änderungen verwerfen?',
        message:
          'Die Notiz wurde gerade von jemand anderem bearbeitet. Beim Neuladen gehen deine lokalen Änderungen verloren.',
        confirmLabel: 'Neu laden',
        variant: 'danger',
      }))
    ) {
      return;
    }
    try {
      const fresh = await NotesApi.get(note.id);
      onRestored(fresh);
      conflict.dismiss();
    } catch (e) {
      toast.error(getApiError(e));
    }
  };
  const [historyOpen, setHistoryOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const isRecipient = note.share_source !== null;
  const canEdit = !isRecipient || note.share_permission === 'EDIT';
  return (
    <>
      <NoteMobileLayout
        note={note}
        state={state}
        save={save}
        availableTags={availableTags}
        folders={folders}
        onChange={onChange}
        onDelete={isRecipient ? undefined : onDelete}
        onTogglePin={onTogglePin}
        onToggleArchive={onToggleArchive}
        onSummarize={canEdit ? () => setSummaryOpen(true) : undefined}
        onShowHistory={isRecipient ? undefined : () => setHistoryOpen(true)}
        onShare={isRecipient ? undefined : () => setShareOpen(true)}
        shareActive={note.share_enabled}
        onLeaveShare={isRecipient ? onLeaveShare : undefined}
        isRecipient={isRecipient}
        canEdit={canEdit}
        onBack={onBack}
        onOpenByTitle={onOpenByTitle}
        onCreateFolder={onCreateFolder}
        conflictBanner={
          <NoteConflictBanner
            visible={conflict.hasConflict}
            isDirty={state.isDirty}
            onReload={reloadNote}
            onDismiss={conflict.dismiss}
          />
        }
      />
      <VersionHistoryPanel
        noteId={note.id}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onRestored={onRestored}
      />
      <NoteSummaryModal
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        noteId={note.id}
        onInsert={(summary) => {
          state.setContent(`${summary}\n\n${state.content}`.trimStart());
        }}
      />
      {!isRecipient && (
        <ShareNotePanel
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          note={note}
          onUpdate={(patch) => {
            for (const [k, v] of Object.entries(patch)) {
              if (k === 'share_enabled' || k === 'share_token') {
                onChange({ [k]: v } as Partial<Note>);
              }
            }
          }}
        />
      )}
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

/** Side-effect-only loader for the deep-link / archived-note path.
 *
 *  Mounted by NotesPage only while a focus target exists outside the
 *  currently scoped list (`activeId && !inList`). Subscribes via
 *  useResourceQuery so the note re-fetches on focus return and when
 *  the user-WS broadcasts an edit — the earlier one-shot useEffect
 *  fetched once and then went stale on later remote changes.
 *
 *  `key={activeId}` on the parent's render means a different deep link
 *  re-mounts this loader cleanly, so we don't have to track the
 *  previous id ourselves. */
function NoteFallbackLoader({
  noteId,
  onLoaded,
  onMissing,
}: {
  noteId: number;
  onLoaded: (n: Note) => void;
  onMissing: () => void;
}) {
  const onLoadedRef = useRef(onLoaded);
  const onMissingRef = useRef(onMissing);
  onLoadedRef.current = onLoaded;
  onMissingRef.current = onMissing;

  const fetcher = useCallback(async () => {
    try {
      const n = await NotesApi.get(noteId);
      onLoadedRef.current(n);
    } catch {
      onMissingRef.current();
    }
  }, [noteId]);

  useResourceQuery(`note:${noteId}`, fetcher);
  return null;
}
