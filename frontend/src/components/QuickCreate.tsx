/** Quick-create button for the "Heute" screen.
 *
 *  One primary button, four ways to start something: Liste, Aufgabe, Notiz,
 *  Rezept. The dropdown/sheet mechanics come from ActionMenu.
 *
 *  It deliberately lives only here, not in the header: the app is trying to
 *  get quieter, and a global create button would add another icon to the bar
 *  we just decluttered.
 *
 *  Two of the four open a dialog (a list needs a name and type, a task needs
 *  a target list); the other two have a create route already, so they just
 *  go there — a note is created empty and opened in the editor, exactly what
 *  the "+" on the Notizen page does.
 */
import { useEffect, useState, useId, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckSquare, ChefHat, ListPlus, NotebookPen, Plus } from 'lucide-react';
import { ItemsApi, ListsApi, NotesApi } from '@/api/endpoints';
import { getApiError } from '@/api/client';
import { ActionMenu } from '@/components/ActionMenu';
import { CreateListModal } from '@/components/lists/CreateListModal';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { invalidateOverview } from '@/hooks/useOverviewQuery';
import type { ListSummary } from '@/types';

export function QuickCreate() {
  const [listOpen, setListOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const nav = useNavigate();

  const newNote = async () => {
    try {
      const n = await NotesApi.create({ title: 'Neue Notiz', folder_id: null });
      invalidateOverview('notes');
      nav(`/notes?focus=${n.id}`);
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  return (
    <>
      <ActionMenu
        triggerLabel="Neu"
        triggerIcon={Plus}
        items={[
          { label: 'Neue Liste', icon: ListPlus, run: () => setListOpen(true) },
          { label: 'Neue Aufgabe', icon: CheckSquare, run: () => setTaskOpen(true) },
          { label: 'Neue Notiz', icon: NotebookPen, run: () => void newNote() },
          { label: 'Neues Rezept', icon: ChefHat, run: () => nav('/recipes/new') },
        ]}
      />

      <CreateListModal
        open={listOpen}
        onClose={() => setListOpen(false)}
        onCreated={() => {
          setListOpen(false);
          invalidateOverview('lists');
        }}
      />
      <QuickTaskModal open={taskOpen} onClose={() => setTaskOpen(false)} />
    </>
  );
}

/** Capture a task without leaving "Heute": text plus the list it belongs to.
 *  Tasks have no table of their own — they are list items (or note tasks), so
 *  a target list is required rather than optional. */
function QuickTaskModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const fid = useId();
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [listId, setListId] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    ListsApi.list()
      .then((all) => {
        if (cancelled) return;
        // Only lists the user may write to; list() is sorted by updated_at,
        // so the first one is the list they touched last.
        const usable = all.filter((l) => l.is_owner || l.permission === 'EDIT');
        setLists(usable);
        setListId((cur) => cur ?? usable[0]?.id ?? null);
      })
      .catch((e) => toast.error(getApiError(e)));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!listId) return;
    setSaving(true);
    try {
      await ItemsApi.create(listId, text.trim());
      invalidateOverview('lists');
      toast.success('Aufgabe hinzugefügt');
      setText('');
      onClose();
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Neue Aufgabe">
      {lists.length === 0 ? (
        <p className="text-sm text-muted">
          Aufgaben leben in einer Liste — lege zuerst eine Liste an.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label" htmlFor={`${fid}-aufgabe`}>Aufgabe</label>
            <input
              id={`${fid}-aufgabe`}
              className="input"
              value={text}
              autoFocus
              required
              onChange={(e) => setText(e.target.value)}
              placeholder="z.B. Rechnung bezahlen"
            />
          </div>
          <div>
            <label className="label" htmlFor={`${fid}-in-liste`}>In Liste</label>
            <select
              id={`${fid}-in-liste`}
              className="input"
              value={listId ?? ''}
              onChange={(e) => setListId(Number(e.target.value))}
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.icon ? `${l.icon} ` : ''}
                  {l.title}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Abbrechen
            </button>
            <button type="submit" className="btn-primary" disabled={saving || !text.trim()}>
              {saving ? 'Speichern…' : 'Hinzufügen'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
