/** Single-recipe share panel — toggle + copyable link + QR code.
 *
 *  Mirrors the list-share panel pattern but mounted as a modal so it lives
 *  cleanly off the action row icon. The QR code is only returned at
 *  enable-time; toggling enable→disable→enable refreshes it.
 *
 *  Parent owns the recipe so we surface state changes via `onUpdate`. */
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { RecipesApi } from '@/api/endpoints';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import type { Recipe, ShareInfo } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  recipe: Recipe;
  onUpdate: (patch: Partial<Recipe>) => void;
}

export function ShareRecipePanel({ open, onClose, recipe, onUpdate }: Props) {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (recipe.share_enabled && recipe.share_token) {
      // We have a token but no QR cached — show the link without QR until
      // the user re-enables (which fetches a fresh QR).
      const url = `${window.location.origin}/share/recipe/${recipe.share_token}`;
      setInfo({ share_token: recipe.share_token, share_url: url, qr_code_png_base64: '' });
    } else {
      setInfo(null);
    }
  }, [open, recipe.share_enabled, recipe.share_token]);

  const enable = async () => {
    setLoading(true);
    try {
      const r = await RecipesApi.shareEnable(recipe.id);
      setInfo(r);
      onUpdate({ share_enabled: true, share_token: r.share_token });
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const disable = async () => {
    setLoading(true);
    try {
      await RecipesApi.shareDisable(recipe.id);
      setInfo(null);
      onUpdate({ share_enabled: false, share_token: null });
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!info) return;
    await navigator.clipboard.writeText(info.share_url);
    toast.success('Link kopiert');
  };

  return (
    <Modal open={open} onClose={onClose} title="Rezept teilen" className="max-w-md">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Öffentlich teilen</h3>
            <p className="text-xs text-muted">
              Schreibgeschützt — jede Person mit dem Link kann das Rezept ansehen.
            </p>
          </div>
          <label className="inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={recipe.share_enabled}
              onChange={() => (recipe.share_enabled ? disable() : enable())}
              disabled={loading}
            />
            <div className="w-11 h-6 bg-line peer-checked:bg-brand rounded-full transition relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-[#fff] after:rounded-full after:h-5 after:w-5 after:transition peer-checked:after:translate-x-5" />
          </label>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted py-3">
            <Loader2 size={14} className="animate-spin" />
            <span>Einen Moment…</span>
          </div>
        )}

        {info && !loading && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                className="input flex-1 text-xs font-mono"
                readOnly
                value={info.share_url}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button className="btn-secondary text-sm" onClick={copy}>
                Kopieren
              </button>
            </div>
            {info.qr_code_png_base64 ? (
              <div className="flex justify-center">
                <img
                  src={`data:image/png;base64,${info.qr_code_png_base64}`}
                  alt="QR-Code"
                  className="w-40 h-40 rounded-lg border border-line"
                />
              </div>
            ) : (
              <div className="text-xs text-muted text-center">
                QR-Code wird beim erneuten Aktivieren angezeigt.
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
