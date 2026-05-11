import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem('lyst-install-dismissed');
    if (dismissed) setHidden(true);
    const handler = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!evt || hidden) return null;
  return (
    <div className="fixed bottom-4 right-4 z-40 card p-4 max-w-xs flex flex-col gap-3">
      <div className="text-sm text-zinc-700">Installiere Lyst auf deinem Gerät für schnelleren Zugriff.</div>
      <div className="flex gap-2 justify-end">
        <button
          className="btn-ghost text-sm"
          onClick={() => {
            localStorage.setItem('lyst-install-dismissed', '1');
            setHidden(true);
          }}
        >
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
    </div>
  );
}
