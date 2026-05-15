import { useEffect, useState } from 'react';
import { Sparkles, Hand, X, Zap } from 'lucide-react';
import type { CategorizationMode, ListSummary, ListType } from '@/types';
import { ListsApi } from '@/api/endpoints';
import { SharePanel } from '@/components/lists/SharePanel';
import { CollaboratorsPanel } from '@/components/lists/CollaboratorsPanel';
import { RemindersPanel } from '@/components/lists/RemindersPanel';
import { HistoryPanel } from '@/components/lists/HistoryPanel';
import { toast } from '@/components/Toast';
import { useConfirm } from '@/components/Dialogs';
import { getApiError } from '@/api/client';
import { PresetPicker } from '@/components/PresetPicker';
import { categoriesForType } from '@/data/listCategories';

interface Props {
  open: boolean;
  list: ListSummary;
  onClose: () => void;
  onListUpdate: (patch: Partial<ListSummary>) => void;
  /** Notified when the user starts a manual categorize run. Lets the parent
   *  show a progress indicator above the items list. */
  onCategorizationStarted?: (queued: number) => void;
}

const TYPE_OPTIONS: { v: ListType; label: string }[] = [
  { v: 'SHOPPING', label: 'Einkauf' },
  { v: 'PACKING', label: 'Packliste' },
  { v: 'CHECKLIST', label: 'Checkliste' },
  { v: 'CUSTOM', label: 'Eigene' },
];

/** Slide-in side panel with list-level configuration. */
export function ListSettingsPanel({
  open,
  list,
  onClose,
  onListUpdate,
  onCategorizationStarted,
}: Props) {
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
          {/* Categorization only makes sense for list types with a fixed
              taxonomy (SHOPPING, PACKING). CHECKLIST relies on the AI
              list-generator to seed its dynamic categories at creation
              time; CUSTOM lists have no categorization at all. Hiding
              the section here keeps the toggle from being a footgun
              (enabling AUTO on CHECKLIST/CUSTOM was a no-op anyway). */}
          {categoriesForType(list.type) && (
            <CategorizationModeSection
              list={list}
              onListUpdate={onListUpdate}
              onCategorizationStarted={onCategorizationStarted}
              saveField={async (_field, payload) => {
                try {
                  const updated = await ListsApi.update(list.id, payload);
                  onListUpdate(updated);
                } catch (e) {
                  toast.error(getApiError(e));
                }
              }}
            />
          )}
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

  // PresetPicker fires onChange on every preset click and on every keystroke
  // in the custom-emoji input — debounce the autosave so picking a preset
  // sends one PATCH (both fields) and typing a custom emoji coalesces into
  // one PATCH instead of one per keystroke. The props-sync effect above
  // resets local state when the server confirms, so the diff is always
  // against the latest known server values.
  useEffect(() => {
    const handle = setTimeout(() => {
      const curIcon = list.icon ?? '';
      const curColor = list.color ?? '#00c896';
      const patch: Parameters<typeof ListsApi.update>[1] = {};
      if (icon !== curIcon) patch.icon = icon;
      if (color !== curColor) patch.color = color;
      if (Object.keys(patch).length === 0) return;
      void saveField('preset', patch);
    }, 600);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [icon, color]);

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
      <div>
        <label className="label">Symbol &amp; Farbe</label>
        <div className="flex items-center gap-3">
          <PresetPicker
            emoji={icon}
            color={color}
            onChange={({ emoji, color }) => {
              setIcon(emoji);
              setColor(color);
            }}
          />
          <span className="text-xs text-muted">
            {savingField === 'preset' ? 'Speichert…' : 'Tippen, um Symbol oder Farbe zu ändern.'}
          </span>
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
    </div>
  );
}

// Wraps the mode selector + manual buttons; rendered as a sibling card under
// "Listendetails" inside the Settings Panel.
function CategorizationModeSection({
  list,
  onListUpdate,
  saveField,
  onCategorizationStarted,
}: {
  list: ListSummary;
  onListUpdate: (patch: Partial<ListSummary>) => void;
  saveField: (field: string, payload: Parameters<typeof ListsApi.update>[1]) => Promise<void>;
  onCategorizationStarted?: (queued: number) => void;
}) {
  const [busy, setBusy] = useState<'normal' | 'force' | null>(null);
  const [lastQueued, setLastQueued] = useState<number | null>(null);
  const active = MODE_OPTIONS.find((m) => m.v === list.categorization_mode) ?? MODE_OPTIONS[0];
  const confirmDialog = useConfirm();

  const trigger = async (force: boolean) => {
    if (
      force &&
      !(await confirmDialog({
        title: 'Alle Items neu kategorisieren?',
        message:
          'Auch manuell festgelegte Kategorien werden überschrieben und neu gesetzt.',
        confirmLabel: 'Neu kategorisieren',
      }))
    )
      return;
    setBusy(force ? 'force' : 'normal');
    setLastQueued(null);
    try {
      const r = await ListsApi.categorize(list.id, force);
      setLastQueued(r.queued);
      if (r.queued > 0) onCategorizationStarted?.(r.queued);
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card p-4">
      <div className="text-sm font-medium mb-2">Kategorisierung</div>
      <div className="grid grid-cols-3 gap-1 bg-page border border-line rounded-xl p-1 mb-2">
        {MODE_OPTIONS.map((m) => {
          const isActive = list.categorization_mode === m.v;
          const Icon = m.icon;
          return (
            <button
              key={m.v}
              type="button"
              onClick={() => {
                if (!isActive) {
                  void saveField('categorization_mode', { categorization_mode: m.v });
                  onListUpdate({ categorization_mode: m.v });
                }
              }}
              className={`flex flex-col items-center gap-1 py-2 px-1 rounded-lg text-xs font-medium transition ${
                isActive ? 'bg-surface shadow-flat text-brand-700' : 'text-muted hover:bg-surface/60'
              }`}
            >
              <Icon size={16} />
              {m.label}
            </button>
          );
        })}
      </div>
      <div className="text-xs text-muted px-1 mb-3">{active.description}</div>

      {list.categorization_mode !== 'OFF' && (
        <div className="space-y-2">
          <button
            type="button"
            className="btn-primary w-full text-sm"
            disabled={busy !== null}
            onClick={() => void trigger(false)}
          >
            <Sparkles size={14} className={busy === 'normal' ? 'animate-pulse' : ''} />
            {busy === 'normal' ? 'Starte…' : 'Jetzt kategorisieren'}
          </button>
          <button
            type="button"
            className="btn-secondary w-full text-xs"
            disabled={busy !== null}
            onClick={() => void trigger(true)}
          >
            {busy === 'force' ? 'Starte…' : 'Alle neu kategorisieren'}
          </button>
          {lastQueued !== null && (
            <div className="text-xs text-muted px-1">
              {lastQueued === 0
                ? 'Alle Items sind bereits kategorisiert.'
                : `${lastQueued} Item${lastQueued === 1 ? '' : 's'} in der Warteschlange — Fortschritt erscheint im Hauptfenster.`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const MODE_OPTIONS: {
  v: CategorizationMode;
  label: string;
  icon: typeof Hand;
  description: string;
}[] = [
  {
    v: 'OFF',
    label: 'Aus',
    icon: X,
    description: 'Items werden in der Reihenfolge angezeigt, in der du sie hinzufügst.',
  },
  {
    v: 'MANUAL',
    label: 'Manuell',
    icon: Hand,
    description:
      'Items werden auf Wunsch nach Kategorie gruppiert. Du löst die Kategorisierung selbst aus.',
  },
  {
    v: 'AUTO',
    label: 'Automatisch',
    icon: Zap,
    description: 'Jedes neue Item wird sofort einer Kategorie zugeordnet.',
  },
];
