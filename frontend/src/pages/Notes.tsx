import { useEffect, useMemo, useState } from 'react';
import { NotesApi, TagsApi } from '@/api/endpoints';
import type { Note, Tag } from '@/types';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';
import MDEditor from '@uiw/react-md-editor';

export function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(false);

  const refresh = async () => {
    try {
      const [n, t] = await Promise.all([
        NotesApi.list({ q: q || undefined, tag: tagFilter || undefined }),
        TagsApi.list(),
      ]);
      setNotes(n);
      setTags(t);
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagFilter]);

  const active = useMemo(() => notes.find((n) => n.id === activeId) ?? null, [notes, activeId]);

  const create = async () => {
    try {
      const n = await NotesApi.create({ title: 'Neue Notiz' });
      setNotes((cur) => [n, ...cur]);
      setActiveId(n.id);
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const updateNote = async (n: Note, patch: Partial<Note>) => {
    try {
      const upd = await NotesApi.update(n.id, patch);
      setNotes((cur) => cur.map((x) => (x.id === upd.id ? upd : x)));
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const removeNote = async (n: Note) => {
    if (!confirm('Notiz löschen?')) return;
    try {
      await NotesApi.remove(n.id);
      setNotes((cur) => cur.filter((x) => x.id !== n.id));
      if (activeId === n.id) setActiveId(null);
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4 min-h-[60vh]">
      <aside className="card p-3 flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Suche…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && refresh()}
          />
          <button className="btn-primary text-sm" onClick={create}>+</button>
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setTagFilter(null)}
            className={`text-xs px-2 py-1 rounded-full ${tagFilter === null ? 'bg-brand text-white' : 'bg-zinc-100 text-zinc-600'}`}
          >
            alle
          </button>
          {tags.map((t) => (
            <button
              key={t.id}
              onClick={() => setTagFilter(tagFilter === t.name ? null : t.name)}
              className={`text-xs px-2 py-1 rounded-full ${tagFilter === t.name ? 'text-white' : 'bg-zinc-100 text-zinc-600'}`}
              style={tagFilter === t.name ? { background: t.color || '#0a84ff' } : undefined}
            >
              #{t.name}
            </button>
          ))}
          <button onClick={() => setTagsOpen(true)} className="text-xs px-2 py-1 rounded-full bg-zinc-100 text-zinc-500 hover:bg-zinc-200">
            ⚙
          </button>
        </div>
        <div className="flex-1 overflow-auto -mx-1 px-1">
          {loading ? (
            <div className="text-zinc-400 text-sm">Lade…</div>
          ) : notes.length === 0 ? (
            <div className="text-zinc-400 text-sm py-6 text-center">Noch keine Notizen.</div>
          ) : (
            <ul className="space-y-1">
              {notes.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => setActiveId(n.id)}
                    className={`w-full text-left p-2 rounded-lg ${activeId === n.id ? 'bg-brand-50' : 'hover:bg-zinc-50'}`}
                  >
                    <div className="font-medium truncate">{n.title || '(ohne Titel)'}</div>
                    <div className="text-xs text-zinc-500 truncate">
                      {n.content.replace(/[#*_>`-]/g, '').slice(0, 60) || 'leer'}
                    </div>
                    {n.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {n.tags.map((t) => (
                          <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600">
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section className="card p-4 flex flex-col gap-3 min-w-0">
        {active ? (
          <NoteEditor
            key={active.id}
            note={active}
            availableTags={tags}
            onChange={(patch) => updateNote(active, patch)}
            onDelete={() => removeNote(active)}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-400">
            Wähle eine Notiz oder lege eine neue an.
          </div>
        )}
      </section>

      <ManageTagsModal
        open={tagsOpen}
        tags={tags}
        onClose={() => setTagsOpen(false)}
        onChange={(t) => setTags(t)}
      />
    </div>
  );
}

function NoteEditor({
  note,
  availableTags,
  onChange,
  onDelete,
}: {
  note: Note;
  availableTags: Tag[];
  onChange: (patch: Partial<Note>) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [tags, setTags] = useState<string[]>(note.tags);
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    setTitle(note.title);
    setContent(note.content);
    setTags(note.tags);
  }, [note.id]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (title !== note.title || content !== note.content || tags.join(',') !== note.tags.join(',')) {
        onChange({ title, content, tags });
      }
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, tags]);

  return (
    <>
      <div className="flex items-center gap-2">
        <input
          className="input flex-1 text-lg font-semibold"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button className="btn-ghost text-sm text-red-600" onClick={onDelete}>Löschen</button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 text-xs bg-zinc-100 px-2 py-1 rounded-full">
            #{t}
            <button onClick={() => setTags(tags.filter((x) => x !== t))} className="text-zinc-400 hover:text-red-500">×</button>
          </span>
        ))}
        <input
          list="tag-suggestions"
          className="px-2 py-1 text-xs border border-zinc-200 rounded-full bg-white outline-none focus:border-brand"
          placeholder="+ tag"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              const v = tagInput.trim().replace(/^#/, '');
              if (v && !tags.includes(v)) setTags([...tags, v]);
              setTagInput('');
            }
          }}
        />
        <datalist id="tag-suggestions">
          {availableTags.map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>
      </div>
      <div data-color-mode="light" className="flex-1 min-h-[400px]">
        <MDEditor value={content} onChange={(v) => setContent(v ?? '')} height={500} preview="live" />
      </div>
    </>
  );
}

function ManageTagsModal({
  open,
  tags,
  onClose,
  onChange,
}: {
  open: boolean;
  tags: Tag[];
  onClose: () => void;
  onChange: (t: Tag[]) => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#0a84ff');

  const create = async () => {
    if (!name.trim()) return;
    try {
      const t = await TagsApi.create(name.trim(), color);
      onChange([...tags, t].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  const remove = async (t: Tag) => {
    try {
      await TagsApi.remove(t.id);
      onChange(tags.filter((x) => x.id !== t.id));
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Tags verwalten">
      <div className="space-y-3">
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="Neuer Tag" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="color" className="h-[42px] w-14 rounded-xl border border-zinc-200" value={color} onChange={(e) => setColor(e.target.value)} />
          <button className="btn-primary" onClick={create}>+</button>
        </div>
        {tags.length === 0 ? (
          <div className="text-sm text-zinc-500">Keine Tags.</div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {tags.map((t) => (
              <li key={t.id} className="py-2 flex items-center justify-between">
                <span className="inline-flex items-center gap-2">
                  <span className="size-3 rounded-full" style={{ background: t.color || '#0a84ff' }} />
                  #{t.name}
                </span>
                <button className="text-xs text-red-500 hover:underline" onClick={() => remove(t)}>Löschen</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
