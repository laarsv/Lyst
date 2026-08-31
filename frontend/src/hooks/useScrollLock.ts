/** Freeze background scrolling while an overlay is open.
 *
 *  Ref-counted on purpose: overlays can stack (a sheet that opens a dialog),
 *  and the naive "set overflow on mount, restore on unmount" that three
 *  components used to carry each unlocked the page as soon as the FIRST of
 *  them closed. Only the last release restores the original value.
 */
import { useEffect } from 'react';

let locks = 0;
let restore = '';

export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (locks === 0) {
      restore = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    locks += 1;
    return () => {
      locks -= 1;
      if (locks === 0) document.body.style.overflow = restore;
    };
  }, [active]);
}
