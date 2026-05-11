import { useEffect, useState, type ReactNode } from 'react';
import axios from 'axios';
import { useAuthStore } from '@/store/auth';

export function AuthBootstrap({ children }: { children: ReactNode }) {
  const { userId, accessToken, setAccessToken, clear } = useAuthStore();
  const [ready, setReady] = useState(!!accessToken || !userId);

  useEffect(() => {
    // Already have a token, or never logged in — nothing to do.
    if (accessToken || !userId) {
      setReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.post<{ data: { access_token: string } | null; error: string | null }>(
          '/api/auth/refresh',
          {},
          { withCredentials: true },
        );
        if (cancelled) return;
        if (r.data.data?.access_token) setAccessToken(r.data.data.access_token);
        else clear();
      } catch {
        if (!cancelled) clear();
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) {
    return (
      <div className="min-h-full flex items-center justify-center text-zinc-400">
        Lade…
      </div>
    );
  }
  return <>{children}</>;
}
