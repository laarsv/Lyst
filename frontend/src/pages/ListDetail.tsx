import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ItemsApi, ListsApi } from '@/api/endpoints';
import type { ListItem, ListSummary } from '@/types';
import { SortableItem } from '@/components/lists/SortableItem';
import { ListSettingsPanel } from '@/components/lists/ListSettingsPanel';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { enqueue } from '@/lib/offlineQueue';
import { useListWebSocket } from '@/hooks/useListWebSocket';
import { LiveIndicator } from '@/components/LiveIndicator';

export function ListDetailPage() {
  const { id } = useParams();
  const listId = Number(id);
  const nav = useNavigate();

  const [list, setList] = useState<ListSummary | null>(null);
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  // Settings panel open-state mirrored to ?settings=1 so it survives reloads
  // and back/forward navigation.
  const [params, setParams] = useSearchParams();
  const settingsOpen = params.get('settings') === '1';
  const setSettingsOpen = (open: boolean) => {
    if (open) params.set('settings', '1');
    else params.delete('settings');
    setParams(params, { replace: true });
  };
  const [editOpen, setEditOpen] = useState(false);

  const canEdit = useMemo(
    () => !!list && (list.is_owner || list.permission === 'EDIT'),
    [list],
  );

  const refresh = useCallback(async () => {
    try {
      const [l, it] = await Promise.all([ListsApi.get(listId), ItemsApi.list(listId)]);
      setList(l);
      setItems(it);
    } catch (e) {
      toast.error(getApiError(e));
      nav('/');
    } finally {
      setLoading(false);
    }
  }, [listId, nav]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live collab — receive remote changes (skipped for messages we caused
  // ourselves: backend filters by X-Client-Id header). Polling fallback
  // simply re-fetches items if the WS stays down.
  const refreshItems = useCallback(async () => {
    try {
      setItems(await ItemsApi.list(listId));
    } catch {
      /* swallow — refresh is best-effort while polling */
    }
  }, [listId]);

  const wsConnected = useListWebSocket(listId, {
    onMessage: (msg) => {
      switch (msg.type) {
        case 'item_created':
          setItems((cur) =>
            cur.some((i) => i.id === msg.payload.id) ? cur : [...cur, msg.payload],
          );
          break;
        case 'item_updated':
          setItems((cur) => cur.map((i) => (i.id === msg.payload.id ? msg.payload : i)));
          break;
        case 'item_deleted':
          setItems((cur) => cur.filter((i) => i.id !== msg.payload.id));
          break;
        case 'item_reordered': {
          const map = new Map(msg.payload.map((p) => [p.id, p.position]));
          setItems((cur) =>
            [...cur]
              .map((i) => (map.has(i.id) ? { ...i, position: map.get(i.id)! } : i))
              .sort((a, b) => a.position - b.position),
          );
          break;
        }
        case 'list_reset':
          setItems((cur) => cur.map((i) => ({ ...i, is_checked: false })));
          break;
      }
    },
    onPollWhileDisconnected: refreshItems,
  });

  const addItem = async (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || !canEdit) return;
    try {
      const it = await ItemsApi.create(listId, t);
      setItems((cur) => [...cur, it]);
      setText('');
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  const toggle = async (item: ListItem) => {
    const prev = item.is_checked;
    setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, is_checked: !prev } : i)));
    try {
      await ItemsApi.update(listId, item.id, { is_checked: !prev });
    } catch {
      if (!navigator.onLine) {
        await enqueue({
          kind: 'toggle',
          list_id: listId,
          item_id: item.id,
          payload: { is_checked: !prev },
        });
        toast.info('Offline – wird synchronisiert wenn du wieder online bist.');
      } else {
        setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, is_checked: prev } : i)));
        toast.error('Konnte nicht speichern');
      }
    }
  };

  const update = async (item: ListItem, patch: Partial<ListItem>) => {
    setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, ...patch } : i)));
    try {
      await ItemsApi.update(listId, item.id, patch as any);
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const del = async (item: ListItem) => {
    setItems((cur) => cur.filter((i) => i.id !== item.id));
    try {
      await ItemsApi.remove(listId, item.id);
    } catch (e) {
      toast.error(getApiError(e));
      void refresh();
    }
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    const reordered = arrayMove(items, oldIdx, newIdx);
    setItems(reordered);
    try {
      await ItemsApi.reorder(
        listId,
        reordered.map((it, i) => ({ id: it.id, position: i })),
      );
    } catch (err) {
      toast.error(getApiError(err));
    }
  };

  const reset = async () => {
    if (!confirm('Alle Häkchen entfernen?')) return;
    try {
      await ListsApi.reset(listId);
      setItems((cur) => cur.map((i) => ({ ...i, is_checked: false })));
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const saveAsTemplate = async () => {
    const name = prompt('Vorlagenname?', list?.title);
    if (!name) return;
    try {
      await ListsApi.duplicate(listId, { as_template: true, template_name: name, title: list?.title });
      toast.success('Als Vorlage gespeichert');
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const removeList = async () => {
    if (!confirm('Liste endgültig löschen?')) return;
    try {
      await ListsApi.remove(listId);
      nav('/');
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  if (loading || !list) return <div className="text-muted/70">Lade…</div>;

  const checkedCount = items.filter((i) => i.is_checked).length;
  const pct = items.length ? Math.round((checkedCount / items.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <div
        className="card p-6"
        style={{ borderTopColor: list.color || '#00c896', borderTopWidth: 4 }}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            {list.icon && <span className="text-3xl">{list.icon}</span>}
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-semibold truncate">{list.title}</h1>
                <LiveIndicator connected={wsConnected} />
              </div>
              {!list.is_owner && (
                <div className="text-xs text-muted">
                  geteilt – {list.permission === 'EDIT' ? 'Bearbeiten erlaubt' : 'nur Lesen'}
                </div>
              )}
              {list.description && (
                <div className="text-sm text-muted mt-1">{list.description}</div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <button className="btn-secondary text-sm" onClick={() => setBulkOpen(true)}>
                Mehrere hinzufügen
              </button>
            )}
            {canEdit && (
              <button className="btn-secondary text-sm" onClick={reset}>
                Zurücksetzen
              </button>
            )}
            {list.is_owner && (
              <button className="btn-secondary text-sm" onClick={saveAsTemplate}>
                Als Vorlage
              </button>
            )}
            {list.is_owner && (
              <button className="btn-secondary text-sm" onClick={() => setEditOpen(true)}>
                Bearbeiten
              </button>
            )}
            {list.is_owner && (
              <button className="btn-ghost text-sm text-danger" onClick={removeList}>
                Löschen
              </button>
            )}
            {list.is_owner && (
              <button
                type="button"
                className="p-2 rounded-lg text-muted hover:bg-page hover:text-ink transition"
                aria-label="Listen-Einstellungen"
                title="Einstellungen (Teilen, Mitnutzer, Erinnerungen, Verlauf)"
                onClick={() => setSettingsOpen(true)}
              >
                <GearIcon />
              </button>
            )}
          </div>
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between text-sm text-muted mb-1">
            <span>Fortschritt</span>
            <span>{checkedCount} / {items.length}</span>
          </div>
          <div className="h-2 rounded-full bg-page overflow-hidden">
            <div
              className="h-full transition-all"
              style={{ width: `${pct}%`, background: list.color || '#00c896' }}
            />
          </div>
        </div>
      </div>

      {canEdit && (
        <form onSubmit={addItem} className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Eintrag hinzufügen und Enter drücken…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="btn-primary" type="submit" disabled={!text.trim()}>
            Hinzufügen
          </button>
        </form>
      )}

      <div className="card p-3 sm:p-4">
        {items.length === 0 ? (
          <div className="text-center text-muted/70 py-8">Noch keine Einträge.</div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1.5">
                {items.map((it) => (
                  <SortableItem
                    key={it.id}
                    item={it}
                    canEdit={canEdit}
                    onToggle={toggle}
                    onUpdate={update}
                    onDelete={del}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {list.is_owner && (
        <ListSettingsPanel
          open={settingsOpen}
          list={list}
          onClose={() => setSettingsOpen(false)}
          onListUpdate={(p) => setList((cur) => (cur ? { ...cur, ...p } : cur))}
        />
      )}

      <BulkModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onSubmit={async (lines) => {
          try {
            const created = await ItemsApi.bulk(listId, lines);
            setItems((cur) => [...cur, ...created]);
            setBulkOpen(false);
          } catch (e) {
            toast.error(getApiError(e));
          }
        }}
      />
      <EditListModal
        open={editOpen}
        list={list}
        onClose={() => setEditOpen(false)}
        onSaved={(l) => {
          setList(l);
          setEditOpen(false);
        }}
      />
    </div>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.36.16.66.42.88.74.22.32.34.7.34 1.09v.34c0 .39-.12.77-.34 1.09-.22.32-.52.58-.88.74Z" />
    </svg>
  );
}

function BulkModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (lines: string[]) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (open) setTimeout(() => ref.current?.focus(), 50);
    else setText('');
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Mehrere Einträge">
      <div className="space-y-3">
        <p className="text-sm text-muted">Eine Zeile = ein Eintrag.</p>
        <textarea
          ref={ref}
          className="input min-h-[180px] font-mono text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Milch\nBrot\nÄpfel'}
        />
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button
            className="btn-primary"
            onClick={() =>
              onSubmit(text.split('\n').map((s) => s.trim()).filter(Boolean))
            }
          >
            Hinzufügen
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EditListModal({
  open,
  list,
  onClose,
  onSaved,
}: {
  open: boolean;
  list: ListSummary;
  onClose: () => void;
  onSaved: (l: ListSummary) => void;
}) {
  const [title, setTitle] = useState(list.title);
  const [description, setDescription] = useState(list.description ?? '');
  const [icon, setIcon] = useState(list.icon ?? '');
  const [color, setColor] = useState(list.color ?? '#00c896');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(list.title);
      setDescription(list.description ?? '');
      setIcon(list.icon ?? '');
      setColor(list.color ?? '#00c896');
    }
  }, [open, list]);

  const save = async () => {
    setLoading(true);
    try {
      const l = await ListsApi.update(list.id, { title, description, icon, color });
      onSaved(l);
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Liste bearbeiten">
      <div className="space-y-3">
        <div>
          <label className="label">Titel</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="label">Beschreibung</label>
          <textarea
            className="input min-h-[80px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="label">Emoji</label>
            <input className="input" value={icon} maxLength={4} onChange={(e) => setIcon(e.target.value)} />
          </div>
          <div>
            <label className="label">Farbe</label>
            <input
              type="color"
              className="h-[42px] w-16 rounded-xl border border-line cursor-pointer"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button className="btn-primary" disabled={loading} onClick={save}>
            {loading ? 'Speichern…' : 'Speichern'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
