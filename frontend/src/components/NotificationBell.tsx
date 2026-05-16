/** Header bell — opens a dropdown with the most recent notifications.
 *
 *  Lives in AppShell next to the Live indicator. Subscribes to the
 *  notifications store so the badge reflects:
 *    - the initial GET /notifications fetch (mount + focus return)
 *    - real-time prepends from useUserWebSocket's `notification`
 *      dispatch branch (this used to be dead-letter; the backend now
 *      writes a row and broadcasts it)
 *
 *  Click → navigate to the resource referenced by the payload + mark
 *  the row read. The dropdown closes on outside click or Escape. */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check } from 'lucide-react';
import { NotificationsApi, type NotificationRow } from '@/api/endpoints';
import { useNotificationsStore } from '@/store/notifications';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';

export function NotificationBell() {
  const items = useNotificationsStore((s) => s.items);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  const setRows = useNotificationsStore((s) => s.set);
  const markReadInStore = useNotificationsStore((s) => s.markRead);
  const markAllReadInStore = useNotificationsStore((s) => s.markAllRead);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const nav = useNavigate();

  // Initial fetch + focus refetch. Same network-first pattern the
  // overview hook uses; we don't reuse useResourceQuery here because
  // the store IS the cache, not React state per-route.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await NotificationsApi.list();
        if (!cancelled) setRows(r.items, r.unread_count);
      } catch {
        // Silent — first load failure shows badge=0, retry on next focus.
      }
    };
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [setRows]);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleRowClick = async (row: NotificationRow) => {
    setOpen(false);
    // Navigate first — instant feedback. Mark-read fires in the
    // background; if it fails we don't roll back (the row visually
    // stays marked, mismatch will reconcile on next list-load).
    const target = deepLinkFor(row);
    if (target) nav(target);
    if (!row.read_at) {
      markReadInStore(row.id);
      try {
        await NotificationsApi.markRead(row.id);
      } catch {
        /* swallow — see comment above */
      }
    }
  };

  const markAll = async () => {
    markAllReadInStore();
    try {
      await NotificationsApi.markAllRead();
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Benachrichtigungen"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative p-2 rounded-lg text-muted hover:bg-page hover:text-ink transition"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            aria-label={`${unreadCount} ungelesen`}
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 inline-flex items-center justify-center text-[10px] font-semibold rounded-full bg-brand text-white tabular-nums"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Benachrichtigungen"
          className="absolute right-0 mt-1 z-50 card shadow-flat border border-line bg-surface w-[320px] sm:w-[360px] max-h-[480px] flex flex-col"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-line">
            <span className="text-sm font-medium">Benachrichtigungen</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="text-[11px] text-muted hover:text-ink inline-flex items-center gap-1"
              >
                <Check size={11} />
                Alle gelesen
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="text-sm text-muted/70 py-8 text-center">
                Keine neuen Benachrichtigungen.
              </div>
            ) : (
              <ul>
                {items.map((row) => (
                  <NotificationRowView
                    key={row.id}
                    row={row}
                    onClick={() => handleRowClick(row)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationRowView({
  row,
  onClick,
}: {
  row: NotificationRow;
  onClick: () => void;
}) {
  const unread = !row.read_at;
  const { title, subtitle } = describe(row);
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`w-full text-left px-3 py-2.5 border-b border-line/50 hover:bg-page transition flex items-start gap-2 ${
          unread ? 'bg-brand-50/40' : ''
        }`}
      >
        {unread && (
          <span
            aria-hidden
            className="mt-1.5 inline-block size-1.5 rounded-full bg-brand shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <div
            className={`text-sm truncate ${unread ? 'text-ink font-medium' : 'text-muted'}`}
          >
            {title}
          </div>
          {subtitle && (
            <div className="text-xs text-muted/80 truncate">{subtitle}</div>
          )}
          <div className="text-[10px] text-muted/60 mt-0.5 tabular-nums">
            {formatRelative(row.created_at)}
          </div>
        </div>
      </button>
    </li>
  );
}

/** Per-kind row formatting + deep-link target. Payload shape is
 *  defined in backend/app/services/notification_service.py — keep the
 *  two in sync when adding new kinds. */
function describe(row: NotificationRow): { title: string; subtitle: string | null } {
  const p = row.payload as Record<string, unknown>;
  const actor = typeof p.actor_name === 'string' ? p.actor_name : 'Jemand';
  switch (row.kind) {
    case 'share_created': {
      const title = typeof p.title === 'string' ? p.title : '';
      const type = typeof p.resource_type === 'string' ? p.resource_type : '';
      const label =
        type === 'note'
          ? 'Notiz'
          : type === 'list'
            ? 'Liste'
            : type === 'recipe'
              ? 'Rezept'
              : 'Inhalt';
      return {
        title: `${actor} hat ${label} geteilt`,
        subtitle: title || null,
      };
    }
    case 'mention': {
      const noteTitle = typeof p.note_title === 'string' ? p.note_title : '';
      return {
        title: `${actor} hat dich erwähnt`,
        subtitle: noteTitle || null,
      };
    }
    case 'task_assigned': {
      const text = typeof p.text === 'string' ? p.text : '';
      return {
        title: `${actor} hat dir eine Aufgabe zugewiesen`,
        subtitle: text || null,
      };
    }
    case 'task_reminder': {
      const text = typeof p.text === 'string' ? p.text : '';
      return {
        title: 'Erinnerung an Aufgabe',
        subtitle: text || null,
      };
    }
    default:
      return { title: 'Benachrichtigung', subtitle: null };
  }
}

function deepLinkFor(row: NotificationRow): string | null {
  const p = row.payload as Record<string, unknown>;
  switch (row.kind) {
    case 'share_created': {
      const type = typeof p.resource_type === 'string' ? p.resource_type : '';
      const id = typeof p.resource_id === 'number' ? p.resource_id : null;
      if (id === null) return null;
      if (type === 'note') return `/notes?focus=${id}`;
      if (type === 'list') return `/lists/${id}`;
      if (type === 'recipe') return `/recipes/${id}`;
      return null;
    }
    case 'mention': {
      const id = typeof p.note_id === 'number' ? p.note_id : null;
      return id ? `/notes?focus=${id}` : null;
    }
    case 'task_assigned':
    case 'task_reminder': {
      const source = typeof p.source === 'string' ? p.source : '';
      const sid = typeof p.source_id === 'number' ? p.source_id : null;
      const tid = typeof p.task_id === 'number' ? p.task_id : null;
      if (sid === null) return null;
      if (source === 'list') {
        return tid !== null ? `/lists/${sid}?task=${tid}` : `/lists/${sid}`;
      }
      if (source === 'note') {
        const params = new URLSearchParams({ focus: String(sid) });
        if (tid !== null) params.set('task', String(tid));
        return `/notes?${params.toString()}`;
      }
      return null;
    }
    default:
      return null;
  }
}

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const delta = Math.max(0, now - then);
    const min = Math.floor(delta / 60_000);
    if (min < 1) return 'jetzt';
    if (min < 60) return `vor ${min} Min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `vor ${h} Std`;
    const d = Math.floor(h / 24);
    if (d < 7) return `vor ${d} Tagen`;
    return new Date(iso).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
    });
  } catch {
    return '';
  }
}
