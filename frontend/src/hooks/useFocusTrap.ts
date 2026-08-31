/** Keep keyboard focus inside an open overlay, and give it back on close.
 *
 *  Three jobs, all of which the app's dialogs were missing:
 *    1. Move focus into the panel when it opens — but ONLY if it isn't
 *       already there, so a field with `autoFocus` keeps the focus React
 *       just gave it.
 *    2. Cycle Tab / Shift+Tab within the panel instead of walking into the
 *       page behind the backdrop.
 *    3. Return focus to whatever was focused before, so closing a dialog
 *       drops the user back where they were instead of at the top of the page.
 */
import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const panel = ref.current;
    if (!panel) return;

    const previous = document.activeElement as HTMLElement | null;
    if (!panel.contains(document.activeElement)) {
      (focusable(panel)[0] ?? panel).focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusable(panel);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === first || !panel.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // Only take focus back if it is still inside the closing panel —
      // otherwise the user has already clicked somewhere else.
      if (previous && panel.contains(document.activeElement)) previous.focus();
    };
  }, [ref, active]);
}
