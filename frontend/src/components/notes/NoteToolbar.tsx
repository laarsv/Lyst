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
  /** Full content before the selection. */
  before: string;
  /** Selected slice — empty string when caret is collapsed. */
  selection: string;
  /** Full content after the selection. */
  after: string;
  /** Absolute index of selection start in the full content (= before.length). */
  selectionStart: number;
}

interface Patch {
  /** Slice of the full content to replace, expressed as absolute indices.
   *  Defaults to the original selection range. Used by line-prefix actions
   *  that need to widen the replacement to start at the line boundary. */
  rangeStart?: number;
  rangeEnd?: number;
  /** Text to splice in. */
  replacement: string;
  /** Where to put the cursor *inside* the replacement. Defaults to end. */
  cursorOffset?: number;
  /** When true, leave the existing selection range covering `replacement`
   *  (handy for line-prefix on a multi-line selection). */
  selectReplacement?: boolean;
}

const ACTIONS: Action[] = [
  {
    key: 'bold',
    label: 'Fett',
    icon: Bold,
    apply: ({ selection }) => wrap('**', '**', selection),
  },
  {
    key: 'italic',
    label: 'Kursiv',
    icon: Italic,
    apply: ({ selection }) => wrap('*', '*', selection),
  },
  {
    key: 'strike',
    label: 'Durchgestrichen',
    icon: Strikethrough,
    apply: ({ selection }) => wrap('~~', '~~', selection),
  },
  {
    key: 'h2',
    label: 'Überschrift',
    icon: Heading2,
    apply: (ctx) => linePrefix(ctx, '## '),
  },
  {
    key: 'link',
    label: 'Link',
    icon: LinkIcon,
    apply: ({ selection }) =>
      selection
        ? // Selection becomes the link text; cursor jumps inside the URL parens.
          { replacement: `[${selection}]()`, cursorOffset: selection.length + 3 }
        : // No selection: empty `[]()`, cursor inside the brackets.
          { replacement: '[]()', cursorOffset: 1 },
  },
  {
    key: 'quote',
    label: 'Zitat',
    icon: Quote,
    apply: (ctx) => linePrefix(ctx, '> '),
  },
  {
    key: 'code',
    label: 'Inline-Code',
    icon: Code,
    apply: ({ selection }) => wrap('`', '`', selection),
  },
  {
    key: 'codeblock',
    label: 'Code-Block',
    icon: FileCode,
    apply: ({ selection }) => {
      // Empty: \n```\n\n```\n — cursor on the blank line between fences.
      // With selection: wrap it inside the fences, cursor at end.
      if (!selection) {
        return { replacement: '\n```\n\n```\n', cursorOffset: 5 };
      }
      return { replacement: `\n\`\`\`\n${selection}\n\`\`\`\n` };
    },
  },
  {
    key: 'image',
    label: 'Bild',
    icon: ImageIcon,
    apply: ({ selection }) =>
      selection
        ? { replacement: `![${selection}]()`, cursorOffset: 2 + selection.length + 2 }
        : // No selection: '![]()' — cursor inside the alt-text brackets.
          { replacement: '![]()', cursorOffset: 2 },
  },
  {
    key: 'table',
    label: 'Tabelle',
    icon: TableIcon,
    apply: () => ({
      // Empty cells, valid GFM table. Cursor lands in the first header cell
      // so the user can start typing immediately.
      replacement: '\n|  |  |\n| --- | --- |\n|  |  |\n',
      cursorOffset: 3, // after "\n| "
    }),
  },
  {
    key: 'ul',
    label: 'Liste',
    icon: List,
    apply: (ctx) => linePrefix(ctx, '- '),
  },
  {
    key: 'ol',
    label: 'Nummerierte Liste',
    icon: ListOrdered,
    apply: (ctx) => linePrefix(ctx, '1. '),
  },
  {
    key: 'task',
    label: 'Aufgabenliste',
    icon: ListChecks,
    apply: (ctx) => linePrefix(ctx, '- [ ] '),
  },
];

/** Wrap selection (or insert empty wrapper) with prefix/suffix.
 *  Empty selection → cursor sits between the markers.
 *  Non-empty       → cursor sits at the end of the wrapped block. */
function wrap(prefix: string, suffix: string, selection: string): Patch {
  if (!selection) {
    return { replacement: `${prefix}${suffix}`, cursorOffset: prefix.length };
  }
  return {
    replacement: `${prefix}${selection}${suffix}`,
    cursorOffset: prefix.length + selection.length + suffix.length,
  };
}

/** Line-oriented prefix (heading / quote / list).
 *
 *  Empty selection: insert `prefix` at the start of the current line, place
 *  cursor right after the prefix so the user can type the heading text.
 *
 *  Non-empty selection: prepend `prefix` to every line in the selection,
 *  keep the (now-prefixed) range selected. */
function linePrefix(ctx: ApplyCtx, prefix: string): Patch {
  if (!ctx.selection) {
    // Find the start of the current line (the char after the last \n before
    // the cursor, or 0 if no newline yet).
    const lineStart = ctx.before.lastIndexOf('\n') + 1;
    return {
      rangeStart: lineStart,
      rangeEnd: ctx.selectionStart,
      // Re-emit the line's existing content (between lineStart and cursor)
      // and prepend the prefix.
      replacement: prefix + ctx.before.slice(lineStart),
      cursorOffset: prefix.length + (ctx.selectionStart - lineStart),
    };
  }
  const lines = ctx.selection.split('\n');
  const prefixed = lines.map((l) => `${prefix}${l}`).join('\n');
  return { replacement: prefixed, selectReplacement: true };
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
    const selStart = ta.selectionStart ?? content.length;
    const selEnd = ta.selectionEnd ?? selStart;
    const before = content.slice(0, selStart);
    const selection = content.slice(selStart, selEnd);
    const after = content.slice(selEnd);

    const patch = action.apply({ before, selection, after, selectionStart: selStart });

    // Line-prefix actions (heading, list, …) widen the replaced range to the
    // start of the current line. Other actions just replace the selection.
    const replaceStart = patch.rangeStart ?? selStart;
    const replaceEnd = patch.rangeEnd ?? selEnd;
    const next =
      content.slice(0, replaceStart) + patch.replacement + content.slice(replaceEnd);
    setContent(next);

    // Restore focus + selection on next paint, after MDEditor's own re-render.
    requestAnimationFrame(() => {
      const ta2 = getTextarea();
      if (!ta2) return;
      ta2.focus();
      if (patch.selectReplacement) {
        ta2.selectionStart = replaceStart;
        ta2.selectionEnd = replaceStart + patch.replacement.length;
      } else if (patch.cursorOffset !== undefined) {
        const pos = replaceStart + patch.cursorOffset;
        ta2.selectionStart = ta2.selectionEnd = pos;
      } else {
        const pos = replaceStart + patch.replacement.length;
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
