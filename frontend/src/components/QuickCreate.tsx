/** Quick-create button for the "Heute" screen.
 *
 *  One primary button, four ways to start something: Liste, Aufgabe, Notiz,
 *  Rezept. Dropdown on desktop / BottomSheet on mobile, mirroring
 *  AccountMenu and NoteActionsMenu — rows always carry icon AND text.
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
import { useEffect, useRef, useState, type FormEvent, useId} from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckSquare, ChefHat, ListPlus, NotebookPen, Plus } from 'lucide-react';
import { ItemsApi, ListsApi, NotesApi } from '@/api/endpoints';
import { getApiError } from '@/api/client';
import { BottomSheet } from '@/components/BottomSheet';
import { CreateListModal } from '@/components/lists/CreateListModal';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { invalidateOverview } from '@/hooks/useOverviewQuery';
import type { ListSummary } from '@/types';

export function QuickCreate() {
  const isMobile = useMediaQuery('(max-width: 767.98px)');
  const [open, setOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    if (!open || isMobile) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, isMobile]);

  const newNote = async () => {
    setOpen(false);
    try {
      const n = await NotesApi.create({ title: 'Neue Notiz', folder_id: null });
      invalidateOverview('notes');
      nav(`/notes?focus=${n.id}`);
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const ACTIONS = [
    { icon: ListPlus, label: 'Neue Liste', run: () => { setOpen(false); setListOpen(true); } },
    { icon: CheckSquare, label: 'Neue Aufgabe', run: () => { setOpen(false); setTaskOpen(true); } },
    { icon: NotebookPen, label: 'Neue Notiz', run: newNote },
    { icon: ChefHat, label: 'Neues Rezept', run: () => { setOpen(false); nav('/recipes/new'); } },
  ];

  const rows = (variant: 'sheet' | 'dropdown') => {
    const base =
      variant === 'sheet'
        ? 'w-full flex items-center gap-3 px-5 py-3.5 text-[15px] text-left transition active:bg-page'
        : 'w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-left hover:bg-page transition';
    const sz = variant === 'sheet' ? 20 : 16;
    return ACTIONS.map(({ icon: Icon, label, run }) => (
      <button key={label} type="button" role="menuitem" onClick={run} className={base}>
        <Icon size={sz} className="shrink-0 text-muted" />
        {label}
      </button>
    ));
  };

  return (
    <>
      <div ref={wrapRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="btn-primary inline-flex items-center gap-1.5"
        >
          <Plus size={18} />
          Neu
        </button>

        {isMobile ? (
          <BottomSheet
            open={open}
            onClose={() => setOpen(false)}
            maxHeightClass="max-h-[60vh]"
            ariaLabel="Neu anlegen"
          >
            <div className="py-1">{rows('sheet')}</div>
          </BottomSheet>
        ) : (
          open && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-1 z-30 min-w-[200px] card p-1 shadow-flat border border-line bg-surface"
            >
              {rows('dropdown')}
            </div>
          )
        )}
      </div>

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
