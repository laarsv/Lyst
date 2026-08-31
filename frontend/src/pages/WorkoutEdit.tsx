import { useCallback, useState, useId} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FitnessApi } from '@/api/endpoints';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { BackLink } from '@/components/BackLink';
import { invalidateOverview, useResourceQuery } from '@/hooks/useOverviewQuery';

export function WorkoutEditPage() {
  const fid = useId();
  const { id } = useParams();
  const isEdit = id !== undefined;
  const wId = Number(id);
  const nav = useNavigate();

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const fetchW = useCallback(async () => {
    if (!isEdit) return;
    try {
      const w = await FitnessApi.getWorkout(wId);
      setName(w.name);
      setDescription(w.description ?? '');
    } catch (e) {
      toast.error(getApiError(e));
      nav('/fitness');
    } finally {
      setLoading(false);
    }
  }, [isEdit, wId, nav]);
  useResourceQuery(`workout-edit:${id ?? 'new'}`, fetchW);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Name ist erforderlich');
      return;
    }
    const payload = { name: name.trim(), description: description.trim() || null };
    setSaving(true);
    try {
      if (isEdit) {
        await FitnessApi.updateWorkout(wId, payload);
        invalidateOverview('fitness');
        toast.success('Gespeichert');
        nav(`/fitness/workouts/${wId}`);
      } else {
        const w = await FitnessApi.createWorkout(payload);
        invalidateOverview('fitness');
        toast.success('Workout angelegt — füge jetzt Übungen hinzu');
        nav(`/fitness/workouts/${w.id}`);
      }
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-muted/70">Lade…</div>;

  return (
    <form onSubmit={save} className="max-w-xl flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <BackLink to={isEdit ? `/fitness/workouts/${wId}` : '/fitness'} label="zu Fitness" />
        <h1 className="text-xl font-semibold">{isEdit ? 'Workout bearbeiten' : 'Neues Workout'}</h1>
      </div>
      <div className="card p-4 flex flex-col gap-3">
        <div>
          <label className="label" htmlFor={`${fid}-name`}>Name *</label>
          <input id={`${fid}-name`} className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="z. B. Push A" />
        </div>
        <div>
          <label className="label" htmlFor={`${fid}-beschreibung`}>Beschreibung</label>
          <textarea id={`${fid}-beschreibung`} className="input min-h-[70px]" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => nav(isEdit ? `/fitness/workouts/${wId}` : '/fitness')}>
          Abbrechen
        </button>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Speichere…' : 'Speichern'}
        </button>
      </div>
    </form>
  );
}
