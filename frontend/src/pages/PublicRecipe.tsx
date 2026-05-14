/** Public read-only recipe view (route: /share/recipe/:token).
 *  No nav, no auth, no edit controls — just the recipe + Lyst footer. */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { RecipesApi } from '@/api/endpoints';
import { fmtQty } from '@/lib/format';
import type { PublicRecipeData } from '@/types';

export function PublicRecipePage() {
  const { token } = useParams();
  const [data, setData] = useState<PublicRecipeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        setData(await RecipesApi.getPublic(token));
      } catch {
        setError('Dieses Rezept ist nicht (mehr) öffentlich.');
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

  const totalTime = (data.prep_time_minutes ?? 0) + (data.cook_time_minutes ?? 0);

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6">
      <div className="text-center mb-4">
        <a href="/" className="wordmark text-xl">lyst</a>
      </div>
      <article className="card overflow-hidden">
        {data.image_url && (
          <div
            className="h-48 sm:h-64 bg-cover bg-center"
            style={{ backgroundImage: `url(${data.image_url})` }}
          />
        )}
        <div className="p-6">
          <h1 className="text-2xl font-semibold">{data.title}</h1>
          {data.description && <p className="text-muted mt-2">{data.description}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted mt-3">
            <span>🍴 {data.servings} Pers.</span>
            {data.prep_time_minutes !== null && <span>Vorbereitung: {data.prep_time_minutes} Min</span>}
            {data.cook_time_minutes !== null && <span>Kochen: {data.cook_time_minutes} Min</span>}
            {totalTime > 0 && <span className="font-medium">Gesamt: {totalTime} Min</span>}
          </div>
          {data.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {data.tags.map((t) => (
                <span key={t} className="text-xs px-2 py-0.5 rounded-chip bg-line text-muted">
                  #{t}
                </span>
              ))}
            </div>
          )}
          {data.source_url && (
            <a
              href={data.source_url}
              target="_blank"
              rel="noreferrer"
              className="inline-block mt-3 text-xs text-brand hover:underline truncate max-w-full"
            >
              Quelle: {data.source_url}
            </a>
          )}
        </div>
      </article>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 mt-4">
        <section className="card p-5">
          <h2 className="font-semibold mb-3">Zutaten</h2>
          {data.ingredients.length === 0 ? (
            <div className="text-sm text-muted/70">Keine Zutaten erfasst.</div>
          ) : (
            <ul className="divide-y divide-line">
              {data.ingredients.map((ing) => (
                <li key={ing.id} className="py-2 flex items-baseline gap-2">
                  <span className="text-sm text-muted tabular-nums w-20 shrink-0">
                    {fmtQty(ing.quantity)} {ing.unit ?? ''}
                  </span>
                  <span className="text-sm">{ing.name}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-5">
          <h2 className="font-semibold mb-3">Zubereitung</h2>
          {data.steps.length === 0 ? (
            <div className="text-sm text-muted/70">Keine Schritte erfasst.</div>
          ) : (
            <ol className="space-y-3">
              {data.steps.map((s, i) => (
                <li key={s.id} className="flex gap-3">
                  <span className="size-6 rounded-full bg-brand text-white flex items-center justify-center text-xs font-medium shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-sm leading-relaxed pt-0.5">{s.description}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <footer className="text-center text-xs text-muted mt-8 mb-4">
        Erstellt mit{' '}
        <a href="/" className="wordmark text-sm align-baseline">lyst</a>
      </footer>
    </div>
  );
}
