import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Dumbbell, ListChecks, Play, Plus } from 'lucide-react';
import { FitnessApi } from '@/api/endpoints';
import type { Session, SessionSummary, WorkoutSummary } from '@/types';
import { useOverviewQuery } from '@/hooks/useOverviewQuery';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { IconAction } from '@/components/IconAction';
import { WorkoutCard } from '@/components/fitness/WorkoutCard';
import { dateShort } from '@/lib/fitness';

export function FitnessPage() {
  const nav = useNavigate();
  const [workouts, setWorkouts] = useState<WorkoutSummary[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [open, setOpen] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [w, s, o] = await Promise.all([
        FitnessApi.listWorkouts(),
        FitnessApi.listSessions(),
        FitnessApi.getOpenSession(),
      ]);
      setWorkouts(w);
      setSessions(s);
      setOpen(o);
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  };
  useOverviewQuery('fitness', () => load());

  const startFree = async () => {
    if (open) {
      nav(`/fitness/session/${open.id}`);
      return;
    }
    try {
      const s = await FitnessApi.startSession(null);
      nav(`/fitness/session/${s.id}`);
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const discardOpen = async () => {
    if (!open) return;
    try {
      await FitnessApi.removeSession(open.id);
      toast.success('Training verworfen');
      void load();
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-semibold">Fitness</h1>
        <div className="flex flex-wrap gap-1.5 items-center">
          <IconAction label="Übungen" icon={ListChecks} onClick={() => nav('/fitness/exercises')} />
          <IconAction label="Neues Workout" icon={Plus} onClick={() => nav('/fitness/workouts/new')} variant="primary" />
        </div>
      </div>

      {/* Offene Session */}
      {open && (
        <div className="mb-6 rounded-[18px] border border-brand-100 bg-brand-50 p-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-brand-700 flex-1">
            Ein Training läuft (seit {dateShort(open.started_at)}).
          </span>
          <button type="button" className="btn-primary text-sm" onClick={() => nav(`/fitness/session/${open.id}`)}>
            Fortsetzen
          </button>
          <button type="button" className="btn-ghost text-sm text-danger" onClick={discardOpen}>
            Verwerfen
          </button>
        </div>
      )}

      {!open && (
        <button type="button" onClick={startFree} className="btn-secondary w-full mb-6 justify-center">
          <Play size={16} /> Freies Training starten
        </button>
      )}

      {/* Workouts */}
      <h2 className="text-sm font-semibold text-ink mb-2">Workouts</h2>
      {loading ? (
        <div className="text-muted/70">Lade…</div>
      ) : workouts.length === 0 ? (
        <div className="card p-8 text-center text-muted mb-6">
          Noch keine Workouts.{' '}
          <Link to="/fitness/workouts/new" className="text-brand hover:underline">Erstes Workout anlegen</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          {workouts.map((w) => (
            <WorkoutCard key={w.id} workout={w} />
          ))}
        </div>
      )}

      {/* Verlauf */}
      {sessions.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-ink mb-2">Letzte Trainings</h2>
          <ul className="card divide-y divide-line">
            {sessions.slice(0, 12).map((s) => (
              <li key={s.id}>
                <Link to={`/fitness/session/${s.id}`} className="flex items-center gap-3 p-3 hover:bg-page transition">
                  <Dumbbell size={16} className="text-brand-700 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink truncate">{s.workout_name || 'Freies Training'}</div>
                    <div className="text-xs text-muted">
                      {dateShort(s.started_at)} · {s.set_count} Sätze
                    </div>
                  </div>
                  {!s.finished_at && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand-50 text-brand-700">läuft</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
