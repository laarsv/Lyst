/** Global tasks page — /tasks
 *
 *  Aggregates tasks across lists + notes for the current user and
 *  groups them by their parent resource. Driven by GET /tasks; the
 *  backend already applies scope + status filters, so the page only
 *  picks them in chips and re-fetches on change.
 *
 *  Tapping a row navigates to the parent (list or note) with a
 *  `task=<id>` query param. List detail / note detail pages aren't
 *  yet wired to highlight that — the deep-link works at the route
 *  level today, the highlight pulse is a deferred polish task.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, ChevronRight, ListChecks, NotebookPen, RotateCcw } from 'lucide-react';
import { ItemsApi, NoteTasksApi, TasksApi } from '@/api/endpoints';
import type { AggregatedTask } from '@/types';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { useOverviewQuery } from '@/hooks/useOverviewQuery';
import {
  formatTaskDue,
  isOverdue,
  taskInitials,
} from '@/components/tasks/taskFormat';

type Scope = 'assigned_to_me' | 'mine' | 'all';
type Status = 'open' | 'today' | 'this_week' | 'overdue' | 'done';

const SCOPE_LABEL: Record<Scope, string> = {
  assigned_to_me: 'Mir zugewiesen',
  mine: 'Von mir',
  all: 'Alle',
};
const STATUS_LABEL: Record<Status, string> = {
  open: 'Offen',
  today: 'Heute',
  this_week: 'Diese Woche',
  overdue: 'Überfällig',
  done: 'Erledigt',
};

export function TasksPage() {
  const nav = useNavigate();
  const [scope, setScope] = useState<Scope>('assigned_to_me');
  const [status, setStatus] = useState<Status>('open');
  const [tasks, setTasks] = useState<AggregatedTask[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const rows = await TasksApi.list({ scope, status });
      setTasks(rows);
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  }, [scope, status]);

  // Network-first refresh on mount/focus + a key per filter pair so
  // changing chips fires a fresh fetch.
  useOverviewQuery(`tasks:${scope}:${status}`, () => load());

  useEffect(() => {
    setLoading(true);
  }, [scope, status]);

  // Group tasks by source (list vs note) + source_id, preserving the
  // backend's stable sort within each group.
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { key: string; source: 'list' | 'note'; sourceId: number; title: string; rows: AggregatedTask[] }
    >();
    for (const t of tasks) {
      const key = `${t.source}:${t.source_id}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          source: t.source,
          sourceId: t.source_id,
          title: t.source_title || '(Ohne Titel)',
          rows: [],
        };
        map.set(key, g);
      }
      g.rows.push(t);
    }
    return Array.from(map.values());
  }, [tasks]);

  const openParent = (g: { source: 'list' | 'note'; sourceId: number; rows: AggregatedTask[] }) => {
    // List detail is /lists/:id, note detail is /notes?focus=:id —
    // both already exist and the optional `task` query param lets
    // the receiving page implement scroll+highlight when it gains
    // that capability.
    const first = g.rows[0];
    const taskQS = first ? `?task=${first.id}` : '';
    if (g.source === 'list') {
      nav(`/lists/${g.sourceId}${taskQS}`);
    } else {
      const q = new URLSearchParams({ focus: String(g.sourceId) });
      if (first) q.set('task', String(first.id));
      nav(`/notes?${q.toString()}`);
    }
  };

  const toggleDone = async (t: AggregatedTask) => {
    // Optimistic flip locally so the user feels the change instantly.
    setTasks((cur) =>
      cur.map((x) => (x.id === t.id && x.source === t.source ? { ...x, is_done: !x.is_done } : x)),
    );
    try {
      if (t.source === 'list') {
        await ItemsApi.update(t.source_id, t.id, { is_checked: !t.is_done });
      } else {
        await NoteTasksApi.update(t.source_id, t.id, { is_done: !t.is_done });
      }
    } catch (e) {
      toast.error(getApiError(e));
      // Roll back on failure.
      setTasks((cur) =>
        cur.map((x) =>
          x.id === t.id && x.source === t.source ? { ...x, is_done: t.is_done } : x,
        ),
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Aufgaben</h1>
        <button
          type="button"
          onClick={() => void load()}
          aria-label="Neu laden"
          className="size-9 inline-flex items-center justify-center rounded-ctl text-muted hover:text-ink hover:bg-page"
        >
          <RotateCcw size={16} />
        </button>
      </div>

      {/* Scope chips — exclusive single-select. */}
      <div className="flex flex-wrap gap-1 bg-surface border border-line rounded-xl p-1">
        {(['assigned_to_me', 'mine', 'all'] as Scope[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            className={`px-3 py-1.5 rounded-lg text-sm transition ${
              scope === s ? 'bg-brand-50 text-brand-700 font-medium' : 'text-muted hover:text-ink'
            }`}
          >
            {SCOPE_LABEL[s]}
          </button>
        ))}
      </div>

      {/* Status chips — separate selector so the user can combine
          "Mir zugewiesen" with "Heute" etc. */}
      <div className="flex flex-wrap gap-1 bg-surface border border-line rounded-xl p-1">
        {(['open', 'today', 'this_week', 'overdue', 'done'] as Status[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-sm transition ${
              status === s ? 'bg-brand-50 text-brand-700 font-medium' : 'text-muted hover:text-ink'
            }`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-muted/70 py-8 text-center">Lade…</div>
      ) : groups.length === 0 ? (
        <div className="card p-12 text-center text-muted">
          Keine Aufgaben. Lege in einer Liste oder Notiz eine Fälligkeit
          oder Zuweisung an.
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const Icon = g.source === 'list' ? ListChecks : NotebookPen;
            return (
              <section
                key={g.key}
                className="card p-3 sm:p-4"
              >
                <button
                  type="button"
                  onClick={() => openParent(g)}
                  className="w-full flex items-center gap-2 text-left mb-2 group"
                >
                  <Icon size={16} className="text-muted shrink-0" />
                  <span className="font-medium truncate">{g.title}</span>
                  <ChevronRight
                    size={14}
                    className="text-muted/60 ml-auto group-hover:translate-x-0.5 transition"
                  />
                </button>
                <ul className="space-y-1">
                  {g.rows.map((t) => (
                    <TaskRow
                      key={`${t.source}-${t.id}`}
                      task={t}
                      onToggle={() => void toggleDone(t)}
                      onOpenParent={() => openParent(g)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TaskRow({
  task,
  onToggle,
  onOpenParent,
}: {
  task: AggregatedTask;
  onToggle: () => void;
  onOpenParent: () => void;
}) {
  const overdue = isOverdue(task.due_at, task.is_done);
  return (
    <li className="flex items-center gap-2 px-1 py-1.5 rounded-ctl hover:bg-page">
      <input
        type="checkbox"
        checked={task.is_done}
        onChange={onToggle}
        // Tap target large enough for thumbs on mobile.
        className="size-5 rounded-md accent-brand cursor-pointer"
        aria-label={`${task.text} – ${task.is_done ? 'erledigt' : 'offen'}`}
      />
      <button
        type="button"
        onClick={onOpenParent}
        className="flex-1 min-w-0 text-left"
      >
        <div
          className={`truncate text-sm ${
            task.is_done ? 'line-through text-muted/70' : ''
          }`}
        >
          {task.text || '(ohne Text)'}
        </div>
      </button>
      {task.due_at && (
        <span
          className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-chip shrink-0 ${
            overdue ? 'bg-danger-50 text-danger' : 'bg-page text-muted'
          }`}
          title={new Date(task.due_at).toLocaleString('de-DE')}
        >
          <CalendarClock size={11} />
          {formatTaskDue(task.due_at)}
        </span>
      )}
      {task.assignee_id !== null && (
        <span
          title={task.assignee_name ?? 'Zugewiesen'}
          className="inline-flex size-6 items-center justify-center rounded-full bg-brand-50 text-brand-700 text-[10px] font-semibold shrink-0"
        >
          {taskInitials(task.assignee_name)}
        </span>
      )}
    </li>
  );
}
