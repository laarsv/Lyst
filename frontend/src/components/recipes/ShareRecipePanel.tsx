/** Single-recipe share panel — toggle + copyable link + QR code.
 *
 *  Mirrors the list-share panel pattern but mounted as a modal so it lives
 *  cleanly off the action row icon. The QR code is only returned at
 *  enable-time; toggling enable→disable→enable refreshes it.
 *
 *  Parent owns the recipe so we surface state changes via `onUpdate`. */
import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { RecipesApi } from '@/api/endpoints';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import type { InternalShare, Recipe, ShareInfo } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  recipe: Recipe;
  onUpdate: (patch: Partial<Recipe>) => void;
}

export function ShareRecipePanel({ open, onClose, recipe, onUpdate }: Props) {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailValue, setEmailValue] = useState('');
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [shares, setShares] = useState<InternalShare[]>([]);

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
    // Always pull the current internal-share list when the panel opens.
    void RecipesApi.listShares(recipe.id)
      .then(setShares)
      .catch(() => setShares([]));
  }, [open, recipe.id, recipe.share_enabled, recipe.share_token]);

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = emailValue.trim();
    if (!email) return;
    setEmailSubmitting(true);
    try {
      const r = await RecipesApi.shareByEmail(recipe.id, email);
      if (r.type === 'internal') {
        toast.success(
          `An ${r.user_name ?? email} in Lyst geteilt — das Rezept erscheint jetzt in ihrer Bibliothek.`,
        );
        // Refresh the visible list.
        const fresh = await RecipesApi.listShares(recipe.id).catch(() => shares);
        setShares(fresh);
      } else {
        toast.success(
          `${email} hat keinen Lyst-Account — der öffentliche Link wurde per E-Mail gesendet.`,
        );
        // Sending the public link auto-enables share_token; reflect that.
        if (!recipe.share_enabled) {
          onUpdate({ share_enabled: true });
        }
      }
      setEmailValue('');
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setEmailSubmitting(false);
    }
  };

  const revoke = async (s: InternalShare) => {
    try {
      await RecipesApi.revokeShare(recipe.id, s.user_id);
      setShares((cur) => cur.filter((x) => x.user_id !== s.user_id));
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

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
      <div className="space-y-4">
        {/* ── Per-email share ────────────────────────────────────────── */}
        <section>
          <h3 className="font-semibold">Per E-Mail teilen</h3>
          <p className="text-xs text-muted mb-2">
            Hat die Empfängerin einen Lyst-Account? Dann erscheint das
            Rezept direkt in ihrer Bibliothek. Sonst senden wir den
            öffentlichen Link an die angegebene Adresse.
          </p>
          <form onSubmit={submitEmail} className="flex gap-2">
            <input
              type="email"
              required
              className="input flex-1 text-sm"
              placeholder="email@beispiel.de"
              value={emailValue}
              onChange={(e) => setEmailValue(e.target.value)}
              disabled={emailSubmitting}
            />
            <button
              type="submit"
              className="btn-primary text-sm"
              disabled={emailSubmitting || !emailValue.trim()}
            >
              {emailSubmitting ? 'Sende…' : 'Teilen'}
            </button>
          </form>
          {shares.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
                Geteilt mit
              </div>
              <ul className="border border-line rounded-ctl divide-y divide-line">
                {shares.map((s) => (
                  <li
                    key={s.user_id}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-muted ml-2 text-xs">{s.email}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => revoke(s)}
                      className="size-6 inline-flex items-center justify-center rounded-full text-muted hover:text-danger hover:bg-page"
                      aria-label={`Freigabe für ${s.name} entfernen`}
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <hr className="border-line" />

        {/* ── Public link + QR ───────────────────────────────────────── */}
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
