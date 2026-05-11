import { useEffect, useMemo, useState } from 'react';
import { AdminApi } from '@/api/endpoints';
import type { AdminUser } from '@/types';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { useAuthStore } from '@/store/auth';

export function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [tempPwInfo, setTempPwInfo] = useState<{ email: string; temp: string } | null>(null);
  const myId = useAuthStore((s) => s.userId);

  const refresh = async () => {
    setLoading(true);
    try {
      setUsers(await AdminApi.listUsers(q || undefined));
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => users, [users]);

  const onToggleActive = async (u: AdminUser) => {
    try {
      const upd = await AdminApi.updateUser(u.id, { is_active: !u.is_active });
      setUsers((cur) => cur.map((x) => (x.id === upd.id ? { ...x, is_active: upd.is_active } : x)));
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const onResetPw = async (u: AdminUser) => {
    try {
      await AdminApi.resetPassword(u.id);
      toast.success(`Reset-Link an ${u.email} gesendet.`);
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const onDelete = async (u: AdminUser) => {
    if (!confirm(`Benutzer ${u.email} endgültig löschen? Alle Listen und Notizen werden entfernt.`)) return;
    try {
      await AdminApi.deleteUser(u.id);
      setUsers((cur) => cur.filter((x) => x.id !== u.id));
      toast.success('Benutzer gelöscht');
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Benutzerverwaltung</h1>
          <p className="text-sm text-zinc-500">Verwalte Konten, lade Personen ein und setze Passwörter zurück.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setInviteOpen(true)}>Einladen</button>
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>Anlegen</button>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          className="input flex-1"
          placeholder="Suche nach Name oder E-Mail"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && refresh()}
        />
        <button className="btn-secondary" onClick={refresh}>Suchen</button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-600">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">E-Mail</th>
              <th className="text-left px-4 py-3 font-medium">Rolle</th>
              <th className="text-left px-4 py-3 font-medium">Listen</th>
              <th className="text-left px-4 py-3 font-medium">Letzter Login</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-zinc-400">Lade…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-zinc-400">Keine Benutzer.</td></tr>
            )}
            {filtered.map((u) => (
              <tr key={u.id} className="hover:bg-zinc-50">
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3 text-zinc-600">{u.email}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${u.role === 'admin' ? 'bg-violet-50 text-violet-700' : 'bg-zinc-100 text-zinc-700'}`}>
                    {u.role === 'admin' ? 'Admin' : 'Nutzer'}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-600">{u.list_count}</td>
                <td className="px-4 py-3 text-zinc-600">
                  {u.last_login ? new Date(u.last_login).toLocaleString('de-DE') : '—'}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${u.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-500'}`}>
                    {u.is_active ? 'Aktiv' : 'Deaktiviert'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button className="btn-ghost text-xs" onClick={() => onResetPw(u)}>Passwort</button>
                  <button className="btn-ghost text-xs" onClick={() => onToggleActive(u)}>
                    {u.is_active ? 'Deaktivieren' : 'Aktivieren'}
                  </button>
                  {u.id !== myId && (
                    <button className="btn-ghost text-xs text-red-600" onClick={() => onDelete(u)}>Löschen</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(u, temp) => {
          setUsers((cur) => [{ ...u, list_count: 0 } as AdminUser, ...cur]);
          setCreateOpen(false);
          setTempPwInfo({ email: u.email, temp });
        }}
      />
      <InviteUserModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={(u) => {
          setUsers((cur) => [{ ...u, list_count: 0 } as AdminUser, ...cur]);
          setInviteOpen(false);
          toast.success(`Einladung an ${u.email} gesendet.`);
        }}
      />
      <Modal open={!!tempPwInfo} onClose={() => setTempPwInfo(null)} title="Konto angelegt">
        {tempPwInfo && (
          <div className="space-y-3 text-sm">
            <p>
              Konto für <strong>{tempPwInfo.email}</strong> wurde angelegt. Teile das temporäre
              Passwort sicher mit:
            </p>
            <pre className="bg-zinc-50 border border-zinc-100 rounded-lg px-3 py-2 font-mono text-sm">
              {tempPwInfo.temp}
            </pre>
            <div className="flex justify-end">
              <button className="btn-primary" onClick={() => setTempPwInfo(null)}>Verstanden</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function CreateUserModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (u: AdminUser, temp: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      const r = await AdminApi.createUser({ email, name, password: password || randomPw(), role });
      onCreated(r.user as AdminUser, r.temp_password);
      setEmail(''); setName(''); setPassword(''); setRole('user');
    } catch (e) {
      setError(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Benutzer anlegen">
      <div className="space-y-3">
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">E-Mail</label>
          <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Temporäres Passwort (optional)</label>
          <input className="input" placeholder="leer = automatisch generieren" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <label className="label">Rolle</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'user')}>
            <option value="user">Nutzer</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button className="btn-primary" disabled={loading} onClick={submit}>
            {loading ? 'Anlegen…' : 'Anlegen'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function InviteUserModal({
  open,
  onClose,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  onInvited: (u: AdminUser) => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      const u = await AdminApi.inviteUser({ email, name, role });
      onInvited(u as AdminUser);
      setEmail(''); setName(''); setRole('user');
    } catch (e) {
      setError(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Einladung senden">
      <div className="space-y-3">
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">E-Mail</label>
          <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Rolle</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'user')}>
            <option value="user">Nutzer</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <p className="text-xs text-zinc-500">Die eingeladene Person erhält eine E-Mail mit Link (gültig 48h).</p>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button className="btn-primary" disabled={loading} onClick={submit}>
            {loading ? 'Senden…' : 'Einladen'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function randomPw() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#';
  let s = '';
  for (let i = 0; i < 14; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
