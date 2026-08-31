import { useCallback, useState, useId} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { FitnessApi } from '@/api/endpoints';
import type { ExerciseLocation, ExerciseType, TrackingType } from '@/types';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { BackLink } from '@/components/BackLink';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useResourceQuery, invalidateOverview } from '@/hooks/useOverviewQuery';
import {
  EXERCISE_TYPE_LABELS,
  EXERCISE_TYPE_OPTIONS,
  LOCATION_LABELS,
  LOCATION_OPTIONS,
  MUSCLE_GROUPS,
  TRACKING_LABELS,
  TRACKING_OPTIONS,
} from '@/lib/fitness';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export function ExerciseEditPage() {
  const fid = useId();
  const { id } = useParams();
  const isEdit = id !== undefined;
  const exId = Number(id);
  const nav = useNavigate();

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [muscle, setMuscle] = useState<string>(MUSCLE_GROUPS[0]);
  const [type, setType] = useState<ExerciseType>('AUFBAU');
  const [location, setLocation] = useState<ExerciseLocation>('BEIDES');
  const [tracking, setTracking] = useState<TrackingType>('WEIGHT_REPS');
  const [instructions, setInstructions] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  // Ungespeicherte Eingaben nicht still verlieren (Abbrechen, Zurueck-Link,
  // Reload). Der Browser-Zurueck-Button bleibt ungeschuetzt — siehe Hook.
  const { leave } = useUnsavedChanges({
    values: { name, muscle, type, location, tracking, instructions, imageUrl },
    ready: !loading,
  });


  const fetchEx = useCallback(async () => {
    if (!isEdit) return;
    try {
      const ex = await FitnessApi.getExercise(exId);
      if (!ex.editable) {
        toast.error('Diese Übung kann nicht bearbeitet werden');
        nav(`/fitness/exercises/${exId}`);
        return;
      }
      setName(ex.name);
      setMuscle(ex.muscle_group);
      setType(ex.type);
      setLocation(ex.location);
      setTracking(ex.tracking_type);
      setInstructions(ex.instructions ?? '');
      setImageUrl(ex.image_url ?? '');
    } catch (e) {
      toast.error(getApiError(e));
      nav('/fitness/exercises');
    } finally {
      setLoading(false);
    }
  }, [isEdit, exId, nav]);
  useResourceQuery(`exercise-edit:${id ?? 'new'}`, fetchEx);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Name ist erforderlich');
      return;
    }
    const payload = {
      name: name.trim(),
      muscle_group: muscle,
      type,
      location,
      tracking_type: tracking,
      instructions: instructions.trim() || null,
    };
    setSaving(true);
    try {
      if (isEdit) {
        await FitnessApi.updateExercise(exId, payload);
        invalidateOverview('exercises');
        toast.success('Gespeichert');
        nav(`/fitness/exercises/${exId}`);
      } else {
        const created = await FitnessApi.createExercise(payload);
        invalidateOverview('exercises');
        toast.success('Übung angelegt');
        nav(`/fitness/exercises/${created.id}`);
      }
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const upload = async (file: File) => {
    if (!ACCEPTED.includes(file.type)) return toast.error('Nur JPG, PNG oder WebP');
    if (file.size > 10 * 1024 * 1024) return toast.error('Maximal 10 MB');
    setUploadPct(0);
    try {
      const ex = await FitnessApi.uploadExerciseImage(exId, file, setUploadPct);
      setImageUrl(ex.image_url ?? '');
      toast.success('Bild hochgeladen');
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setUploadPct(null);
    }
  };

  if (loading) return <div className="text-muted/70">Lade…</div>;

  return (
    <form onSubmit={save} className="max-w-xl flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <BackLink
          onBeforeNavigate={() => {
            void leave(isEdit ? `/fitness/exercises/${exId}` : '/fitness/exercises');
            return false;
          }}
          to={isEdit ? `/fitness/exercises/${exId}` : '/fitness/exercises'} label="zu Übungen" />
        <h1 className="text-xl font-semibold">{isEdit ? 'Übung bearbeiten' : 'Neue Übung'}</h1>
      </div>

      <div className="card p-4 flex flex-col gap-3">
        <div>
          <label className="label" htmlFor={`${fid}-name`}>Name *</label>
          <input id={`${fid}-name`} className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="z. B. Kniebeuge" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor={`${fid}-muskelgruppe`}>Muskelgruppe</label>
            <select id={`${fid}-muskelgruppe`} className="input" value={muscle} onChange={(e) => setMuscle(e.target.value)}>
              {MUSCLE_GROUPS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor={`${fid}-art`}>Art</label>
            <select id={`${fid}-art`} className="input" value={type} onChange={(e) => setType(e.target.value as ExerciseType)}>
              {EXERCISE_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{EXERCISE_TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor={`${fid}-ort`}>Ort</label>
            <select id={`${fid}-ort`} className="input" value={location} onChange={(e) => setLocation(e.target.value as ExerciseLocation)}>
              {LOCATION_OPTIONS.map((l) => <option key={l} value={l}>{LOCATION_LABELS[l]}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor={`${fid}-tracking`}>Tracking</label>
            <select id={`${fid}-tracking`} className="input" value={tracking} onChange={(e) => setTracking(e.target.value as TrackingType)}>
              {TRACKING_OPTIONS.map((t) => <option key={t} value={t}>{TRACKING_LABELS[t]}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor={`${fid}-anleitung`}>Anleitung</label>
          <textarea id={`${fid}-anleitung`} className="input min-h-[80px]" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </div>
        <div>
          <div className="label">Bild</div>
          {isEdit ? (
            imageUrl && uploadPct === null ? (
              <div className="rounded-ctl border border-line overflow-hidden">
                <div className="h-32 bg-cover bg-center" style={{ backgroundImage: `url(${imageUrl})` }} />
                <div className="flex justify-end p-2 bg-surface border-t border-line">
                  <button
                    type="button"
                    className="btn-ghost text-xs text-danger"
                    onClick={async () => {
                      const ex = await FitnessApi.removeExerciseImage(exId);
                      setImageUrl(ex.image_url ?? '');
                    }}
                  >
                    <Trash2 size={14} /> Entfernen
                  </button>
                </div>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-1 h-28 rounded-ctl border-2 border-dashed border-line bg-surface text-muted cursor-pointer hover:border-brand/60">
                {uploadPct !== null ? (
                  <><Loader2 size={18} className="animate-spin" /><span className="text-xs">{uploadPct}%</span></>
                ) : (
                  <><ImagePlus size={20} /><span className="text-xs">Bild hochladen</span></>
                )}
                <input
                  type="file"
                  accept={ACCEPTED.join(',')}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                    e.target.value = '';
                  }}
                />
              </label>
            )
          ) : (
            <p className="text-xs text-muted">Ein Bild kannst du nach dem Speichern hinzufügen.</p>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => void leave(isEdit ? `/fitness/exercises/${exId}` : '/fitness/exercises')}>
          Abbrechen
        </button>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Speichere…' : 'Speichern'}
        </button>
      </div>
    </form>
  );
}
