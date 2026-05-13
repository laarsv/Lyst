/** "Zurück zu …" link for detail pages.
 *
 *  SPA navigation via react-router (preserves state and avoids the full
 *  page reload that triggers the stale-cache symptom). On viewports below
 *  640 px the long label collapses to just "Zurück" so the action area in
 *  the detail header doesn't blow out on mobile.
 *
 *  Pass `to` for the overview route and `label` for the long-form text
 *  (e.g. "zu Rezepten"). The arrow + word "Zurück" are added automatically. */
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Props {
  /** Overview route this link returns to (e.g. "/", "/recipes", "/notes"). */
  to: string;
  /** Trailing label after "Zurück". Example: "zu Listen" → renders
   *  "← Zurück zu Listen" on desktop, "← Zurück" on mobile. */
  label: string;
  /** Optional click hook — useful when the back action also needs to
   *  reset some local state (e.g. closing a child panel). Runs *before*
   *  the navigation. Return false to cancel the navigation. */
  onBeforeNavigate?: () => boolean | void;
  className?: string;
}

export function BackLink({ to, label, onBeforeNavigate, className = '' }: Props) {
  const nav = useNavigate();
  const handleClick = () => {
    if (onBeforeNavigate?.() === false) return;
    nav(to);
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center gap-1 text-sm text-muted hover:text-ink transition ${className}`}
    >
      <ArrowLeft size={16} className="shrink-0" />
      <span>
        Zurück <span className="hidden sm:inline">{label}</span>
      </span>
    </button>
  );
}
