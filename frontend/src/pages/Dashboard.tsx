import { useEffect, useMemo, useState } from 'react';
import { AiListsApi, ListsApi } from '@/api/endpoints';
import { useOverviewQuery } from '@/hooks/useOverviewQuery';
import type { ListSummary, ListType } from '@/types';
import { Modal } from '@/components/Modal';
import { ListCard } from '@/components/lists/ListCard';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_PRESET_FOR_TYPE, LIST_TYPES as TYPES } from '@/data/presets';
import { CreateListModal } from '@/components/lists/CreateListModal';
import { useConfirm } from '@/components/Dialogs';
import { Loader2, Sparkles, Trash2 } from 'lucide-react';
import type { AiGeneratedList } from '@/types';

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
  const [aiGenOpen, setAiGenOpen] = useState(false);
  const nav = useNavigate();
  const confirmDialog = useConfirm();

  // Network-first lists fetch — also fires on focus + on
  // invalidateOverview('lists') from list-detail mutations.
  useOverviewQuery('lists', async () => {
    try {
      setLists(await ListsApi.list());
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  });

  // Templates ride a separate key so switching segments doesn't refetch
  // the wrong set, and so a "duplicate template" mutation can refresh
  // just the templates list.
  useOverviewQuery(
    `templates:${mode === 'templates' ? 'on' : 'off'}`,
    async () => {
      // Lazy: only fetch when the segment is actually visible. Once the
      // user opens it the first time we keep refreshing on subsequent
      // mounts/focuses — that's the network-first contract.
      if (mode !== 'templates') return;
      try {
        setTemplates(await ListsApi.templates());
        setTemplatesLoaded(true);
      } catch (e) {
        toast.error(getApiError(e));
      }
    },
  );

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
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setAiGenOpen(true)}
              title="Liste mit KI generieren"
              aria-label="Liste mit KI generieren"
              className="size-10 inline-flex items-center justify-center rounded-ctl border border-line text-muted hover:text-brand-700 hover:bg-page transition"
            >
              <Sparkles size={18} />
            </button>
            <button className="btn-primary" onClick={() => setCreateOpen(true)}>
              + Neue Liste
            </button>
          </div>
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

      <AiGenerateListModal
        open={aiGenOpen}
        onClose={() => setAiGenOpen(false)}
        onCreated={(l) => {
          setLists((cur) => [l, ...cur]);
          setAiGenOpen(false);
          nav(`/lists/${l.id}`);
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

/** Feature 4: Generate a list from a goal.
 *
 *  Picks a list type, takes a free-text goal, asks Ollama for an item set,
 *  shows the preview, then on confirm: creates the list (with title + the
 *  default preset for the type) and bulk-inserts the items. For CHECKLIST
 *  the AI also returns category labels per item; we set those via PATCH on
 *  each item after creation. */
function AiGenerateListModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (l: ListSummary) => void;
}) {
  const [type, setType] = useState<ListType>('PACKING');
  const [goal, setGoal] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<AiGeneratedList | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) {
      setGoal('');
      setPreview(null);
      setLoading(false);
      setConfirming(false);
    }
  }, [open]);

  const generate = async () => {
    if (!goal.trim()) return;
    setLoading(true);
    setPreview(null);
    try {
      const r = await AiListsApi.generate(type, goal.trim());
      setPreview(r);
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    setConfirming(true);
    try {
      const def = DEFAULT_PRESET_FOR_TYPE[type] ?? DEFAULT_PRESET_FOR_TYPE.CUSTOM;
      // Step 1: create the list shell.
      const list = await ListsApi.create({
        title: preview.title,
        type,
        icon: def.emoji,
        color: def.color,
      });
      // Step 2: bulk-add items. Categories (if any) are PATCHed in step 3.
      // Lazy import to avoid the top-level import bloat.
      const { ItemsApi } = await import('@/api/endpoints');
      const created = await ItemsApi.bulkStructured(
        list.id,
        preview.items.map((i) => ({ text: i.text })),
      );
      // Step 3: apply categories from the AI for CHECKLIST type. PATCHed in
      // a Promise.all so this stays under a second even on long lists.
      if (type === 'CHECKLIST') {
        await Promise.all(
          created.map((it, i) => {
            const cat = preview.items[i]?.category;
            if (!cat) return Promise.resolve();
            return ItemsApi.update(list.id, it.id, { category: cat });
          }),
        );
      }
      toast.success(`Liste „${list.title}" mit ${created.length} Einträgen angelegt`);
      onCreated(list);
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Liste mit KI generieren" className="max-w-lg">
      <div className="space-y-3">
        {!preview && (
          <>
            <div>
              <label className="label">Typ</label>
              <div className="grid grid-cols-2 gap-2">
                {TYPES.map((t) => (
                  <button
                    type="button"
                    key={t.v}
                    onClick={() => setType(t.v)}
                    className={`p-2 rounded-xl border text-sm transition flex items-center gap-2 ${
                      type === t.v ? 'border-brand bg-brand-50' : 'border-line hover:bg-page'
                    }`}
                  >
                    <span className="text-lg">{t.icon}</span>
                    <span className="font-medium">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Ziel</label>
              <textarea
                className="input min-h-[72px] text-sm"
                placeholder='z. B. "3 Tage Wandern im Herbst" oder "Umzug in neue Wohnung"'
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                disabled={loading}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Abbrechen
              </button>
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-2"
                disabled={!goal.trim() || loading}
                onClick={generate}
              >
                {loading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Generiere…
                  </>
                ) : (
                  <>
                    <Sparkles size={14} /> Vorschlag erzeugen
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {preview && (
          <>
            <div className="rounded-ctl border border-line p-3 max-h-72 overflow-auto">
              <div className="font-semibold mb-1">{preview.title}</div>
              <div className="text-xs text-muted mb-2">
                {preview.items.length} Einträge
              </div>
              <ul className="text-sm space-y-0.5">
                {preview.items.map((it, idx) => (
                  <li key={idx} className="flex items-baseline gap-2">
                    <span className="text-muted">•</span>
                    <span className="flex-1">{it.text}</span>
                    {it.category && (
                      <span className="text-[10px] text-muted bg-page px-1.5 py-0.5 rounded-full">
                        {it.category}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex justify-between items-center gap-2">
              <button
                type="button"
                className="text-xs text-muted hover:text-ink"
                onClick={() => setPreview(null)}
              >
                ← Anderes Ziel
              </button>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={onClose}>
                  Verwerfen
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={confirming || preview.items.length === 0}
                  onClick={confirm}
                >
                  {confirming ? 'Lege an…' : 'Liste erstellen'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
