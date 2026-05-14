import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ListsApi } from '@/api/endpoints';
import type { ListSummary, ListType } from '@/types';
import { Modal } from '@/components/Modal';
import { ListCard } from '@/components/lists/ListCard';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { useNavigate } from 'react-router-dom';
import { PresetPicker } from '@/components/PresetPicker';
import { DEFAULT_PRESET_FOR_TYPE } from '@/data/presets';
import { useConfirm } from '@/components/Dialogs';
import { Trash2 } from 'lucide-react';

// Defaults below mirror DEFAULT_PRESET_FOR_TYPE so the type-card preview
// matches what the list will look like on creation. Keep them in sync.
const TYPES: { v: ListType; label: string; icon: string; color: string }[] = [
  { v: 'SHOPPING', label: 'Einkauf', icon: '🛒', color: '#00c896' },
  { v: 'PACKING', label: 'Packliste', icon: '🎒', color: '#2e7d6b' },
  { v: 'CHECKLIST', label: 'Checkliste', icon: '✅', color: '#00c896' },
  { v: 'CUSTOM', label: 'Eigene', icon: '📋', color: '#5e7a8a' },
];

type Mode = 'lists' | 'templates';

export function DashboardPage() {
  const [mode, setMode] = useState<Mode>('lists');
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [templates, setTemplates] = useState<ListSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<ListType | 'ALL'>('ALL');
  const [createOpen, setCreateOpen] = useState(false);
  const nav = useNavigate();
  const confirmDialog = useConfirm();

  useEffect(() => {
    void (async () => {
      try {
        setLists(await ListsApi.list());
      } catch (e) {
        toast.error(getApiError(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Lazy-load templates the first time the user switches to the segment.
  // Subsequent toggles reuse the cached array; mutations (delete / create
  // from template) update it locally.
  useEffect(() => {
    if (mode !== 'templates' || templatesLoaded) return;
    void (async () => {
      try {
        setTemplates(await ListsApi.templates());
        setTemplatesLoaded(true);
      } catch (e) {
        toast.error(getApiError(e));
      }
    })();
  }, [mode, templatesLoaded]);

  const filteredLists = useMemo(() => {
    return lists
      .filter((l) => (filter === 'ALL' ? true : l.type === filter))
      .filter((l) => (q ? l.title.toLowerCase().includes(q.toLowerCase()) : true));
  }, [lists, filter, q]);

  const filteredTemplates = useMemo(() => {
    if (!q) return templates;
    const needle = q.toLowerCase();
    return templates.filter(
      (t) =>
        (t.template_name ?? t.title).toLowerCase().includes(needle) ||
        t.title.toLowerCase().includes(needle),
    );
  }, [templates, q]);

  const useTemplate = async (t: ListSummary) => {
    try {
      const newList = await ListsApi.duplicate(t.id, { title: t.template_name || t.title });
      toast.success('Liste aus Vorlage erstellt');
      nav(`/lists/${newList.id}`);
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const deleteTemplate = async (t: ListSummary) => {
    if (
      !(await confirmDialog({
        title: `Vorlage „${t.template_name || t.title}" löschen?`,
        message: 'Diese Aktion kann nicht rückgängig gemacht werden.',
        confirmLabel: 'Löschen',
        variant: 'danger',
      }))
    )
      return;
    try {
      await ListsApi.remove(t.id);
      setTemplates((cur) => cur.filter((x) => x.id !== t.id));
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-semibold">
          {mode === 'lists' ? 'Deine Listen' : 'Deine Vorlagen'}
        </h1>
        {mode === 'lists' && (
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>
            + Neue Liste
          </button>
        )}
      </div>

      {/* Mode toggle — replaces the old top-level "Vorlagen" nav tab. */}
      <div className="inline-flex bg-surface border border-line rounded-xl p-1 mb-4 text-sm">
        <SegmentButton active={mode === 'lists'} onClick={() => setMode('lists')}>
          Listen
        </SegmentButton>
        <SegmentButton active={mode === 'templates'} onClick={() => setMode('templates')}>
          Vorlagen
        </SegmentButton>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <input
          className="input flex-1 min-w-[200px]"
          placeholder={mode === 'lists' ? 'Liste suchen…' : 'Vorlage suchen…'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {/* Type filter chips only apply to lists — templates have a single
            grid view, no need to filter by type. */}
        {mode === 'lists' && (
          <div className="flex gap-1 bg-surface border border-line rounded-xl p-1">
            {(['ALL', ...TYPES.map((t) => t.v)] as const).map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t as any)}
                className={`px-3 py-1.5 rounded-lg text-sm transition ${
                  filter === t ? 'bg-surface shadow-sm font-medium' : 'text-muted'
                }`}
              >
                {t === 'ALL' ? 'Alle' : TYPES.find((x) => x.v === t)?.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {mode === 'lists' ? (
        loading ? (
          <div className="text-muted/70">Lade…</div>
        ) : filteredLists.length === 0 ? (
          <div className="card p-12 text-center text-muted">
            Noch keine Listen.{' '}
            <button className="text-brand hover:underline" onClick={() => setCreateOpen(true)}>
              Erste Liste erstellen
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredLists.map((l) => (
              <ListCard key={l.id} list={l} />
            ))}
          </div>
        )
      ) : !templatesLoaded ? (
        <div className="text-muted/70">Lade…</div>
      ) : filteredTemplates.length === 0 ? (
        <div className="card p-12 text-center text-muted">
          {templates.length === 0
            ? 'Noch keine Vorlagen. Du kannst eine Liste in der Detailansicht als Vorlage speichern.'
            : 'Keine Vorlage passt zur Suche.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              onUse={() => useTemplate(t)}
              onDelete={() => deleteTemplate(t)}
            />
          ))}
        </div>
      )}

      <CreateListModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(l) => {
          setLists((cur) => [l, ...cur]);
          setCreateOpen(false);
        }}
      />
    </div>
  );
}

function SegmentButton({
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
      className={`px-4 py-1.5 rounded-lg font-medium transition ${
        active ? 'bg-page shadow-sm text-ink' : 'text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function TemplateCard({
  template: t,
  onUse,
  onDelete,
}: {
  template: ListSummary;
  onUse: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="card p-5 flex flex-col gap-3"
      style={{ borderTopColor: t.color || '#00c896', borderTopWidth: 4 }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {t.icon && <span className="text-2xl shrink-0">{t.icon}</span>}
        <div className="min-w-0">
          <div className="font-semibold truncate">{t.template_name || t.title}</div>
          <div className="text-xs text-muted">{t.item_count} Einträge</div>
        </div>
      </div>
      <div className="flex justify-end gap-1.5 pt-2">
        <button
          type="button"
          onClick={onDelete}
          aria-label="Vorlage löschen"
          title="Vorlage löschen"
          className="size-9 inline-flex items-center justify-center rounded-ctl text-muted hover:text-danger hover:bg-page transition"
        >
          <Trash2 size={16} />
        </button>
        <button className="btn-primary text-sm" onClick={onUse}>
          Verwenden
        </button>
      </div>
    </div>
  );
}

function CreateListModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (l: ListSummary) => void;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ListType>('SHOPPING');
  // Seed icon/color from the same preset table the picker uses, so the
  // initial trigger button matches the preview circle inside the picker.
  const [icon, setIcon] = useState(DEFAULT_PRESET_FOR_TYPE.SHOPPING.emoji);
  const [color, setColor] = useState(DEFAULT_PRESET_FOR_TYPE.SHOPPING.color);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const l = await ListsApi.create({ title, type, icon, color });
      onCreated(l);
      setTitle('');
      nav(`/lists/${l.id}`);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Neue Liste">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">Titel</label>
          <input
            className="input"
            value={title}
            autoFocus
            required
            onChange={(e) => setTitle(e.target.value)}
            placeholder="z.B. Wocheneinkauf"
          />
        </div>
        <div>
          <label className="label">Typ</label>
          <div className="grid grid-cols-2 gap-2">
            {TYPES.map((t) => (
              <button
                type="button"
                key={t.v}
                onClick={() => {
                  setType(t.v);
                  // Reseed the preset to the per-type default. Spec calls
                  // for SHOPPING → 🛒/#00c896, PACKING → 🎒/#2e7d6b,
                  // CHECKLIST → ✅/#00c896, CUSTOM → 📋/#5e7a8a.
                  const def = DEFAULT_PRESET_FOR_TYPE[t.v];
                  if (def) {
                    setIcon(def.emoji);
                    setColor(def.color);
                  }
                }}
                className={`p-3 rounded-xl border text-left transition ${
                  type === t.v ? 'border-brand bg-brand-50' : 'border-line hover:bg-page'
                }`}
              >
                <div className="text-2xl mb-1">{t.icon}</div>
                <div className="text-sm font-medium">{t.label}</div>
              </button>
            ))}
          </div>
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
              Tippen, um aus den Vorlagen zu wählen oder eigenes Emoji / eigene Farbe zu setzen.
            </span>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Anlegen…' : 'Anlegen'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
