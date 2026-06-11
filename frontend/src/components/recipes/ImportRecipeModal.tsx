/** Recipe import dialog with four input paths.
 *
 *  - URL   : paste a recipe webpage URL → backend fetches + extracts.
 *  - Foto  : upload a JPG/PNG/WebP → vision model OCRs the page.
 *  - Datei : upload an HTML or PDF (or image too — same dropzone) →
 *            backend extracts text and feeds the structured prompt.
 *  - Text  : paste / type a free-form recipe → backend sends raw
 *            text to the LLM, no cleaning.
 *
 *  All four flows produce an ImportedRecipe payload which we hand to
 *  /recipes/new via location.state.prefill — the existing edit form
 *  takes over from there.
 *
 *  Drag & drop:
 *  - Datei tab accepts files dropped anywhere in its zone.
 *  - Text tab accepts plain-text drops (drag selection from another
 *    app) into the textarea, AND a paste of formatted content gets
 *    flattened to plain text on paste so the textarea stays clean.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/Modal';
import { RecipesApi } from '@/api/endpoints';
import { getApiError } from '@/api/client';
import { invalidateOverview } from '@/hooks/useOverviewQuery';
import { toast } from '@/components/Toast';
import { useConfirm } from '@/components/Dialogs';
import { File as FileIcon, FileJson, FileText, ImagePlus, Link2 } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Mode = 'url' | 'photo' | 'file' | 'text' | 'json';

const TEXT_MAX = 10_000;
const MAX_PHOTOS = 4; // matches the backend's import-photos cap

function fmtElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`;
}

export function ImportRecipeModal({ open, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('url');
  const [url, setUrl] = useState('');
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  // Datei tab is multi-file: a single non-.eml goes through the AI import, any
  // .eml files go through the no-AI Picnic import (batch).
  const [anyFiles, setAnyFiles] = useState<File[]>([]);
  const [text, setText] = useState('');
  // No-AI JSON bulk import — parsed recipe array from the chosen .json file.
  const [jsonRecipes, setJsonRecipes] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const nav = useNavigate();
  const confirmDialog = useConfirm();

  useEffect(() => {
    if (!open) {
      setUrl('');
      setPhotoFiles([]);
      setAnyFiles([]);
      setText('');
      setJsonRecipes(null);
      setError(null);
      setMode('url');
    }
  }, [open]);

  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [loading]);

  // Cheap word count — splits on whitespace, ignores empty tokens.
  // Used as a visual cue on the Text tab so the user knows they're
  // within the backend's 10k char ceiling.
  const wordCount = useMemo(
    () => (text.trim() ? text.trim().split(/\s+/).length : 0),
    [text],
  );
  const charsOver = Math.max(0, text.length - TEXT_MAX);

  // Picnic .eml import (no AI). One file → navigate to the created recipe, or a
  // "schon vorhanden" confirm on a duplicate. Several → a batch summary.
  const submitEml = async (files: File[], force = false) => {
    setError(null);
    setLoading(true);
    let r;
    try {
      r = await RecipesApi.importEmail(files, force);
    } catch (e) {
      setError(getApiError(e, 'Import fehlgeschlagen'));
      setLoading(false);
      return;
    }
    if (files.length > 1) {
      setLoading(false);
      invalidateOverview('recipes');
      onClose();
      toast.success(
        `${r.imported} importiert · ${r.duplicates} Duplikat(e) übersprungen · ${
          r.unrecognized + r.errors
        } nicht erkannt`,
      );
      return;
    }
    const res = r.results[0];
    if (res?.status === 'created' && res.recipe_id) {
      setLoading(false);
      invalidateOverview('recipes');
      onClose();
      toast.success(`„${res.title}" importiert`);
      nav(`/recipes/${res.recipe_id}`);
    } else if (res?.status === 'duplicate') {
      setLoading(false);
      const yes = await confirmDialog({
        title: `„${res.title}" ist schon in deinen Rezepten.`,
        message: 'Trotzdem importieren?',
        confirmLabel: 'Trotzdem importieren',
      });
      if (yes) await submitEml(files, true);
    } else {
      setLoading(false);
      setError(`${res?.message ?? 'Nicht erkannt.'} Tipp: Versuch den Text-Tab.`);
    }
  };

  const trySubmit = async () => {
    setError(null);
    if (mode === 'json') {
      if (!jsonRecipes || jsonRecipes.length === 0) {
        setError('Bitte eine JSON-Datei mit Rezepten wählen');
        return;
      }
      setLoading(true);
      try {
        const r = await RecipesApi.bulkImport(jsonRecipes);
        invalidateOverview('recipes');
        onClose();
        toast.success(
          `${r.imported} ${r.imported === 1 ? 'Rezept' : 'Rezepte'} importiert`,
        );
      } catch (e) {
        // 422 from the backend names the offending recipe index.
        setError(getApiError(e, 'Import fehlgeschlagen'));
      } finally {
        setLoading(false);
      }
      return;
    }
    if (mode === 'file') {
      if (anyFiles.length === 0) {
        setError('Bitte eine Datei auswählen');
        return;
      }
      const isEml = (f: File) =>
        f.name.toLowerCase().endsWith('.eml') || f.type === 'message/rfc822';
      const eml = anyFiles.filter(isEml);
      const other = anyFiles.filter((f) => !isEml(f));
      if (eml.length > 0) {
        await submitEml(eml);
        return;
      }
      if (other.length > 1) {
        setError('Mehrere Dateien gleichzeitig werden nur für .eml unterstützt.');
        return;
      }
      // Single non-.eml → existing AI import (HTML / PDF / image).
      setLoading(true);
      try {
        const data = await RecipesApi.importFromFile(other[0]);
        onClose();
        nav('/recipes/new', { state: { prefill: data } });
      } catch (e) {
        setError(getApiError(e, 'Import fehlgeschlagen'));
      } finally {
        setLoading(false);
      }
      return;
    }
    if (mode === 'url' && !url.trim()) {
      setError('Bitte eine URL eingeben');
      return;
    }
    if (mode === 'photo' && photoFiles.length === 0) {
      setError('Bitte mindestens ein Bild auswählen');
      return;
    }
    if (mode === 'text' && !text.trim()) {
      setError('Kein Text eingegeben');
      return;
    }
    setLoading(true);
    try {
      const data =
        mode === 'url'
          ? await RecipesApi.importFromUrl(url.trim())
          : mode === 'photo'
            ? // One photo → the direct single-image extractor; several → the
              // OCR-each-then-merge endpoint.
              photoFiles.length === 1
              ? await RecipesApi.importFromPhoto(photoFiles[0])
              : await RecipesApi.importFromPhotos(photoFiles)
            : await RecipesApi.importFromText(text.trim().slice(0, TEXT_MAX));
      onClose();
      nav('/recipes/new', { state: { prefill: data } });
    } catch (e) {
      setError(getApiError(e, 'Import fehlgeschlagen'));
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void trySubmit();
  };

  // Parse the chosen .json locally — accepts { "recipes": [...] } or a bare
  // array — and stash the recipe list so the button can show the count.
  const onJsonFile = async (f: File | null) => {
    setJsonRecipes(null);
    setError(null);
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text());
      const recipes = Array.isArray(parsed) ? parsed : parsed?.recipes;
      if (!Array.isArray(recipes) || recipes.length === 0) {
        setError('Keine Rezepte gefunden — erwartet { "recipes": [...] } oder ein Array.');
        return;
      }
      setJsonRecipes(recipes);
    } catch {
      setError('Die Datei ist kein gültiges JSON.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={loading ? () => {} : onClose}
      title="Rezept importieren"
      className="max-w-lg"
    >
      <div className="space-y-4">
        {/* Tabs */}
        <div className="grid grid-cols-5 gap-1 bg-surface border border-line rounded-xl p-1">
          {([
            ['url', 'URL', Link2],
            ['photo', 'Foto', ImagePlus],
            ['file', 'Datei', FileIcon],
            ['text', 'Text', FileText],
            ['json', 'JSON', FileJson],
          ] as const).map(([m, label, Icon]) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              disabled={loading}
              className={`flex flex-col sm:flex-row items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-sm font-medium transition ${
                mode === m
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-muted hover:bg-page'
              }`}
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {mode === 'url' && (
            <>
              <p className="text-sm text-muted">
                Füge die URL einer Rezept-Webseite ein. Die KI extrahiert
                Titel, Zutaten und Schritte.
              </p>
              <div>
                <label className="label">URL</label>
                <input
                  type="url"
                  className="input"
                  placeholder="https://…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={loading}
                  autoFocus
                  required
                />
              </div>
            </>
          )}

          {mode === 'photo' && (
            <>
              <p className="text-sm text-muted">
                Lade ein oder mehrere Fotos eines Rezepts hoch (z.B. mehrere
                Seiten aus einem Kochbuch). Die KI liest jedes Foto und baut
                daraus ein Rezept. Bis {MAX_PHOTOS} Fotos, je max. 10 MB,
                JPG/PNG/WebP.
              </p>
              <div>
                <label className="label">Bilder</label>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="block w-full text-sm text-muted file:mr-3 file:py-2 file:px-4 file:rounded-ctl file:border file:border-line file:text-sm file:font-medium file:bg-surface file:text-ink hover:file:bg-page"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []);
                    if (picked.length > MAX_PHOTOS) {
                      setError(`Maximal ${MAX_PHOTOS} Fotos — es werden die ersten ${MAX_PHOTOS} verwendet.`);
                    }
                    setPhotoFiles(picked.slice(0, MAX_PHOTOS));
                  }}
                  disabled={loading}
                  required
                />
                {photoFiles.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {photoFiles.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="text-xs text-muted flex items-center justify-between gap-2">
                        <span className="truncate">{f.name}</span>
                        <span className="shrink-0 tabular-nums">{(f.size / 1024 / 1024).toFixed(2)} MB</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {mode === 'file' && (
            <DropZone
              files={anyFiles}
              onFiles={setAnyFiles}
              disabled={loading}
              inputRef={fileInputRef}
            />
          )}

          {mode === 'text' && (
            <TextZone
              value={text}
              onChange={setText}
              disabled={loading}
              wordCount={wordCount}
              charsOver={charsOver}
              max={TEXT_MAX}
              textRef={textRef}
            />
          )}

          {mode === 'json' && (
            <div>
              <p className="text-sm text-muted mb-2">
                Importiere eine JSON-Datei mit bereits strukturierten Rezepten —
                <span className="font-medium"> ohne KI</span>, direkt in die
                Datenbank. Erwartet {'{ "recipes": […] }'} oder ein Array von
                Rezepten.
              </p>
              <input
                type="file"
                accept="application/json,.json"
                className="block w-full text-sm text-muted file:mr-3 file:py-2 file:px-4 file:rounded-ctl file:border file:border-line file:text-sm file:font-medium file:bg-surface file:text-ink hover:file:bg-page"
                onChange={(e) => void onJsonFile(e.target.files?.[0] ?? null)}
                disabled={loading}
              />
              {jsonRecipes && (
                <p className="mt-2 text-sm text-brand-700">
                  {jsonRecipes.length}{' '}
                  {jsonRecipes.length === 1 ? 'Rezept' : 'Rezepte'} gefunden — bereit zum Import.
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="text-sm text-danger bg-danger-50 border border-danger/30 rounded-lg p-3">
              {error}
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-3 bg-brand-50 text-brand-700 rounded-lg p-3 text-sm">
              <span
                className="size-4 rounded-full border-2 border-brand-700 border-t-transparent animate-spin shrink-0"
                aria-hidden
              />
              <span className="flex-1">
                {mode === 'photo'
                  ? 'KI liest die Fotos… je nach Modell und Anzahl Fotos mehrere Minuten (ein kleineres Vision-Modell wie minicpm-v ist deutlich schneller).'
                  : mode === 'json'
                    ? 'Importiere Rezepte… (ohne KI, geht schnell)'
                    : 'KI analysiert Rezept… (je nach Hardware bis zu 1–2 Minuten)'}
              </span>
              <span className="tabular-nums font-mono text-brand-700/70 shrink-0">
                {fmtElapsed(elapsed)}
              </span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={loading}
            >
              Abbrechen
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={
                loading ||
                (mode === 'url' && !url.trim()) ||
                (mode === 'photo' && photoFiles.length === 0) ||
                (mode === 'file' && anyFiles.length === 0) ||
                (mode === 'text' && !text.trim()) ||
                (mode === 'json' && (!jsonRecipes || jsonRecipes.length === 0))
              }
            >
              {loading ? 'Importieren…' : 'Importieren'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Datei tab — combined dropzone (HTML / PDF / image)
// ---------------------------------------------------------------------------

const FILE_ACCEPT =
  'image/jpeg,image/png,image/webp,text/html,application/pdf,message/rfc822,.html,.htm,.pdf,.jpg,.jpeg,.png,.webp,.eml';

function DropZone({
  files,
  onFiles,
  disabled,
  inputRef,
}: {
  files: File[];
  onFiles: (f: File[]) => void;
  disabled: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <>
      <p className="text-sm text-muted">
        Ziehe Dateien hier rein oder klicke, um auszuwählen. Eine Datei (HTML /
        PDF / Bild) wird per KI ausgelesen; <span className="font-medium">.eml</span>
        {' '}von Picnic werden direkt (ohne KI) importiert — auch mehrere auf einmal.
      </p>
      <label
        className={`block border-2 border-dashed rounded-ctl p-6 text-center cursor-pointer transition ${
          dragOver
            ? 'border-brand bg-brand-50/40'
            : 'border-line hover:border-brand/50 hover:bg-page'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (disabled) return;
          const dropped = Array.from(e.dataTransfer.files ?? []);
          if (dropped.length) onFiles(dropped);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={FILE_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => onFiles(Array.from(e.target.files ?? []))}
          disabled={disabled}
        />
        <FileIcon size={20} className="mx-auto text-muted mb-1.5" />
        {files.length > 0 ? (
          <ul className="text-sm text-ink space-y-0.5">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2">
                <span className="truncate">{f.name}</span>
                <span className="shrink-0 text-xs text-muted tabular-nums">
                  {(f.size / 1024 / 1024).toFixed(2)} MB
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <div className="text-sm text-ink">Datei auswählen</div>
            <div className="text-xs text-muted mt-1">
              HTML, PDF, EML, JPG, PNG, WebP – max 10 MB
            </div>
          </>
        )}
      </label>
    </>
  );
}

// ---------------------------------------------------------------------------
// Text tab — paste-as-plain + drag-text-in
// ---------------------------------------------------------------------------

function TextZone({
  value,
  onChange,
  disabled,
  wordCount,
  charsOver,
  max,
  textRef,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  wordCount: number;
  charsOver: number;
  max: number;
  textRef: React.RefObject<HTMLTextAreaElement>;
}) {
  return (
    <div>
      <p className="text-sm text-muted mb-2">
        Schreibe oder füge ein Rezept ein — egal wie unordentlich, die KI
        bringt es in Form.
      </p>
      <textarea
        ref={textRef}
        className="input min-h-[200px] text-sm font-mono"
        placeholder='z. B. "Spaghetti carbonara: 400g pasta, 200g speck in würfeln, 4 eier mit 100g parmesan verquirlen, …"'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        autoCapitalize="sentences"
        autoCorrect="on"
        spellCheck
        // Paste handler — strip formatting so HTML-clipboard pastes
        // don't fill the textarea with tag soup. Plain-text paste is
        // already the browser default; we only intervene when the
        // user copied from a rich-text source.
        onPaste={(e) => {
          const dt = e.clipboardData;
          if (!dt) return;
          // If both HTML and plain text are present, prefer plain.
          // text/plain is always available in modern browsers; we
          // explicitly read it and replace the selection so the HTML
          // half never reaches the textarea.
          const plain = dt.getData('text/plain');
          if (plain) {
            e.preventDefault();
            const ta = e.currentTarget;
            const start = ta.selectionStart ?? value.length;
            const end = ta.selectionEnd ?? value.length;
            const next = value.slice(0, start) + plain + value.slice(end);
            onChange(next);
            // Restore cursor position past the pasted text.
            requestAnimationFrame(() => {
              ta.selectionStart = ta.selectionEnd = start + plain.length;
            });
          }
        }}
        // Drag-and-drop: accept plain text drops (a selection dragged
        // from another app). File drops are intentionally NOT
        // handled here — those go to the Datei tab.
        onDragOver={(e) => {
          // Required for the drop event to fire. We don't paint a
          // hover state here because the textarea has its own
          // native focus styling.
          if (e.dataTransfer.types.includes('text/plain')) {
            e.preventDefault();
          }
        }}
        onDrop={(e) => {
          const t = e.dataTransfer.getData('text/plain');
          if (!t) return;
          e.preventDefault();
          onChange(value + (value && !value.endsWith('\n') ? '\n' : '') + t);
        }}
      />
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted/80">
        <span className="tabular-nums">
          {wordCount} {wordCount === 1 ? 'Wort' : 'Wörter'} ·{' '}
          {value.length.toLocaleString('de-DE')} Zeichen
        </span>
        {charsOver > 0 && (
          <span className="text-danger">
            {charsOver.toLocaleString('de-DE')} über{' '}
            {max.toLocaleString('de-DE')} — wird gekürzt
          </span>
        )}
      </div>
    </div>
  );
}
