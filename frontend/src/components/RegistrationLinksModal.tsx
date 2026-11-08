/** Admin: make and manage registration links — one link lets a whole group sign itself up
 *  (Urlaubsgruppe etc.) instead of inviting each person by e-mail. A link is bounded by an
 *  expiry and a use limit; removing it revokes it immediately. New accounts are normal users
 *  and only see what is shared with them. */
import { useEffect, useId, useState } from 'react';
import { AdminApi } from '@/api/endpoints';
import { getApiError } from '@/api/client';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { useConfirm } from '@/components/Dialogs';
import type { RegistrationLink } from '@/types';

const STATUS_LABEL: Record<RegistrationLink['status'], string> = {
  active: 'Aktiv',
  expired: 'Abgelaufen',
  exhausted: 'Aufgebraucht',
};

const linkUrl = (token: string) => `${window.location.origin}/register?token=${token}`;

export function RegistrationLinksModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const fid = useId();
  const confirmDialog = useConfirm();
  const [links, setLinks] = useState<RegistrationLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(7);
  const [maxUses, setMaxUses] = useState(10);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    AdminApi.listRegistrationLinks()
      .then((rows) => !cancelled && setLinks(rows))
      .catch((e) => !cancelled && toast.error(getApiError(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const create = async () => {
    setCreating(true);
    try {
      const link = await AdminApi.createRegistrationLink({
        expires_in_days: days,
        max_uses: maxUses,
      });
      setLinks((cur) => [link, ...cur]);
      toast.success('Registrierungslink erstellt.');
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setCreating(false);
    }
  };

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(linkUrl(token));
      toast.success('Link kopiert.');
    } catch {
      toast.error('Kopieren nicht möglich — Link markieren und von Hand kopieren.');
    }
  };

  const remove = async (l: RegistrationLink) => {
    if (
      l.status === 'active' &&
      !(await confirmDialog({
        title: 'Link widerrufen?',
        message: 'Wer den Link noch nicht benutzt hat, kann sich damit nicht mehr registrieren. Bereits angelegte Konten bleiben bestehen.',
        confirmLabel: 'Widerrufen',
        variant: 'danger',
      }))
    )
      return;
    try {
      await AdminApi.deleteRegistrationLink(l.id);
      setLinks((cur) => cur.filter((x) => x.id !== l.id));
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Registrierungslink">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Mit einem Link kann sich eine ganze Gruppe selbst ein Konto anlegen — bis er abläuft oder
          das Limit erreicht ist. Neue Konten sehen nur, was du mit ihnen teilst.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor={`${fid}-days`}>Gültig (Tage)</label>
            <input
              id={`${fid}-days`}
              type="number"
              className="input"
              min={1}
              max={30}
              value={days}
              onChange={(e) => setDays(Math.min(30, Math.max(1, Number(e.target.value) || 1)))}
            />
          </div>
          <div>
            <label className="label" htmlFor={`${fid}-uses`}>Max. Anmeldungen</label>
            <input
              id={`${fid}-uses`}
              type="number"
              className="input"
              min={1}
              max={100}
              value={maxUses}
              onChange={(e) => setMaxUses(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
            />
          </div>
        </div>
        <button className="btn-primary w-full" disabled={creating} onClick={create}>
          {creating ? 'Erstelle…' : 'Link erstellen'}
        </button>

        <div className="space-y-3">
          {loading && <div className="text-sm text-muted">Lade…</div>}
          {!loading && links.length === 0 && (
            <div className="text-sm text-muted">Noch keine Links.</div>
          )}
          {links.map((l) => (
            <div key={l.id} className="border border-line rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs text-muted">
                <span
                  className={`px-2 py-0.5 rounded font-medium ${l.status === 'active' ? 'bg-brand-50 text-brand-700' : 'bg-page text-muted'}`}
                >
                  {STATUS_LABEL[l.status]}
                </span>
                <span>
                  {l.used_count}/{l.max_uses} genutzt · bis{' '}
                  {new Date(l.expires_at).toLocaleDateString('de-DE')}
                </span>
              </div>
              {l.status === 'active' && (
                <input
                  aria-label="Registrierungslink"
                  readOnly
                  className="input text-xs"
                  value={linkUrl(l.token)}
                  onFocus={(e) => e.currentTarget.select()}
                />
              )}
              <div className="flex justify-end gap-1">
                {l.status === 'active' && (
                  <button className="btn-ghost text-xs" onClick={() => copy(l.token)}>
                    Kopieren
                  </button>
                )}
                <button className="btn-ghost text-xs text-danger" onClick={() => remove(l)}>
                  {l.status === 'active' ? 'Widerrufen' : 'Entfernen'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <button className="btn-secondary" onClick={onClose}>Schließen</button>
        </div>
      </div>
    </Modal>
  );
}
