/** TipTap-based WYSIWYG note editor.
 *
 *  Replaces MDEditor + NoteToolbar. Users never see Markdown syntax: they
 *  type into a contenteditable, the toolbar applies marks/nodes directly
 *  (`chain().focus().toggleBold().run()`), and active state on each
 *  button reflects `editor.isActive('bold')` etc.
 *
 *  Wired extensions:
 *    StarterKit       — paragraphs, headings, lists, blockquote, code,
 *                       code blocks, hard break, history, basic marks.
 *    Link             — explicit, opens an inline dialog for href + text.
 *    Image            — `setImage({src})` after a multipart upload to
 *                       /notes/{id}/images.
 *    Table (+ row/cell/header) — insert 3x3, then native TipTap UI.
 *    TaskList/TaskItem — GFM `- [ ]` style with a real checkbox.
 *    Placeholder      — gray hint when the doc is empty.
 *    Wikilink         — custom @-triggered note-link extension.
 *
 *  Read-only mode flips `editable=false`. Clicks on wikilinks then route
 *  via `onNavigate` (the host resolves the title to a note id).
 *
 *  Storage: parent owns the HTML string. We push edits up via onChange
 *  on every transaction; the parent decides whether to debounce/autosave.
 *  The bleach allowlist on the backend matches the markup the editor
 *  emits, so a round-trip through save+reload is lossless.
 */
import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { Editor, EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import CharacterCount from '@tiptap/extension-character-count';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import { ReactRenderer } from '@tiptap/react';
import { computePosition, flip, offset, shift } from '@floating-ui/dom';
import { lowlight } from '@/lib/lowlight';
import { TableFloatingMenu } from './TableFloatingMenu';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  FileCode,
  Heading2,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Minus as HorizontalRuleIcon,
  Palette,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  Underline as UnderlineIcon,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import Wikilink from './WikilinkExtension';
import { SearchApi, type NoteTitleResult } from '@/api/endpoints';
import { toast } from '@/components/Toast';
import { api, getApiError } from '@/api/client';

export interface NoteEditorRef {
  editor: Editor | null;
}

interface Props {
  /** Current note HTML. Stable identity across edits — parent owns
   *  the string and replaces it on initial load / version restore. */
  content: string;
  /** Re-keyed on note id changes by the parent so a fresh editor mounts
   *  per note. Avoids stale undo-history bleeding between notes. */
  noteId: number;
  /** Read-only when false. The toolbar isn't rendered and the editor
   *  becomes non-editable; clicks on wikilinks navigate via onNavigate. */
  editable?: boolean;
  placeholder?: string;
  /** Fires on every editor transaction. Emits the serialized HTML. */
  onChange?: (html: string) => void;
  /** Click handler for wikilinks in read-only mode. No-op in edit mode. */
  onNavigate?: (title: string) => void;
  /** Hide the toolbar even when editable (used by VersionHistoryPanel
   *  for read-only diff previews). Defaults to editable. */
  showToolbar?: boolean;
  className?: string;
  /** Bottom padding for the editor container — used by mobile to clear
   *  the floating toolbar / keyboard. */
  contentPaddingBottom?: number;
}

export const NoteEditor = forwardRef<NoteEditorRef, Props>(function NoteEditor(
  {
    content,
    noteId,
    editable = true,
    placeholder = 'Inhalt… Tippe @ um eine andere Notiz zu verlinken.',
    onChange,
    onNavigate,
    showToolbar,
    className,
    contentPaddingBottom,
  },
  ref,
) {
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          // Disable the plain code-block — we swap in the lowlight variant
          // below so triple-backtick fences pick up syntax highlighting.
          codeBlock: false,
          // HorizontalRule lives in StarterKit; we add a toolbar button
          // for it below. No config change needed here.
        }),
        CodeBlockLowlight.configure({
          lowlight,
          defaultLanguage: null,
          HTMLAttributes: { class: 'note-codeblock' },
        }),
        Underline,
        TextStyle,
        // Color depends on TextStyle (it stores `color` as a CSS prop on
        // a <span style="color:…">). Toolbar button drives setColor /
        // unsetColor; renderer picks up the inline style.
        Color.configure({ types: ['textStyle'] }),
        Highlight.configure({
          multicolor: true,
          HTMLAttributes: { class: 'note-highlight' },
        }),
        TextAlign.configure({
          types: ['paragraph', 'heading'],
          // Default alignment is 'left' — we don't store that on the
          // node to keep HTML clean. Center / right serialise as
          // `style="text-align:…"`.
          defaultAlignment: 'left',
        }),
        CharacterCount.configure({}),
        Link.configure({
          openOnClick: false, // we handle clicks ourselves below
          autolink: true,
          HTMLAttributes: {
            rel: 'noopener noreferrer',
            target: '_blank',
            class: 'note-link',
          },
        }),
        Image.configure({
          inline: false,
          allowBase64: false,
          HTMLAttributes: { class: 'note-image' },
        }),
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        TaskList.configure({
          HTMLAttributes: { class: 'note-tasklist' },
        }),
        TaskItem.configure({
          nested: true,
          HTMLAttributes: { class: 'note-taskitem' },
        }),
        Placeholder.configure({
          placeholder,
          showOnlyWhenEditable: true,
        }),
        Wikilink.configure({
          suggestion: createWikilinkSuggestion(),
        }),
      ],
      content: content || '',
      editable,
      editorProps: {
        attributes: {
          // The editor surface itself. `prose` + custom resets give it a
          // typographic feel without bringing in @tailwindcss/typography.
          class:
            'note-editor-surface outline-none focus:outline-none min-h-[400px] max-w-none',
          spellcheck: 'true',
          autocapitalize: 'sentences',
          autocorrect: 'on',
        },
        // Click handler: in read-only mode, jump to the wikilink target.
        handleClickOn: (_view, _pos, node, _parent, event) => {
          if (node.type.name !== 'wikilink') return false;
          if (editable) return false; // editing — let the cursor land in the span
          const title = node.attrs.title as string;
          if (title && onNavigateRef.current) {
            event.preventDefault();
            onNavigateRef.current(title);
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor: ed }) => {
        if (!onChange) return;
        onChange(ed.getHTML());
      },
    },
    // Re-build the editor when switching notes so undo history doesn't
    // bleed across them. Toggling editable also needs a rebuild —
    // TipTap's setEditable runtime call works but doesn't reliably clear
    // the contenteditable attribute on every browser version.
    [noteId, editable],
  );

  // External content updates (e.g. version restore): syncthe editor
  // when the parent prop changes BUT only when it differs from the
  // current doc — otherwise we'd loop with our own onChange.
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (current === content) return;
    editor.commands.setContent(content || '', false);
  }, [content, editor]);

  // Expose the editor instance via the imperative ref so the parent can
  // call commands (e.g. focus on mount).
  useImperativeHandle(ref, () => ({ editor: editor ?? null }), [editor]);

  return (
    <div className={`note-editor-root flex flex-col ${className ?? ''}`}>
      {editable && (showToolbar ?? true) && editor && (
        <NoteEditorToolbar editor={editor} noteId={noteId} />
      )}
      <div
        className="note-editor-content flex-1 overflow-y-auto"
        style={
          contentPaddingBottom !== undefined
            ? { paddingBottom: contentPaddingBottom }
            : undefined
        }
      >
        <EditorContent editor={editor} />
      </div>
      {/* Word / character counter. Read-only views hide it because
          someone reading a shared note doesn't need editing telemetry. */}
      {editable && editor && <CharacterCountFooter editor={editor} />}
      {/* Table row/column commands. Only renders when the editor's
          selection is inside a table cell. Read-only editors never see
          this — there's nothing to edit. */}
      {editable && editor && <TableFloatingMenu editor={editor} />}
    </div>
  );
});

function CharacterCountFooter({ editor }: { editor: Editor }) {
  // Subscribe just to the counts — re-renders this small footer on every
  // doc change without pulling the whole toolbar in.
  const { words, chars } = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      words: ed.storage.characterCount?.words() ?? 0,
      chars: ed.storage.characterCount?.characters() ?? 0,
    }),
  });
  return (
    <div className="note-editor-counter text-xs text-muted/80 px-2 pt-1 pb-0.5 text-right tabular-nums select-none">
      {/* Mobile (≤480px) hides the character total to save vertical
          space — the dot separator collapses with it via :before. */}
      <span className="hidden sm:inline">
        {chars.toLocaleString('de-DE')} Zeichen ·{' '}
      </span>
      <span>{words.toLocaleString('de-DE')} Wörter</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar (grouped)
// ---------------------------------------------------------------------------
//
// Buttons are organised into 7 semantic groups separated by thin vertical
// dividers. Order is the same on desktop and mobile; the row uses flex-
// wrap, so on narrow viewports later groups drop to a second/third line
// rather than scrolling horizontally — the most-used buttons (style,
// color, structure) stay on the first line at ≥360px.
//
//   1. Text style: Bold · Italic · Underline · Strikethrough
//   2. Color:      Text color · Highlight
//   3. Structure:  Heading · Quote · Horizontal rule
//   4. Lists:      Bullet · Ordered · Task list
//   5. Insert:     Link · Code · Code block · Image · Table
//   6. Alignment:  Left · Center · Right
//   7. History:    Undo · Redo

interface ToolbarBtnConfig {
  key: string;
  label: string;
  icon: LucideIcon;
  command: (editor: Editor) => void;
  isActive?: (editor: Editor) => boolean;
  isDisabled?: (editor: Editor) => boolean;
}

/** Curated text-colour palette. Each entry maps a user-readable label
 *  to the CSS colour the Color extension sets via setColor. `null`
 *  means "remove colour" (unsetColor). Greyscale + 6 hues. Sized to
 *  read against both light and dark surfaces. */
const TEXT_COLORS: { label: string; value: string | null }[] = [
  { label: 'Standard', value: null },
  { label: 'Schwarz', value: '#111111' },
  { label: 'Grau', value: '#6B7280' },
  { label: 'Rot', value: '#DC2626' },
  { label: 'Orange', value: '#EA580C' },
  { label: 'Gelb', value: '#CA8A04' },
  { label: 'Grün', value: '#16A34A' },
  { label: 'Blau', value: '#2563EB' },
  { label: 'Lila', value: '#7C3AED' },
];

/** Highlight palette — semi-transparent fills so dark-mode text stays
 *  legible. The Highlight extension stores `color` as a raw CSS string;
 *  using `rgb(... / α)` keeps the same swatch shape for picker + render. */
const HIGHLIGHT_COLORS: { label: string; value: string | null }[] = [
  { label: 'Standard', value: null },
  { label: 'Gelb', value: 'rgb(254 240 138 / 0.6)' },
  { label: 'Grün', value: 'rgb(187 247 208 / 0.6)' },
  { label: 'Blau', value: 'rgb(191 219 254 / 0.6)' },
  { label: 'Pink', value: 'rgb(252 165 165 / 0.55)' },
  { label: 'Orange', value: 'rgb(253 186 116 / 0.6)' },
];

function NoteEditorToolbar({ editor, noteId }: { editor: Editor; noteId: number }) {
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [highlightOpen, setHighlightOpen] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Subscribe to editor state so isActive() / can() re-evaluate on every
  // selection change without re-rendering the parent.
  const flags = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      bold: ed.isActive('bold'),
      italic: ed.isActive('italic'),
      underline: ed.isActive('underline'),
      strike: ed.isActive('strike'),
      heading: ed.isActive('heading', { level: 2 }),
      blockquote: ed.isActive('blockquote'),
      link: ed.isActive('link'),
      code: ed.isActive('code'),
      codeBlock: ed.isActive('codeBlock'),
      ul: ed.isActive('bulletList'),
      ol: ed.isActive('orderedList'),
      task: ed.isActive('taskList'),
      alignLeft: ed.isActive({ textAlign: 'left' }) || (!ed.isActive({ textAlign: 'center' }) && !ed.isActive({ textAlign: 'right' })),
      alignCenter: ed.isActive({ textAlign: 'center' }),
      alignRight: ed.isActive({ textAlign: 'right' }),
      color: (ed.getAttributes('textStyle')?.color as string | undefined) ?? null,
      highlight: (ed.getAttributes('highlight')?.color as string | undefined) ?? null,
      canUndo: ed.can().chain().focus().undo().run(),
      canRedo: ed.can().chain().focus().redo().run(),
    }),
  });

  const onPickImage = async (file: File) => {
    setUploadingImage(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await api.post<{ data: { url: string } }>(
        `/notes/${noteId}/images`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      const url = r.data.data.url;
      editor.chain().focus().setImage({ src: url, alt: file.name }).run();
    } catch (e) {
      toast.error(getApiError(e));
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Convenience helpers — each group is rendered inline below to keep
  // the structure visible at a glance.
  const btn = (cfg: {
    key: string;
    label: string;
    icon: LucideIcon;
    active?: boolean;
    disabled?: boolean;
    onClick: () => void;
    spinning?: boolean;
  }) => (
    <ToolbarButton
      key={cfg.key}
      label={cfg.label}
      icon={cfg.icon}
      active={!!cfg.active}
      disabled={!!cfg.disabled}
      spinning={cfg.spinning}
      onClick={cfg.onClick}
    />
  );

  return (
    <div
      role="toolbar"
      aria-label="Formatieren"
      className="flex flex-wrap items-center gap-0.5 px-1 py-1 border border-line rounded-ctl bg-surface sticky top-0 z-10"
      // Don't blur the editor when the user mouse-downs on a button — the
      // commands need a focused editor to operate on the current selection.
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Group 1: Text style */}
      <ToolbarGroup>
        {btn({
          key: 'bold',
          label: 'Fett',
          icon: Bold,
          active: flags.bold,
          onClick: () => editor.chain().focus().toggleBold().run(),
        })}
        {btn({
          key: 'italic',
          label: 'Kursiv',
          icon: Italic,
          active: flags.italic,
          onClick: () => editor.chain().focus().toggleItalic().run(),
        })}
        {btn({
          key: 'underline',
          label: 'Unterstrichen',
          icon: UnderlineIcon,
          active: flags.underline,
          onClick: () => editor.chain().focus().toggleUnderline().run(),
        })}
        {btn({
          key: 'strike',
          label: 'Durchgestrichen',
          icon: Strikethrough,
          active: flags.strike,
          onClick: () => editor.chain().focus().toggleStrike().run(),
        })}
      </ToolbarGroup>

      <ToolbarDivider />

      {/* Group 2: Color + highlight */}
      <ToolbarGroup>
        <ColorPickerButton
          label="Textfarbe"
          icon={Palette}
          colors={TEXT_COLORS}
          activeColor={flags.color}
          open={colorOpen}
          onOpenChange={setColorOpen}
          onPick={(value) => {
            if (value === null) {
              editor.chain().focus().unsetColor().run();
            } else {
              editor.chain().focus().setColor(value).run();
            }
          }}
        />
        <ColorPickerButton
          label="Hervorheben"
          icon={Highlighter}
          colors={HIGHLIGHT_COLORS}
          activeColor={flags.highlight}
          open={highlightOpen}
          onOpenChange={setHighlightOpen}
          onPick={(value) => {
            if (value === null) {
              editor.chain().focus().unsetHighlight().run();
            } else {
              editor.chain().focus().setHighlight({ color: value }).run();
            }
          }}
        />
      </ToolbarGroup>

      <ToolbarDivider />

      {/* Group 3: Structure */}
      <ToolbarGroup>
        {btn({
          key: 'h2',
          label: 'Überschrift',
          icon: Heading2,
          active: flags.heading,
          onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        })}
        {btn({
          key: 'quote',
          label: 'Zitat',
          icon: Quote,
          active: flags.blockquote,
          onClick: () => editor.chain().focus().toggleBlockquote().run(),
        })}
        {btn({
          key: 'hr',
          label: 'Trennlinie',
          icon: HorizontalRuleIcon,
          onClick: () => editor.chain().focus().setHorizontalRule().run(),
        })}
      </ToolbarGroup>

      <ToolbarDivider />

      {/* Group 4: Lists */}
      <ToolbarGroup>
        {btn({
          key: 'ul',
          label: 'Liste',
          icon: List,
          active: flags.ul,
          onClick: () => editor.chain().focus().toggleBulletList().run(),
        })}
        {btn({
          key: 'ol',
          label: 'Nummerierte Liste',
          icon: ListOrdered,
          active: flags.ol,
          onClick: () => editor.chain().focus().toggleOrderedList().run(),
        })}
        {btn({
          key: 'task',
          label: 'Aufgabenliste',
          icon: ListChecks,
          active: flags.task,
          onClick: () => editor.chain().focus().toggleTaskList().run(),
        })}
      </ToolbarGroup>

      <ToolbarDivider />

      {/* Group 5: Insert */}
      <ToolbarGroup>
        {btn({
          key: 'link',
          label: 'Link',
          icon: LinkIcon,
          active: flags.link,
          onClick: () => setLinkDialogOpen(true),
        })}
        {btn({
          key: 'code',
          label: 'Inline-Code',
          icon: Code,
          active: flags.code,
          onClick: () => editor.chain().focus().toggleCode().run(),
        })}
        {btn({
          key: 'codeblock',
          label: 'Code-Block',
          icon: FileCode,
          active: flags.codeBlock,
          onClick: () => editor.chain().focus().toggleCodeBlock().run(),
        })}
        {btn({
          key: 'image',
          label: 'Bild',
          icon: uploadingImage ? Loader2 : ImageIcon,
          spinning: uploadingImage,
          onClick: () => fileInputRef.current?.click(),
        })}
        {btn({
          key: 'table',
          label: 'Tabelle',
          icon: TableIcon,
          onClick: () =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run(),
        })}
      </ToolbarGroup>

      <ToolbarDivider />

      {/* Group 6: Alignment */}
      <ToolbarGroup>
        {btn({
          key: 'align-left',
          label: 'Linksbündig',
          icon: AlignLeft,
          active: flags.alignLeft,
          onClick: () => editor.chain().focus().setTextAlign('left').run(),
        })}
        {btn({
          key: 'align-center',
          label: 'Zentriert',
          icon: AlignCenter,
          active: flags.alignCenter,
          onClick: () => editor.chain().focus().setTextAlign('center').run(),
        })}
        {btn({
          key: 'align-right',
          label: 'Rechtsbündig',
          icon: AlignRight,
          active: flags.alignRight,
          onClick: () => editor.chain().focus().setTextAlign('right').run(),
        })}
      </ToolbarGroup>

      <ToolbarDivider />

      {/* Group 7: History */}
      <ToolbarGroup>
        {btn({
          key: 'undo',
          label: 'Rückgängig',
          icon: Undo2,
          disabled: !flags.canUndo,
          onClick: () => editor.chain().focus().undo().run(),
        })}
        {btn({
          key: 'redo',
          label: 'Wiederherstellen',
          icon: Redo2,
          disabled: !flags.canRedo,
          onClick: () => editor.chain().focus().redo().run(),
        })}
      </ToolbarGroup>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onPickImage(f);
        }}
      />
      {linkDialogOpen && (
        <LinkDialog
          initialUrl={(editor.getAttributes('link').href as string) || ''}
          initialText={editor.state.doc.textBetween(
            editor.state.selection.from,
            editor.state.selection.to,
          )}
          onCancel={() => setLinkDialogOpen(false)}
          onConfirm={(url, text) => {
            const chain = editor.chain().focus();
            if (!url) {
              chain.extendMarkRange('link').unsetLink().run();
            } else if (text && !editor.state.selection.empty) {
              // Replace the selection with the new text, then mark it.
              chain
                .extendMarkRange('link')
                .deleteRange({
                  from: editor.state.selection.from,
                  to: editor.state.selection.to,
                })
                .insertContent(text)
                .setTextSelection({
                  from: editor.state.selection.from,
                  to: editor.state.selection.from + text.length,
                })
                .setLink({ href: url })
                .run();
            } else if (text) {
              chain
                .insertContent(text)
                .setTextSelection({
                  from: editor.state.selection.from - text.length,
                  to: editor.state.selection.from,
                })
                .setLink({ href: url })
                .run();
            } else {
              chain.extendMarkRange('link').setLink({ href: url }).run();
            }
            setLinkDialogOpen(false);
          }}
        />
      )}
    </div>
  );
}

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

function ToolbarDivider() {
  return (
    <span
      aria-hidden
      className="self-stretch w-px bg-line/70 mx-0.5"
    />
  );
}

/** Compact color-picker button: shows the icon, opens a popover with the
 *  curated palette on click. Active state mirrors `activeColor !== null`
 *  so the user can tell at a glance whether the current selection has
 *  a colour applied. */
function ColorPickerButton({
  label,
  icon: Icon,
  colors,
  activeColor,
  open,
  onOpenChange,
  onPick,
}: {
  label: string;
  icon: LucideIcon;
  colors: { label: string; value: string | null }[];
  activeColor: string | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onPick: (value: string | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  const active = activeColor !== null && activeColor !== undefined;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-pressed={active}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className={`size-8 inline-flex items-center justify-center rounded-ctl transition ${
          active
            ? 'bg-brand-50 text-brand-700'
            : 'text-muted hover:text-ink hover:bg-page'
        }`}
      >
        {/* The icon picks up the active swatch as a tiny underline so
            the user gets a hint of the current colour without us having
            to render a separate chip. */}
        <Icon
          size={16}
          style={
            active
              ? {
                  // Drop-shadow to nudge the icon visually toward the
                  // applied colour without recolouring the glyph.
                  filter: 'none',
                }
              : undefined
          }
        />
        {active && (
          <span
            aria-hidden
            className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-[3px] w-4 rounded-full"
            style={{ background: activeColor ?? 'transparent' }}
          />
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute top-full left-0 mt-1 z-50 card p-2 shadow-flat border border-line bg-surface min-w-[180px]"
        >
          <div className="text-[11px] text-muted px-1 pb-1.5 font-medium">{label}</div>
          <div className="grid grid-cols-3 gap-1">
            {colors.map((c) => {
              const isActive = (activeColor ?? null) === c.value;
              return (
                <button
                  key={c.label}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault(); // keep editor selection
                    onPick(c.value);
                    onOpenChange(false);
                  }}
                  title={c.label}
                  className={`flex items-center gap-1.5 px-1.5 py-1 rounded text-xs text-left transition ${
                    isActive ? 'bg-brand-50 text-brand-700' : 'hover:bg-page'
                  }`}
                >
                  <span
                    aria-hidden
                    className="inline-block size-3 rounded-sm border border-line"
                    style={{
                      background:
                        c.value ??
                        // "Default" swatch: a slashed-out empty box.
                        'repeating-linear-gradient(45deg, rgb(var(--color-line)) 0 2px, transparent 2px 4px)',
                    }}
                  />
                  <span className="truncate">{c.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolbarButton({
  label,
  icon: Icon,
  active,
  disabled,
  spinning,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  disabled: boolean;
  spinning?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`size-8 inline-flex items-center justify-center rounded-ctl transition disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? 'bg-brand-50 text-brand-700'
          : 'text-muted hover:text-ink hover:bg-page'
      }`}
    >
      <Icon size={16} className={spinning ? 'animate-spin' : ''} />
    </button>
  );
}

function LinkDialog({
  initialUrl,
  initialText,
  onCancel,
  onConfirm,
}: {
  initialUrl: string;
  initialText: string;
  onCancel: () => void;
  onConfirm: (url: string, text: string) => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [text, setText] = useState(initialText);
  return (
    <div
      className="fixed inset-0 z-[70] bg-ink/40 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm bg-surface rounded-card border border-line p-4 space-y-3">
        <div className="font-semibold">Link einfügen</div>
        <div>
          <label className="label">URL</label>
          <input
            className="input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            autoFocus
          />
        </div>
        <div>
          <label className="label">Linktext (optional)</label>
          <input
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Text bleibt unverändert, wenn leer"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Abbrechen
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onConfirm(url.trim(), text)}
          >
            {initialUrl ? 'Aktualisieren' : 'Einfügen'}
          </button>
        </div>
        {initialUrl && (
          <button
            type="button"
            className="text-xs text-danger hover:underline"
            onClick={() => onConfirm('', text)}
          >
            Link entfernen
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// @-trigger suggestion renderer (note-title autocomplete)
// ---------------------------------------------------------------------------

/** Returns the `items` and `render` halves of a Suggestion configuration.
 *  The popover is a floating panel anchored to the caret via the
 *  Floating UI library. Items come from SearchApi.noteTitles. */
function createWikilinkSuggestion(): {
  items: (props: { query: string }) => Promise<NoteTitleResult[]>;
  render: () => {
    onStart: (props: any) => void;
    onUpdate: (props: any) => void;
    onKeyDown: (props: any) => boolean;
    onExit: () => void;
  };
} {
  return {
    items: async ({ query }) => {
      try {
        return await SearchApi.noteTitles(query);
      } catch {
        return [];
      }
    },
    render: () => {
      let component: ReactRenderer<WikilinkPopoverHandle, WikilinkPopoverProps> | null = null;
      let popupEl: HTMLDivElement | null = null;

      const reposition = (clientRect: (() => DOMRect | null) | null) => {
        if (!popupEl) return;
        const rect = clientRect?.();
        if (!rect) return;
        // Virtual reference for Floating UI.
        const reference = {
          getBoundingClientRect: () => rect,
        } as any;
        void computePosition(reference, popupEl, {
          placement: 'bottom-start',
          middleware: [offset(6), flip(), shift({ padding: 8 })],
        }).then(({ x, y }) => {
          if (!popupEl) return;
          Object.assign(popupEl.style, {
            left: `${x}px`,
            top: `${y}px`,
            position: 'absolute',
          });
        });
      };

      return {
        onStart: (props) => {
          component = new ReactRenderer<WikilinkPopoverHandle, WikilinkPopoverProps>(
            WikilinkPopover,
            { props, editor: props.editor },
          );
          popupEl = document.createElement('div');
          popupEl.style.position = 'absolute';
          popupEl.style.zIndex = '60';
          popupEl.appendChild(component.element);
          document.body.appendChild(popupEl);
          reposition(props.clientRect);
        },
        onUpdate: (props) => {
          component?.updateProps(props);
          reposition(props.clientRect);
        },
        onKeyDown: (props) => {
          if (props.event.key === 'Escape') {
            // Close handled by Suggestion on Escape; just signal handled.
            return true;
          }
          return component?.ref?.onKeyDown(props.event) ?? false;
        },
        onExit: () => {
          if (popupEl) {
            popupEl.remove();
            popupEl = null;
          }
          component?.destroy();
          component = null;
        },
      };
    },
  };
}

interface WikilinkPopoverProps {
  items: NoteTitleResult[];
  command: (item: { title: string }) => void;
  // The Suggestion plugin also passes editor + clientRect + range; we
  // only need items and command for rendering.
}

interface WikilinkPopoverHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

const WikilinkPopover = forwardRef<WikilinkPopoverHandle, WikilinkPopoverProps>(
  function WikilinkPopover({ items, command }, ref) {
    const [index, setIndex] = useState(0);

    // Reset highlight when the suggestion list changes (user keeps typing).
    useEffect(() => {
      setIndex(0);
    }, [items]);

    const select = (i: number) => {
      const it = items[i];
      if (!it) return;
      command({ title: it.title });
    };

    useImperativeHandle(
      ref,
      () => ({
        onKeyDown: (event: KeyboardEvent) => {
          if (event.key === 'ArrowDown') {
            setIndex((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
            return true;
          }
          if (event.key === 'ArrowUp') {
            setIndex((i) =>
              items.length === 0 ? 0 : (i - 1 + items.length) % items.length,
            );
            return true;
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            select(index);
            return true;
          }
          return false;
        },
      }),
      [items, index],
    );

    if (items.length === 0) {
      return (
        <div className="card p-2 shadow-flat border border-line bg-surface text-xs text-muted min-w-[220px]">
          Keine Notiz gefunden
        </div>
      );
    }

    return (
      <div className="card p-1 shadow-flat border border-line bg-surface min-w-[220px]">
        <div className="text-[11px] text-muted px-2 py-1">
          Notiz verlinken — ↑/↓ wählen, Enter einfügen, Esc abbrechen
        </div>
        <ul className="max-h-48 overflow-auto">
          {items.map((it, i) => (
            <li key={it.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(i);
                }}
                onMouseEnter={() => setIndex(i)}
                className={`w-full text-left px-2 py-1.5 text-sm rounded ${
                  i === index ? 'bg-brand-50 text-brand-700' : 'hover:bg-page'
                }`}
              >
                {it.title}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  },
);
