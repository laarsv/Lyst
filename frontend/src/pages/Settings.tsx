import { useEffect, useState, type FormEvent } from 'react';
import { MeApi } from '@/api/endpoints';
import { useAuthStore } from '@/store/auth';
import { useInstallStore } from '@/store/install';
import {
  START_PAGE_OPTIONS,
  getStartPage,
  setStartPage,
  type StartPage,
} from '@/store/startPage';
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
      <StartPageSection />
      <InstallSection />
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

function StartPageSection() {
  const [page, setPage] = useState<StartPage>(getStartPage);

  const change = (p: StartPage) => {
    setPage(p);
    setStartPage(p);
    toast.success('Startseite gespeichert');
  };

  return (
    <section className="card p-6 space-y-3">
      <div>
        <h2 className="font-semibold">Startseite</h2>
        <p className="text-sm text-muted">
          Welche Ansicht beim Öffnen der App erscheint. Gilt für dieses Gerät.
        </p>
      </div>
      <select
        className="input"
        value={page}
        onChange={(e) => change(e.target.value as StartPage)}
      >
        {START_PAGE_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </section>
  );
}

function InstallSection() {
  const evt = useInstallStore((s) => s.evt);
  const standalone = useInstallStore((s) => s.standalone);
  const setEvt = useInstallStore((s) => s.setEvt);
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);

  let body: React.ReactNode;
  if (standalone) {
    body = (
      <p className="text-sm text-muted">
        lyst läuft bereits als installierte App auf diesem Gerät. ✓
      </p>
    );
  } else if (evt) {
    body = (
      <button
        className="btn-primary"
        onClick={async () => {
          try {
            await evt.prompt();
            const r = await evt.userChoice;
            if (r.outcome === 'accepted') setEvt(null);
          } catch {
            /* user closed dialog */
          }
        }}
      >
        App installieren
      </button>
    );
  } else if (isIos) {
    body = (
      <p className="text-sm text-muted">
        Auf iPhone / iPad: in Safari unten auf <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-page">Teilen</span>{' '}
        tippen und dann <em>„Zum Home-Bildschirm"</em>.
      </p>
    );
  } else {
    body = (
      <div className="text-sm text-muted space-y-2">
        <p>
          Dein Browser bietet die Installation aktuell nicht an. Häufige Gründe:
        </p>
        <ul className="list-disc list-inside space-y-0.5 text-xs">
          <li>Die App ist bereits installiert (dann oben nochmal nachsehen).</li>
          <li>Browser unterstützt PWA-Install nicht (z.B. Firefox).</li>
          <li>
            In Chrome rechts oben das Menü öffnen → „App installieren" oder
            „Zum Startbildschirm hinzufügen".
          </li>
          <li>Hard-Reload (Strg+Umschalt+R) versuchen damit der Service Worker frisch lädt.</li>
        </ul>
      </div>
    );
  }

  return (
    <section className="card p-6 space-y-3">
      <div>
        <h2 className="font-semibold">App installieren</h2>
        <p className="text-sm text-muted">
          lyst lässt sich als eigenständige App installieren — schneller Start, eigenes Icon,
          Offline-Modus.
        </p>
      </div>
      {body}
    </section>
  );
}
