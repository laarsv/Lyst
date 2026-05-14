/** Whole recipe-book share panel — same UX as ShareRecipePanel but
 *  toggles the user's recipe_book_share_token instead of a per-recipe one.
 *
 *  State is managed locally inside the modal since the user object is not
 *  surfaced through props on the Recipes page; we read the live state by
 *  calling `shareBookEnable` to bootstrap when the user opts in. To detect
 *  whether sharing is already on (across page reloads), we ping the
 *  enable endpoint once on first open — that's idempotent and returns the
 *  current token. Disabling clears state cleanly. */
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { RecipesApi } from '@/api/endpoints';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import type { ShareInfo } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ShareRecipeBookPanel({ open, onClose }: Props) {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  // First open: query nothing — let the user explicitly opt in. The
  // enable endpoint is idempotent: calling it on an already-shared book
  // returns the existing token.
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) {
      setTouched(false);
      setInfo(null);
      setEnabled(false);
    }
  }, [open]);

  const enable = async () => {
    setLoading(true);
    try {
      const r = await RecipesApi.shareBookEnable();
      setInfo(r);
      setEnabled(true);
      setTouched(true);
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const disable = async () => {
    setLoading(true);
    try {
      await RecipesApi.shareBookDisable();
      setInfo(null);
      setEnabled(false);
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
    <Modal open={open} onClose={onClose} title="Rezeptbuch teilen" className="max-w-md">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">Öffentliches Rezeptbuch</h3>
            <p className="text-xs text-muted">
              Schreibgeschützt — jede Person mit dem Link sieht eine Übersicht
              all deiner Rezepte. Einzelne Rezepte sind nur dann anklickbar,
              wenn du sie zusätzlich einzeln freigegeben hast.
            </p>
          </div>
          <label className="inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={enabled}
              onChange={() => (enabled ? disable() : enable())}
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

        {!touched && !loading && (
          <div className="text-xs text-muted">
            Schalte den Toggle ein, um einen Link + QR-Code zu erzeugen.
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
            {info.qr_code_png_base64 && (
              <div className="flex justify-center">
                <img
                  src={`data:image/png;base64,${info.qr_code_png_base64}`}
                  alt="QR-Code"
                  className="w-40 h-40 rounded-lg border border-line"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
