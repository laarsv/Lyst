/** "Zu Picnic": review how the open items of a shopping list map to Picnic products, then
 *  put the confirmed ones into the Picnic cart.
 *
 *  The backend preview is read-only and only pre-selects where it is confident (a remembered
 *  choice, or a name match that was bought before). Everything else starts unselected so the
 *  user decides — nothing reaches the cart without this confirmation, and it never orders:
 *  buying stays in the Picnic app. "Merken" stores the choice so the next preview is a click. */
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Check, Loader2, Minus, Plus, ShoppingCart } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { PicnicApi } from '@/api/endpoints';
import type {
  PicnicCandidate,
  PicnicCartResult,
  PicnicPreview,
  PicnicPreviewItem,
} from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  listId: number;
}

interface Row {
  include: boolean;
  productId: string | null;
  count: number;
  remember: boolean;
}

type Phase = 'loading' | 'ready' | 'error' | 'done';

const eur = (cents: number) =>
  (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

/** Everything after the name: unit, price, how often bought, remembered. */
function candidateMeta(c: PicnicCandidate): string[] {
  const parts: string[] = [];
  if (c.unit) parts.push(c.unit);
  if (c.price_cents !== null) parts.push(eur(c.price_cents));
  if (c.bought > 0) parts.push(`${c.bought}× gekauft`);
  if (c.reason === 'mapping') parts.push('gemerkt');
  return parts;
}

const candidateLabel = (c: PicnicCandidate): string => [c.name, ...candidateMeta(c)].join(' · ');

/** Choosing a product that isn't already a remembered mapping is worth remembering. */
function defaultRemember(item: PicnicPreviewItem, productId: string | null): boolean {
  if (!productId || !item.term) return false;
  return item.candidates.find((c) => c.id === productId)?.reason !== 'mapping';
}

function initRows(preview: PicnicPreview): Record<number, Row> {
  const rows: Record<number, Row> = {};
  for (const it of preview.items) {
    rows[it.item_id] = {
      include: it.preselected !== null,
      productId: it.preselected,
      count: it.count,
      remember: defaultRemember(it, it.preselected),
    };
  }
  return rows;
}

export function PicnicCartModal({ open, onClose, listId }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState<PicnicPreview | null>(null);
  const [rows, setRows] = useState<Record<number, Row>>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PicnicCartResult | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase('loading');
    setError(null);
    setPreview(null);
    setResult(null);
    PicnicApi.preview(listId)
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
        setRows(initRows(p));
        setPhase('ready');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(getApiError(e));
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [open, listId, attempt]);

  const setRow = (id: number, patch: Partial<Row>) =>
    setRows((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }));

  const chooseProduct = (item: PicnicPreviewItem, productId: string | null) =>
    setRow(item.item_id, {
      productId,
      include: productId !== null,
      remember: defaultRemember(item, productId),
    });

  const selected = useMemo(
    () =>
      (preview?.items ?? []).filter((it) => {
        const r = rows[it.item_id];
        return r?.include && r.productId;
      }),
    [preview, rows],
  );

  const estimate = useMemo(() => {
    let cents = 0;
    let approx = false;
    for (const it of selected) {
      const r = rows[it.item_id];
      const price = it.candidates.find((c) => c.id === r.productId)?.price_cents;
      if (price === null || price === undefined) approx = true;
      else cents += price * r.count;
    }
    return { cents, approx };
  }, [selected, rows]);

  const send = async () => {
    setSending(true);
    try {
      const res = await PicnicApi.addToCart(
        selected.map((it) => {
          const r = rows[it.item_id];
          const cand = it.candidates.find((c) => c.id === r.productId)!;
          return {
            product_id: cand.id,
            product_name: cand.name,
            count: r.count,
            term: it.term,
            remember: r.remember && !!it.term,
          };
        }),
      );
      setResult(res);
      setPhase('done');
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setSending(false);
    }
  };

  const guardedClose = () => {
    if (!sending) onClose();
  };

  return (
    <Modal open={open} onClose={guardedClose} title="Zu Picnic" className="!max-w-2xl">
      {phase === 'loading' && (
        <div className="py-8 text-center text-sm text-muted">
          <Loader2 size={20} className="mx-auto mb-3 animate-spin" aria-hidden />
          Suche passende Produkte…
          <div className="mt-1 text-xs">Beim ersten Mal kann das etwas dauern.</div>
        </div>
      )}

      {phase === 'error' && (
        <div className="space-y-4">
          <div className="flex items-start gap-2 text-sm text-danger" role="alert">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost text-sm" onClick={onClose}>
              Schließen
            </button>
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Erneut versuchen
            </button>
          </div>
        </div>
      )}

      {phase === 'ready' && preview && (
        <div className="space-y-3">
          {preview.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Keine offenen Einträge auf der Liste.</p>
          ) : (
            <>
              <p className="text-sm text-muted">
                Prüfe die Zuordnung. Es wird nichts bestellt, die Artikel landen nur im
                Picnic-Warenkorb.
              </p>
              {preview.truncated && (
                <p className="text-xs text-muted">
                  Es werden nur die ersten {preview.items.length} offenen Einträge berücksichtigt.
                </p>
              )}
              <ul className="max-h-[55vh] space-y-2 overflow-auto pr-1">
                {preview.items.map((it) => {
                  const r = rows[it.item_id];
                  if (!r) return null;
                  const noMatch = it.candidates.length === 0;
                  const needsChoice = !noMatch && r.productId === null;
                  const chosen = it.candidates.find((c) => c.id === r.productId);
                  return (
                    <li
                      key={it.item_id}
                      className={clsx(
                        'rounded-ctl border p-3',
                        needsChoice ? 'border-brand-100 bg-brand-50' : 'border-line bg-surface',
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={r.include && r.productId !== null}
                          disabled={r.productId === null}
                          onChange={(e) => setRow(it.item_id, { include: e.target.checked })}
                          aria-label={`${it.text} in den Warenkorb`}
                          className="size-4 accent-brand"
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">{it.text}</span>
                        {!noMatch && (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="btn-ghost p-1"
                              aria-label={`Weniger ${it.text}`}
                              disabled={r.count <= 1}
                              onClick={() => setRow(it.item_id, { count: r.count - 1 })}
                            >
                              <Minus size={14} aria-hidden />
                            </button>
                            <span className="w-6 text-center text-sm tabular-nums" aria-live="polite">
                              {r.count}
                            </span>
                            <button
                              type="button"
                              className="btn-ghost p-1"
                              aria-label={`Mehr ${it.text}`}
                              disabled={r.count >= 99}
                              onClick={() => setRow(it.item_id, { count: r.count + 1 })}
                            >
                              <Plus size={14} aria-hidden />
                            </button>
                          </div>
                        )}
                      </div>

                      {noMatch ? (
                        <p className={clsx('mt-2 text-sm', it.error ? 'text-danger' : 'text-muted')}>
                          {it.error ?? 'Nichts gefunden.'}
                        </p>
                      ) : (
                        <>
                          <select
                            className="input mt-2 text-sm"
                            aria-label={`Produkt für ${it.text}`}
                            value={r.productId ?? ''}
                            onChange={(e) => chooseProduct(it, e.target.value || null)}
                          >
                            <option value="">Produkt wählen…</option>
                            {it.candidates.map((c) => (
                              <option key={c.id} value={c.id}>
                                {candidateLabel(c)}
                              </option>
                            ))}
                          </select>
                          {/* A native <select> truncates long labels on a phone, which hides
                              the price and purchase count — repeat them below it. */}
                          {chosen && (
                            <p className="mt-1 text-xs text-muted sm:hidden">
                              {candidateMeta(chosen).join(' · ')}
                            </p>
                          )}
                          {needsChoice && (
                            <p className="mt-1 text-xs text-brand-700">Bitte ein Produkt wählen.</p>
                          )}
                          {r.productId !== null && it.term && (
                            <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                              <input
                                type="checkbox"
                                checked={r.remember}
                                onChange={(e) => setRow(it.item_id, { remember: e.target.checked })}
                                className="size-3.5 accent-brand"
                              />
                              Für „{it.term}“ merken
                            </label>
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-muted">
              {selected.length} Artikel
              {selected.length > 0 && (
                <>
                  {' · '}
                  {estimate.approx ? 'mind. ' : 'ca. '}
                  {eur(estimate.cents)}
                </>
              )}
            </span>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost text-sm" onClick={guardedClose} disabled={sending}>
                Abbrechen
              </button>
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-2 whitespace-nowrap text-sm"
                onClick={send}
                disabled={sending || selected.length === 0}
              >
                {sending ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                ) : (
                  <ShoppingCart size={14} aria-hidden />
                )}
                In den Warenkorb
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'done' && result && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-ctl border border-brand-100 bg-brand-50 p-3 text-brand-700">
            <Check size={18} className="mt-0.5 shrink-0" aria-hidden />
            <div className="text-sm">
              <div className="font-medium">
                {result.added} {result.added === 1 ? 'Artikel liegt' : 'Artikel liegen'} im Picnic-Warenkorb.
              </div>
              <div className="mt-0.5 text-xs">
                Bestellt wird in der Picnic-App
                {result.remembered > 0 && ` · ${result.remembered} Zuordnung${result.remembered === 1 ? '' : 'en'} gemerkt`}.
              </div>
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted">Warenkorb jetzt</div>
            <ul className="max-h-48 space-y-0.5 overflow-auto text-sm">
              {result.cart.lines.map((l) => (
                <li key={l.id} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{l.name}</span>
                  <span className="shrink-0 text-muted">{l.count}×</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between border-t border-line pt-2 text-sm font-medium">
              <span>Summe</span>
              <span>{eur(result.cart.total_cents)}</span>
            </div>
          </div>
          <div className="flex justify-end">
            <button type="button" className="btn-primary text-sm" onClick={onClose}>
              Fertig
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
