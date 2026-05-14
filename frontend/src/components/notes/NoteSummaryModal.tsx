/** Feature 6: AI summary preview for a note.
 *
 *  Two states: loading spinner while the call is in flight, then a small
 *  card with the summary text and two actions:
 *    - "Als Notiz-Anfang einfügen" — prepends the summary as a paragraph
 *      to the existing content (with a blank line separator).
 *    - "Verwerfen" — closes without changes.
 *
 *  The fetch fires once when `open` flips true; reopening makes a fresh
 *  call so the user can re-run after edits. */
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { NotesApi } from '@/api/endpoints';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';

interface Props {
  open: boolean;
  onClose: () => void;
  noteId: number;
  /** Called when the user wants to insert the summary as the note's
   *  intro paragraph. Parent splices it into the editor's content state
   *  (server save happens via the existing autosave). */
  onInsert: (summary: string) => void;
}

export function NoteSummaryModal({ open, onClose, noteId, onInsert }: Props) {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSummary(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSummary(null);
    NotesApi.aiSummarize(noteId)
      .then((r) => {
        if (!cancelled) setSummary(r.summary);
      })
      .catch((e) => {
        if (!cancelled) {
          toast.error(getApiError(e));
          onClose();
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, noteId, onClose]);

  return (
    <Modal open={open} onClose={onClose} title="Zusammenfassung" className="max-w-md">
      <div className="space-y-3">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted py-3">
            <Loader2 size={16} className="animate-spin" />
            <span>KI fasst zusammen…</span>
          </div>
        )}
        {!loading && summary !== null && (
          <>
            <div className="text-sm leading-relaxed border border-line rounded-ctl p-3 bg-page/40 whitespace-pre-wrap">
              {summary}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Verwerfen
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  onInsert(summary);
                  onClose();
                  toast.success('Zusammenfassung eingefügt');
                }}
              >
                Als Notiz-Anfang einfügen
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
