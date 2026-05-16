/** Soft-merge banner shown when a remote edit lands on the open note.
 *
 *  Mounted inside both the desktop split-view editor pane and the
 *  mobile full-screen layout. The user can either reload (overwriting
 *  any local unsaved draft after a confirm) or dismiss the banner —
 *  dismissing keeps editing the local state and the next autosave
 *  fires a backend update with the user's content as the new latest
 *  version. Same "last writer wins" behaviour we have today; the
 *  banner just makes the user aware that *something* changed
 *  underneath them so they don't unwittingly clobber it. */
import { AlertTriangle, RefreshCw, X } from 'lucide-react';

interface Props {
  /** Show banner only when a foreign update has been observed and
   *  not yet dismissed. */
  visible: boolean;
  /** Whether the user has unsaved local edits. Influences confirm
   *  copy ("Deine Änderungen gehen verloren" vs. plain reload). */
  isDirty: boolean;
  onReload: () => void;
  onDismiss: () => void;
}

export function NoteConflictBanner({
  visible,
  isDirty,
  onReload,
  onDismiss,
}: Props) {
  if (!visible) return null;
  return (
    <div
      role="status"
      className="rounded-card border border-yellow-300 bg-yellow-50 text-yellow-900 dark:border-yellow-700/60 dark:bg-yellow-900/30 dark:text-yellow-100 px-3 py-2 text-xs flex items-center gap-2"
    >
      <AlertTriangle size={14} className="shrink-0" aria-hidden />
      <span className="flex-1 truncate">
        Diese Notiz wurde gerade von jemand anderem bearbeitet.
        {isDirty ? ' Lokale Änderungen gehen beim Neuladen verloren.' : ''}
      </span>
      <button
        type="button"
        onClick={onReload}
        className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline shrink-0"
      >
        <RefreshCw size={12} />
        Neu laden
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Hinweis schließen"
        className="text-yellow-900/70 hover:text-yellow-900 dark:text-yellow-100/70 dark:hover:text-yellow-100 shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  );
}
