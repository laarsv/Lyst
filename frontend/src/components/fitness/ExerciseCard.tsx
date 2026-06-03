import { Link } from 'react-router-dom';
import type { Exercise } from '@/types';
import { TRACKING_LABELS } from '@/lib/fitness';

export function ExerciseCard({ exercise }: { exercise: Exercise }) {
  return (
    <Link
      to={`/fitness/exercises/${exercise.id}`}
      className="card p-4 hover:shadow-md transition flex items-center gap-3"
    >
      {exercise.image_url ? (
        <div
          className="size-12 rounded-lg bg-cover bg-center shrink-0"
          style={{ backgroundImage: `url(${exercise.image_url})` }}
        />
      ) : (
        <div className="size-12 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center text-xl shrink-0">
          💪
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="font-medium text-ink truncate">{exercise.name}</div>
        <div className="text-xs text-muted flex flex-wrap items-center gap-x-2">
          <span>{exercise.muscle_group}</span>
          <span>·</span>
          <span>{TRACKING_LABELS[exercise.tracking_type]}</span>
        </div>
      </div>
      {exercise.is_global && <span className="chip rounded-full shrink-0">Bibliothek</span>}
    </Link>
  );
}
