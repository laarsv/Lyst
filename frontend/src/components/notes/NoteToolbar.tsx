/** Compact icon-only markdown toolbar.
 *
 *  Operates directly on the textarea selection — wraps it with a prefix/
 *  suffix (Bold/Italic), inserts at the cursor (Link/Image/Table), or
 *  prepends per line (List, Quote, Heading). Knowing nothing about which
 *  layout is hosting it, just `getTextarea`, `content`, `setContent`. */
import { useState } from 'react';
import {
  Bold,
  Code,
  FileCode,
  HelpCircle,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Strikethrough,
  Table as TableIcon,
  type LucideIcon,
} from 'lucide-react';

interface Props {
  content: string;
  setContent: (next: string) => void;
  getTextarea: () => HTMLTextAreaElement | null;
  /** Layout hint — controls visual presentation. */
  variant?: 'desktop' | 'mobile';
  className?: string;
}

interface Action {
  key: string;
  label: string;
  icon: LucideIcon;
  apply: (ctx: ApplyCtx) => Patch;
}

interface ApplyCtx {
  before: string;
  selection: string;
  after: string;
}

interface Patch {
  /** Replacement for the original `[selection]` slice. */
  replacement: string;
  /** Where to put the cursor *inside* the replacement. Defaults to end. */
  cursorOffset?: number;
  /** When true, leave the existing selection range covering `replacement`
   *  instead of collapsing the cursor. */
  selectReplacement?: boolean;
}

const ACTIONS: Action[] = [
  {
    key: 'bold',
    label: 'Fett',
    icon: Bold,
    apply: ({ selection }) => wrap('**', '**', selection || 'Fett'),
  },
  {
    key: 'italic',
    label: 'Kursiv',
    icon: Italic,
    apply: ({ selection }) => wrap('*', '*', selection || 'kursiv'),
  },
  {
    key: 'strike',
    label: 'Durchgestrichen',
    icon: Strikethrough,
    apply: ({ selection }) => wrap('~~', '~~', selection || 'durchgestrichen'),
  },
  {
    key: 'h2',
    label: 'Überschrift',
    icon: Heading2,
    apply: (ctx) => prefixLines(ctx, '## ', 'Überschrift'),
  },
  {
    key: 'link',
    label: 'Link',
    icon: LinkIcon,
    apply: ({ selection }) => {
      const text = selection || 'Linktext';
      return { replacement: `[${text}](https://)`, cursorOffset: text.length + 3 };
    },
  },
  {
    key: 'quote',
    label: 'Zitat',
    icon: Quote,
    apply: (ctx) => prefixLines(ctx, '> ', 'Zitat'),
  },
  {
    key: 'code',
    label: 'Inline-Code',
    icon: Code,
    apply: ({ selection }) => wrap('`', '`', selection || 'code'),
  },
  {
    key: 'codeblock',
    label: 'Code-Block',
    icon: FileCode,
    apply: ({ selection }) => {
      const body = selection || 'code';
      return { replacement: `\n\`\`\`\n${body}\n\`\`\`\n`, selectReplacement: false };
    },
  },
  {
    key: 'image',
    label: 'Bild',
    icon: ImageIcon,
    apply: ({ selection }) => {
      const alt = selection || 'Bild';
      return { replacement: `![${alt}](https://)`, cursorOffset: alt.length + 4 };
    },
  },
  {
    key: 'table',
    label: 'Tabelle',
    icon: TableIcon,
    apply: () => ({
      replacement:
        '\n| Spalte 1 | Spalte 2 |\n| --- | --- |\n| Zelle | Zelle |\n',
    }),
  },
  {
    key: 'ul',
    label: 'Liste',
    icon: List,
    apply: (ctx) => prefixLines(ctx, '- ', 'Eintrag'),
  },
  {
    key: 'ol',
    label: 'Nummerierte Liste',
    icon: ListOrdered,
    apply: (ctx) => prefixLines(ctx, '1. ', 'Eintrag'),
  },
  {
    key: 'task',
    label: 'Aufgabenliste',
    icon: ListChecks,
    apply: (ctx) => prefixLines(ctx, '- [ ] ', 'Aufgabe'),
  },
];

function wrap(prefix: string, suffix: string, body: string): Patch {
  return {
    replacement: `${prefix}${body}${suffix}`,
    cursorOffset: prefix.length + body.length + suffix.length,
  };
}

/** Prepend `prefix` to every line of the selection. If the selection is empty
 *  we drop in a placeholder so the line still renders something useful. */
function prefixLines(ctx: ApplyCtx, prefix: string, placeholder: string): Patch {
  const body = ctx.selection || placeholder;
  const lines = body.split('\n');
  const prefixed = lines.map((l) => `${prefix}${l}`).join('\n');
  return { replacement: prefixed, selectReplacement: !!ctx.selection };
}

export function NoteToolbar({
  content,
  setContent,
  getTextarea,
  variant = 'desktop',
  className = '',
}: Props) {
  const [helpOpen, setHelpOpen] = useState(false);

  const apply = (action: Action) => {
    const ta = getTextarea();
    if (!ta) return;
    const start = ta.selectionStart ?? content.length;
    const end = ta.selectionEnd ?? start;
    const before = content.slice(0, start);
    const selection = content.slice(start, end);
    const after = content.slice(end);

    const patch = action.apply({ before, selection, after });
    const next = before + patch.replacement + after;
    setContent(next);

    // Restore focus + selection on next paint, after MDEditor's own re-render.
    requestAnimationFrame(() => {
      const ta2 = getTextarea();
      if (!ta2) return;
      ta2.focus();
      if (patch.selectReplacement) {
        ta2.selectionStart = start;
        ta2.selectionEnd = start + patch.replacement.length;
      } else if (patch.cursorOffset !== undefined) {
        const pos = start + patch.cursorOffset;
        ta2.selectionStart = ta2.selectionEnd = pos;
      } else {
        const pos = start + patch.replacement.length;
        ta2.selectionStart = ta2.selectionEnd = pos;
      }
    });
  };

  const isMobile = variant === 'mobile';

  return (
    <>
      <div
        role="toolbar"
        aria-label="Markdown-Werkzeuge"
        className={[
          isMobile
            ? 'flex items-center gap-1 overflow-x-auto px-1 py-1.5 bg-surface border-t border-line shadow-[0_-2px_6px_-3px_rgba(0,0,0,0.1)]'
            : 'flex flex-wrap items-center gap-0.5 px-1 py-1 border border-line rounded-ctl bg-surface',
          className,
        ].join(' ')}
        // Stop the touch from blurring the textarea (which would close the
        // iOS keyboard between every toolbar tap).
        onMouseDown={(e) => e.preventDefault()}
        onTouchStart={(e) => {
          if ((e.target as HTMLElement).closest('button')) e.preventDefault();
        }}
      >
        {ACTIONS.map((action) => (
          <ToolbarButton
            key={action.key}
            label={action.label}
            icon={action.icon}
            onClick={() => apply(action)}
            isMobile={isMobile}
          />
        ))}
        <ToolbarButton
          label="Hilfe"
          icon={HelpCircle}
          onClick={() => setHelpOpen(true)}
          isMobile={isMobile}
        />
      </div>

      {helpOpen && <HelpSheet onClose={() => setHelpOpen(false)} />}
    </>
  );
}

function ToolbarButton({
  label,
  icon: Icon,
  onClick,
  isMobile,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  isMobile: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`shrink-0 inline-flex items-center justify-center rounded-ctl text-muted hover:text-ink hover:bg-page transition ${
        // 44×44 on mobile (iOS minimum tap target), tighter on desktop.
        isMobile ? 'size-11' : 'size-8'
      }`}
    >
      <Icon size={isMobile ? 20 : 16} />
    </button>
  );
}

function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[70] bg-ink/40 flex items-end sm:items-center justify-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full sm:max-w-md bg-surface rounded-t-card sm:rounded-card border border-line p-5 max-h-[85vh] overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Markdown-Spickzettel</h3>
          <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Schließen">
            ✕
          </button>
        </div>
        <dl className="text-sm space-y-2">
          {[
            ['**Fett**', 'Fett'],
            ['*Kursiv*', 'Kursiv'],
            ['~~durch~~', 'Durchgestrichen'],
            ['## Titel', 'Überschrift'],
            ['[Text](url)', 'Link'],
            ['`code`', 'Inline-Code'],
            ['```\\ncode\\n```', 'Code-Block'],
            ['> Zitat', 'Zitat'],
            ['- Eintrag', 'Aufzählung'],
            ['1. Eintrag', 'Nummerierte Liste'],
            ['- [ ] Aufgabe', 'Aufgabenliste'],
            ['[[Notiz-Titel]]', 'Andere Notiz verlinken'],
          ].map(([syntax, label]) => (
            <div key={syntax} className="flex items-baseline gap-3">
              <code className="text-xs bg-page px-2 py-0.5 rounded font-mono shrink-0">{syntax}</code>
              <span className="text-muted">{label}</span>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
