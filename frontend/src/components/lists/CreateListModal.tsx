/** "Neue Liste" dialog — title, type, emoji/colour preset.
 *
 *  Lived inside pages/Dashboard until the "Heute" screen grew a quick-create
 *  menu that needs the same dialog. Navigates to the fresh list itself, so a
 *  caller only has to render it; `onCreated` is for pages that also keep a
 *  local list state (the Listen overview does, Heute doesn't).
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListsApi } from '@/api/endpoints';
import { getApiError } from '@/api/client';
import { Modal } from '@/components/Modal';
import { PresetPicker } from '@/components/PresetPicker';
import { toast } from '@/components/Toast';
import { DEFAULT_PRESET_FOR_TYPE, LIST_TYPES as TYPES } from '@/data/presets';
import type { ListSummary, ListType } from '@/types';

export function CreateListModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (l: ListSummary) => void;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ListType>('SHOPPING');
  // Seed icon/color from the same preset table the picker uses, so the
  // initial trigger button matches the preview circle inside the picker.
  const [icon, setIcon] = useState(DEFAULT_PRESET_FOR_TYPE.SHOPPING.emoji);
  const [color, setColor] = useState(DEFAULT_PRESET_FOR_TYPE.SHOPPING.color);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const l = await ListsApi.create({ title, type, icon, color });
      onCreated(l);
      setTitle('');
      nav(`/lists/${l.id}`);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Neue Liste">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">Titel</label>
          <input
            className="input"
            value={title}
            autoFocus
            required
            onChange={(e) => setTitle(e.target.value)}
            placeholder="z.B. Wocheneinkauf"
          />
        </div>
        <div>
          <label className="label">Typ</label>
          <div className="grid grid-cols-2 gap-2">
            {TYPES.map((t) => (
              <button
                type="button"
                key={t.v}
                onClick={() => {
                  setType(t.v);
                  // Reseed the preset to the per-type default. Spec calls
                  // for SHOPPING → 🛒/#00c896, PACKING → 🎒/#2e7d6b,
                  // CHECKLIST → ✅/#00c896, CUSTOM → 📋/#5e7a8a.
                  const def = DEFAULT_PRESET_FOR_TYPE[t.v];
                  if (def) {
                    setIcon(def.emoji);
                    setColor(def.color);
                  }
                }}
                className={`p-3 rounded-xl border text-left transition ${
                  type === t.v ? 'border-brand bg-brand-50' : 'border-line hover:bg-page'
                }`}
              >
                <div className="text-2xl mb-1">{t.icon}</div>
                <div className="text-sm font-medium">{t.label}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Symbol &amp; Farbe</label>
          <div className="flex items-center gap-3">
            <PresetPicker
              emoji={icon}
              color={color}
              onChange={({ emoji, color }) => {
                setIcon(emoji);
                setColor(color);
              }}
            />
            <span className="text-xs text-muted">
              Tippen, um aus den Vorlagen zu wählen oder eigenes Emoji / eigene Farbe zu setzen.
            </span>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Anlegen…' : 'Anlegen'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
