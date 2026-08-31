/** Centred dialog used by ~19 screens.
 *
 *  Carries the dialog semantics centrally so callers don't have to: role,
 *  aria-modal, a title tied to the panel via aria-labelledby, Escape,
 *  a focus trap with focus restore, and a scroll-locked background. A caller
 *  that renders its own header (SearchModal) passes `ariaLabel` instead of
 *  `title` so the dialog still has a name.
 *
 *  Stays IN TREE (unlike BottomSheet, which must portal past the header's
 *  `backdrop-blur`): the recipe detail page pins `data-theme="light"` on its
 *  wrapper, and a dialog portalled to document.body would leave that subtree
 *  and flip to the app theme mid-page in dark mode.
 */
import { useId, useRef, type ReactNode } from 'react';
import clsx from 'clsx';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useScrollLock } from '@/hooks/useScrollLock';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Accessible name when the panel brings its own header instead of `title`. */
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
}

export function Modal({ open, onClose, title, ariaLabel, children, className }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useScrollLock(open);
  useFocusTrap(panelRef, open);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        tabIndex={-1}
        className={clsx('w-full max-w-md card p-6 outline-none', className)}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <h2 id={titleId} className="text-lg font-semibold mb-4">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}
