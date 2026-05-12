import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { ListSummary, ListType } from '@/types';
import { ListsApi } from '@/api/endpoints';
import { SharePanel } from '@/components/lists/SharePanel';
import { CollaboratorsPanel } from '@/components/lists/CollaboratorsPanel';
import { RemindersPanel } from '@/components/lists/RemindersPanel';
import { HistoryPanel } from '@/components/lists/HistoryPanel';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';

interface Props {
  open: boolean;
  list: ListSummary;
  onClose: () => void;
  onListUpdate: (patch: Partial<ListSummary>) => void;
}

const TYPE_OPTIONS: { v: ListType; label: string }[] = [
  { v: 'SHOPPING', label: 'Einkauf' },
  { v: 'PACKING', label: 'Packliste' },
  { v: 'CHECKLIST', label: 'Checkliste' },
  { v: 'CUSTOM', label: 'Eigene' },
];

/** Slide-in side panel with list-level configuration. */
export function ListSettingsPanel({ open, list, onClose, onListUpdate }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <>
      <button
        type="button"
        aria-hidden={!open}
        tabIndex={-1}
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-ink/30 transition-opacity duration-200 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Listen-Einstellungen"
        className={`fixed top-0 right-0 z-50 h-full w-full sm:w-[400px] bg-page border-l border-line
          shadow-flat transition-transform duration-200 ease-out flex flex-col
          ${open ? 'translate-x-0' : 'translate-x-full'}`}
        style={{
          paddingTop: 'env(safe-area-inset-top, 0)',
          paddingBottom: 'env(safe-area-inset-bottom, 0)',
        }}
      >
        <header className="px-4 py-3 border-b border-line bg-surface flex items-center gap-2">
          <h2 className="font-semibold flex-1">Einstellungen</h2>
          <button
            type="button"
            className="p-2 rounded-lg text-muted hover:bg-page hover:text-ink"
            aria-label="Schließen"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          <Section title="Listendetails">
            <ListDetailsSection list={list} onListUpdate={onListUpdate} />
          </Section>
          <Section title="Öffentlicher Link">
            <SharePanel list={list} onUpdate={onListUpdate} />
          </Section>
          <Section title="Mitnutzer">
            <CollaboratorsPanel listId={list.id} />
          </Section>
          <Section title="Erinnerungen">
            <RemindersPanel listId={list.id} />
          </Section>
          <Section title="Verlauf">
            <HistoryPanel listId={list.id} />
          </Section>
        </div>
      </aside>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted mb-1.5 px-1">
        {title}
      </div>
      {children}
    </section>
  );
}

// ---------- Listendetails (replaces the standalone Edit modal) ----------

function ListDetailsSection({
  list,
  onListUpdate,
}: {
  list: ListSummary;
  onListUpdate: (patch: Partial<ListSummary>) => void;
}) {
  const [title, setTitle] = useState(list.title);
  const [icon, setIcon] = useState(list.icon ?? '');
  const [color, setColor] = useState(list.color ?? '#00c896');
  const [type, setType] = useState<ListType>(list.type);
  const [savingField, setSavingField] = useState<string | null>(null);

  useEffect(() => {
    setTitle(list.title);
    setIcon(list.icon ?? '');
    setColor(list.color ?? '#00c896');
    setType(list.type);
  }, [list.id, list.title, list.icon, list.color, list.type]);

  const saveField = async (field: string, payload: Parameters<typeof ListsApi.update>[1]) => {
    setSavingField(field);
    try {
      const updated = await ListsApi.update(list.id, payload);
      onListUpdate(updated);
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setSavingField(null);
    }
  };

  // Title autosaves on blur to avoid one PATCH per keystroke.
  const onTitleBlur = () => {
    if (title.trim() && title !== list.title) void saveField('title', { title: title.trim() });
  };

  return (
    <div className="card p-4 space-y-3">
      <div>
        <label className="label">Titel</label>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={onTitleBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          disabled={savingField === 'title'}
        />
      </div>
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="label">Emoji</label>
          <input
            className="input"
            value={icon}
            maxLength={4}
            onChange={(e) => setIcon(e.target.value)}
            onBlur={() => {
              if ((icon || null) !== (list.icon ?? null)) void saveField('icon', { icon });
            }}
          />
        </div>
        <div>
          <label className="label">Farbe</label>
          <input
            type="color"
            className="h-[42px] w-16 rounded-xl border border-line cursor-pointer"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            onBlur={() => {
              if (color !== (list.color ?? '#00c896')) void saveField('color', { color });
            }}
          />
        </div>
      </div>
      <div>
        <label className="label">Typ</label>
        <div className="grid grid-cols-2 gap-2">
          {TYPE_OPTIONS.map((t) => (
            <button
              type="button"
              key={t.v}
              onClick={() => {
                if (t.v === type) return;
                setType(t.v);
                void saveField('type', { type: t.v });
              }}
              className={`p-2 rounded-ctl border text-sm transition ${
                type === t.v ? 'border-brand bg-brand-50 text-brand-700' : 'border-line hover:bg-page'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center justify-between gap-3 cursor-pointer pt-1">
        <span className="min-w-0">
          <span className="block font-medium">Nach Kategorie sortieren</span>
          <span className="block text-xs text-muted">
            Items werden automatisch nach Kategorie gruppiert
            (Obst & Gemüse, Milchprodukte, …). Manuelles Verschieben deaktiviert.
          </span>
        </span>
        <input
          type="checkbox"
          className="sr-only peer"
          checked={list.sort_by_category}
          onChange={(e) =>
            void saveField('sort_by_category', { sort_by_category: e.target.checked })
          }
        />
        <span className="w-11 h-6 bg-line peer-checked:bg-brand rounded-full transition relative shrink-0 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-[#fff] after:rounded-full after:h-5 after:w-5 after:transition peer-checked:after:translate-x-5" />
      </label>
    </div>
  );
}
