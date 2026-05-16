/** Conflict-detection hook for the open note editor.
 *
 *  useUserWebSocket dispatches a `lyst:note-updated` CustomEvent on
 *  every remote note.updated. This hook subscribes for the currently
 *  open noteId, filters out our own actor id (so a save bouncing
 *  back from another device of the same user — i.e. the X-Client-Id
 *  echo-suppression missed — doesn't false-positive), and exposes a
 *  `hasConflict` flag the UI can use to render a "Neu laden?" banner.
 *
 *  Caller-controlled dismiss + reload: `dismiss()` clears the flag
 *  (used after the reload completes or the user closes the banner).
 *  Actual reload (fetching fresh note data) lives in the parent
 *  because it needs access to the parent's onRestored / state
 *  replacement machinery — same channel version-restore uses.
 */
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth';

interface NoteUpdatedDetail {
  noteId: number;
  actorId: number;
}

export function useNoteConflict(noteId: number): {
  hasConflict: boolean;
  dismiss: () => void;
} {
  const myId = useAuthStore((s) => s.userId);
  const [hasConflict, setHasConflict] = useState(false);

  useEffect(() => {
    // Clear when the open note changes — old flag doesn't apply.
    setHasConflict(false);
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<NoteUpdatedDetail>).detail;
      if (!detail) return;
      if (detail.noteId !== noteId) return;
      // Our own save bouncing back — ignore. Backend filters by
      // X-Client-Id but two tabs of the same user with different
      // client_ids still emit; gating on actor_id catches that.
      if (myId !== null && detail.actorId === myId) return;
      setHasConflict(true);
    };
    window.addEventListener('lyst:note-updated', handler as EventListener);
    return () =>
      window.removeEventListener('lyst:note-updated', handler as EventListener);
  }, [noteId, myId]);

  return { hasConflict, dismiss: () => setHasConflict(false) };
}
