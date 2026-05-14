/** Shared editor state for both the desktop split-view and the mobile
 *  full-screen note layout.
 *
 *  Holds:
 *   - local title/content/tags + 600ms-debounced autosave
 *   - wikilink autocomplete (`[[…` near the cursor → suggestion list)
 *   - backlinks fetched whenever the active note or its updated_at changes
 *   - a stable getTextarea() helper that walks the wrapper div to find
 *     MDEditor's internal textarea (the lib doesn't expose a ref for it).
 *
 *  The two layout components only differ in their chrome — they consume the
 *  same hook so the editing experience (autosave timing, autocomplete,
 *  backlinks) stays identical across viewports. */
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { SearchApi, type NoteTitleResult } from '@/api/endpoints';
import type { Note } from '@/types';

export interface AutocompleteState {
  query: string;
  index: number;
}

export interface NoteEditingState {
  title: string;
  setTitle: Dispatch<SetStateAction<string>>;
  content: string;
  setContent: Dispatch<SetStateAction<string>>;
  tags: string[];
  setTags: Dispatch<SetStateAction<string[]>>;
  backlinks: NoteTitleResult[];

  editorWrapRef: MutableRefObject<HTMLDivElement | null>;
  getTextarea: () => HTMLTextAreaElement | null;

  autocomplete: AutocompleteState | null;
  setAutocomplete: Dispatch<SetStateAction<AutocompleteState | null>>;
  titleSuggestions: NoteTitleResult[];
  detectAutocomplete: (newContent: string) => void;
  insertWikilink: (linkTitle: string) => void;
  onTextareaKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}

interface SaveCallbacks {
  onSaveStart?: () => void;
  /** Called after onChange resolves successfully (or returned non-Promise). */
  onSaveSuccess?: () => void;
  /** Called when onChange returned a Promise that rejected, or returned the
   *  literal `false` (the convention NotesPage.updateNote uses). The
   *  optional `retry` re-runs the same patch on user demand. */
  onSaveError?: (retry: () => void) => void;
}

export function useNoteEditingState(
  note: Note,
  onChange: (patch: Partial<Note>) => void | Promise<boolean | void>,
  callbacks: SaveCallbacks = {},
): NoteEditingState {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [tags, setTags] = useState<string[]>(note.tags);
  const [backlinks, setBacklinks] = useState<NoteTitleResult[]>([]);

  const editorWrapRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const getTextarea = (): HTMLTextAreaElement | null => {
    if (textareaRef.current && document.body.contains(textareaRef.current)) {
      return textareaRef.current;
    }
    const ta = editorWrapRef.current?.querySelector<HTMLTextAreaElement>('textarea') ?? null;
    textareaRef.current = ta;
    return ta;
  };

  const [autocomplete, setAutocomplete] = useState<AutocompleteState | null>(null);
  const [titleSuggestions, setTitleSuggestions] = useState<NoteTitleResult[]>([]);

  // Reset local state when switching to a different note.
  useEffect(() => {
    setTitle(note.title);
    setContent(note.content);
    setTags(note.tags);
    setAutocomplete(null);
    // textareaRef is intentionally NOT reset — when MDEditor remounts (key
    // changes per note), the next getTextarea() call walks the wrapper again.
  }, [note.id]);

  // Debounced autosave. Compares against the last-known server values so
  // remote-driven prop changes (e.g. version restore) don't cause a redundant
  // round-trip. Drives the optional save callbacks: `onSaveStart` fires
  // when the patch leaves, `onSaveSuccess` / `onSaveError(retry)` fire
  // based on what `onChange` returns (Promise<boolean> from
  // NotesPage.updateNote — false = failure).
  useEffect(() => {
    const t = setTimeout(() => {
      if (
        title !== note.title ||
        content !== note.content ||
        tags.join(',') !== note.tags.join(',')
      ) {
        const patch = { title, content, tags };
        const runSave = () => {
          callbacks.onSaveStart?.();
          let result: void | Promise<boolean | void>;
          try {
            result = onChange(patch);
          } catch {
            callbacks.onSaveError?.(runSave);
            return;
          }
          if (result instanceof Promise) {
            result.then(
              (ok) => {
                if (ok === false) callbacks.onSaveError?.(runSave);
                else callbacks.onSaveSuccess?.();
              },
              () => callbacks.onSaveError?.(runSave),
            );
          } else {
            callbacks.onSaveSuccess?.();
          }
        };
        runSave();
      }
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, tags]);

  // Backlinks — refetch on note id or updated_at (so a freshly typed
  // [[Title]] elsewhere shows up after autosave persists).
  useEffect(() => {
    let cancelled = false;
    SearchApi.noteBacklinks(note.id)
      .then((r) => {
        if (!cancelled) setBacklinks(r);
      })
      .catch(() => {
        /* non-critical */
      });
    return () => {
      cancelled = true;
    };
  }, [note.id, note.updated_at]);

  const detectAutocomplete = (newContent: string) => {
    const ta = getTextarea();
    if (!ta) {
      setAutocomplete(null);
      return;
    }
    const cursor = ta.selectionStart ?? newContent.length;
    const before = newContent.slice(0, cursor);
    const lastOpen = before.lastIndexOf('[[');
    if (lastOpen === -1) {
      setAutocomplete(null);
      return;
    }
    const between = before.slice(lastOpen + 2);
    if (between.includes(']]') || between.includes('\n')) {
      setAutocomplete(null);
      return;
    }
    setAutocomplete((prev) => ({
      query: between,
      // Preserve the highlighted suggestion as long as the query is unchanged
      // (cursor moves within the same `[[…` token). Reset to 0 when the user
      // types more characters so the new top match is highlighted.
      index: prev?.query === between ? prev.index : 0,
    }));
  };

  useEffect(() => {
    if (!autocomplete) {
      setTitleSuggestions([]);
      return;
    }
    let cancelled = false;
    SearchApi.noteTitles(autocomplete.query)
      .then((r) => {
        if (!cancelled) setTitleSuggestions(r.filter((s) => s.id !== note.id));
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [autocomplete?.query, note.id]);

  const insertWikilink = (linkTitle: string) => {
    const ta = getTextarea();
    if (!ta) return;
    const cursor = ta.selectionStart ?? content.length;
    const before = content.slice(0, cursor);
    const lastOpen = before.lastIndexOf('[[');
    if (lastOpen === -1) return;
    const after = content.slice(cursor);
    const insert = `[[${linkTitle}]]`;
    const newContent = content.slice(0, lastOpen) + insert + after;
    setContent(newContent);
    setAutocomplete(null);
    requestAnimationFrame(() => {
      const pos = lastOpen + insert.length;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = pos;
    });
  };

  const onTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!autocomplete || titleSuggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAutocomplete({
        ...autocomplete,
        index: (autocomplete.index + 1) % titleSuggestions.length,
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAutocomplete({
        ...autocomplete,
        index: (autocomplete.index - 1 + titleSuggestions.length) % titleSuggestions.length,
      });
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertWikilink(titleSuggestions[autocomplete.index].title);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setAutocomplete(null);
    }
  };

  return {
    title,
    setTitle,
    content,
    setContent,
    tags,
    setTags,
    backlinks,
    editorWrapRef,
    getTextarea,
    autocomplete,
    setAutocomplete,
    titleSuggestions,
    detectAutocomplete,
    insertWikilink,
    onTextareaKeyDown,
  };
}
