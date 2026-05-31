import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Droplets, Pencil, Sprout, Trash2 } from 'lucide-react';
import { PlantsApi } from '@/api/endpoints';
import type { Plant } from '@/types';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { useConfirm } from '@/components/Dialogs';
import { BackLink } from '@/components/BackLink';
import { IconAction } from '@/components/IconAction';
import { invalidateOverview, useResourceQuery } from '@/hooks/useOverviewQuery';
import { PLANT_LOCATION_LABELS, dueLabel, fmtPlantDate } from '@/lib/plants';

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

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between gap-3 mb-4">
        <BackLink to="/plants" label="zu Pflanzen" />
        <div className="flex items-center gap-1.5">
          <IconAction label="Bearbeiten" icon={Pencil} onClick={() => nav(`/plants/${plant.id}/edit`)} />
          <IconAction label="Löschen" icon={Trash2} onClick={remove} variant="danger" />
        </div>
      </div>

      {plant.image_url ? (
        <div
          className="h-48 bg-cover bg-center rounded-2xl mb-4"
          style={{ backgroundImage: `url(${plant.image_url})` }}
        />
      ) : (
        <div className="h-48 bg-gradient-to-br from-brand-50 to-brand-100/40 rounded-2xl mb-4 flex items-center justify-center text-5xl">
          🪴
        </div>
      )}

      <h1 className="text-2xl font-semibold">{plant.name}</h1>
      {plant.species && <p className="text-muted italic">{plant.species}</p>}

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
        <span>📍 {PLANT_LOCATION_LABELS[plant.location]}</span>
        {plant.edible && <span>🍽 Essbar</span>}
        {plant.winterhardy && <span>❄️ Winterhart</span>}
        {(plant.height_cm || plant.width_cm) && (
          <span>
            📐 {plant.height_cm ? `${plant.height_cm} cm hoch` : ''}
            {plant.height_cm && plant.width_cm ? ', ' : ''}
            {plant.width_cm ? `${plant.width_cm} cm breit` : ''}
          </span>
        )}
      </div>

      {/* Care actions + status */}
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <CareCard
          icon={<Droplets size={16} className="text-brand-700" />}
          title="Gießen"
          interval={plant.watering_interval_days}
          note={plant.watering_note}
          last={plant.last_watered_at}
          due={waterDue}
          actionLabel="Gegossen"
          onAction={water}
        />
        {plant.fertilize && (
          <CareCard
            icon={<Sprout size={16} className="text-brand-700" />}
            title="Düngen"
            interval={plant.fertilize_interval_days}
            note={null}
            last={plant.last_fertilized_at}
            due={fertDue}
            actionLabel="Gedüngt"
            onAction={fertilize}
          />
        )}
      </div>

      {plant.notes && (
        <div className="card p-5 mt-5">
          <h2 className="text-sm font-semibold text-ink mb-2">Notizen</h2>
          <p className="text-sm text-ink whitespace-pre-wrap">{plant.notes}</p>
        </div>
      )}
    </div>
  );
}

function CareCard({
  icon,
  title,
  interval,
  note,
  last,
  due,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  interval: number | null;
  note: string | null;
  last: string | null;
  due: { text: string; overdue: boolean } | null;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        {icon}
        <span>{title}</span>
      </div>
      <div className="text-xs text-muted flex flex-col gap-0.5">
        <span>
          {interval ? `alle ${interval} Tage` : 'kein Intervall — keine Erinnerung'}
        </span>
        {note && <span className="italic">{note}</span>}
        <span>Zuletzt: {fmtPlantDate(last)}</span>
        {due && (
          <span className={due.overdue ? 'text-danger font-medium' : ''}>{due.text}</span>
        )}
      </div>
      <button type="button" onClick={onAction} className="btn-secondary text-sm mt-1">
        {actionLabel}
      </button>
    </div>
  );
}
