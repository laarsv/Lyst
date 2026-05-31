import { Link } from 'react-router-dom';
import { Droplets, Sprout } from 'lucide-react';
import type { Plant } from '@/types';
import { PLANT_LOCATION_LABELS, dueLabel } from '@/lib/plants';

/** Plant summary card — image (or 🪴 fallback), name, species, location, and
 *  a water/fertilize due chip when the next-due moment is set. Mirrors
 *  RecipeCard's layout. */
export function PlantCard({ plant }: { plant: Plant }) {
  const water = dueLabel(plant.next_water_due);
  const fert = dueLabel(plant.next_fertilize_due);
  return (
    <Link
      to={`/plants/${plant.id}`}
      className="card p-5 hover:shadow-md transition flex flex-col gap-3 group"
    >
      {plant.image_url ? (
        <div
          className="-mx-5 -mt-5 mb-1 h-32 bg-cover bg-center rounded-t-2xl"
          style={{ backgroundImage: `url(${plant.image_url})` }}
        />
      ) : (
        <div className="-mx-5 -mt-5 mb-1 h-32 bg-gradient-to-br from-brand-50 to-brand-100/40 rounded-t-2xl flex items-center justify-center text-3xl">
          🪴
        </div>
      )}
      <div className="min-w-0">
        <div className="font-semibold text-ink truncate">{plant.name}</div>
        {plant.species && (
          <div className="text-xs text-muted italic truncate">{plant.species}</div>
        )}
        <div className="mt-1 text-xs text-muted flex flex-wrap gap-x-3 gap-y-1">
          <span>☀️ {PLANT_LOCATION_LABELS[plant.location]}</span>
          {plant.edible && <span>🍽 Essbar</span>}
          {plant.winterhardy && <span>❄️ Winterhart</span>}
        </div>
        {(water || fert) && (
          <div className="mt-2 flex flex-wrap gap-1">
            {water && (
              <span
                className={`text-[11px] px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${
                  water.overdue ? 'bg-danger/10 text-danger' : 'bg-page text-muted'
                }`}
              >
                <Droplets size={11} /> {water.text}
              </span>
            )}
            {fert && (
              <span
                className={`text-[11px] px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${
                  fert.overdue ? 'bg-danger/10 text-danger' : 'bg-page text-muted'
                }`}
              >
                <Sprout size={11} /> {fert.text}
              </span>
            )}
          </div>
        )}
        {plant.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {plant.tags.slice(0, 4).map((t) => (
              <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-page text-muted">
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
