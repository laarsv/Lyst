import clsx from 'clsx';

export function LiveIndicator({ connected }: { connected: boolean }) {
  return (
    <span
      title={
        connected
          ? 'Live verbunden — Änderungen werden sofort synchronisiert'
          : 'Offline — versuche neu zu verbinden, fällt auf 10-Sekunden-Polling zurück'
      }
      className="inline-flex items-center gap-1.5 text-xs select-none"
    >
      <span
        className={clsx(
          'size-2 rounded-full',
          connected ? 'bg-brand animate-pulse' : 'bg-muted/40',
        )}
      />
      <span className="text-muted">{connected ? 'Live' : 'Offline'}</span>
    </span>
  );
}
