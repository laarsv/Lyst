/** Mobile-first full-screen note view (under 768 px).
 *
 *  Layout (top to bottom):
 *    [Top bar]   ← back, kebab
 *    [Title row] tap-to-edit title + pin toggle
 *    [Tag row]   inline chips + "+ tag" input
 *    [Mode]      "Bearbeiten | Vorschau" segmented control
 *    [Content]   either MDEditor (edit-only) or rendered Markdown
 *    [Toolbar]   sticky to viewport bottom, only in edit mode, follows
 *                the iOS keyboard via visualViewport.
 *
 *  All state plumbing (autosave, autocomplete, backlinks) is reused from
 *  the shared `useNoteEditingState` hook, so the editing semantics are
 *  identical to the desktop split-view. */
import { useEffect, useRef, useState } from 'react';
import MDEditor from '@uiw/react-md-editor';
import { ArrowLeft, Pin, X } from 'lucide-react';
import type { Note, NoteFolder, Tag } from '@/types';
import type { NoteEditingState } from '@/hooks/useNoteEditingState';
import { remarkWikilinks, parseWikilinkUrl } from '@/lib/wikilinks';
import remarkGfm from 'remark-gfm';
import { FolderChip } from './FolderChip';
import { NoteActionsMenu } from './NoteActionsMenu';
import { NoteToolbar } from './NoteToolbar';
import { SaveIndicator, type SaveIndicatorApi } from '@/components/SaveIndicator';

interface Props {
  note: Note;
  state: NoteEditingState;
  /** Autosave indicator state. Optional so legacy callers without the
   *  hook plumbed in still render — they just don't see the chip. */
  save?: SaveIndicatorApi;
  availableTags: Tag[];
  folders: NoteFolder[];
  onChange: (patch: Partial<Note>) => void | Promise<boolean | void>;
  onDelete: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onShowHistory: () => void;
  onBack: () => void;
  onOpenByTitle: (title: string) => void;
  onCreateFolder: () => void;
}

export function NoteMobileLayout({
  note,
  state,
  save,
  availableTags,
  folders,
  onChange,
  onDelete,
  onTogglePin,
  onToggleArchive,
  onShowHistory,
  onBack,
  onOpenByTitle,
  onCreateFolder,
}: Props) {
  const [mode, setMode] = useState<'edit' | 'preview'>('preview');
  const [titleEditing, setTitleEditing] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [pinPulse, setPinPulse] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const keyboardOffset = useKeyboardOffset();

  useEffect(() => {
    if (titleEditing) titleInputRef.current?.focus();
  }, [titleEditing]);

  // Reset to preview every time the user opens a different note.
  useEffect(() => {
    setMode('preview');
    setTitleEditing(false);
  }, [note.id]);

  const handlePin = () => {
    if (note.is_archived) return;
    setPinPulse(true);
    setTimeout(() => setPinPulse(false), 250);
    onTogglePin();
  };

  return (
    <div className="fixed inset-0 z-30 bg-page flex flex-col"
         style={{ paddingTop: 'env(safe-area-inset-top, 0)' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-2 py-1 bg-surface border-b border-line shrink-0">
        <button
          type="button"
          onClick={onBack}
          aria-label="Zurück zur Notizliste"
          className="size-11 inline-flex items-center justify-center rounded-ctl text-ink hover:bg-page"
        >
          <ArrowLeft size={22} />
        </button>
        <NoteActionsMenu
          isPinned={note.is_pinned}
          isArchived={note.is_archived}
          onTogglePin={handlePin}
          onChangeFolder={() => setFolderPickerOpen(true)}
          onToggleArchive={onToggleArchive}
          onShowHistory={onShowHistory}
          onDelete={onDelete}
          buttonClassName="size-11"
        />
      </div>

      {/* Title row */}
      <div className="flex items-center gap-2 px-3 pt-3 shrink-0">
        {titleEditing ? (
          <input
            ref={titleInputRef}
            value={state.title}
            onChange={(e) => state.setTitle(e.target.value)}
            onBlur={() => setTitleEditing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') setTitleEditing(false);
            }}
            placeholder="Titel"
            className="flex-1 bg-transparent text-xl font-semibold outline-none border-b border-brand pb-1"
          />
        ) : (
          <button
            type="button"
            onClick={() => setTitleEditing(true)}
            className="flex-1 text-left text-xl font-semibold truncate min-h-[2.25rem]"
          >
            {state.title || <span className="text-muted/70">Titel</span>}
          </button>
        )}
        {save && <SaveIndicator state={save.state} onRetry={save.retry} />}
        <button
          type="button"
          onClick={handlePin}
          aria-label={note.is_pinned ? 'Pin entfernen' : 'Anpinnen'}
          aria-pressed={note.is_pinned}
          disabled={note.is_archived}
          className={`size-11 inline-flex items-center justify-center rounded-ctl transition-transform ${
            note.is_pinned ? 'text-brand-700' : 'text-muted hover:text-ink'
          } ${pinPulse ? 'scale-125' : 'scale-100'} ${
            note.is_archived ? 'opacity-30 cursor-not-allowed' : ''
          }`}
        >
          <Pin size={20} fill={note.is_pinned ? 'currentColor' : 'none'} />
        </button>
      </div>

      {/* Metadata row: folder chip + tag chips + "+ tag" input. Folder
          and tags are visually grouped — both are chip-shaped. */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 mt-2 shrink-0">
        <FolderChip
          folders={folders}
          currentFolderId={note.folder_id}
          onChange={(id) => onChange({ folder_id: id })}
          onCreateFolder={onCreateFolder}
          open={folderPickerOpen}
          onOpenChange={setFolderPickerOpen}
        />
        {state.tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 text-xs bg-surface border border-line px-2 py-1 rounded-full"
          >
            #{t}
            <button
              type="button"
              onClick={() => state.setTags(state.tags.filter((x) => x !== t))}
              className="text-muted/70 hover:text-danger -mr-0.5"
              aria-label={`Tag ${t} entfernen`}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          list="tag-suggestions-mobile"
          className="px-2 py-1 text-xs border border-line rounded-full bg-surface outline-none focus:border-brand min-w-[80px]"
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
        <datalist id="tag-suggestions-mobile">
          {availableTags.map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>
      </div>

      {/* Mode toggle */}
      <div className="px-3 mt-3 shrink-0">
        <div className="inline-flex bg-surface border border-line rounded-ctl p-0.5 text-sm">
          <ModeButton active={mode === 'edit'} onClick={() => setMode('edit')}>
            Bearbeiten
          </ModeButton>
          <ModeButton active={mode === 'preview'} onClick={() => setMode('preview')}>
            Vorschau
          </ModeButton>
        </div>
      </div>

      {/* Content — fills the remaining space, scrolls. The bottom padding
          accounts for the sticky toolbar + iOS keyboard so the cursor
          line is never hidden behind them. */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-3 pt-3"
        style={{ paddingBottom: mode === 'edit' ? `${72 + keyboardOffset}px` : '24px' }}
      >
        {mode === 'edit' ? (
          <div data-color-mode="light" className="relative" ref={state.editorWrapRef}>
            <MDEditor
              value={state.content}
              onChange={(v) => {
                const next = v ?? '';
                state.setContent(next);
                state.detectAutocomplete(next);
              }}
              preview="edit"
              hideToolbar
              visibleDragbar={false}
              height={600}
              textareaProps={{
                onKeyDown: state.onTextareaKeyDown,
                onClick: () => state.detectAutocomplete(state.content),
                onKeyUp: () => state.detectAutocomplete(state.content),
                placeholder: 'Inhalt… Tippe [[ um eine andere Notiz zu verlinken.',
              }}
            />
            {state.autocomplete && state.titleSuggestions.length > 0 && (
              <WikilinkPopup state={state} />
            )}
          </div>
        ) : (
          <div data-color-mode="light" className="max-w-none">
            <MDEditor.Markdown
              source={state.content || '_Leere Notiz._'}
              style={{ background: 'transparent' }}
              remarkPlugins={[remarkGfm, remarkWikilinks]}
              components={{
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
                        className="inline text-brand-700 underline decoration-dotted underline-offset-2"
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
              }}
            />
            {state.backlinks.length > 0 && (
              <section className="border-t border-line mt-6 pt-3">
                <div className="text-xs uppercase tracking-wide text-muted mb-2">
                  Wird erwähnt in ({state.backlinks.length})
                </div>
                <ul className="space-y-1">
                  {state.backlinks.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        onClick={() => onOpenByTitle(b.title)}
                        className="text-sm text-brand-700 underline decoration-dotted"
                      >
                        {b.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>

      {/* Sticky bottom toolbar (only in edit mode). `bottom` follows the
          iOS keyboard via the visualViewport hook so the bar stays visible
          right above the keys. */}
      {mode === 'edit' && (
        <div
          className="fixed left-0 right-0 z-30"
          style={{
            bottom: `${keyboardOffset}px`,
            paddingBottom: keyboardOffset > 0 ? 0 : 'env(safe-area-inset-bottom, 0)',
          }}
        >
          <NoteToolbar
            variant="mobile"
            content={state.content}
            setContent={state.setContent}
            getTextarea={state.getTextarea}
          />
        </div>
      )}

    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded text-sm font-medium transition ${
        active ? 'bg-page text-ink shadow-sm' : 'text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function WikilinkPopup({ state }: { state: NoteEditingState }) {
  const ac = state.autocomplete!;
  return (
    <div className="absolute z-20 left-2 right-2 sm:right-auto sm:max-w-sm bottom-2 card p-1 shadow-flat border border-line bg-surface">
      <div className="text-[11px] text-muted px-2 py-1">
        Notiz verlinken — Enter einfügen, Esc abbrechen
      </div>
      <ul className="max-h-48 overflow-auto">
        {state.titleSuggestions.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                state.insertWikilink(s.title);
              }}
              onMouseEnter={() => state.setAutocomplete({ ...ac, index: i })}
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
}

/** Returns the on-screen keyboard's height in pixels. Uses visualViewport
 *  (iOS Safari, Chrome Android, modern desktop browsers); falls back to 0
 *  when the API is missing. The toolbar binds its `bottom` to this value
 *  so it sits right above the keyboard. */
function useKeyboardOffset(): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const vv = (window as any).visualViewport as VisualViewport | undefined;
    if (!vv) return;
    const update = () => {
      const kb = window.innerHeight - vv.height - vv.offsetTop;
      // Round and clamp at 0 — visualViewport can briefly return a tiny
      // negative when the page over-scrolls.
      setOffset(Math.max(0, Math.round(kb)));
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return offset;
}
