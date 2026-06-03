import type { ExerciseHistory } from '@/types';
import { dateShort, historyValue } from '@/lib/fitness';

/** Dependency-free inline-SVG line of an exercise's progress over time. */
export function HistorySparkline({ data }: { data: ExerciseHistory }) {
  const pts = data.points;
  if (pts.length < 2) {
    return <p className="text-xs text-muted">Noch zu wenig Verlauf für eine Linie.</p>;
  }
  const W = 300, H = 80, pad = 8;
  const vals = pts.map((p) => historyValue(p, data.tracking_type));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - min) / span) * (H - 2 * pad);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20 text-brand" preserveAspectRatio="none">
        <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {vals.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r={2.5} className="fill-brand-700" />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-muted">
        <span>{dateShort(pts[0].date)}</span>
        <span>min {min} · max {max}</span>
        <span>{dateShort(pts[pts.length - 1].date)} · {vals[vals.length - 1]}</span>
      </div>
    </div>
  );
}
