import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Apple, Clock, Droplets, Flower2, Leaf, Pencil, Ruler, Scissors, Snowflake, Sprout, Sun, Trash2 } from 'lucide-react';
import { PlantsApi } from '@/api/endpoints';
import type { Plant } from '@/types';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { useConfirm } from '@/components/Dialogs';
import { BackLink } from '@/components/BackLink';
import { IconAction } from '@/components/IconAction';
import { invalidateOverview, useResourceQuery } from '@/hooks/useOverviewQuery';
import { PLANT_LOCATION_LABELS, dueLabel, monthLabel, monthRangeLabel, relativePast } from '@/lib/plants';

// White info card — ~18px radius, hairline border, no heavy shadow (per design).
const CARD = 'rounded-[18px] border border-line bg-surface';
// Outline action pill — white bg, mint border, dark-mint text (never white-on-mint).
const PILL =
  'inline-flex items-center gap-1.5 shrink-0 rounded-full border border-brand bg-surface px-3.5 py-1.5 text-sm font-medium text-brand-700 transition hover:bg-brand-50 active:scale-[0.98]';

export function PlantDetailPage() {
  const { id } = useParams();
  const plantId = Number(id);
  const nav = useNavigate();
  const [plant, setPlant] = useState<Plant | null>(null);
  const [loading, setLoading] = useState(true);
  const confirmDialog = useConfirm();

  const fetchPlant = useCallback(async () => {
    try {
      setPlant(await PlantsApi.get(plantId));
    } catch (e) {
      toast.error(getApiError(e));
      nav('/plants');
    } finally {
      setLoading(false);
    }
  }, [plantId, nav]);

  useResourceQuery(`plant:${plantId}`, fetchPlant);

  const water = async () => {
    try {
      setPlant(await PlantsApi.water(plantId));
      invalidateOverview('plants');
      toast.success('Als gegossen markiert');
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const fertilize = async () => {
    try {
      setPlant(await PlantsApi.fertilize(plantId));
      invalidateOverview('plants');
      toast.success('Als gedüngt markiert');
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const remove = async () => {
    if (!plant) return;
    if (
      !(await confirmDialog({
        title: `Pflanze „${plant.name}" löschen?`,
        message: 'Kann nicht rückgängig gemacht werden.',
        confirmLabel: 'Löschen',
        variant: 'danger',
      }))
    )
      return;
    try {
      await PlantsApi.remove(plant.id);
      invalidateOverview('plants');
      toast.success('Pflanze gelöscht');
      nav('/plants');
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  if (loading) return <div className="text-muted/70">Lade…</div>;
  if (!plant) return null;

  const waterDue = dueLabel(plant.next_water_due);
  const fertDue = dueLabel(plant.next_fertilize_due);
  // A care row shows only when its interval is set (null = no reminder).
  const showWater = plant.watering_interval_days != null && waterDue != null;
  const showFert = plant.fertilize && plant.fertilize_interval_days != null && fertDue != null;

  const wasserValue =
    plant.watering_interval_days != null ? `alle ${plant.watering_interval_days} Tage` : '—';
  const fertSeason =
    plant.fertilize_start_month != null && plant.fertilize_end_month != null
      ? ` (${monthRangeLabel(plant.fertilize_start_month, plant.fertilize_end_month)})`
      : '';
  const duengenValue = !plant.fertilize
    ? 'nein'
    : (plant.fertilize_interval_days != null ? `alle ${plant.fertilize_interval_days} Tage` : 'ja') +
      fertSeason;
  const schnittValue = plant.prune_month
    ? monthLabel(plant.prune_month) + (plant.prune_due ? ' · jetzt fällig' : '')
    : '—';
  const blueteValue = monthRangeLabel(plant.bloom_start_month, plant.bloom_end_month);
  const sizeValue =
    [
      plant.height_cm != null && `Höhe ${plant.height_cm} cm`,
      plant.width_cm != null && `Breite ${plant.width_cm} cm`,
    ]
      .filter(Boolean)
      .join(' · ') || '—';

  return (
    <div className="mx-auto max-w-xl">
      <div className="flex items-center justify-between gap-3 mb-4">
        <BackLink to="/plants" label="zu Pflanzen" />
        <div className="flex items-center gap-1.5">
          <IconAction label="Bearbeiten" icon={Pencil} onClick={() => nav(`/plants/${plant.id}/edit`)} />
          <IconAction label="Löschen" icon={Trash2} onClick={remove} variant="danger" />
        </div>
      </div>

      {/* Hero */}
      {plant.image_url ? (
        <div
          className="h-52 rounded-[18px] bg-cover bg-center"
          style={{ backgroundImage: `url(${plant.image_url})` }}
        />
      ) : (
        <div className="h-52 rounded-[18px] bg-brand-50 flex items-center justify-center">
          <Leaf size={48} className="text-brand-700" />
        </div>
      )}

      {/* Name + species + Bereich pills */}
      <h1 className="mt-4 text-2xl font-bold text-ink">{plant.name}</h1>
      {plant.species && <p className="text-muted italic">{plant.species}</p>}
      {plant.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {plant.tags.map((t) => (
            <span key={t} className="chip rounded-full px-2.5">
              {t}
            </span>
          ))}
        </div>
      )}

      {/* CARE STATUS — prominent, soft-mint, right under the name. */}
      {(showWater || showFert) && (
        <section className="mt-4 rounded-[18px] border border-brand-100 bg-brand-50 p-4 flex flex-col gap-3">
          {showWater && (
            <CareRow
              icon={<Droplets size={18} />}
              label="Gießen"
              due={waterDue!}
              actionLabel="Gegossen"
              onAction={water}
            />
          )}
          {showFert && (
            <CareRow
              icon={<Sprout size={18} />}
              label="Düngen"
              due={fertDue!}
              actionLabel="Gedüngt"
              onAction={fertilize}
            />
          )}
        </section>
      )}

      {/* Pflege auf einen Blick — 2×2 */}
      <section className={`${CARD} mt-4 p-5`}>
        <h2 className="text-sm font-semibold text-ink mb-4">Pflege auf einen Blick</h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-5">
          <Stat icon={<Sun size={18} />} label="Licht" value={PLANT_LOCATION_LABELS[plant.location]} />
          <Stat icon={<Droplets size={18} />} label="Wasser" value={wasserValue} />
          <Stat
            icon={<Snowflake size={18} />}
            label="Frosthärte"
            value={plant.winterhardy ? 'winterhart' : 'nicht winterhart'}
          />
          <Stat icon={<Sprout size={18} />} label="Düngen" value={duengenValue} />
          <Stat icon={<Scissors size={18} />} label="Schnitt" value={schnittValue} />
          <Stat icon={<Flower2 size={18} />} label="Blüte" value={blueteValue} />
        </div>
      </section>

      {/* Details */}
      <section className={`${CARD} mt-4 p-5`}>
        <h2 className="text-sm font-semibold text-ink mb-4">Details</h2>
        <div className="flex flex-col gap-4">
          <DetailRow icon={<Ruler size={18} />} label="Größe" value={sizeValue} />
          <DetailRow icon={<Apple size={18} />} label="Essbar" value={plant.edible ? 'ja' : 'nein'} />
          <DetailRow
            icon={<Clock size={18} />}
            label="Zuletzt gegossen"
            value={relativePast(plant.last_watered_at)}
          />
        </div>
      </section>

      {/* Notizen */}
      {plant.notes && (
        <section className={`${CARD} mt-4 p-5`}>
          <h2 className="text-sm font-semibold text-ink mb-2">Notizen</h2>
          <p className="text-sm text-ink whitespace-pre-wrap">{plant.notes}</p>
        </section>
      )}
    </div>
  );
}

/** Soft-mint icon disc — soft-mint bg, dark-mint glyph. */
function IconCircle({ children }: { children: React.ReactNode }) {
  return (
    <span className="size-9 shrink-0 rounded-full bg-brand-50 text-brand-700 inline-flex items-center justify-center">
      {children}
    </span>
  );
}

function CareRow({
  icon,
  label,
  due,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  label: string;
  due: { text: string; overdue: boolean };
  actionLabel: string;
  onAction: () => void;
}) {
  // Overdue tints text + icon with the danger token; otherwise dark mint.
  const tone = due.overdue ? 'text-danger' : 'text-brand-700';
  return (
    <div className="flex items-center justify-between gap-3">
      <div className={`flex items-center gap-2 min-w-0 ${tone}`}>
        <span className="shrink-0">{icon}</span>
        <span className="text-sm truncate">
          <span className="font-semibold">{label}</span>
          <span className="opacity-80"> — {due.text}</span>
        </span>
      </div>
      <button type="button" onClick={onAction} className={PILL}>
        {actionLabel}
      </button>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <IconCircle>{icon}</IconCircle>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-ink">{label}</div>
        <div className="text-sm text-muted truncate">{value}</div>
      </div>
    </div>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <IconCircle>{icon}</IconCircle>
      <span className="text-sm font-semibold text-ink">{label}</span>
      <span className="ml-auto text-sm text-muted text-right">{value}</span>
    </div>
  );
}
