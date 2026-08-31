/** Warn before abandoning a half-filled editor.
 *
 *  Two guards, because they cover different exits:
 *    - `beforeunload` catches reload, tab close and leaving the site. The
 *      browser shows its own generic text; the message can't be customised.
 *    - `leave(to)` is for the editor's own exits (Abbrechen, BackLink). It
 *      asks with the app's confirm dialog and only then navigates.
 *
 *  NOT covered: the browser's own Back button and the Android back gesture.
 *  Intercepting those needs react-router's `useBlocker`, which only exists on
 *  a data router (`createBrowserRouter`) — this app mounts `<BrowserRouter>`,
 *  so that would be a routing migration, not a hook. Worth doing separately;
 *  until then Back still loses the draft.
 *
 *  `values` is compared as JSON against a snapshot taken when `ready` first
 *  turns true, so it must only contain form state (no dates, no functions).
 */
import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfirm } from '@/components/Dialogs';

interface Options {
  /** Everything the user can edit on the page. */
  values: unknown;
  /** False while the editor is still loading its record. */
  ready?: boolean;
}

export function useUnsavedChanges({ values, ready = true }: Options) {
  const baseline = useRef<string | null>(null);
  const serialized = JSON.stringify(values);
  const confirm = useConfirm();
  const nav = useNavigate();

  useEffect(() => {
    if (ready && baseline.current === null) baseline.current = serialized;
  }, [ready, serialized]);

  const dirty = ready && baseline.current !== null && baseline.current !== serialized;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy browsers need returnValue set; the text itself is ignored.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const leave = useCallback(
    async (to: string) => {
      if (
        dirty &&
        !(await confirm({
          title: 'Änderungen verwerfen?',
          message: 'Du hast Änderungen, die noch nicht gespeichert sind.',
          confirmLabel: 'Verwerfen',
          cancelLabel: 'Weiter bearbeiten',
          variant: 'danger',
        }))
      ) {
        return;
      }
      nav(to);
    },
    [dirty, confirm, nav],
  );

  return { dirty, leave };
}
