/** Note share panel — email/internal + public link + QR.
 *
 *  Mirrors ShareRecipePanel from the recipes domain (see that file for the
 *  shape). Two stacked sections: email-share at the top (with the internal
 *  share list below), public toggle + link + QR at the bottom. Modal
 *  lifecycle is owned by the parent; we mount once and react to `open`. */
import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { NotesApi } from '@/api/endpoints';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { ShareSuggestionsRow } from '@/components/ShareSuggestionsRow';
import type { CollaboratorPermission, InternalShare, Note, ShareInfo } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  note: Note;
  onUpdate: (patch: Partial<Note>) => void;
}

export function ShareNotePanel({ open, onClose, note, onUpdate }: Props) {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailValue, setEmailValue] = useState('');
  const [emailPerm, setEmailPerm] = useState<CollaboratorPermission>('VIEW');
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [shares, setShares] = useState<InternalShare[]>([]);

  useEffect(() => {
    if (!open) return;
    if (note.share_enabled && note.share_token) {
      // Show the link without QR until the user re-enables (which fetches
      // a fresh QR). Same UX as the recipe-share panel.
      const url = `${window.location.origin}/share/note/${note.share_token}`;
      setInfo({ share_token: note.share_token, share_url: url, qr_code_png_base64: '' });
    } else {
      setInfo(null);
    }
    void NotesApi.listShares(note.id)
      .then(setShares)
      .catch(() => setShares([]));
  }, [open, note.id, note.share_enabled, note.share_token]);

  const enable = async () => {
    setLoading(true);
    try {
      const r = await NotesApi.shareEnable(note.id);
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
      await NotesApi.shareDisable(note.id);
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

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = emailValue.trim();
    if (!email) return;
    setEmailSubmitting(true);
    try {
      const r = await NotesApi.shareByEmail(note.id, email, emailPerm);
      if (r.type === 'internal') {
        const permLabel = emailPerm === 'EDIT' ? 'mit Bearbeitungsrecht' : 'zum Lesen';
        toast.success(
          `An ${r.user_name ?? email} in Lyst geteilt (${permLabel}).`,
        );
        const fresh = await NotesApi.listShares(note.id).catch(() => shares);
        setShares(fresh);
      } else {
        // Public link only for non-Lyst users — permission is irrelevant
        // for that path (public links are always read-only).
        toast.success(
          `${email} hat keinen Lyst-Account — der öffentliche Link wurde per E-Mail gesendet.`,
        );
        if (!note.share_enabled) {
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

  const setRowPerm = async (s: InternalShare, next: CollaboratorPermission) => {
    if (next === s.permission) return;
    // Optimistic — flip locally, revert on error.
    setShares((cur) => cur.map((x) => (x.user_id === s.user_id ? { ...x, permission: next } : x)));
    try {
      await NotesApi.patchShare(note.id, s.user_id, next);
    } catch (err) {
      setShares((cur) => cur.map((x) => (x.user_id === s.user_id ? { ...x, permission: s.permission } : x)));
      toast.error(getApiError(err));
    }
  };

  const revoke = async (s: InternalShare) => {
    try {
      await NotesApi.revokeShare(note.id, s.user_id);
      setShares((cur) => cur.filter((x) => x.user_id !== s.user_id));
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Notiz teilen" className="max-w-md">
      <div className="space-y-4">
        {/* ── Per-email share ────────────────────────────────────────── */}
        <section>
          <h3 className="font-semibold">Per E-Mail teilen</h3>
          <p className="text-xs text-muted mb-2">
            Hat die Empfängerin einen Lyst-Account? Dann erscheint die
            Notiz direkt in ihren Notizen. Sonst senden wir den öffentlichen
            Link an die angegebene Adresse.
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
          {/* People the user has shared anything with before, click to
              fill the email input. Filtered to hide users this note
              is already shared with. */}
          <ShareSuggestionsRow
            excludeEmails={shares.map((s) => s.email)}
            onPick={(email) => setEmailValue(email)}
          />
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

        {/* ── Public link + QR ───────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Öffentlich teilen</h3>
            <p className="text-xs text-muted">
              Schreibgeschützt — jede Person mit dem Link kann die Notiz lesen.
            </p>
          </div>
          <label className="inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={note.share_enabled}
              onChange={() => (note.share_enabled ? disable() : enable())}
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
