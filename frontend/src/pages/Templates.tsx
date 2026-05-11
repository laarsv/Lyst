import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListsApi } from '@/api/endpoints';
import type { ListSummary } from '@/types';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';

export function TemplatesPage() {
  const [templates, setTemplates] = useState<ListSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    void (async () => {
      try {
        setTemplates(await ListsApi.templates());
      } catch (e) {
        toast.error(getApiError(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const useTemplate = async (t: ListSummary) => {
    try {
      const newList = await ListsApi.duplicate(t.id, { title: t.template_name || t.title });
      toast.success('Liste aus Vorlage erstellt');
      nav(`/lists/${newList.id}`);
    } catch (e) {
      toast.error(getApiError(e));
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Vorlagen</h1>
      {loading ? (
        <div className="text-muted/70">Lade…</div>
      ) : templates.length === 0 ? (
        <div className="card p-12 text-center text-muted">
          Noch keine Vorlagen. Du kannst eine Liste in der Detailansicht als Vorlage speichern.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => (
            <div
              key={t.id}
              className="card p-5 flex flex-col gap-3"
              style={{ borderTopColor: t.color || '#00c896', borderTopWidth: 4 }}
            >
              <div className="flex items-center gap-2">
                {t.icon && <span className="text-2xl">{t.icon}</span>}
                <div>
                  <div className="font-semibold">{t.template_name || t.title}</div>
                  <div className="text-xs text-muted">{t.item_count} Einträge</div>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn-primary text-sm" onClick={() => useTemplate(t)}>Verwenden</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
