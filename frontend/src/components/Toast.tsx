import { create } from 'zustand';
import { useEffect } from 'react';
import clsx from 'clsx';

type ToastKind = 'info' | 'success' | 'error';
interface ToastAction {
  label: string;
  onClick: () => void;
}
interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
  action?: ToastAction;
  durationMs: number;
}

interface ToastStore {
  items: ToastItem[];
  push: (
    text: string,
    kind?: ToastKind,
    opts?: { action?: ToastAction; durationMs?: number },
  ) => void;
  remove: (id: number) => void;
}

let nextId = 1;

const useToastStore = create<ToastStore>((set) => ({
  items: [],
  push: (text, kind = 'info', opts) => {
    const id = nextId++;
    const durationMs = opts?.durationMs ?? 4000;
    set((s) => ({
      items: [...s.items, { id, text, kind, action: opts?.action, durationMs }],
    }));
    setTimeout(() => {
      set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
    }, durationMs);
  },
  remove: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

export const toast = {
  info: (t: string) => useToastStore.getState().push(t, 'info'),
  success: (t: string) => useToastStore.getState().push(t, 'success'),
  error: (t: string) => useToastStore.getState().push(t, 'error'),
  /** Show a toast with an inline action button (e.g. "Rückgängig"). The
   *  default duration is 5s so the user has time to react. Clicking the
   *  action fires `onClick` and dismisses the toast. */
  action: (
    text: string,
    actionLabel: string,
    onAction: () => void,
    opts?: { durationMs?: number; kind?: ToastKind },
  ) =>
    useToastStore.getState().push(text, opts?.kind ?? 'info', {
      action: { label: actionLabel, onClick: onAction },
      durationMs: opts?.durationMs ?? 5000,
    }),
};

export function ToastHost() {
  const items = useToastStore((s) => s.items);
  const remove = useToastStore((s) => s.remove);
  useEffect(() => {}, []);
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'pointer-events-auto rounded-xl px-4 py-2.5 text-sm shadow-lg border max-w-sm flex items-center gap-3',
            t.kind === 'success' && 'bg-brand-50 border-brand-100 text-brand-700',
            t.kind === 'error' && 'bg-danger-50 border-red-200 text-red-900',
            t.kind === 'info' && 'bg-surface border-line text-ink',
          )}
        >
          <span
            onClick={() => !t.action && remove(t.id)}
            className={t.action ? '' : 'cursor-pointer'}
          >
            {t.text}
          </span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action!.onClick();
                remove(t.id);
              }}
              className="text-xs font-semibold uppercase tracking-wider px-2 py-1 rounded-md text-brand-700 hover:bg-brand-50 transition"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
