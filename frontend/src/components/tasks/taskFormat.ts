/** Small shared formatters for task chips (due-date, assignee
 *  initials, overdue check). Kept separate from the popover because
 *  the /tasks page also renders these chips and the format rules
 *  should be identical across surfaces. */

const WEEKDAY = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** Format a due-at ISO string for a task chip:
 *    today      -> "heute 14:00"
 *    tomorrow   -> "morgen 14:00"
 *    this week  -> "Mo 14:00"
 *    later      -> "21.5. 14:00"
 *  Time is dropped entirely when the user picked midnight (the
 *  default of HTML `datetime-local` when only a date is typed). */
export function formatTaskDue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow =
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate();
  const diffMs = d.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.floor(diffMs / 86400000);

  const time =
    d.getHours() === 0 && d.getMinutes() === 0
      ? ''
      : ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  if (sameDay) return `heute${time}`;
  if (isTomorrow) return `morgen${time}`;
  if (days >= 0 && days < 7) return `${WEEKDAY[d.getDay()]}${time}`;
  return `${d.getDate()}.${d.getMonth() + 1}.${time}`;
}

/** True if due_at < now AND not done. Caller passes done separately
 *  so this helper stays pure. */
export function isOverdue(due: string | null, done: boolean): boolean {
  if (done || !due) return false;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

/** Build the 1–2 character initials we draw inside the assignee
 *  avatar chip. "Anna Schmidt" -> "AS"; "Anna" -> "A". */
export function taskInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}
