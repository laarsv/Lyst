/** Public read-only note view (route: /share/note/:token).
 *  No nav, no auth, no edit controls — just the note + Lyst footer.
 *
 *  Renders the backend-sanitised HTML directly. The bleach allowlist
 *  guarantees no script/style/event-handler attributes survived, so
 *  dangerouslySetInnerHTML here is safe — the backend is authoritative.
 *  Falls back to the legacy markdown viewer if the row hasn't been
 *  migrated yet. */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { NotesApi } from '@/api/endpoints';
import type { PublicNoteData } from '@/types';
import { LegacyMarkdownView } from '@/components/notes/LegacyMarkdownView';

export function PublicNotePage() {
  const { token } = useParams();
  const [data, setData] = useState<PublicNoteData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        setData(await NotesApi.getPublic(token));
      } catch {
        setError('Diese Notiz ist nicht (mehr) öffentlich.');
      }
    })();
  }, [token]);

  if (error) {
    return (
      <div className="min-h-full flex items-center justify-center p-6 text-center">
        <div className="card p-8 max-w-sm">
          <div className="wordmark text-3xl mb-2">lyst</div>
          <p className="text-muted">{error}</p>
        </div>
      </div>
    );
  }
  if (!data) return <div className="p-6 text-center text-muted/70">Lade…</div>;

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6">
      <div className="text-center mb-4">
        <a href="/" className="wordmark text-xl">lyst</a>
      </div>
      <article className="card p-6">
        <h1 className="text-2xl font-semibold">{data.title || '(Ohne Titel)'}</h1>
        {data.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {data.tags.map((t) => (
              <span key={t} className="text-xs px-2 py-0.5 rounded-chip bg-line text-muted">
                #{t}
              </span>
            ))}
          </div>
        )}
        <div className="mt-4 max-w-none">
          {data.content_format === 'MARKDOWN' ? (
            <LegacyMarkdownView source={data.content || '_Leere Notiz._'} />
          ) : (
            // Bleach has stripped everything outside the allowlist on the
            // way out of the backend; rendering as HTML is safe.
            <div
              className="note-public-html"
              dangerouslySetInnerHTML={{
                __html: data.content || '<p><em>Leere Notiz.</em></p>',
              }}
            />
          )}
        </div>
      </article>

      <footer className="text-center text-xs text-muted mt-8 mb-4">
        Erstellt mit{' '}
        <a href="/" className="wordmark text-sm align-baseline">lyst</a>
      </footer>
    </div>
  );
}
