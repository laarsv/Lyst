import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthApi } from '@/api/endpoints';
import { useAuthStore } from '@/store/auth';
import { getApiError } from '@/api/client';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setAuth = useAuthStore((s) => s.setAuth);
  const nav = useNavigate();
  const loc = useLocation() as any;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await AuthApi.login(email, password);
      setAuth({
        accessToken: r.access_token,
        userId: r.user_id,
        email: r.email,
        name: r.name,
        role: r.role,
      });
      const dest = loc.state?.from?.pathname ?? (r.role === 'admin' ? '/admin' : '/');
      nav(dest, { replace: true });
    } catch (e) {
      setError(getApiError(e, 'Anmeldung fehlgeschlagen'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md card p-8">
        <div className="text-center mb-6">
          <div className="wordmark text-4xl">lyst</div>
          <div className="text-muted mt-2">Bei deinem Konto anmelden</div>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label">E-Mail</label>
            <input
              type="email"
              className="input"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Passwort</label>
            <input
              type="password"
              className="input"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <div className="text-sm text-danger bg-danger-50 border border-danger/30 rounded-lg p-3">
              {error}
            </div>
          )}
          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Anmelden…' : 'Anmelden'}
          </button>
        </form>
        <div className="text-center text-sm mt-6">
          <Link to="/forgot-password" className="text-brand hover:underline">
            Passwort vergessen?
          </Link>
        </div>
      </div>
    </div>
  );
}
