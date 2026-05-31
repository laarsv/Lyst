import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Droplets, Plus, Sprout } from 'lucide-react';
import { PlantsApi } from '@/api/endpoints';
import type { Plant, PlantDue } from '@/types';
import { PlantCard } from '@/components/plants/PlantCard';
import { IconAction } from '@/components/IconAction';
import { useOverviewQuery } from '@/hooks/useOverviewQuery';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { dueLabel } from '@/lib/plants';

export function PlantsPage() {
  const nav = useNavigate();
  const [plants, setPlants] = useState<Plant[]>([]);
  const [due, setDue] = useState<PlantDue>({ water: [], fertilize: [] });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [list, dueGroups] = await Promise.all([
        PlantsApi.list({ q: q || undefined }),
        PlantsApi.due(),
      ]);
      setPlants(list);
      setDue(dueGroups);
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useOverviewQuery(`plants:${q}`, () => load());

  const doWater = async (id: number) => {
    try {
      await PlantsApi.water(id);
      toast.success('Als gegossen markiert');
      void load();
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const doFertilize = async (id: number) => {
    try {
      await PlantsApi.fertilize(id);
      toast.success('Als gedüngt markiert');
      void load();
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const hasDue = due.water.length > 0 || due.fertilize.length > 0;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-semibold">Pflanzen</h1>
        <IconAction
          label="Neue Pflanze"
          icon={Plus}
          onClick={() => nav('/plants/new')}
          variant="primary"
        />
      </div>

      <div className="mb-6">
        <input
          className="input"
          placeholder="Pflanze oder Art suchen…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
      </div>

      {/* Diese Woche fällig — overdue + due within 7 days. */}
      {hasDue && (
        <div className="card p-5 mb-6">
          <h2 className="text-sm font-semibold text-ink mb-3">Diese Woche fällig</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
            {due.water.length > 0 && (
              <DueColumn
                title="Gießen"
                icon={<Droplets size={14} className="text-brand-700" />}
                plants={due.water}
                dueField="next_water_due"
                actionLabel="Gegossen"
                onAction={doWater}
              />
            )}
            {due.fertilize.length > 0 && (
              <DueColumn
                title="Düngen"
                icon={<Sprout size={14} className="text-brand-700" />}
                plants={due.fertilize}
                dueField="next_fertilize_due"
                actionLabel="Gedüngt"
                onAction={doFertilize}
              />
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-muted/70">Lade…</div>
      ) : plants.length === 0 ? (
        <div className="card p-12 text-center text-muted">
          Noch keine Pflanzen.{' '}
          <Link to="/plants/new" className="text-brand hover:underline">
            Erste Pflanze anlegen
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {plants.map((p) => (
            <PlantCard key={p.id} plant={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function DueColumn({
  title,
  icon,
  plants,
  dueField,
  actionLabel,
  onAction,
}: {
  title: string;
  icon: React.ReactNode;
  plants: Plant[];
  dueField: 'next_water_due' | 'next_fertilize_due';
  actionLabel: string;
  onAction: (id: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted mb-2">
        {icon}
        <span>{title}</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {plants.map((p) => {
          const label = dueLabel(p[dueField]);
          return (
            <li key={p.id} className="flex items-center gap-2">
              <Link to={`/plants/${p.id}`} className="flex-1 min-w-0">
                <span className="text-sm text-ink truncate">{p.name}</span>{' '}
                {label && (
                  <span className={`text-[11px] ${label.overdue ? 'text-danger' : 'text-muted'}`}>
                    · {label.text}
                  </span>
                )}
              </Link>
              <button
                type="button"
                onClick={() => onAction(p.id)}
                className="btn-ghost text-xs shrink-0"
              >
                {actionLabel}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
