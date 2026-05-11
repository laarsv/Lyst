import { useEffect, useState } from 'react';
import { ShareApi } from '@/api/endpoints';
import type { Collaborator, CollaboratorPermission } from '@/types';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';

export function CollaboratorsPanel({ listId }: { listId: number }) {
  const [items, setItems] = useState<Collaborator[]>([]);
  const [email, setEmail] = useState('');
  const [perm, setPerm] = useState<CollaboratorPermission>('VIEW');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setItems(await ShareApi.collaborators(listId));
      } catch (e) {
        toast.error(getApiError(e));
      }
    })();
  }, [listId]);

  const add = async () => {
    if (!email) return;
    setLoading(true);
    try {
      const c = await ShareApi.addCollaborator(listId, email, perm);
      setItems((cur) => {
        const without = cur.filter((x) => x.user_id !== c.user_id);
        return [...without, c];
      });
      setEmail('');
      toast.success(`${c.email} hinzugefügt`);
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const remove = async (c: Collaborator) => {
    try {
      await ShareApi.removeCollaborator(listId, c.user_id);
      setItems((cur) => cur.filter((x) => x.user_id !== c.user_id));
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  return (
    <div className="card p-5">
      <h3 className="font-semibold mb-3">Mitnutzer</h3>
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          type="email"
          className="input flex-1 min-w-[150px]"
          placeholder="email@beispiel.de"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <select className="input w-32" value={perm} onChange={(e) => setPerm(e.target.value as CollaboratorPermission)}>
          <option value="VIEW">Lesen</option>
          <option value="EDIT">Bearbeiten</option>
        </select>
        <button className="btn-primary text-sm" disabled={loading || !email} onClick={add}>
          Hinzufügen
        </button>
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-muted">Noch keine Mitnutzer.</div>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((c) => (
            <li key={c.user_id} className="py-2 flex items-center justify-between">
              <div className="min-w-0">
                <div className="font-medium truncate">{c.name}</div>
                <div className="text-xs text-muted truncate">{c.email}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded ${c.permission === 'EDIT' ? 'bg-brand-50 text-brand-700' : 'bg-page text-muted'}`}>
                  {c.permission === 'EDIT' ? 'Bearbeiten' : 'Lesen'}
                </span>
                <button className="text-xs text-danger hover:underline" onClick={() => remove(c)}>
                  Entfernen
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
