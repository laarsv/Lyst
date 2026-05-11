import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ListsApi } from '@/api/endpoints';
import type { ListSummary, ListType } from '@/types';
import { Modal } from '@/components/Modal';
import { ListCard } from '@/components/lists/ListCard';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import { useNavigate } from 'react-router-dom';

const TYPES: { v: ListType; label: string; icon: string; color: string }[] = [
  { v: 'SHOPPING', label: 'Einkauf', icon: '🛒', color: '#00c896' },
  { v: 'PACKING', label: 'Packliste', icon: '🧳', color: '#f59e0b' },
  { v: 'CHECKLIST', label: 'Checkliste', icon: '✅', color: '#1a1a1a' },
  { v: 'CUSTOM', label: 'Eigene', icon: '📋', color: '#888884' },
];

export function DashboardPage() {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<ListType | 'ALL'>('ALL');
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setLists(await ListsApi.list());
      } catch (e) {
        toast.error(getApiError(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    return lists
      .filter((l) => (filter === 'ALL' ? true : l.type === filter))
      .filter((l) => (q ? l.title.toLowerCase().includes(q.toLowerCase()) : true));
  }, [lists, filter, q]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-semibold">Deine Listen</h1>
        <button className="btn-primary" onClick={() => setCreateOpen(true)}>
          + Neue Liste
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <input
          className="input flex-1 min-w-[200px]"
          placeholder="Liste suchen…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex gap-1 bg-surface border border-line rounded-xl p-1">
          {(['ALL', ...TYPES.map((t) => t.v)] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t as any)}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${
                filter === t ? 'bg-white shadow-sm font-medium' : 'text-muted'
              }`}
            >
              {t === 'ALL' ? 'Alle' : TYPES.find((x) => x.v === t)?.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-muted/70">Lade…</div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center text-muted">
          Noch keine Listen.{' '}
          <button className="text-brand hover:underline" onClick={() => setCreateOpen(true)}>
            Erste Liste erstellen
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((l) => (
            <ListCard key={l.id} list={l} />
          ))}
        </div>
      )}

      <CreateListModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(l) => {
          setLists((cur) => [l, ...cur]);
          setCreateOpen(false);
        }}
      />
    </div>
  );
}

function CreateListModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (l: ListSummary) => void;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ListType>('SHOPPING');
  const [icon, setIcon] = useState('🛒');
  const [color, setColor] = useState('#00c896');
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const l = await ListsApi.create({ title, type, icon, color });
      onCreated(l);
      setTitle('');
      nav(`/lists/${l.id}`);
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Neue Liste">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">Titel</label>
          <input
            className="input"
            value={title}
            autoFocus
            required
            onChange={(e) => setTitle(e.target.value)}
            placeholder="z.B. Wocheneinkauf"
          />
        </div>
        <div>
          <label className="label">Typ</label>
          <div className="grid grid-cols-2 gap-2">
            {TYPES.map((t) => (
              <button
                type="button"
                key={t.v}
                onClick={() => {
                  setType(t.v);
                  setIcon(t.icon);
                  setColor(t.color);
                }}
                className={`p-3 rounded-xl border text-left transition ${
                  type === t.v ? 'border-brand bg-brand-50' : 'border-line hover:bg-page'
                }`}
              >
                <div className="text-2xl mb-1">{t.icon}</div>
                <div className="text-sm font-medium">{t.label}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="label">Emoji</label>
            <input className="input" value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} />
          </div>
          <div>
            <label className="label">Farbe</label>
            <input
              type="color"
              className="h-[42px] w-16 rounded-xl border border-line cursor-pointer"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Anlegen…' : 'Anlegen'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
