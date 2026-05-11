import { useEffect, useState, type FormEvent } from 'react';
import { MeApi } from '@/api/endpoints';
import { useAuthStore } from '@/store/auth';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';

export function SettingsPage() {
  const { name: storeName, email: storeEmail, setProfile } = useAuthStore();
  const [name, setName] = useState(storeName ?? '');
  const [email, setEmail] = useState(storeEmail ?? '');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const u = await MeApi.get();
        setName(u.name);
        setEmail(u.email);
      } catch (e) {
        toast.error(getApiError(e));
      }
    })();
  }, []);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const u = await MeApi.update({ name, email });
      setProfile({ name: u.name, email: u.email });
      toast.success('Profil aktualisiert');
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (newPw.length < 8) return toast.error('Mindestens 8 Zeichen');
    setLoading(true);
    try {
      await MeApi.update({ current_password: currentPw, new_password: newPw });
      setCurrentPw(''); setNewPw('');
      toast.success('Passwort aktualisiert');
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold">Konto</h1>
      <form onSubmit={saveProfile} className="card p-6 space-y-4">
        <h2 className="font-semibold">Profil</h2>
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">E-Mail</label>
          <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={loading}>Speichern</button>
        </div>
      </form>
      <form onSubmit={savePassword} className="card p-6 space-y-4">
        <h2 className="font-semibold">Passwort ändern</h2>
        <div>
          <label className="label">Aktuelles Passwort</label>
          <input type="password" className="input" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} required />
        </div>
        <div>
          <label className="label">Neues Passwort</label>
          <input type="password" className="input" minLength={8} value={newPw} onChange={(e) => setNewPw(e.target.value)} required />
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={loading}>Aktualisieren</button>
        </div>
      </form>
    </div>
  );
}
