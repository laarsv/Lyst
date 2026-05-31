import { useState } from 'react';
import { ImagePlus, Loader2, Trash2, Upload } from 'lucide-react';
import { PlantsApi } from '@/api/endpoints';
import { toast } from '@/components/Toast';
import { getApiError } from '@/api/client';

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Hero-image uploader for a plant — same UX as the recipe one: drag-drop
 *  dropzone when empty, preview + ändern/entfernen when filled, progress bar
 *  driven by axios onUploadProgress. Requires an existing plant id, so the
 *  edit form only renders it after the plant has been saved. */
export function PlantImageUploader({
  plantId,
  currentUrl,
  onChanged,
}: {
  plantId: number;
  currentUrl: string;
  onChanged: (url: string | null) => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busyDelete, setBusyDelete] = useState(false);

  const upload = async (file: File) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      toast.error('Nur JPG, PNG oder WebP');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Maximal 10 MB');
      return;
    }
    setProgress(0);
    try {
      const updated = await PlantsApi.uploadImage(plantId, file, setProgress);
      onChanged(updated.image_url);
      toast.success('Bild hochgeladen');
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setProgress(null);
    }
  };

  const remove = async () => {
    setBusyDelete(true);
    try {
      const updated = await PlantsApi.removeImage(plantId);
      onChanged(updated.image_url ?? null);
      toast.success('Bild entfernt');
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setBusyDelete(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void upload(file);
  };

  const isUploaded = currentUrl.startsWith('/static/');
  const showPreview = !!currentUrl && progress === null;

  if (showPreview) {
    return (
      <div className="rounded-ctl border border-line overflow-hidden bg-page">
        <div
          className="h-32 bg-cover bg-center"
          style={{ backgroundImage: `url(${currentUrl})` }}
        />
        <div className="flex items-center justify-between gap-2 px-2 py-2 border-t border-line bg-surface">
          <label className="btn-ghost text-xs cursor-pointer inline-flex items-center gap-1">
            <Upload size={14} />
            <span>Bild ändern</span>
            <input
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(',')}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = '';
              }}
            />
          </label>
          {isUploaded && (
            <button
              type="button"
              onClick={remove}
              disabled={busyDelete}
              className="btn-ghost text-xs text-danger inline-flex items-center gap-1"
            >
              <Trash2 size={14} />
              <span>Entfernen</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`flex flex-col items-center justify-center gap-1 h-32 rounded-ctl border-2 border-dashed cursor-pointer transition ${
        dragOver
          ? 'border-brand bg-brand-50/50 text-brand-700'
          : 'border-line bg-surface text-muted hover:border-brand/60 hover:bg-page'
      }`}
    >
      {progress !== null ? (
        <>
          <Loader2 size={20} className="animate-spin" />
          <div className="text-xs">Lade hoch… {progress}%</div>
          <div className="w-32 h-1 bg-line rounded-full overflow-hidden">
            <div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} />
          </div>
        </>
      ) : (
        <>
          <ImagePlus size={22} />
          <span className="text-sm font-medium">Bild hochladen</span>
          <span className="text-[11px]">oder hierher ziehen · JPG, PNG, WebP — max 10 MB</span>
        </>
      )}
      <input
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(',')}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = '';
        }}
      />
    </label>
  );
}
