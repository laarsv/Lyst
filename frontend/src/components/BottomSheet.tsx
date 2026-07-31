/** Mobile bottom sheet — slide-up panel with a backdrop overlay.
 *
 *  Used by the note actions kebab and the notes filter panel. Renders nothing
 *  unless `open` is true so callers can mount it conditionally without
 *  worrying about animation timing — the slide-in transition fires off a
 *  one-frame delay inside, and `onClose` is invoked when the user taps the
 *  backdrop or presses Escape.
 *
 *  Rendered through a PORTAL to document.body: `backdrop-filter` (and
 *  transform/filter/perspective) on any ancestor makes it the containing block
 *  for `position: fixed`, so an in-tree sheet would be clipped to that box
 *  instead of covering the viewport. The AppShell header uses `backdrop-blur`,
 *  which broke the account menu's sheet on Android exactly that way —
 *  NotificationBell already portals its own sheet for the same reason. */
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Tailwind max-h class for the panel body. Default ~70% of viewport. */
  maxHeightClass?: string;
  /** Optional `aria-label` for the dialog wrapper. */
  ariaLabel?: string;
}

export function BottomSheet({
  open,
  onClose,
  children,
  maxHeightClass = 'max-h-[75vh]',
  ariaLabel,
}: Props) {
  const [shown, setShown] = useState(false);

  // Trigger the slide-in transition by toggling translate after first paint.
  useEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Esc closes — only when this sheet is on screen.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        aria-label="Schließen"
        className={`absolute inset-0 transition-opacity duration-200 bg-ink/40 ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />
      <div
        className={`relative w-full max-w-[640px] bg-surface border-t border-line rounded-t-card pb-[max(env(safe-area-inset-bottom,0px),12px)] flex flex-col ${maxHeightClass} transition-transform duration-200 ${
          shown ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="flex justify-center py-2 shrink-0">
          <span className="block w-10 h-1.5 rounded-full bg-line" />
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
