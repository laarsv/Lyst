import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { FitnessApi } from '@/api/endpoints';
import type { Exercise, Workout, WorkoutExercise } from '@/types';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { useConfirm } from '@/components/Dialogs';
import { Modal } from '@/components/Modal';
import { BackLink } from '@/components/BackLink';
import { IconAction } from '@/components/IconAction';
import { invalidateOverview, useResourceQuery } from '@/hooks/useOverviewQuery';
import { TRACKING_LABELS } from '@/lib/fitness';

export function WorkoutDetailPage() {
  const { id } = useParams();
  const wId = Number(id);
  const nav = useNavigate();
  const confirmDialog = useConfirm();
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  const fetch = useCallback(async () => {
    try {
      setWorkout(await FitnessApi.getWorkout(wId));
    } catch (e) {
      toast.error(getApiError(e));
      nav('/fitness');
    } finally {
      setLoading(false);
    }
  }, [wId, nav]);
  useResourceQuery(`workout:${wId}`, fetch);

  const start = async () => {
    try {
      const s = await FitnessApi.startSession(wId);
      invalidateOverview('fitness');
      nav(`/fitness/session/${s.id}`);
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const remove = async () => {
    if (!workout) return;
    if (!(await confirmDialog({ title: `Workout „${workout.name}" löschen?`, message: 'Trainings-Logs bleiben erhalten.', confirmLabel: 'Löschen', variant: 'danger' }))) return;
    try {
      await FitnessApi.removeWorkout(wId);
      invalidateOverview('fitness');
      toast.success('Workout gelöscht');
      nav('/fitness');
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const addExercise = async (exerciseId: number) => {
    try {
      await FitnessApi.addWorkoutExercise(wId, { exercise_id: exerciseId });
      setPickerOpen(false);
      void fetch();
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const removeSlot = async (weId: number) => {
    try {
      await FitnessApi.removeWorkoutExercise(wId, weId);
      void fetch();
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const move = async (index: number, dir: -1 | 1) => {
    if (!workout) return;
    const slots = [...workout.exercises];
    const j = index + dir;
    if (j < 0 || j >= slots.length) return;
    [slots[index], slots[j]] = [slots[j], slots[index]];
    try {
      await FitnessApi.reorderWorkoutExercises(wId, slots.map((s, i) => ({ id: s.id, position: i })));
      void fetch();
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  if (loading) return <div className="text-muted/70">Lade…</div>;
  if (!workout) return null;

  return (
    <div className="mx-auto max-w-xl">
      <div className="flex items-center justify-between gap-3 mb-4">
        <BackLink to="/fitness" label="zu Fitness" />
        <div className="flex items-center gap-1.5">
          <IconAction label="Bearbeiten" icon={Pencil} onClick={() => nav(`/fitness/workouts/${wId}/edit`)} />
          <IconAction label="Löschen" icon={Trash2} onClick={remove} variant="danger" />
        </div>
      </div>

      <h1 className="text-2xl font-bold text-ink">{workout.name}</h1>
      {workout.description && <p className="text-muted mt-1">{workout.description}</p>}

      <button type="button" onClick={start} className="btn-primary w-full justify-center mt-4">
        <Play size={16} /> Training starten
      </button>

      <div className="flex items-center justify-between mt-6 mb-2">
        <h2 className="text-sm font-semibold text-ink">Übungen</h2>
        <button type="button" className="btn-ghost text-sm" onClick={() => setPickerOpen(true)}>
          <Plus size={16} /> Hinzufügen
        </button>
      </div>

      {workout.exercises.length === 0 ? (
        <div className="card p-8 text-center text-muted">Noch keine Übungen. „Hinzufügen" antippen.</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {workout.exercises.map((we, i) => (
            <SlotRow
              key={we.id}
              we={we}
              workoutId={wId}
              first={i === 0}
              last={i === workout.exercises.length - 1}
              onUp={() => move(i, -1)}
              onDown={() => move(i, 1)}
              onRemove={() => removeSlot(we.id)}
            />
          ))}
        </ul>
      )}

      <ExercisePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addExercise} />
    </div>
  );
}

function SlotRow({
  we,
  workoutId,
  first,
  last,
  onUp,
  onDown,
  onRemove,
}: {
  we: WorkoutExercise;
  workoutId: number;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}) {
  const [sets, setSets] = useState(we.target_sets?.toString() ?? '');
  const [reps, setReps] = useState(we.target_reps?.toString() ?? '');
  const [weight, setWeight] = useState(we.target_weight?.toString() ?? '');

  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const saveTargets = async () => {
    try {
      await FitnessApi.updateWorkoutExercise(workoutId, we.id, {
        target_sets: num(sets),
        target_reps: num(reps),
        target_weight: num(weight),
      });
    } catch (e) {
      toast.error(getApiError(e));
    }
  };
  const weighted = we.exercise.tracking_type === 'WEIGHT_REPS';
  const timed = we.exercise.tracking_type === 'TIME';

  return (
    <li className="card p-3">
      <div className="flex items-center gap-2">
        <div className="flex flex-col">
          <button type="button" disabled={first} onClick={onUp} className="text-muted disabled:opacity-30 hover:text-ink"><ArrowUp size={14} /></button>
          <button type="button" disabled={last} onClick={onDown} className="text-muted disabled:opacity-30 hover:text-ink"><ArrowDown size={14} /></button>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-ink truncate">{we.exercise.name}</div>
          <div className="text-[11px] text-muted">{we.exercise.muscle_group} · {TRACKING_LABELS[we.exercise.tracking_type]}</div>
        </div>
        <button type="button" onClick={onRemove} aria-label="Entfernen" className="text-muted/70 hover:text-danger p-1"><X size={16} /></button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <label className="flex items-center gap-1">
          Sätze
          <input className="input w-16 py-1" type="number" min={1} value={sets} onChange={(e) => setSets(e.target.value)} onBlur={saveTargets} />
        </label>
        {!timed && (
          <label className="flex items-center gap-1">
            Wdh
            <input className="input w-16 py-1" type="number" min={1} value={reps} onChange={(e) => setReps(e.target.value)} onBlur={saveTargets} />
          </label>
        )}
        {weighted && (
          <label className="flex items-center gap-1">
            kg
            <input className="input w-20 py-1" type="number" min={0} step="0.5" value={weight} onChange={(e) => setWeight(e.target.value)} onBlur={saveTargets} />
          </label>
        )}
      </div>
    </li>
  );
}

function ExercisePicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (id: number) => void }) {
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
            <button type="button" onClick={() => onPick(ex.id)} className="w-full text-left p-3 hover:bg-page flex items-center justify-between gap-2">
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
