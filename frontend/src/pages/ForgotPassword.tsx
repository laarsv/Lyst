import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuthApi } from '@/api/endpoints';
import { getApiError } from '@/api/client';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await AuthApi.resetRequest(email);
      setDone(true);
    } catch (e) {
      setError(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md card p-8">
        <h1 className="text-2xl font-semibold mb-2">Passwort zurücksetzen</h1>
        <p className="text-muted mb-6 text-sm">
          Wir senden dir einen Link zum Zurücksetzen, falls die E-Mail-Adresse bei uns registriert ist.
        </p>
        {done ? (
          <div className="text-sm text-brand-700 bg-brand-50 border border-brand-100 rounded-lg p-3">
            Falls die E-Mail-Adresse bei uns registriert ist, hast du gleich eine E-Mail im Postfach.
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="label">E-Mail</label>
              <input
                type="email"
                className="input"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {error && (
              <div className="text-sm text-danger bg-danger-50 border border-danger/30 rounded-lg p-3">
                {error}
              </div>
            )}
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? 'Senden…' : 'Link senden'}
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
