import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, Sparkles } from 'lucide-react';
import { PlantsApi } from '@/api/endpoints';
import type { Plant, PlantLocation, PlantPrefill } from '@/types';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { BackLink } from '@/components/BackLink';
import { TagInput } from '@/components/TagInput';
import { PlantImageUploader } from '@/components/plants/PlantImageUploader';
import { invalidateOverview, useResourceQuery } from '@/hooks/useOverviewQuery';
import { PLANT_LOCATION_LABELS, PLANT_LOCATION_OPTIONS, todayInputValue } from '@/lib/plants';
import { SUGGESTED_PLANT_TAGS } from '@/data/plantTags';

const toNum = (s: string): number | null => {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function PlantEditPage() {
  const { id } = useParams();
  const isEdit = id !== undefined;
  const plantId = Number(id);
  const nav = useNavigate();

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  // Form state — number fields kept as strings so the inputs stay controlled.
  const [name, setName] = useState('');
  const [species, setSpecies] = useState('');
  const [location, setLocation] = useState<PlantLocation>('HALBSCHATTEN');
  const [wateringInterval, setWateringInterval] = useState('');
  const [wateringNote, setWateringNote] = useState('');
  const [fertilize, setFertilize] = useState(false);
  const [fertilizeInterval, setFertilizeInterval] = useState('');
  const [winterhardy, setWinterhardy] = useState(false);
  const [edible, setEdible] = useState(false);
  const [heightCm, setHeightCm] = useState('');
  const [widthCm, setWidthCm] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [imageUrl, setImageUrl] = useState('');

  // Create-only: "Zuletzt gegossen / gedüngt", pre-filled with today. Left at
  // today → omitted on save so the backend starts the cycle at now().
  const [wateredDate, setWateredDate] = useState(todayInputValue());
  const [fertilizedDate, setFertilizedDate] = useState(todayInputValue());

  // Create-only AI prefill (Ollama, advisory). Non-blocking: it runs while the
  // user keeps typing, and only fills fields still at their default/empty value.
  const [searchName, setSearchName] = useState('');
  const [prefilling, setPrefilling] = useState(false);
  const [prefillInfo, setPrefillInfo] = useState<{ text: string; ok: boolean } | null>(null);
  const [edibleSuggestion, setEdibleSuggestion] = useState<boolean | null>(null);
  const [edibleNote, setEdibleNote] = useState<string | null>(null);

  /** Populate via functional updaters so we read the LATEST value at apply
   *  time — a field the user edited DURING the (slow) request is never
   *  overwritten. We never touch `edible` — edibility stays a hint. */
  const applyPrefill = (d: PlantPrefill) => {
    setName((prev) => (prev.trim() ? prev : d.suggested_name || searchName.trim()));
    setSpecies((prev) => (prev.trim() ? prev : d.species ?? ''));
    setLocation((prev) => (prev !== 'HALBSCHATTEN' ? prev : d.location ?? prev));
    setWateringInterval((prev) =>
      prev.trim() ? prev : d.watering_interval_days != null ? String(d.watering_interval_days) : prev,
    );
    if (d.fertilize) {
      // Only ever turns the flag on (default is off) — never clears a user's choice.
      setFertilize(true);
      setFertilizeInterval((prev) =>
        prev.trim() ? prev : d.fertilize_interval_days != null ? String(d.fertilize_interval_days) : prev,
      );
    }
    if (d.winterhardy) setWinterhardy(true);
    setHeightCm((prev) => (prev.trim() ? prev : d.height_cm != null ? String(d.height_cm) : prev));
    setWidthCm((prev) => (prev.trim() ? prev : d.width_cm != null ? String(d.width_cm) : prev));
    // edible: intentionally NOT set — only surfaced as a hint below.
    setEdibleSuggestion(d.edible_suggestion);
    setEdibleNote(d.edible_note);
  };

  const doPrefill = async () => {
    const query = searchName.trim();
    if (!query || prefilling) return;
    setPrefilling(true);
    setPrefillInfo(null);
    try {
      const d = await PlantsApi.prefill(query);
      if (d.ok) {
        applyPrefill(d);
        setPrefillInfo({
          text: d.note || 'Vorschläge eingefügt – bitte alle Felder prüfen.',
          ok: true,
        });
      } else {
        setPrefillInfo({ text: d.note || 'Konnte nicht ermitteln, bitte manuell ausfüllen.', ok: false });
      }
    } catch (err) {
      setPrefillInfo({ text: getApiError(err), ok: false });
    } finally {
      setPrefilling(false);
    }
  };

  const fetchPlant = useCallback(async () => {
    if (!isEdit) return;
    try {
      const p = await PlantsApi.get(plantId);
      setName(p.name);
      setSpecies(p.species ?? '');
      setLocation(p.location);
      setWateringInterval(p.watering_interval_days?.toString() ?? '');
      setWateringNote(p.watering_note ?? '');
      setFertilize(p.fertilize);
      setFertilizeInterval(p.fertilize_interval_days?.toString() ?? '');
      setWinterhardy(p.winterhardy);
      setEdible(p.edible);
      setHeightCm(p.height_cm?.toString() ?? '');
      setWidthCm(p.width_cm?.toString() ?? '');
      setNotes(p.notes ?? '');
      setTags(p.tags ?? []);
      setImageUrl(p.image_url ?? '');
    } catch (e) {
      toast.error(getApiError(e));
      nav('/plants');
    } finally {
      setLoading(false);
    }
  }, [isEdit, plantId, nav]);

  useResourceQuery(`plant-edit:${id ?? 'new'}`, fetchPlant);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Name ist erforderlich');
      return;
    }
    const base = {
      name: name.trim(),
      species: species.trim() || null,
      location,
      watering_interval_days: toNum(wateringInterval),
      watering_note: wateringNote.trim() || null,
      fertilize,
      fertilize_interval_days: fertilize ? toNum(fertilizeInterval) : null,
      winterhardy,
      edible,
      height_cm: toNum(heightCm),
      width_cm: toNum(widthCm),
      notes: notes.trim() || null,
      tags,
    };
    setSaving(true);
    try {
      if (isEdit) {
        await PlantsApi.update(plantId, base);
        invalidateOverview('plants');
        toast.success('Gespeichert');
        nav(`/plants/${plantId}`);
      } else {
        const today = todayInputValue();
        const created = await PlantsApi.create({
          ...base,
          // Only send when the user moved the date off today; otherwise the
          // backend falls back to now().
          last_watered_at: wateredDate !== today ? new Date(wateredDate).toISOString() : undefined,
          last_fertilized_at:
            fertilize && fertilizedDate !== today
              ? new Date(fertilizedDate).toISOString()
              : undefined,
        });
        invalidateOverview('plants');
        toast.success('Pflanze angelegt');
        nav(`/plants/${created.id}`);
      }
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-muted/70">Lade…</div>;

  return (
    <form onSubmit={save} className="max-w-2xl flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <BackLink to={isEdit ? `/plants/${plantId}` : '/plants'} label="zu Pflanzen" />
        <h1 className="text-xl font-semibold">
          {isEdit ? 'Pflanze bearbeiten' : 'Neue Pflanze'}
        </h1>
      </div>

      {/* AI prefill — name → advisory suggestions. Non-blocking; the form
          stays editable while it loads. */}
      {!isEdit && (
        <div className="card p-5 flex flex-col gap-3">
          <div>
            <label className="label">Pflanze suchen (KI-Vorschlag)</label>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                placeholder="z. B. Monstera deliciosa"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void doPrefill();
                  }
                }}
              />
              <button
                type="button"
                className="btn-secondary shrink-0"
                onClick={doPrefill}
                disabled={prefilling || !searchName.trim()}
              >
                {prefilling ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                <span>{prefilling ? 'Suche…' : 'Vorschlag'}</span>
              </button>
            </div>
            {prefilling && (
              <p className="text-xs text-muted mt-1.5">
                Die KI denkt nach – kann 10–30 s dauern. Du kannst schon weiter ausfüllen.
              </p>
            )}
          </div>
          {prefillInfo && (
            <p
              className={`text-xs rounded-ctl px-3 py-2 ${
                prefillInfo.ok ? 'bg-brand-50 text-brand-700' : 'bg-page text-muted'
              }`}
            >
              {prefillInfo.text}
            </p>
          )}
        </div>
      )}

      <div className="card p-5 flex flex-col gap-4">
        <div>
          <label className="label">Name *</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Monstera Wohnzimmer"
            autoFocus
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Art / lat. Name</label>
            <input
              className="input"
              value={species}
              onChange={(e) => setSpecies(e.target.value)}
              placeholder="z. B. Monstera deliciosa"
            />
          </div>
          <div>
            <label className="label">Lichtverhältnisse</label>
            <select
              className="input"
              value={location}
              onChange={(e) => setLocation(e.target.value as PlantLocation)}
            >
              {PLANT_LOCATION_OPTIONS.map((loc) => (
                <option key={loc} value={loc}>
                  {PLANT_LOCATION_LABELS[loc]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <TagInput
          label="Bereich"
          value={tags}
          onChange={setTags}
          suggestionGroups={SUGGESTED_PLANT_TAGS}
          datalistId="plant-tag-suggestions"
        />
      </div>

      {/* Watering */}
      <div className="card p-5 flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-ink">Gießen</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Intervall (Tage)</label>
            <input
              className="input"
              type="number"
              min={1}
              max={365}
              value={wateringInterval}
              onChange={(e) => setWateringInterval(e.target.value)}
              placeholder="leer = keine Erinnerung"
            />
          </div>
          {!isEdit && (
            <div>
              <label className="label">Zuletzt gegossen</label>
              <input
                className="input"
                type="date"
                value={wateredDate}
                onChange={(e) => setWateredDate(e.target.value)}
              />
            </div>
          )}
        </div>
        <div>
          <label className="label">Notiz (wie viel?)</label>
          <input
            className="input"
            value={wateringNote}
            onChange={(e) => setWateringNote(e.target.value)}
            placeholder="z. B. durchdringend bis Wasser unten austritt"
          />
        </div>
      </div>

      {/* Fertilizing */}
      <div className="card p-5 flex flex-col gap-4">
        <Toggle label="Düngen" checked={fertilize} onChange={setFertilize} />
        {fertilize && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Intervall (Tage)</label>
              <input
                className="input"
                type="number"
                min={1}
                max={365}
                value={fertilizeInterval}
                onChange={(e) => setFertilizeInterval(e.target.value)}
                placeholder="leer = keine Erinnerung"
              />
            </div>
            {!isEdit && (
              <div>
                <label className="label">Zuletzt gedüngt</label>
                <input
                  className="input"
                  type="date"
                  value={fertilizedDate}
                  onChange={(e) => setFertilizedDate(e.target.value)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Properties */}
      <div className="card p-5 flex flex-col gap-4">
        <Toggle label="Winterhart" checked={winterhardy} onChange={setWinterhardy} />
        <Toggle label="Essbar" checked={edible} onChange={setEdible} />
        {edibleSuggestion !== null && (
          <p className="-mt-2 text-xs text-muted">
            KI vermutet:{' '}
            <span className="font-medium text-ink">
              {edibleSuggestion ? 'essbar' : 'nicht essbar'}
            </span>{' '}
            — bitte selbst bestätigen.{edibleNote ? ` ${edibleNote}` : ''}
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Höhe (cm)</label>
            <input
              className="input"
              type="number"
              min={0}
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Breite (cm)</label>
            <input
              className="input"
              type="number"
              min={0}
              value={widthCm}
              onChange={(e) => setWidthCm(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="label">Notizen</label>
          <textarea
            className="input min-h-[80px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      {/* Image — only once the plant exists (needs an id to upload against). */}
      <div className="card p-5 flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink">Bild</h2>
        {isEdit ? (
          <PlantImageUploader
            plantId={plantId}
            currentUrl={imageUrl}
            onChanged={(url) => setImageUrl(url ?? '')}
          />
        ) : (
          <p className="text-xs text-muted">
            Ein Bild kannst du nach dem Speichern hinzufügen.
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => nav(isEdit ? `/plants/${plantId}` : '/plants')}
        >
          Abbrechen
        </button>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Speichere…' : 'Speichern'}
        </button>
      </div>
    </form>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-sm font-medium text-ink">{label}</span>
      <span className="inline-flex items-center">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="w-11 h-6 bg-line peer-checked:bg-brand rounded-full transition relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-[#fff] after:rounded-full after:h-5 after:w-5 after:transition peer-checked:after:translate-x-5" />
      </span>
    </label>
  );
}
