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
import { Loader2, X } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { RecipesApi } from '@/api/endpoints';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { ShareSuggestionsRow } from '@/components/ShareSuggestionsRow';
import type { CollaboratorPermission, InternalShare, ShareInfo } from '@/types';

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
  const [emailValue, setEmailValue] = useState('');
  const [emailPerm, setEmailPerm] = useState<CollaboratorPermission>('VIEW');
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [shares, setShares] = useState<InternalShare[]>([]);

  useEffect(() => {
    if (!open) {
      setTouched(false);
      setInfo(null);
      setEnabled(false);
      setShares([]);
      setEmailValue('');
      return;
    }
    void RecipesApi.listBookShares()
      .then(setShares)
      .catch(() => setShares([]));
  }, [open]);

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = emailValue.trim();
    if (!email) return;
    setEmailSubmitting(true);
    try {
      const r = await RecipesApi.shareBookByEmail(email, emailPerm);
      if (r.type === 'internal') {
        const permLabel = emailPerm === 'EDIT' ? 'mit Bearbeitungsrecht' : 'zum Lesen';
        toast.success(
          `An ${r.user_name ?? email} in Lyst geteilt (${permLabel}).`,
        );
        const fresh = await RecipesApi.listBookShares().catch(() => shares);
        setShares(fresh);
      } else {
        toast.success(
          `${email} hat keinen Lyst-Account — der öffentliche Link wurde per E-Mail gesendet.`,
        );
        // Sending the public link enables the book token server-side;
        // surface that visually so the user sees the toggle as on.
        setEnabled(true);
        setTouched(true);
      }
      setEmailValue('');
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setEmailSubmitting(false);
    }
  };

  const setRowPerm = async (s: InternalShare, next: CollaboratorPermission) => {
    if (next === s.permission) return;
    setShares((cur) => cur.map((x) => (x.user_id === s.user_id ? { ...x, permission: next } : x)));
    try {
      await RecipesApi.patchBookShare(s.user_id, next);
    } catch (err) {
      setShares((cur) => cur.map((x) => (x.user_id === s.user_id ? { ...x, permission: s.permission } : x)));
      toast.error(getApiError(err));
    }
  };

  const revoke = async (s: InternalShare) => {
    try {
      await RecipesApi.revokeBookShare(s.user_id);
      setShares((cur) => cur.filter((x) => x.user_id !== s.user_id));
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

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
      <div className="space-y-4">
        {/* ── Per-email share ────────────────────────────────────────── */}
        <section>
          <h3 className="font-semibold">Per E-Mail teilen</h3>
          <p className="text-xs text-muted mb-2">
            Hat die Empfängerin einen Lyst-Account? Dann erscheinen alle
            deine Rezepte (auch zukünftige) direkt in ihrer Bibliothek.
            Sonst senden wir den öffentlichen Link per E-Mail.
          </p>
          <form onSubmit={submitEmail} className="flex flex-wrap gap-2">
            <input
              aria-label="E-Mail-Adresse"
              type="email"
              required
              className="input flex-1 min-w-[160px] text-sm"
              placeholder="email@beispiel.de"
              value={emailValue}
              onChange={(e) => setEmailValue(e.target.value)}
              disabled={emailSubmitting}
            />
            <select
              className="input w-32 text-sm"
              value={emailPerm}
              onChange={(e) => setEmailPerm(e.target.value as CollaboratorPermission)}
              disabled={emailSubmitting}
              title="Berechtigung — gilt nur für Lyst-Nutzer:innen, öffentliche Links sind immer schreibgeschützt."
            >
              <option value="VIEW">Ansehen</option>
              <option value="EDIT">Bearbeiten</option>
            </select>
            <button
              type="submit"
              className="btn-primary text-sm"
              disabled={emailSubmitting || !emailValue.trim()}
            >
              {emailSubmitting ? 'Sende…' : 'Teilen'}
            </button>
          </form>
          <ShareSuggestionsRow
            excludeEmails={shares.map((s) => s.email)}
            onPick={(email) => setEmailValue(email)}
          />
          {shares.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
                Rezeptbuch geteilt mit
              </div>
              <ul className="border border-line rounded-ctl divide-y divide-line">
                {shares.map((s) => (
                  <li
                    key={s.user_id}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-muted ml-2 text-xs">{s.email}</span>
                    </span>
                    <select
                      className="text-xs border border-line rounded px-1.5 py-0.5 bg-surface"
                      value={s.permission}
                      onChange={(e) =>
                        setRowPerm(s, e.target.value as CollaboratorPermission)
                      }
                      aria-label={`Berechtigung für ${s.name}`}
                    >
                      <option value="VIEW">Ansehen</option>
                      <option value="EDIT">Bearbeiten</option>
                    </select>
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
