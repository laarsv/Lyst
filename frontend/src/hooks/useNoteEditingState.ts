/** Shared editor state for both the desktop split-view and the mobile
 *  full-screen note layout.
 *
 *  Holds:
 *   - local title / content / tags
 *   - 600 ms debounced autosave with optional success/error callbacks
 *   - backlinks fetched whenever the active note or its updated_at changes
 *
 *  The earlier markdown-era version of this hook also walked the DOM for
 *  MDEditor's hidden textarea and ran an `[[…]]` autocomplete plugin in
 *  JS. Both of those moved into the TipTap layer (the Wikilink extension
 *  ships its own Suggestion plugin), so the hook is now scoped to the
 *  bits that are still layout-agnostic. */
import {
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { SearchApi, type NoteTitleResult } from '@/api/endpoints';
import type { Note } from '@/types';

export interface NoteEditingState {
  title: string;
  setTitle: Dispatch<SetStateAction<string>>;
  content: string;
  setContent: Dispatch<SetStateAction<string>>;
  tags: string[];
  setTags: Dispatch<SetStateAction<string[]>>;
  backlinks: NoteTitleResult[];
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

  // Reset local state when switching to a different note.
  useEffect(() => {
    setTitle(note.title);
    setContent(note.content);
    setTags(note.tags);
  }, [note.id]);

  // Debounced autosave. Compares against the last-known server values so
  // remote-driven prop changes (e.g. version restore) don't cause a
  // redundant round-trip.
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
  // wikilink elsewhere shows up after autosave persists).
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

  return {
    title,
    setTitle,
    content,
    setContent,
    tags,
    setTags,
    backlinks,
  };
}
