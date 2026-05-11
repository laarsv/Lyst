import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'lyst-install-dismissed';

function isStandalone(): boolean {
  // PWA already installed → don't nag
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari iOS legacy flag
    // @ts-expect-error nav.standalone is iOS-only
    window.navigator.standalone === true
  );
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(window.navigator.userAgent);
}

export function InstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY)) {
      setHidden(true);
      return;
    }
    if (isStandalone()) {
      setHidden(true);
      return;
    }
    // Android / desktop Chromium fires this; iOS Safari does not.
    const handler = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    // iOS — show a manual hint instead, since there's no install API.
    if (isIos()) setIosHint(true);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setHidden(true);
  };

  if (hidden) return null;
  if (!evt && !iosHint) return null;

  return (
    <div
      className="fixed left-4 right-4 sm:left-auto sm:right-4 z-40 card p-4 max-w-sm flex flex-col gap-3"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0) + 16px)' }}
    >
      {evt ? (
        <>
          <div className="text-sm text-zinc-700">
            Installiere <strong>Lyst</strong> auf deinem Gerät für schnelleren Zugriff und Offline-Modus.
          </div>
          <div className="flex gap-2 justify-end">
            <button className="btn-ghost text-sm" onClick={dismiss}>
              Nicht jetzt
            </button>
            <button
              className="btn-primary text-sm"
              onClick={async () => {
                await evt.prompt();
                const r = await evt.userChoice;
                if (r.outcome === 'accepted') setHidden(true);
              }}
            >
              Installieren
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="text-sm text-zinc-700">
            <strong>Lyst zum Home-Bildschirm hinzufügen:</strong> tippe in Safari unten auf{' '}
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-zinc-100">
              Teilen
            </span>{' '}
            und dann <em>„Zum Home-Bildschirm"</em>.
          </div>
          <div className="flex justify-end">
            <button className="btn-ghost text-sm" onClick={dismiss}>
              Verstanden
            </button>
          </div>
        </>
      )}
    </div>
  );
}
