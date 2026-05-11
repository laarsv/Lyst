import { Link } from 'react-router-dom';
import type { ListSummary } from '@/types';

const TYPE_LABEL: Record<ListSummary['type'], string> = {
  SHOPPING: 'Einkauf',
  PACKING: 'Packliste',
  CHECKLIST: 'Checkliste',
  CUSTOM: 'Liste',
};

export function ListCard({ list }: { list: ListSummary }) {
  const pct = list.item_count ? Math.round((list.checked_count / list.item_count) * 100) : 0;
  const color = list.color || '#00c896';
  return (
    <Link
      to={`/lists/${list.id}`}
      className="card p-5 hover:shadow-md transition flex flex-col gap-3 group"
      style={{ borderTopColor: color, borderTopWidth: 4 }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {list.icon && <span className="text-2xl shrink-0">{list.icon}</span>}
          <div className="min-w-0">
            <div className="font-semibold text-ink truncate">{list.title}</div>
            <div className="text-xs text-muted">{TYPE_LABEL[list.type]}</div>
          </div>
        </div>
        {!list.is_owner && (
          <span className="text-xs px-2 py-0.5 rounded-chip bg-line text-muted">geteilt</span>
        )}
      </div>
      <div className="text-sm text-muted">
        {list.checked_count} / {list.item_count} erledigt
      </div>
      <div className="h-1.5 rounded-full bg-page overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </Link>
  );
}
