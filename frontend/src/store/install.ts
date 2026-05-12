import { create } from 'zustand';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallState {
  /** The deferred event Chrome / Edge fires when the PWA install criteria are met.
   *  null = no offer is available (already installed, criteria not met,
   *  unsupported browser, or already accepted/declined). */
  evt: BeforeInstallPromptEvent | null;
  /** Whether the app is currently running as an installed PWA. */
  standalone: boolean;
  setEvt: (e: BeforeInstallPromptEvent | null) => void;
  setStandalone: (b: boolean) => void;
}

export const useInstallStore = create<InstallState>((set) => ({
  evt: null,
  standalone: detectStandalone(),
  setEvt: (e) => set({ evt: e }),
  setStandalone: (b) => set({ standalone: b }),
}));

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // @ts-expect-error nav.standalone is iOS-only
    window.navigator.standalone === true
  );
}

// Wire the global listeners exactly once at module load. Even if InstallPrompt
// hasn't mounted yet (e.g. user is on the login page), we still capture the
// event — without preventDefault the browser would already have shown its own
// mini-infobar and discarded the event by the time React mounts a listener.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    useInstallStore.getState().setEvt(e as BeforeInstallPromptEvent);
  });
  window.addEventListener('appinstalled', () => {
    useInstallStore.getState().setEvt(null);
    useInstallStore.getState().setStandalone(true);
  });
  // React to display-mode flips (e.g. browser → installed app)
  const mq = window.matchMedia?.('(display-mode: standalone)');
  if (mq?.addEventListener) {
    mq.addEventListener('change', (m) => useInstallStore.getState().setStandalone(m.matches));
  }
}
