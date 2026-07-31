import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCircle2,
  Circle,
  Droplet,
  Dumbbell,
  UtensilsCrossed,
} from 'lucide-react';
import {
  DashboardApi,
  ItemsApi,
  NoteTasksApi,
  PlantsApi,
} from '@/api/endpoints';
import type { Dashboard, DashboardDueTask } from '@/types';
import { useOverviewQuery } from '@/hooks/useOverviewQuery';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';

/** "Heute" — only time-critical, actionable things. Blocks with no rows are
 *  NOT rendered (no empty-state cheer): a quiet day should be a short screen,
 *  so that when something IS there you actually notice it. */
export function TodayPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      setData(await DashboardApi.get());
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  useOverviewQuery('dashboard', () => load());

  // Both actions drop the row optimistically — it's done, it shouldn't linger
  // while the request is in flight. On error we reload to get the truth back.

  const water = async (id: number) => {
    setBusy(`plant-${id}`);
    setData((d) =>
      d ? { ...d, due_plants: d.due_plants.filter((p) => p.id !== id) } : d,
    );
    try {
      await PlantsApi.water(id);
      toast.success('Gegossen');
    } catch (e) {
      toast.error(getApiError(e));
      await load();
    } finally {
      setBusy(null);
    }
  };

  const completeTask = async (t: DashboardDueTask) => {
    setBusy(`task-${t.source}-${t.id}`);
    setData((d) =>
      d
        ? {
            ...d,
            due_tasks: d.due_tasks.filter(
              (r) => !(r.id === t.id && r.source === t.source),
            ),
          }
        : d,
    );
    try {
      if (t.source === 'list') {
        await ItemsApi.update(t.parent_id, t.id, { is_checked: true });
      } else {
        await NoteTasksApi.update(t.parent_id, t.id, { is_done: true });
      }
    } catch (e) {
      toast.error(getApiError(e));
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <div className="text-muted/70">Lade…</div>;

  const nothing =
    !data.open_session &&
    data.due_plants.length === 0 &&
    data.due_tasks.length === 0 &&
    data.today_meals.length === 0 &&
    data.upcoming_reminders.length === 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Heute</h1>

      {nothing && (
        <div className="card p-10 text-center text-muted">
          Nichts Dringendes. 🎉
        </div>
      )}

      {data.open_session && (
        <OpenSessionBanner session={data.open_session} />
      )}

      {data.due_tasks.length > 0 && (
        <Block icon={CheckCircle2} title="Fällig">
          {data.due_tasks.map((t) => (
            <Row key={`${t.source}-${t.id}`}>
              <button
                type="button"
                aria-label="Erledigt"
                disabled={busy === `task-${t.source}-${t.id}`}
                onClick={() => completeTask(t)}
                className="shrink-0 text-muted hover:text-brand transition disabled:opacity-40"
              >
                <Circle size={20} />
              </button>
              <Link
                to={t.source === 'list' ? `/lists/${t.parent_id}` : `/notes?focus=${t.parent_id}`}
                className="min-w-0 flex-1"
              >
                <span className="block truncate">{t.text}</span>
                <span className="block text-xs text-muted truncate">
                  {t.parent_title}
                  {t.is_overdue && (
                    <span className="text-danger font-medium"> · überfällig</span>
                  )}
                </span>
              </Link>
            </Row>
          ))}
        </Block>
      )}

      {data.due_plants.length > 0 && (
        <Block icon={Droplet} title="Gießen">
          {data.due_plants.map((p) => (
            <Row key={p.id}>
              <Link to={`/plants/${p.id}`} className="min-w-0 flex-1">
                <span className="block truncate">{p.name}</span>
                <span className="block text-xs text-muted">
                  {p.days_overdue > 0 ? (
                    <span className="text-danger font-medium">
                      {p.days_overdue}{' '}
                      {p.days_overdue === 1 ? 'Tag' : 'Tage'} überfällig
                    </span>
                  ) : (
                    'heute fällig'
                  )}
                </span>
              </Link>
              <button
                type="button"
                disabled={busy === `plant-${p.id}`}
                onClick={() => water(p.id)}
                className="btn-secondary shrink-0 text-sm disabled:opacity-40"
              >
                Gegossen
              </button>
            </Row>
          ))}
        </Block>
      )}

      {data.today_meals.length > 0 && (
        <Block icon={UtensilsCrossed} title="Heute geplant">
          {data.today_meals.map((m) => (
            <Row key={m.entry_id}>
              <Link to={`/recipes/${m.recipe_id}`} className="min-w-0 flex-1">
                <span className="block truncate">{m.recipe_title}</span>
                <span className="block text-xs text-muted">
                  {m.meal_type} · {m.servings} Portionen
                </span>
              </Link>
            </Row>
          ))}
        </Block>
      )}

      {data.upcoming_reminders.length > 0 && (
        <Block icon={Bell} title="Erinnerungen">
          {data.upcoming_reminders.map((r) => (
            <Row key={r.id}>
              <Link to={`/lists/${r.list_id}`} className="min-w-0 flex-1">
                <span className="block truncate">
                  {r.message || r.list_title}
                </span>
                <span className="block text-xs text-muted">
                  {new Date(r.remind_at).toLocaleString('de-DE', {
                    weekday: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {r.message && ` · ${r.list_title}`}
                </span>
              </Link>
            </Row>
          ))}
        </Block>
      )}
    </div>
  );
}

function OpenSessionBanner({
  session,
}: {
  session: NonNullable<Dashboard['open_session']>;
}) {
  const nav = useNavigate();
  const mins = Math.max(
    0,
    Math.round((Date.now() - new Date(session.started_at).getTime()) / 60000),
  );
  return (
    <button
      type="button"
      onClick={() => nav(`/fitness/session/${session.id}`)}
      className="card p-4 w-full text-left flex items-center gap-3 border-brand-100 bg-brand-50"
    >
      <Dumbbell size={20} className="text-brand-700 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-brand-700 truncate">
          Training läuft{session.workout_name ? ` · ${session.workout_name}` : ''}
        </span>
        <span className="block text-xs text-brand-700/70">
          seit {mins} Min · {session.logged_sets}{' '}
          {session.logged_sets === 1 ? 'Satz' : 'Sätze'} erfasst
        </span>
      </span>
      <span className="text-sm font-medium text-brand-700 shrink-0">
        Fortsetzen
      </span>
    </button>
  );
}

function Block({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Droplet;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-xs uppercase tracking-wide text-muted font-medium mb-2 flex items-center gap-1.5">
        <Icon size={13} aria-hidden />
        {title}
      </h2>
      <div className="card divide-y divide-line">{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-3 p-3">{children}</div>;
}
