import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthApi } from '@/api/endpoints';
import { getApiError } from '@/api/client';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) return setError('Passwort muss mindestens 8 Zeichen haben.');
    if (pw !== pw2) return setError('Passwörter stimmen nicht überein.');
    setLoading(true);
    try {
      await AuthApi.resetConfirm(token, pw);
      nav('/login?reset=ok', { replace: true });
    } catch (e) {
      setError(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md card p-8">
        <h1 className="text-2xl font-semibold mb-6">Neues Passwort wählen</h1>
        {!token ? (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">
            Ungültiger oder abgelaufener Link.
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="label">Neues Passwort</label>
              <input
                type="password"
                className="input"
                required
                minLength={8}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Passwort wiederholen</label>
              <input
                type="password"
                className="input"
                required
                minLength={8}
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
              />
            </div>
            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">
                {error}
              </div>
            )}
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? 'Speichern…' : 'Passwort setzen'}
            </button>
          </form>
        )}
        <div className="text-center text-sm mt-6">
          <Link to="/login" className="text-brand hover:underline">
            Zurück zur Anmeldung
          </Link>
        </div>
      </div>
    </div>
  );
}
