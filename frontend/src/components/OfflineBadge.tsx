import { useEffect, useState } from 'react';

export function OfflineBadge() {
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (!offline) return null;
  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-50 rounded-full bg-zinc-900 text-white text-xs px-3 py-1 shadow">
      Offline-Modus
    </div>
  );
}
