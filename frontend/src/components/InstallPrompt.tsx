import { useEffect, useState } from 'react';
import { useInstallStore } from '@/store/install';

const DISMISS_KEY = 'lyst-install-dismissed-until';

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(window.navigator.userAgent);
}

function isDismissed(): boolean {
  const until = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
  return until > Date.now();
}

function dismissFor(days: number) {
  localStorage.setItem(DISMISS_KEY, String(Date.now() + days * 24 * 60 * 60 * 1000));
}

export function InstallPrompt() {
  const evt = useInstallStore((s) => s.evt);
  const standalone = useInstallStore((s) => s.standalone);
  const setEvt = useInstallStore((s) => s.setEvt);

  const [hidden, setHidden] = useState(true);
  const [iosHint, setIosHint] = useState(false);

  // Show the in-app banner only when:
  //   - the app is NOT already installed
  //   - the user hasn't dismissed it within the last 7 days
  //   - either Chrome fired beforeinstallprompt (`evt`) OR we're on iOS Safari
  useEffect(() => {
    if (standalone) return setHidden(true);
    if (isDismissed()) return setHidden(true);
    if (evt) {
      setHidden(false);
      setIosHint(false);
    } else if (isIos()) {
      setHidden(false);
      setIosHint(true);
    } else {
      setHidden(true);
    }
  }, [evt, standalone]);

  if (hidden) return null;

  const dismiss = () => {
    dismissFor(7);
    setHidden(true);
  };

  return (
    <div
      className="fixed left-4 right-4 sm:left-auto sm:right-4 z-40 card p-4 max-w-sm flex flex-col gap-3"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0) + 16px)' }}
    >
      {evt && !iosHint ? (
        <>
          <div className="text-sm text-ink">
            Installiere <strong>lyst</strong> auf deinem Gerät für schnelleren Zugriff und Offline-Modus.
          </div>
          <div className="flex gap-2 justify-end">
            <button className="btn-ghost text-sm" onClick={dismiss}>
              Nicht jetzt
            </button>
            <button
              className="btn-primary text-sm"
              onClick={async () => {
                try {
                  await evt.prompt();
                  const r = await evt.userChoice;
                  if (r.outcome === 'accepted') {
                    setEvt(null);
                    setHidden(true);
                  }
                } catch {
                  /* user closed system dialog — leave banner */
                }
              }}
            >
              Installieren
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="text-sm text-ink">
            <strong>lyst zum Home-Bildschirm hinzufügen:</strong> tippe in Safari unten auf{' '}
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-page">Teilen</span>{' '}
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
