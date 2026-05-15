/** "Zuletzt geteilt mit" chip row under the email input in share
 *  panels (note / recipe / recipe book).
 *
 *  Fetches GET /me/share-suggestions once on mount, renders a
 *  horizontal scroll of compact chips. Tapping a chip fills the
 *  parent's email input via `onPick(email)` — the parent still
 *  decides permission and triggers the actual share (the chip is a
 *  shortcut, not auto-share, by spec).
 *
 *  Privacy: the API only returns users the current viewer has
 *  shared SOMETHING with before, so we're not surfacing new emails.
 *  Revoking a share doesn't drop a person from this list — the
 *  backend's union doesn't see revoke history; the user remembers
 *  them and wants the chip as a convenience.
 *
 *  Hidden entirely when the suggestion list is empty (new account,
 *  never shared anything).
 */
import { useEffect, useState } from 'react';
import { MeApi } from '@/api/endpoints';
import type { ShareSuggestion } from '@/types';
import { taskInitials } from '@/components/tasks/taskFormat';

interface Props {
  /** When non-null, hide chips for this email (e.g. avoid suggesting
   *  someone you've ALREADY shared this specific resource with). */
  excludeEmails?: string[];
  onPick: (email: string) => void;
}

export function ShareSuggestionsRow({ excludeEmails, onPick }: Props) {
  const [suggestions, setSuggestions] = useState<ShareSuggestion[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    MeApi.shareSuggestions()
      .then((rows) => {
        if (!cancelled) {
          setSuggestions(rows);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) return null;
  const excludeSet = new Set((excludeEmails ?? []).map((e) => e.toLowerCase()));
  const visible = suggestions.filter((s) => !excludeSet.has(s.email.toLowerCase()));
  if (visible.length === 0) return null;

  return (
    <div className="mt-2">
      <div className="text-[11px] uppercase tracking-wider text-muted mb-1">
        Zuletzt geteilt mit
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {visible.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s.email)}
            title={s.email}
            className="shrink-0 inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs transition"
          >
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-brand text-white text-[10px] font-semibold">
              {taskInitials(s.name)}
            </span>
            {/* First name only — keeps the chip compact. The full
                name + email live in the tooltip. */}
            <span className="truncate max-w-[100px]">
              {s.name.split(/\s+/)[0]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
