import { useEffect, useState } from 'react';
import MDEditor from '@uiw/react-md-editor';
import { NotesApi } from '@/api/endpoints';
import type { Note, NoteVersionFull, NoteVersionListItem } from '@/types';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { relativeDe } from '@/lib/relativeTime';

interface Props {
  noteId: number;
  open: boolean;
  onClose: () => void;
  /** Called after a successful restore so the editor can refresh. */
  onRestored: (note: Note) => void;
}

export function VersionHistoryPanel({ noteId, open, onClose, onRestored }: Props) {
  const [list, setList] = useState<NoteVersionListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selected, setSelected] = useState<NoteVersionFull | null>(null);
  const [restoring, setRestoring] = useState(false);

  // Reload versions whenever the panel opens or the note changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setSelectedId(null);
    setSelected(null);
    NotesApi.versions(noteId)
      .then((rows) => {
        if (cancelled) return;
        setList(rows);
        // Auto-select the newest version so there's something to look at.
        if (rows.length > 0) setSelectedId(rows[0].id);
      })
      .catch((e) => {
        if (!cancelled) toast.error(getApiError(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId, open]);

  // When a row is picked, fetch its full content.
  useEffect(() => {
    if (!open || selectedId === null) {
      setSelected(null);
      return;
    }
    let cancelled = false;
    NotesApi.version(noteId, selectedId)
      .then((v) => {
        if (!cancelled) setSelected(v);
      })
      .catch((e) => {
        if (!cancelled) toast.error(getApiError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, noteId, selectedId]);

  const restore = async () => {
    if (selectedId === null) return;
    if (
      !confirm(
        'Diese Version wiederherstellen? Der aktuelle Stand wird vorher als neue Version gesichert.',
      )
    )
      return;
    setRestoring(true);
    try {
      const updated = await NotesApi.restoreVersion(noteId, selectedId);
      onRestored(updated);
      toast.success('Version wiederhergestellt');
      onClose();
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setRestoring(false);
    }
  };

  if (!open) return null;
  return (
    <>
      {/* Backdrop on small screens */}
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        className="fixed inset-0 z-30 bg-ink/30 sm:hidden"
        onClick={onClose}
      />
      <aside
        className="fixed right-0 top-0 z-40 h-full w-full sm:w-[520px] bg-surface border-l border-line shadow-flat flex flex-col"
        style={{ paddingTop: 'env(safe-area-inset-top, 0)' }}
      >
        <header className="px-4 py-3 border-b border-line flex items-center gap-2">
          <h3 className="font-semibold flex-1">Versionsverlauf</h3>
          <button className="btn-ghost text-sm" onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </header>

        <div className="flex-1 grid grid-rows-[auto_1fr] sm:grid-rows-[180px_1fr] overflow-hidden">
          {/* Version list */}
          <div className="overflow-auto border-b border-line">
            {loading ? (
              <div className="p-4 text-sm text-muted">Lade…</div>
            ) : list.length === 0 ? (
              <div className="p-4 text-sm text-muted">
                Noch keine Versionen — die erste wird beim nächsten Speichern angelegt.
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {list.map((v) => {
                  const isActive = v.id === selectedId;
                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(v.id)}
                        className={`w-full text-left px-4 py-2 ${
                          isActive ? 'bg-brand-50' : 'hover:bg-page'
                        }`}
                        title={new Date(v.created_at).toLocaleString('de-DE')}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className={`text-sm font-medium ${isActive ? 'text-brand-700' : ''}`}>
                            {relativeDe(v.created_at)}
                          </span>
                          <span className="text-[11px] text-muted tabular-nums">
                            {new Date(v.created_at).toLocaleTimeString('de-DE', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <div className="text-xs text-muted truncate">{v.title || '(ohne Titel)'}</div>
                        {v.preview && (
                          <div className="text-[11px] text-muted/70 truncate mt-0.5">
                            {v.preview}
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Preview pane */}
          <div className="overflow-auto p-4 flex flex-col gap-3 min-h-0">
            {selected ? (
              <>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-xs text-muted">
                      {new Date(selected.created_at).toLocaleString('de-DE')}
                    </div>
                    <div className="font-medium truncate">{selected.title || '(ohne Titel)'}</div>
                  </div>
                  <button
                    type="button"
                    className="btn-primary text-sm"
                    disabled={restoring}
                    onClick={restore}
                  >
                    {restoring ? 'Wiederherstellen…' : 'Diese Version wiederherstellen'}
                  </button>
                </div>
                <div data-color-mode="light" className="flex-1 min-h-0">
                  <MDEditor.Markdown
                    source={selected.content || '_(leer)_'}
                    style={{ background: 'transparent' }}
                  />
                </div>
              </>
            ) : (
              <div className="text-sm text-muted">Wähle links eine Version aus, um sie anzusehen.</div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
