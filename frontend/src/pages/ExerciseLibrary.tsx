import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { FitnessApi } from '@/api/endpoints';
import type { Exercise } from '@/types';
import { useOverviewQuery } from '@/hooks/useOverviewQuery';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { IconAction } from '@/components/IconAction';
import { BackLink } from '@/components/BackLink';
import { ExerciseCard } from '@/components/fitness/ExerciseCard';
import { EXERCISE_TYPE_LABELS, EXERCISE_TYPE_OPTIONS, LOCATION_LABELS, LOCATION_OPTIONS, MUSCLE_GROUPS } from '@/lib/fitness';

export function ExerciseLibraryPage() {
  const nav = useNavigate();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState('');
  const [type, setType] = useState('');
  const [location, setLocation] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setExercises(
        await FitnessApi.listExercises({
          q: q || undefined,
          muscle_group: muscle || undefined,
          type: type || undefined,
          location: location || undefined,
        }),
      );
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  };
  useOverviewQuery(`exercises:${muscle}:${type}:${location}`, () => load());

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <BackLink to="/fitness" label="zu Fitness" />
        <IconAction label="Neue Übung" icon={Plus} onClick={() => nav('/fitness/exercises/new')} variant="primary" />
      </div>
      <h1 className="text-2xl font-semibold mb-4">Übungen</h1>

      <div className="flex flex-wrap gap-2 mb-5">
        <input
          className="input flex-1 min-w-[160px]"
          placeholder="Übung suchen…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
        <select className="input w-auto" value={muscle} onChange={(e) => setMuscle(e.target.value)}>
          <option value="">Alle Muskelgruppen</option>
          {MUSCLE_GROUPS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Alle Arten</option>
          {EXERCISE_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>{EXERCISE_TYPE_LABELS[t]}</option>
          ))}
        </select>
        <select className="input w-auto" value={location} onChange={(e) => setLocation(e.target.value)}>
          <option value="">Überall</option>
          {LOCATION_OPTIONS.map((l) => (
            <option key={l} value={l}>{LOCATION_LABELS[l]}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-muted/70">Lade…</div>
      ) : exercises.length === 0 ? (
        <div className="card p-12 text-center text-muted">Keine Übungen gefunden.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {exercises.map((ex) => (
            <ExerciseCard key={ex.id} exercise={ex} />
          ))}
        </div>
      )}
    </div>
  );
}
