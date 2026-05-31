import { useMemo, useState } from 'react';
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
import { BEREICH_TAGS } from '@/data/plantTags';

/** 'ALL' = no tag filter; any other value is a "Bereich" tag (server-side). */
type Filter = 'ALL' | string;

export function PlantsPage() {
  const nav = useNavigate();
  const [plants, setPlants] = useState<Plant[]>([]);
  const [due, setDue] = useState<PlantDue>({ water: [], fertilize: [] });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');

  const load = async () => {
    setLoading(true);
    try {
      const [list, dueGroups] = await Promise.all([
        PlantsApi.list({ q: q || undefined, tag: filter === 'ALL' ? undefined : filter }),
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

  useOverviewQuery(`plants:${filter}`, () => load());

  // Filter chips: Bereich suggestions lead (matching the recipes overview's
  // meal-type-first ordering), then any other tags actually in use, deduped
  // and sorted by frequency. Computed from the full loaded set so the bar
  // stays stable as the user clicks.
  const filterChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of plants) {
      for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const t of BEREICH_TAGS) {
      if (counts.has(t) || filter === t) {
        ordered.push(t);
        seen.add(t);
      }
    }
    const others = [...counts.entries()]
      .filter(([t]) => !seen.has(t))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([t]) => t);
    return [...ordered, ...others];
  }, [plants, filter]);

  // Client-side q narrowing on top of the server result, so typing filters
  // live without waiting for Enter (mirrors the recipes overview).
  const visible = useMemo(() => {
    if (!q) return plants;
    const needle = q.toLowerCase();
    return plants.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        (p.species?.toLowerCase().includes(needle) ?? false) ||
        p.tags.some((t) => t.toLowerCase().includes(needle)),
    );
  }, [plants, q]);

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

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <input
          className="input flex-1 min-w-[200px]"
          placeholder="Pflanze, Art oder Bereich suchen…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
        {/* Bereich filter chip bar — mirrors the recipes tag filter. */}
        <div className="flex gap-1 bg-surface border border-line rounded-xl p-1 overflow-x-auto">
          <button
            onClick={() => setFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-sm transition whitespace-nowrap ${
              filter === 'ALL' ? 'bg-surface shadow-sm font-medium' : 'text-muted'
            }`}
          >
            Alle
          </button>
          {filterChips.map((tag) => (
            <button
              key={tag}
              onClick={() => setFilter(tag)}
              className={`px-3 py-1.5 rounded-lg text-sm transition whitespace-nowrap ${
                filter === tag ? 'bg-surface shadow-sm font-medium' : 'text-muted'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Diese Woche fällig — overdue + due within 7 days. Soft-mint to match
          the detail-page care card. */}
      {hasDue && (
        <div className="mb-6 rounded-[18px] border border-brand-100 bg-brand-50 p-5">
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
      ) : visible.length === 0 ? (
        <div className="card p-12 text-center text-muted">
          Noch keine Pflanzen.{' '}
          <Link to="/plants/new" className="text-brand hover:underline">
            Erste Pflanze anlegen
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((p) => (
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
      <div className="flex items-center gap-1.5 text-xs font-semibold text-brand-700 mb-2">
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
                  <span className={`text-[11px] ${label.overdue ? 'text-danger font-medium' : 'text-brand-700'}`}>
                    · {label.text}
                  </span>
                )}
              </Link>
              <button
                type="button"
                onClick={() => onAction(p.id)}
                className="inline-flex items-center shrink-0 rounded-full border border-brand bg-surface px-3 py-1 text-xs font-medium text-brand-700 transition hover:bg-brand-50 active:scale-[0.98]"
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
