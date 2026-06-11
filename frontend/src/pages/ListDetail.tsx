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
import { AiListsApi, ItemsApi, ListsApi, ShareApi } from '@/api/endpoints';
import { useAuthStore } from '@/store/auth';
import type { ListItem, ListSummary, ListType } from '@/types';
import { SortableItem } from '@/components/lists/SortableItem';
import { ListSettingsPanel } from '@/components/lists/ListSettingsPanel';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { enqueue, nextTempItemId } from '@/offline/syncQueue';
import { useListWebSocket } from '@/hooks/useListWebSocket';
import { LiveIndicator } from '@/components/LiveIndicator';
import { useConfirm, usePrompt } from '@/components/Dialogs';
import { BackLink } from '@/components/BackLink';
import { IconAction } from '@/components/IconAction';
import { SaveIndicator, useSaveIndicator } from '@/components/SaveIndicator';
import { invalidateOverview, useResourceQuery } from '@/hooks/useOverviewQuery';
import { formatPreview, hasParse, parseItem } from '@/utils/parseItemInput';
import {
  ChevronRight,
  ListPlus,
  RotateCcw,
  BookmarkPlus,
  Trash2,
  Settings,
  Sparkles,
  MoreHorizontal,
  Loader2,
} from 'lucide-react';
import { AiSuggestionModal } from '@/components/AiSuggestionModal';
import { MergeDuplicatesModal } from '@/components/lists/MergeDuplicatesModal';
import { Combine } from 'lucide-react';
import { categoryIconMapForType } from '@/data/listCategories';

const PENDING_LABEL = 'Wird kategorisiert…';

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
  const confirmDialog = useConfirm();
  const promptDialog = usePrompt();
  const save = useSaveIndicator();
  const [missingOpen, setMissingOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);

  const canEdit = useMemo(
    () => !!list && (list.is_owner || list.permission === 'EDIT'),
    [list],
  );

  // Users we can assign a task to (owner + collaborators). Loaded
  // alongside list/items so the per-item task popover doesn't have to
  // fire its own request when opened.
  const [assignableUsers, setAssignableUsers] = useState<{ id: number; name: string }[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [l, it] = await Promise.all([ListsApi.get(listId), ItemsApi.list(listId)]);
      setList(l);
      setItems(it);
      // Fetch collaborators lazily — only when the list is owned by
      // the current user OR they're an EDIT collaborator (only those
      // see the task UI). Endpoint returns owner + every collaborator.
      try {
        const collabs = await ShareApi.collaborators(listId);
        const me = useAuthStore.getState();
        // Build the assignable set: owner + every collaborator + self.
        // We display "Eigentümer" for the parent owner when the
        // viewer isn't them (the API doesn't ship owner_name on the
        // list summary — picking up a real name would require an
        // extra round-trip we don't need today). For the common
        // owner-viewing-their-own-list case the owner IS in the auth
        // store, so the label is right.
        const out: { id: number; name: string }[] = [];
        if (l.is_owner && me.userId) {
          out.push({ id: me.userId, name: me.name ?? 'Ich' });
        } else {
          out.push({ id: l.owner_id, name: 'Eigentümer' });
          if (me.userId) {
            out.push({ id: me.userId, name: me.name ?? 'Ich' });
          }
        }
        for (const c of collabs) {
          out.push({ id: c.user_id, name: c.name });
        }
        const seen = new Set<number>();
        setAssignableUsers(
          out.filter((u) => (seen.has(u.id) ? false : (seen.add(u.id), true))),
        );
      } catch {
        setAssignableUsers([]);
      }
    } catch (e) {
      toast.error(getApiError(e));
      nav('/');
    } finally {
      setLoading(false);
    }
  }, [listId, nav]);

  // Network-first detail fetch: runs on mount, on focus/visibility
  // return, and whenever a list-detail invalidation fires (e.g. a
  // sibling tab adds an item and the user-WS dispatch pings
  // `list-detail:${listId}`). Without this, the SW's previous SWR
  // strategy fed React a stale snapshot on cold mount and the list
  // appeared empty until the user navigated away and back.
  useResourceQuery(`list-detail:${listId}`, refresh);

  // Deep-link from /tasks: /lists/<id>?task=<item_id> scrolls the matching
  // SortableItem into view and adds a .task-pulse ring for 1.5s.
  // Fires once when both `?task=` and the items state line up; clears
  // the search param so a re-render doesn't re-pulse, and re-runs when
  // items become available (the highlight might land before the first
  // refresh completes if the user deep-links into an unvisited list).
  useEffect(() => {
    const taskId = params.get('task');
    if (!taskId || items.length === 0) return;
    const id = Number(taskId);
    if (!Number.isFinite(id)) return;
    const node = document.querySelector<HTMLElement>(
      `[data-list-item-id="${id}"]`,
    );
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.classList.add('task-pulse');
    const t = window.setTimeout(() => node.classList.remove('task-pulse'), 1600);
    // Drop the ?task=… so back-nav / re-render doesn't re-pulse.
    params.delete('task');
    setParams(params, { replace: true });
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, params.get('task')]);

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

  // Bulk-categorize progress. The Settings panel triggers a backend run and
  // tells us how many items are queued; we then count items flipping from
  // null→category via the existing item_updated WebSocket events.
  const [catTotal, setCatTotal] = useState(0);
  const [catDone, setCatDone] = useState(0);
  const onCategorizationStarted = (queued: number) => {
    setCatTotal(queued);
    setCatDone(0);
  };

  const wsConnected = useListWebSocket(listId, {
    onMessage: (msg) => {
      switch (msg.type) {
        case 'item_created':
          setItems((cur) =>
            cur.some((i) => i.id === msg.payload.id) ? cur : [...cur, msg.payload],
          );
          break;
        case 'item_updated':
          setItems((cur) =>
            cur.map((i) => {
              if (i.id !== msg.payload.id) return i;
              // Count progress: prior was uncategorized, new has a category.
              if ((i.category ?? null) === null && (msg.payload.category ?? null) !== null) {
                setCatDone((d) => d + 1);
              }
              return msg.payload;
            }),
          );
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
    const raw = text.trim();
    if (!raw || !canEdit) return;
    // Client-side split: "200g Käse" → { quantity: 200, unit: "g", text: "Käse" }.
    // If the parser didn't recognize a structure, `text` is the whole input.
    const parsed = parseItem(raw);
    const itemText = parsed.text || raw;
    const extras = {
      quantity: parsed.quantity ?? undefined,
      unit: parsed.unit ?? undefined,
    } as { quantity?: number; unit?: string };
    try {
      const it = await ItemsApi.create(listId, itemText, extras);
      setItems((cur) => [...cur, it]);
      setText('');
      save.signalSaved();
    } catch (err) {
      // Queue offline + place an optimistic placeholder so the UI updates
      // immediately. The placeholder uses a negative id so it can't collide
      // with anything from the server.
      if (!navigator.onLine) {
        const placeholder: ListItem = {
          id: nextTempItemId(),
          list_id: listId,
          text: itemText,
          is_checked: false,
          quantity: parsed.quantity,
          unit: parsed.unit,
          position: items.length,
          category: null,
          category_locked: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          // Task fields default to null on offline-queued placeholders —
          // the user can still upgrade to a task once the row syncs.
          assignee_id: null,
          assignee_name: null,
          due_at: null,
          reminder_at: null,
          reminder_sent: false,
        };
        setItems((cur) => [...cur, placeholder]);
        setText('');
        await enqueue({
          kind: 'item_create',
          list_id: listId,
          item_id: placeholder.id,
          payload: { text: itemText, ...extras },
        });
        toast.info('Offline – wird synchronisiert sobald du wieder online bist.');
      } else {
        toast.error(getApiError(err));
      }
    }
  };

  const toggle = async (item: ListItem) => {
    const prev = item.is_checked;
    setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, is_checked: !prev } : i)));
    try {
      await ItemsApi.update(listId, item.id, { is_checked: !prev });
      save.signalSaved();
    } catch {
      if (!navigator.onLine) {
        await enqueue({
          kind: 'item_update',
          list_id: listId,
          item_id: item.id,
          payload: { is_checked: !prev },
        });
      } else {
        setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, is_checked: prev } : i)));
        save.signalError(() => toggle(item));
        toast.error('Konnte nicht speichern');
      }
    }
  };

  const update = async (item: ListItem, patch: Partial<ListItem>) => {
    setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, ...patch } : i)));
    try {
      await ItemsApi.update(listId, item.id, patch as any);
      save.signalSaved();
    } catch (e) {
      if (!navigator.onLine) {
        await enqueue({
          kind: 'item_update',
          list_id: listId,
          item_id: item.id,
          payload: patch as any,
        });
      } else {
        save.signalError(() => update(item, patch));
        toast.error(getApiError(e));
      }
    }
  };

  const del = async (item: ListItem) => {
    setItems((cur) => cur.filter((i) => i.id !== item.id));
    try {
      await ItemsApi.remove(listId, item.id);
      save.signalSaved();
    } catch (e) {
      if (!navigator.onLine) {
        // If the item was itself only a queued placeholder (negative id),
        // we can short-circuit by removing the matching create op so we
        // never round-trip a doomed pair.
        if (item.id < 0) {
          // Best-effort — finding the matching op is up to the queue.
          await enqueue({
            kind: 'item_delete',
            list_id: listId,
            item_id: item.id,
            payload: {},
          });
        } else {
          await enqueue({
            kind: 'item_delete',
            list_id: listId,
            item_id: item.id,
            payload: {},
          });
        }
      } else {
        toast.error(getApiError(e));
        void refresh();
      }
    }
  };

  // Swipe-driven delete: optimistic-hide + 5s "Rückgängig" undo window.
  // Triggered by SortableItem when the touch swipe commits. If the user
  // taps undo, we restore the item at its original index and skip the
  // API call entirely; otherwise after 5s the regular `del` flow runs
  // (which is what handles the offline-queue branch). Each pending
  // delete keeps its own timer so multiple swipes can stack independently.
  const pendingUndo = useRef(new Map<number, { timer: number; original: ListItem }>());
  const softDelete = (item: ListItem) => {
    const original = items.find((i) => i.id === item.id);
    if (!original) return;
    const originalIndex = items.findIndex((i) => i.id === item.id);
    setItems((cur) => cur.filter((i) => i.id !== item.id));
    let undone = false;
    const timer = window.setTimeout(() => {
      pendingUndo.current.delete(item.id);
      if (undone) return;
      void del(original);
    }, 5000);
    pendingUndo.current.set(item.id, { timer, original });
    toast.action('Eintrag gelöscht', 'Rückgängig', () => {
      undone = true;
      window.clearTimeout(timer);
      pendingUndo.current.delete(item.id);
      setItems((cur) => {
        if (cur.some((i) => i.id === original.id)) return cur;
        const idx = Math.min(originalIndex, cur.length);
        return [...cur.slice(0, idx), original, ...cur.slice(idx)];
      });
    });
  };

  // On unmount, flush any still-pending deletes — otherwise a "swipe
  // then navigate away" in < 5s would lose the API call. Fire each
  // pending delete immediately and clear its timer.
  useEffect(
    () => () => {
      for (const [, { timer, original }] of pendingUndo.current) {
        window.clearTimeout(timer);
        void del(original);
      }
      pendingUndo.current.clear();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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
      save.signalSaved();
    } catch (err) {
      save.signalError(() => onDragEnd(e));
      toast.error(getApiError(err));
    }
  };

  const reset = async () => {
    if (
      !(await confirmDialog({
        title: 'Alle Häkchen entfernen?',
        message: 'Der aktuelle Stand wird vorher als Snapshot gesichert.',
        confirmLabel: 'Zurücksetzen',
      }))
    )
      return;
    try {
      await ListsApi.reset(listId);
      setItems((cur) => cur.map((i) => ({ ...i, is_checked: false })));
      save.signalSaved();
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const saveAsTemplate = async () => {
    const name = await promptDialog({
      title: 'Vorlage speichern',
      message: 'Wie soll die Vorlage heißen?',
      defaultValue: list?.title ?? '',
      confirmLabel: 'Speichern',
    });
    if (!name) return;
    try {
      await ListsApi.duplicate(listId, { as_template: true, template_name: name, title: list?.title });
      // Dashboard's templates segment subscribes under 'templates:on' /
      // 'templates:off' — the prefix-match in invalidateOverview catches
      // both, so opening the segment shows the new template immediately.
      invalidateOverview('templates');
      toast.success('Als Vorlage gespeichert');
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const removeList = async () => {
    if (
      !(await confirmDialog({
        title: 'Liste löschen?',
        message: 'Diese Aktion kann nicht rückgängig gemacht werden.',
        confirmLabel: 'Löschen',
        variant: 'danger',
      }))
    )
      return;
    try {
      await ListsApi.remove(listId);
      // Ping the dashboard's lists subscriber so when its mount fetch runs
      // on the next render of /, the deleted list is already gone (even
      // if Dashboard somehow stays mounted across the route change).
      invalidateOverview('lists');
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
        <div className="mb-3">
          <BackLink to="/" label="zu Listen" />
        </div>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            {list.icon && <span className="text-3xl">{list.icon}</span>}
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-semibold truncate">{list.title}</h1>
                <LiveIndicator connected={wsConnected} />
                <SaveIndicator state={save.state} onRetry={save.retry} />
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
          <div className="flex flex-wrap gap-1.5">
            {canEdit && (
              <IconAction
                label="Mehrere hinzufügen"
                icon={ListPlus}
                onClick={() => setBulkOpen(true)}
              />
            )}
            {canEdit && (list.type === 'SHOPPING' || list.type === 'PACKING') && (
              <IconAction
                label="Fehlt was? (KI)"
                icon={Sparkles}
                onClick={() => setMissingOpen(true)}
              />
            )}
            {canEdit && items.length >= 2 && (
              <IconAction
                label="Doppelte zusammenfassen"
                icon={Combine}
                onClick={() => setMergeOpen(true)}
              />
            )}
            {canEdit && (
              <IconAction label="Zurücksetzen" icon={RotateCcw} onClick={reset} />
            )}
            {list.is_owner && (
              <IconAction label="Als Vorlage" icon={BookmarkPlus} onClick={saveAsTemplate} />
            )}
            {list.is_owner && (
              <IconAction
                label="Löschen"
                icon={Trash2}
                onClick={removeList}
                variant="danger"
              />
            )}
            {list.is_owner && (
              <IconAction
                label="Einstellungen"
                icon={Settings}
                onClick={() => setSettingsOpen(true)}
              />
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
        <form onSubmit={addItem} className="space-y-1">
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder={addItemPlaceholder(list.type)}
              value={text}
              onChange={(e) => setText(e.target.value)}
              // Mobile keyboards disable these by default on inputs that
              // look "structured" — explicitly turn them on so adding
              // "200g Käse" doesn't ship with a lower-case K.
              autoCapitalize="sentences"
              autoCorrect="on"
              spellCheck
              // enterKeyHint=done labels the mobile return key as
              // "Fertig" — matches the form-submit-on-Enter pattern
              // here (the form's onSubmit fires the add path and
              // clears the input; the user types the next item).
              inputMode="text"
              enterKeyHint="done"
            />
            <button className="btn-primary" type="submit" disabled={!text.trim()}>
              Hinzufügen
            </button>
          </div>
          <ParsePreview raw={text} />
        </form>
      )}

      {catTotal > 0 && catDone < catTotal && (
        <div className="card p-3 flex items-center gap-3">
          <Loader2 size={16} className="animate-spin text-brand shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm">
              Kategorisiere{' '}
              <span className="tabular-nums font-medium">
                {catDone} / {catTotal}
              </span>
            </div>
            <div className="h-1 mt-1 bg-line rounded-full overflow-hidden">
              <div
                className="h-full bg-brand transition-all"
                style={{ width: `${Math.min(100, (catDone / catTotal) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="card p-3 sm:p-4">
        {items.length === 0 ? (
          <div className="text-center text-muted/70 py-8">Noch keine Einträge.</div>
        ) : list.categorization_mode !== 'OFF' && categoryIconMapForType(list.type) ? (
          // Auto-sorted: group by category, no DnD. Only shown when the
          // list type has a fixed taxonomy — CHECKLIST/CUSTOM fall
          // through to the plain DnD-ordered view even if the mode flag
          // got flipped (defensive: shouldn't normally happen because
          // the Settings UI hides the toggle for those types). Lists built
          // by the recipe merge / single-recipe copy are created with
          // categorization_mode=MANUAL, so their aisle sections render here.
          <CategoryGroupedList
            items={items}
            canEdit={canEdit}
            listType={list.type}
            listId={list.id}
            onToggle={toggle}
            onUpdate={update}
            onDelete={del}
            onSwipeDelete={softDelete}
            assignableUsers={assignableUsers}
          />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1.5">
                {items.map((it) => (
                  <SortableItem
                    key={it.id}
                    item={it}
                    canEdit={canEdit}
                    listType={list.type}
                    onToggle={toggle}
                    onUpdate={update}
                    onDelete={del}
                    onSwipeDelete={softDelete}
                    assignableUsers={assignableUsers}
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
          onCategorizationStarted={onCategorizationStarted}
        />
      )}

      {/* Feature 5: duplicate merge review modal. */}
      <MergeDuplicatesModal
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        listId={listId}
        items={items}
        onMerged={refreshItems}
      />

      {/* Feature 2: AI "Fehlt was?" — auto-fetches on open since there's
          no prompt to type, then lets the user pick which suggestions to add. */}
      <AiSuggestionModal<{ text: string }>
        open={missingOpen}
        onClose={() => setMissingOpen(false)}
        title="Fehlt was?"
        description="Die KI schaut sich deine Liste an und schlägt häufig dazu passende Dinge vor."
        showPromptInput={false}
        confirmLabel="Hinzufügen"
        getKey={(it) => it.text}
        renderItem={(it) => <span>{it.text}</span>}
        fetchSuggestions={() => AiListsApi.missingItems(listId)}
        onApply={async (picked) => {
          try {
            const created = await ItemsApi.bulkStructured(
              listId,
              picked.map((p) => ({ text: p.text })),
            );
            setItems((cur) => [...cur, ...created]);
            setMissingOpen(false);
            toast.success(`${created.length} Vorschläge hinzugefügt`);
          } catch (e) {
            toast.error(getApiError(e));
          }
        }}
      />

      <BulkModal
        open={bulkOpen}
        listType={list.type}
        onClose={() => setBulkOpen(false)}
        onSubmit={async (lines) => {
          // Apply the same parser the single-item input uses, so "200g Käse"
          // bulk-pasted lands as quantity=200/unit=g/text=Käse, not as one
          // long text blob.
          const items = lines
            .map((l) => {
              const p = parseItem(l);
              return {
                text: p.text || l,
                quantity: p.quantity,
                unit: p.unit,
              };
            })
            .filter((i) => i.text);
          if (items.length === 0) return;
          try {
            const created = await ItemsApi.bulkStructured(listId, items);
            setItems((cur) => [...cur, ...created]);
            setBulkOpen(false);
          } catch (e) {
            toast.error(getApiError(e));
          }
        }}
      />
    </div>
  );
}

// Live preview for the single-item input. Renders only when the parser
// extracted at least quantity or unit — typing plain text stays clean.
function ParsePreview({ raw }: { raw: string }) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const p = parseItem(trimmed);
  if (!hasParse(p)) return null;
  return (
    <div className="text-xs text-muted/80 pl-1">
      → {formatPreview(p)}
    </div>
  );
}

// IconAction now lives in @/components/IconAction; both ListDetail and
// RecipeDetail import the same shared component so they don't drift.

// ---------- Category-grouped item list (read-only DnD, sort by category) ----------

function CategoryGroupedList({
  items,
  canEdit,
  listType,
  listId,
  onToggle,
  onUpdate,
  onDelete,
  onSwipeDelete,
  assignableUsers,
}: {
  items: ListItem[];
  canEdit: boolean;
  listType: ListType;
  listId: number;
  onToggle: (i: ListItem) => void;
  onUpdate: (i: ListItem, patch: Partial<ListItem>) => void;
  onDelete: (i: ListItem) => void;
  onSwipeDelete: (i: ListItem) => void;
  assignableUsers: { id: number; name: string }[];
}) {
  // Pick the icon + order set for this list type. The caller already
  // ensures this is non-null before rendering the grouped view, but the
  // ?? fallback keeps TS happy and is a safe no-op (returns SHOPPING).
  const iconMap = categoryIconMapForType(listType) ?? {};
  const order = Object.keys(iconMap);
  // Bucket by category. Items whose category isn't in the type's set
  // (e.g. stale SHOPPING categories on a PACKING list pre-migration)
  // fall into the "pending" group so the user can re-categorize them
  // rather than rendering as orphaned headers.
  const buckets = new Map<string, ListItem[]>();
  const pending: ListItem[] = [];
  for (const it of items) {
    if (!it.category || !iconMap[it.category]) {
      pending.push(it);
    } else {
      const arr = buckets.get(it.category) ?? [];
      arr.push(it);
      buckets.set(it.category, arr);
    }
  }
  const sections: { label: string; items: ListItem[]; pending: boolean }[] = [];
  for (const cat of order) {
    const arr = buckets.get(cat);
    if (arr && arr.length) sections.push({ label: cat, items: arr, pending: false });
  }
  if (pending.length) sections.push({ label: PENDING_LABEL, items: pending, pending: true });

  // Per-list "which sections did the user collapse" set, persisted to
  // localStorage so collapse state survives navigation away + back.
  // Default = empty set (all expanded), per spec.
  const storageKey = `lyst:list:${listId}:collapsed-cats`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? new Set(arr.filter((x) => typeof x === 'string')) : new Set();
    } catch {
      return new Set();
    }
  });
  const toggleSection = (label: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      try {
        localStorage.setItem(storageKey, JSON.stringify(Array.from(next)));
      } catch {
        // localStorage full / disabled — collapse state is ephemeral
        // this session, not worth a toast.
      }
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {sections.map((s) => {
        const Icon = s.pending ? Loader2 : iconMap[s.label] ?? MoreHorizontal;
        const isCollapsed = collapsed.has(s.label);
        return (
          <div key={s.label}>
            <button
              type="button"
              onClick={() => toggleSection(s.label)}
              className="w-full flex items-center gap-1.5 px-1 mb-1 text-xs text-muted hover:text-ink transition"
              aria-expanded={!isCollapsed}
              aria-controls={`cat-${s.label}`}
            >
              {/* Chevron — rotates 90° when expanded. CSS transition
                  is fine; the user feels the toggle without an extra
                  animation library. */}
              <span
                aria-hidden
                className="inline-flex items-center justify-center transition-transform duration-150"
                style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}
              >
                <ChevronRight size={12} />
              </span>
              <Icon size={14} className={s.pending ? 'animate-spin' : ''} />
              <span>{s.label}</span>
              <span className="text-muted/60 tabular-nums">· {s.items.length}</span>
            </button>
            {!isCollapsed && (
              <div id={`cat-${s.label}`} className="space-y-1.5">
                {s.items.map((it) => (
                  <SortableItem
                    key={it.id}
                    item={it}
                    canEdit={canEdit}
                    listType={listType}
                    onToggle={onToggle}
                    onUpdate={onUpdate}
                    onDelete={onDelete}
                    onSwipeDelete={onSwipeDelete}
                    assignableUsers={assignableUsers}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BulkModal({
  open,
  listType,
  onClose,
  onSubmit,
}: {
  open: boolean;
  listType: ListType;
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
        <p className="text-sm text-muted">
          {bulkHelp(listType)}
        </p>
        <textarea
          ref={ref}
          className="input min-h-[180px] font-mono text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={bulkPlaceholder(listType)}
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
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

function addItemPlaceholder(t: ListType): string {
  switch (t) {
    case 'SHOPPING':
      return 'Eintrag hinzufügen, z. B. „200g Käse"…';
    case 'PACKING':
      return 'Eintrag hinzufügen, z. B. „Wanderschuhe"…';
    case 'CHECKLIST':
      return 'Aufgabe hinzufügen, z. B. „Tickets buchen"…';
    case 'CUSTOM':
    default:
      return 'Eintrag hinzufügen…';
  }
}

function bulkPlaceholder(t: ListType): string {
  switch (t) {
    case 'SHOPPING':
      return '200g Käse\n1,5 kg Mehl\n2 Pack Butter\nJoghurt';
    case 'PACKING':
      return 'Wanderschuhe\nRegenjacke\n2 T-Shirts\nZahnbürste';
    case 'CHECKLIST':
      return 'Tickets buchen\nKoffer packen\nNachbarn Bescheid sagen';
    case 'CUSTOM':
    default:
      return 'Eintrag\nWeiterer Eintrag\n…';
  }
}

function bulkHelp(t: ListType): string {
  if (t === 'SHOPPING' || t === 'PACKING') {
    return 'Eine Zeile = ein Eintrag. Menge und Einheit werden automatisch erkannt — z. B. „200g Käse", „2 Pack Butter" oder „3x Eier".';
  }
  return 'Eine Zeile = ein Eintrag.';
}

