import { create } from 'zustand';
import { useEffect } from 'react';
import clsx from 'clsx';

type ToastKind = 'info' | 'success' | 'error';
interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

interface ToastStore {
  items: ToastItem[];
  push: (text: string, kind?: ToastKind) => void;
  remove: (id: number) => void;
}

let nextId = 1;

const useToastStore = create<ToastStore>((set) => ({
  items: [],
  push: (text, kind = 'info') => {
    const id = nextId++;
    set((s) => ({ items: [...s.items, { id, text, kind }] }));
    setTimeout(() => {
      set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
    }, 4000);
  },
  remove: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

export const toast = {
  info: (t: string) => useToastStore.getState().push(t, 'info'),
  success: (t: string) => useToastStore.getState().push(t, 'success'),
  error: (t: string) => useToastStore.getState().push(t, 'error'),
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
          onClick={() => remove(t.id)}
          className={clsx(
            'pointer-events-auto rounded-xl px-4 py-2.5 text-sm shadow-lg border cursor-pointer max-w-sm',
            t.kind === 'success' && 'bg-brand-50 border-brand-100 text-brand-700',
            t.kind === 'error' && 'bg-danger-50 border-red-200 text-red-900',
            t.kind === 'info' && 'bg-surface border-line text-ink',
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
