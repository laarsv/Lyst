import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, Flag, Plus, Trash2, X } from 'lucide-react';
import { FitnessApi } from '@/api/endpoints';
import type { Exercise, LastValues, Session, SetLog } from '@/types';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { useConfirm } from '@/components/Dialogs';
import { Modal } from '@/components/Modal';
import { BackLink } from '@/components/BackLink';
import { RestTimer } from '@/components/fitness/RestTimer';
import { useResourceQuery, invalidateOverview } from '@/hooks/useOverviewQuery';
import { TRACKING_LABELS, fmtSet } from '@/lib/fitness';

export function SessionLogPage() {
  const { id } = useParams();
  const sid = Number(id);
  const nav = useNavigate();
  const confirmDialog = useConfirm();

  const [session, setSession] = useState<Session | null>(null);
  const [baseScope, setBaseScope] = useState<Exercise[]>([]);
  const [manualExtra, setManualExtra] = useState<Exercise[]>([]);
  const [lastByEx, setLastByEx] = useState<Record<number, LastValues>>({});
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  const reload = useCallback(async () => {
    setSession(await FitnessApi.getSession(sid));
  }, [sid]);

  const load = useCallback(async () => {
    try {
      const s = await FitnessApi.getSession(sid);
      setSession(s);
      const exs: Exercise[] = [];
      const seen = new Set<number>();
      if (s.workout_id) {
        const w = await FitnessApi.getWorkout(s.workout_id);
        for (const we of w.exercises) {
          if (!seen.has(we.exercise_id)) {
            exs.push(we.exercise);
            seen.add(we.exercise_id);
          }
        }
      }
      const extraIds = [...new Set(s.sets.map((x) => x.exercise_id))].filter((eid) => !seen.has(eid));
      const extra = await Promise.all(extraIds.map((eid) => FitnessApi.getExercise(eid)));
      for (const e of extra) {
        exs.push(e);
        seen.add(e.id);
      }
      setBaseScope(exs);
      const lasts = await Promise.all(
        exs.map((e) =>
          FitnessApi.lastValues(e.id)
            .then((lv) => [e.id, lv] as const)
            .catch(() => [e.id, { session_id: null, performed_at: null, sets: [] }] as const),
        ),
      );
      setLastByEx((prev) => ({ ...prev, ...Object.fromEntries(lasts) }));
    } catch (e) {
      toast.error(getApiError(e));
      nav('/fitness');
    } finally {
      setLoading(false);
    }
  }, [sid, nav]);
  useResourceQuery(`session:${sid}`, load);

  const scope = useMemo(() => {
    const seen = new Set(baseScope.map((e) => e.id));
    return [...baseScope, ...manualExtra.filter((e) => !seen.has(e.id))];
  }, [baseScope, manualExtra]);

  const addExerciseToScope = async (ex: Exercise) => {
    setPickerOpen(false);
    setManualExtra((prev) => (prev.some((e) => e.id === ex.id) ? prev : [...prev, ex]));
    if (!(ex.id in lastByEx)) {
      try {
        const lv = await FitnessApi.lastValues(ex.id);
        setLastByEx((prev) => ({ ...prev, [ex.id]: lv }));
      } catch {
        /* ignore */
      }
    }
  };

  const finish = async () => {
    try {
      await FitnessApi.finishSession(sid);
      invalidateOverview('fitness');
      toast.success('Training abgeschlossen');
      void reload();
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const discard = async () => {
    if (!(await confirmDialog({ title: 'Training verwerfen?', message: 'Alle geloggten Sätze gehen verloren.', confirmLabel: 'Verwerfen', variant: 'danger' }))) return;
    try {
      await FitnessApi.removeSession(sid);
      invalidateOverview('fitness');
      toast.success('Training verworfen');
      nav('/fitness');
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  if (loading) return <div className="text-muted/70">Lade…</div>;
  if (!session) return null;
  const finished = session.finished_at != null;

  return (
    <div className="mx-auto max-w-xl">
      <div className="flex items-center justify-between gap-3 mb-4">
        <BackLink to="/fitness" label="zu Fitness" />
        {!finished && (
          <button type="button" className="btn-ghost text-sm text-danger" onClick={discard}>
            Verwerfen
          </button>
        )}
      </div>

      <h1 className="text-2xl font-bold text-ink">{finished ? 'Training' : 'Training läuft'}</h1>
      <p className="text-sm text-muted">
        {new Date(session.started_at).toLocaleString('de-DE')}
        {finished && session.finished_at ? ` – ${new Date(session.finished_at).toLocaleTimeString('de-DE')}` : ''}
      </p>

      {!finished && (
        <div className="my-4">
          <RestTimer />
        </div>
      )}

      <div className="flex flex-col gap-4 mt-4">
        {scope.map((ex) => (
          <ExerciseBlock
            key={ex.id}
            exercise={ex}
            sessionId={sid}
            sets={session.sets.filter((s) => s.exercise_id === ex.id).sort((a, b) => a.set_number - b.set_number)}
            last={lastByEx[ex.id]}
            finished={finished}
            onChanged={reload}
          />
        ))}
        {scope.length === 0 && (
          <div className="card p-6 text-center text-muted text-sm">
            Noch keine Übungen. Füge welche hinzu, um Sätze zu loggen.
          </div>
        )}
      </div>

      {!finished && (
        <>
          <button type="button" className="btn-ghost w-full justify-center mt-3" onClick={() => setPickerOpen(true)}>
            <Plus size={16} /> Übung hinzufügen
          </button>
          <button type="button" className="btn-primary w-full justify-center mt-4" onClick={finish}>
            <Flag size={16} /> Training beenden
          </button>
        </>
      )}

      <ExercisePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addExerciseToScope} />
    </div>
  );
}

function ExerciseBlock({
  exercise,
  sessionId,
  sets,
  last,
  finished,
  onChanged,
}: {
  exercise: Exercise;
  sessionId: number;
  sets: SetLog[];
  last: LastValues | undefined;
  finished: boolean;
  onChanged: () => Promise<void>;
}) {
  const tracking = exercise.tracking_type;
  const nextSetNumber = sets.length + 1;
  // Prefill from last session's matching set (or its last set as a carry-over).
  const prefill = last?.sets.length
    ? last.sets[Math.min(nextSetNumber - 1, last.sets.length - 1)]
    : undefined;

  const [reps, setReps] = useState('');
  const [weight, setWeight] = useState('');
  const [duration, setDuration] = useState('');
  const [busy, setBusy] = useState(false);

  // Seed inputs from the prefill whenever the next set / prefill changes.
  useEffect(() => {
    setReps(prefill?.reps_done != null ? String(prefill.reps_done) : '');
    setWeight(prefill?.weight_done != null ? String(prefill.weight_done) : '');
    setDuration(prefill?.duration_done != null ? String(prefill.duration_done) : '');
  }, [prefill?.reps_done, prefill?.weight_done, prefill?.duration_done, nextSetNumber]);

  const num = (s: string) => (s.trim() === '' ? null : Number(s));

  const addSet = async () => {
    const payload: Record<string, unknown> = { exercise_id: exercise.id, set_number: nextSetNumber, completed: true };
    if (tracking === 'REPS') payload.reps_done = num(reps);
    else if (tracking === 'WEIGHT_REPS') {
      payload.reps_done = num(reps);
      if (num(weight) != null) payload.weight_done = num(weight);
    } else payload.duration_done = num(duration);
    setBusy(true);
    try {
      await FitnessApi.addSet(sessionId, payload as never);
      await onChanged();
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const removeSet = async (setId: number) => {
    try {
      await FitnessApi.removeSet(sessionId, setId);
      await onChanged();
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const lastHint = last?.sets.length
    ? last.sets.map((s) => fmtSet(s, tracking)).join(', ')
    : null;

  return (
    <section className="card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold text-ink">{exercise.name}</h3>
        <span className="text-[11px] text-muted shrink-0">{TRACKING_LABELS[tracking]}</span>
      </div>
      {lastHint && <p className="text-xs text-muted mt-0.5">Letztes Mal: {lastHint}</p>}

      {sets.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {sets.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              <Check size={14} className="text-brand-700 shrink-0" />
              <span className="text-muted">Satz {s.set_number}:</span>
              <span className="text-ink flex-1">{fmtSet(s, tracking)}</span>
              {!finished && (
                <button type="button" onClick={() => removeSet(s.id)} aria-label="Satz löschen" className="text-muted/70 hover:text-danger p-1">
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!finished && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <span className="text-xs text-muted">Satz {nextSetNumber}</span>
          {tracking !== 'TIME' && (
            <label className="text-xs">
              Wdh
              <input className="input w-16 py-1 mt-0.5" type="number" min={0} value={reps} onChange={(e) => setReps(e.target.value)} />
            </label>
          )}
          {tracking === 'WEIGHT_REPS' && (
            <label className="text-xs">
              kg
              <input className="input w-20 py-1 mt-0.5" type="number" min={0} step="0.5" value={weight} onChange={(e) => setWeight(e.target.value)} />
            </label>
          )}
          {tracking === 'TIME' && (
            <label className="text-xs">
              Sek.
              <input className="input w-20 py-1 mt-0.5" type="number" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} />
            </label>
          )}
          <button type="button" className="btn-secondary text-sm" onClick={addSet} disabled={busy}>
            <Plus size={14} /> Satz
          </button>
        </div>
      )}
    </section>
  );
}

function ExercisePicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (ex: Exercise) => void }) {
  const [list, setList] = useState<Exercise[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!open) return;
    FitnessApi.listExercises({ q: q || undefined })
      .then(setList)
      .catch((e) => toast.error(getApiError(e)));
  }, [open, q]);
  return (
    <Modal open={open} onClose={onClose} title="Übung hinzufügen" className="max-w-md">
      <input className="input mb-3" placeholder="Suchen…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <ul className="max-h-[50vh] overflow-y-auto divide-y divide-line border border-line rounded-xl">
        {list.map((ex) => (
          <li key={ex.id}>
            <button type="button" onClick={() => onPick(ex)} className="w-full text-left p-3 hover:bg-page flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="text-sm text-ink truncate block">{ex.name}</span>
                <span className="text-[11px] text-muted">{ex.muscle_group}</span>
              </span>
              <Plus size={16} className="text-brand-700 shrink-0" />
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="p-4 text-center text-sm text-muted">Keine Übungen.</li>}
      </ul>
    </Modal>
  );
}
