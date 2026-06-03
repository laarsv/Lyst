import { Link } from 'react-router-dom';
import { Dumbbell } from 'lucide-react';
import type { WorkoutSummary } from '@/types';

export function WorkoutCard({ workout }: { workout: WorkoutSummary }) {
  return (
    <Link
      to={`/fitness/workouts/${workout.id}`}
      className="card p-4 hover:shadow-md transition flex flex-col gap-1"
    >
      <div className="flex items-center gap-2">
        <Dumbbell size={16} className="text-brand-700 shrink-0" />
        <span className="font-semibold text-ink truncate">{workout.name}</span>
      </div>
      {workout.description && <p className="text-xs text-muted line-clamp-2">{workout.description}</p>}
      <span className="text-xs text-muted">
        {workout.exercise_count} Übung{workout.exercise_count === 1 ? '' : 'en'}
      </span>
    </Link>
  );
}
