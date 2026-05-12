/** Centered modal dialog system: confirm / alert / prompt.
 *
 *  Browser-native confirm/alert/prompt are blocking, look OS-native, and
 *  don't respect Lyst's design (or dark mode). This module replaces them
 *  with a single React-managed `<DialogHost>` that's mounted once in App
 *  and three Promise-returning hooks (`useConfirm`, `useAlert`,
 *  `usePrompt`) so existing call sites change minimally.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type Variant = 'primary' | 'danger';

interface ConfirmOpts {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: Variant;
}

interface AlertOpts {
  title: string;
  message?: string;
  okLabel?: string;
}

interface PromptOpts {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

type Pending =
  | { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: 'alert'; opts: AlertOpts; resolve: () => void }
  | { kind: 'prompt'; opts: PromptOpts; resolve: (v: string | null) => void };

interface DialogApi {
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  alert: (opts: AlertOpts) => Promise<void>;
  prompt: (opts: PromptOpts) => Promise<string | null>;
}

const DialogContext = createContext<DialogApi | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Pending[]>([]);

  const push = useCallback(<T,>(p: Pending): Promise<T> => {
    setStack((s) => [...s, p]);
    return new Promise<T>((res) => {
      const orig = p.resolve;
      p.resolve = (v: any) => {
        orig(v);
        setStack((s) => s.filter((x) => x !== p));
        res(v);
      };
    });
  }, []);

  const api: DialogApi = {
    confirm: (opts) =>
      push({ kind: 'confirm', opts, resolve: () => undefined as unknown as void }),
    alert: (opts) =>
      push({ kind: 'alert', opts, resolve: () => undefined as unknown as void }),
    prompt: (opts) =>
      push({ kind: 'prompt', opts, resolve: () => undefined as unknown as void }),
  };

  return (
    <DialogContext.Provider value={api}>
      {children}
      <DialogHost stack={stack} />
    </DialogContext.Provider>
  );
}

function useDialogApi(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error('Dialog hooks require <DialogProvider> in the tree');
  }
  return ctx;
}

export const useConfirm = () => useDialogApi().confirm;
export const useAlert = () => useDialogApi().alert;
export const usePrompt = () => useDialogApi().prompt;

// ---------- Host ----------

function DialogHost({ stack }: { stack: Pending[] }) {
  const top = stack[stack.length - 1];
  if (!top) return null;
  return <DialogShell key={stack.length} pending={top} />;
}

function DialogShell({ pending }: { pending: Pending }) {
  const [mounted, setMounted] = useState(false);
  // Trigger the fade-in transition by rendering opacity-0 first.
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Esc dismisses with a "no" answer (cancel / null). For alert it just closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = () => {
    if (pending.kind === 'confirm') pending.resolve(false);
    else if (pending.kind === 'prompt') pending.resolve(null);
    else pending.resolve();
  };

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center p-4 transition-opacity duration-150 ${
        mounted ? 'opacity-100' : 'opacity-0'
      }`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
      style={{ background: 'rgba(0,0,0,0.4)' }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-[420px] bg-surface text-ink border border-line rounded-card p-6 shadow-flat"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {pending.kind === 'confirm' && <ConfirmBody pending={pending} cancel={cancel} />}
        {pending.kind === 'alert' && <AlertBody pending={pending} />}
        {pending.kind === 'prompt' && <PromptBody pending={pending} cancel={cancel} />}
      </div>
    </div>
  );
}

function ConfirmBody({
  pending,
  cancel,
}: {
  pending: Extract<Pending, { kind: 'confirm' }>;
  cancel: () => void;
}) {
  const { title, message, confirmLabel = 'OK', cancelLabel = 'Abbrechen', variant = 'primary' } = pending.opts;
  return (
    <>
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      {message && <p className="text-[15px] text-muted mb-5">{message}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={cancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={variant === 'danger' ? 'btn-danger' : 'btn-primary'}
          autoFocus
          onClick={() => pending.resolve(true)}
        >
          {confirmLabel}
        </button>
      </div>
    </>
  );
}

function AlertBody({
  pending,
}: {
  pending: Extract<Pending, { kind: 'alert' }>;
}) {
  const { title, message, okLabel = 'Verstanden' } = pending.opts;
  return (
    <>
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      {message && <p className="text-[15px] text-muted mb-5">{message}</p>}
      <div className="flex justify-end">
        <button type="button" className="btn-primary" autoFocus onClick={() => pending.resolve()}>
          {okLabel}
        </button>
      </div>
    </>
  );
}

function PromptBody({
  pending,
  cancel,
}: {
  pending: Extract<Pending, { kind: 'prompt' }>;
  cancel: () => void;
}) {
  const { title, message, defaultValue = '', placeholder, confirmLabel = 'OK', cancelLabel = 'Abbrechen' } = pending.opts;
  const [value, setValue] = useState(defaultValue);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => ref.current?.focus(), 30);
  }, []);

  const submit = () => pending.resolve(value);

  return (
    <>
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      {message && <p className="text-[15px] text-muted mb-3">{message}</p>}
      <input
        ref={ref}
        className="input mb-5"
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={cancel}>
          {cancelLabel}
        </button>
        <button type="button" className="btn-primary" onClick={submit}>
          {confirmLabel}
        </button>
      </div>
    </>
  );
}
