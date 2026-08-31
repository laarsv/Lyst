/** Placeholder blocks for the moment between "page rendered" and "data here".
 *
 *  Replaces the bare "Lade…" on the overviews: the text collapsed to one line
 *  and the real cards then shoved the page down. A skeleton in the shape of
 *  the coming content keeps the layout still.
 *
 *  `CardGridSkeleton` mirrors the 1/2/3-column card grids (Listen, Rezepte,
 *  Pflanzen), `RowsSkeleton` the stacked rows (Heute, Aufgaben, Notizen).
 *  The pulse honours prefers-reduced-motion via `motion-safe:`.
 */
const BAR = 'bg-line rounded motion-safe:animate-pulse';

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      aria-hidden
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className={`size-9 shrink-0 rounded-xl ${BAR}`} />
            <div className={`h-4 flex-1 ${BAR}`} />
          </div>
          <div className={`h-3 w-2/3 ${BAR}`} />
          <div className={`h-2 w-full ${BAR}`} />
        </div>
      ))}
    </div>
  );
}

export function RowsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="card divide-y divide-line" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 p-3">
          <div className={`size-9 shrink-0 rounded-xl ${BAR}`} />
          <div className="flex-1 space-y-2">
            <div className={`h-3.5 w-1/2 ${BAR}`} />
            <div className={`h-2.5 w-1/3 ${BAR}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Screen-reader counterpart — the skeletons themselves are aria-hidden. */
export function LoadingAnnouncement({ label = 'Wird geladen' }: { label?: string }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {label}
    </span>
  );
}
