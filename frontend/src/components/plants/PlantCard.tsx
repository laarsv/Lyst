import { Link } from 'react-router-dom';
import { Droplets, Leaf, Sprout } from 'lucide-react';
import type { Plant } from '@/types';
import { dueLabel } from '@/lib/plants';

/** Plant summary card — image (or leaf placeholder) on top, then name,
 *  species, a small water/fertilize due indicator (danger-tinted when
 *  overdue), and the Bereich tag pills. White card, ~18px radius, hairline
 *  border, no heavy shadow — per the approved design. */
export function PlantCard({ plant }: { plant: Plant }) {
  const water = dueLabel(plant.next_water_due);
  const fert = dueLabel(plant.next_fertilize_due);
  return (
    <Link
      to={`/plants/${plant.id}`}
      className="group flex flex-col overflow-hidden rounded-[18px] border border-line bg-surface transition hover:border-brand/40"
    >
      {plant.image_url ? (
        <div className="h-36 bg-cover bg-center" style={{ backgroundImage: `url(${plant.image_url})` }} />
      ) : (
        <div className="h-36 bg-brand-50 flex items-center justify-center">
          <Leaf size={32} className="text-brand-700" />
        </div>
      )}
      <div className="p-4 flex flex-col gap-2 min-w-0">
        <div className="min-w-0">
          <div className="font-semibold text-ink truncate">{plant.name}</div>
          {plant.species && <div className="text-xs text-muted italic truncate">{plant.species}</div>}
        </div>
        {(water || fert) && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {water && (
              <span
                className={`inline-flex items-center gap-1 ${
                  water.overdue ? 'text-danger font-medium' : 'text-brand-700'
                }`}
              >
                <Droplets size={13} /> {water.text}
              </span>
            )}
            {fert && (
              <span
                className={`inline-flex items-center gap-1 ${
                  fert.overdue ? 'text-danger font-medium' : 'text-brand-700'
                }`}
              >
                <Sprout size={13} /> {fert.text}
              </span>
            )}
          </div>
        )}
        {plant.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {plant.tags.slice(0, 3).map((t) => (
              <span key={t} className="chip rounded-full px-2.5">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
