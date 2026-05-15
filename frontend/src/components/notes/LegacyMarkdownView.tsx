/** Read-only fallback for notes still flagged as `content_format=MARKDOWN`.
 *
 *  After the one-shot migration script has run on production, every
 *  note flips to HTML and this component becomes dead code (delete it
 *  alongside the `content_format` column in the next release). It exists
 *  to handle the transitional window where:
 *
 *    1. Backend migration 0016 has run (column added, existing rows = MARKDOWN)
 *    2. But `scripts/migrate_notes_to_html.py` hasn't run yet
 *
 *  …or where an operator manually flipped a single row back to MARKDOWN
 *  to recover from a bad conversion (per the rollback note in the
 *  migration script header).
 *
 *  The view is intentionally read-only — TipTap is the only writer
 *  going forward. The banner nudges the operator to run the migration. */
import { useMemo } from 'react';
import MarkdownIt from 'markdown-it';
import { AlertTriangle } from 'lucide-react';

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

interface Props {
  source: string;
  onOpenByTitle?: (title: string) => void;
}

export function LegacyMarkdownView({ source, onOpenByTitle }: Props) {
  // Replace `[[Title]]` with anchor tags BEFORE markdown renders so the
  // tokenizer treats them as inline HTML — we then attach click handlers
  // via a single document listener inside the render container below.
  const html = useMemo(() => {
    const stashed = source.replace(
      /\[\[([^\]\n]+)\]\]/g,
      (_, title: string) =>
        `<a href="#" data-legacy-wikilink="${escapeAttr(title.trim())}">${escapeText(title.trim())}</a>`,
    );
    return md.render(stashed);
  }, [source]);

  return (
    <div className="relative">
      <div className="rounded-card border border-yellow-300 bg-yellow-50 text-yellow-900 px-3 py-2 text-xs mb-3 flex items-start gap-2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <div>
          Diese Notiz wartet auf die Markdown-Konvertierung.
          Sie wird nur lesbar angezeigt, bis das Migrationsskript läuft
          (<code className="font-mono">python -m scripts.migrate_notes_to_html</code>).
        </div>
      </div>
      <div
        className="legacy-markdown-view"
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={(e) => {
          // Delegate wikilink clicks. Anchor was emitted by the stash
          // step above, never by the user's markdown source.
          const target = e.target as HTMLElement | null;
          const a = target?.closest('a[data-legacy-wikilink]') as HTMLAnchorElement | null;
          if (!a) return;
          e.preventDefault();
          const title = a.getAttribute('data-legacy-wikilink') ?? '';
          if (title && onOpenByTitle) onOpenByTitle(title);
        }}
      />
    </div>
  );
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
