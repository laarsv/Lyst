import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { FitnessApi } from '@/api/endpoints';
import type { Exercise, ExerciseHistory } from '@/types';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { useConfirm } from '@/components/Dialogs';
import { BackLink } from '@/components/BackLink';
import { IconAction } from '@/components/IconAction';
import { invalidateOverview, useResourceQuery } from '@/hooks/useOverviewQuery';
import { HistorySparkline } from '@/components/fitness/HistorySparkline';
import { EXERCISE_TYPE_LABELS, LOCATION_LABELS, TRACKING_LABELS } from '@/lib/fitness';

export function ExerciseDetailPage() {
  const { id } = useParams();
  const exId = Number(id);
  const nav = useNavigate();
  const confirmDialog = useConfirm();
  const [ex, setEx] = useState<Exercise | null>(null);
  const [hist, setHist] = useState<ExerciseHistory | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      const [e, h] = await Promise.all([FitnessApi.getExercise(exId), FitnessApi.history(exId)]);
      setEx(e);
      setHist(h);
    } catch (err) {
      toast.error(getApiError(err));
      nav('/fitness/exercises');
    } finally {
      setLoading(false);
    }
  }, [exId, nav]);
  useResourceQuery(`exercise:${exId}`, fetch);

  const remove = async () => {
    if (!ex) return;
    if (!(await confirmDialog({ title: `„${ex.name}" löschen?`, message: 'Kann nicht rückgängig gemacht werden.', confirmLabel: 'Löschen', variant: 'danger' }))) return;
    try {
      await FitnessApi.removeExercise(ex.id);
      invalidateOverview('exercises');
      toast.success('Übung gelöscht');
      nav('/fitness/exercises');
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  if (loading) return <div className="text-muted/70">Lade…</div>;
  if (!ex) return null;

  return (
    <div className="mx-auto max-w-xl">
      <div className="flex items-center justify-between gap-3 mb-4">
        <BackLink to="/fitness/exercises" label="zu Übungen" />
        {ex.editable && (
          <div className="flex items-center gap-1.5">
            <IconAction label="Bearbeiten" icon={Pencil} onClick={() => nav(`/fitness/exercises/${ex.id}/edit`)} />
            <IconAction label="Löschen" icon={Trash2} onClick={remove} variant="danger" />
          </div>
        )}
      </div>

      {ex.image_url ? (
        <div className="h-48 rounded-[18px] bg-cover bg-center" style={{ backgroundImage: `url(${ex.image_url})` }} />
      ) : (
        <div className="h-48 rounded-[18px] bg-brand-50 flex items-center justify-center text-5xl">💪</div>
      )}

      <h1 className="mt-4 text-2xl font-bold text-ink">{ex.name}</h1>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="chip rounded-full">{ex.muscle_group}</span>
        <span className="chip rounded-full">{EXERCISE_TYPE_LABELS[ex.type]}</span>
        <span className="chip rounded-full">{LOCATION_LABELS[ex.location]}</span>
        <span className="chip rounded-full">{TRACKING_LABELS[ex.tracking_type]}</span>
        {ex.is_global && <span className="chip rounded-full">Bibliothek</span>}
      </div>

      {ex.instructions && (
        <section className="rounded-[18px] border border-line bg-surface p-5 mt-4">
          <h2 className="text-sm font-semibold text-ink mb-2">Anleitung</h2>
          <p className="text-sm text-ink whitespace-pre-wrap">{ex.instructions}</p>
        </section>
      )}

      <section className="rounded-[18px] border border-line bg-surface p-5 mt-4">
        <h2 className="text-sm font-semibold text-ink mb-3">Verlauf</h2>
        {hist ? <HistorySparkline data={hist} /> : <p className="text-xs text-muted">—</p>}
      </section>
    </div>
  );
}
