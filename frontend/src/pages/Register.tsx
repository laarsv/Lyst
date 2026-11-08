import { useEffect, useState, type FormEvent, useId } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthApi } from '@/api/endpoints';
import { getApiError } from '@/api/client';
import { useAuthStore } from '@/store/auth';

/** Self-registration through an admin-made registration link (`/register?token=…`). */
export function RegisterPage() {
  const fid = useId();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [linkValid, setLinkValid] = useState<boolean | null>(token ? null : false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const nav = useNavigate();

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    AuthApi.registrationLinkValid(token)
      .then((r) => !cancelled && setLinkValid(r.valid))
      .catch(() => !cancelled && setLinkValid(false));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) return setError('Passwort muss mindestens 8 Zeichen haben.');
    if (pw !== pw2) return setError('Passwörter stimmen nicht überein.');
    setLoading(true);
    try {
      await AuthApi.register({ token, name, email, password: pw });
    } catch (err) {
      setError(getApiError(err));
      setLoading(false);
      return;
    }
    // Account exists now: sign straight in so the group doesn't have to retype it.
    try {
      const r = await AuthApi.login(email, pw);
      setAuth({
        accessToken: r.access_token,
        userId: r.user_id,
        email: r.email,
        name: r.name,
        role: r.role,
      });
      nav('/', { replace: true });
    } catch {
      nav('/login', { replace: true });
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md card p-8">
        <h1 className="text-2xl font-semibold mb-2">Willkommen bei Lyst</h1>
        <p className="text-muted mb-6 text-sm">Lege dein Konto an.</p>
        {linkValid === null ? (
          <div className="text-sm text-muted">Link wird geprüft…</div>
        ) : !linkValid ? (
          <div className="text-sm text-danger bg-danger-50 border border-danger/30 rounded-lg p-3">
            Der Registrierungslink ist ungültig, abgelaufen oder aufgebraucht. Frag die Person, die
            ihn dir gegeben hat, nach einem neuen.
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor={`${fid}-name`}>Dein Name</label>
              <input
                id={`${fid}-name`}
                type="text"
                className="input"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor={`${fid}-e-mail`}>E-Mail</label>
              <input
                id={`${fid}-e-mail`}
                type="email"
                className="input"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor={`${fid}-passwort`}>Passwort</label>
              <input
                id={`${fid}-passwort`}
                type="password"
                className="input"
                autoComplete="new-password"
                required
                minLength={8}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor={`${fid}-passwort-wiederholen`}>Passwort wiederholen</label>
              <input
                id={`${fid}-passwort-wiederholen`}
                type="password"
                className="input"
                autoComplete="new-password"
                required
                minLength={8}
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
              />
            </div>
            {error && (
              <div className="text-sm text-danger bg-danger-50 border border-danger/30 rounded-lg p-3">
                {error}
              </div>
            )}
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? 'Konto wird angelegt…' : 'Konto anlegen'}
            </button>
          </form>
        )}
        <div className="text-center text-sm mt-6">
          <Link to="/login" className="text-brand hover:underline">
            Schon ein Konto? Anmelden
          </Link>
        </div>
      </div>
    </div>
  );
}
