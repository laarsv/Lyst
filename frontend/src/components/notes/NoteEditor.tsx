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
import { Editor, EditorContent, useEditor } from '@tiptap/react';
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
import { ReactRenderer } from '@tiptap/react';
import { computePosition, flip, offset, shift } from '@floating-ui/dom';
import {
  Bold,
  Code,
  FileCode,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
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
          // Link is added separately so we can configure openOnClick.
          // CodeBlock from starter kit is fine; no language picker needed
          // at the StarterKit level — we add a small one in the toolbar.
        }),
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
    </div>
  );
});

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

interface ToolbarBtnConfig {
  key: string;
  label: string;
  icon: LucideIcon;
  command: (editor: Editor) => void;
  isActive?: (editor: Editor) => boolean;
  isDisabled?: (editor: Editor) => boolean;
}

function NoteEditorToolbar({ editor, noteId }: { editor: Editor; noteId: number }) {
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const buttons: ToolbarBtnConfig[] = [
    {
      key: 'bold',
      label: 'Fett',
      icon: Bold,
      command: (e) => e.chain().focus().toggleBold().run(),
      isActive: (e) => e.isActive('bold'),
    },
    {
      key: 'italic',
      label: 'Kursiv',
      icon: Italic,
      command: (e) => e.chain().focus().toggleItalic().run(),
      isActive: (e) => e.isActive('italic'),
    },
    {
      key: 'strike',
      label: 'Durchgestrichen',
      icon: Strikethrough,
      command: (e) => e.chain().focus().toggleStrike().run(),
      isActive: (e) => e.isActive('strike'),
    },
    {
      key: 'h2',
      label: 'Überschrift',
      icon: Heading2,
      command: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
      isActive: (e) => e.isActive('heading', { level: 2 }),
    },
    {
      key: 'link',
      label: 'Link',
      icon: LinkIcon,
      command: () => setLinkDialogOpen(true),
      isActive: (e) => e.isActive('link'),
    },
    {
      key: 'quote',
      label: 'Zitat',
      icon: Quote,
      command: (e) => e.chain().focus().toggleBlockquote().run(),
      isActive: (e) => e.isActive('blockquote'),
    },
    {
      key: 'code',
      label: 'Inline-Code',
      icon: Code,
      command: (e) => e.chain().focus().toggleCode().run(),
      isActive: (e) => e.isActive('code'),
    },
    {
      key: 'codeblock',
      label: 'Code-Block',
      icon: FileCode,
      command: (e) => e.chain().focus().toggleCodeBlock().run(),
      isActive: (e) => e.isActive('codeBlock'),
    },
    {
      key: 'image',
      label: 'Bild',
      icon: ImageIcon,
      command: () => fileInputRef.current?.click(),
    },
    {
      key: 'table',
      label: 'Tabelle',
      icon: TableIcon,
      command: (e) =>
        e
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      key: 'ul',
      label: 'Liste',
      icon: List,
      command: (e) => e.chain().focus().toggleBulletList().run(),
      isActive: (e) => e.isActive('bulletList'),
    },
    {
      key: 'ol',
      label: 'Nummerierte Liste',
      icon: ListOrdered,
      command: (e) => e.chain().focus().toggleOrderedList().run(),
      isActive: (e) => e.isActive('orderedList'),
    },
    {
      key: 'task',
      label: 'Aufgabenliste',
      icon: ListChecks,
      command: (e) => e.chain().focus().toggleTaskList().run(),
      isActive: (e) => e.isActive('taskList'),
    },
    {
      key: 'undo',
      label: 'Rückgängig',
      icon: Undo2,
      command: (e) => e.chain().focus().undo().run(),
      isDisabled: (e) => !e.can().chain().focus().undo().run(),
    },
    {
      key: 'redo',
      label: 'Wiederherstellen',
      icon: Redo2,
      command: (e) => e.chain().focus().redo().run(),
      isDisabled: (e) => !e.can().chain().focus().redo().run(),
    },
  ];

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

  return (
    <div
      role="toolbar"
      aria-label="Formatieren"
      className="flex flex-wrap items-center gap-0.5 px-1 py-1 border border-line rounded-ctl bg-surface sticky top-0 z-10"
      // Don't blur the editor when the user mouse-downs on a button — the
      // commands need a focused editor to operate on the current selection.
      onMouseDown={(e) => e.preventDefault()}
    >
      {buttons.map((b) => (
        <ToolbarButton
          key={b.key}
          label={b.label}
          icon={b.key === 'image' && uploadingImage ? Loader2 : b.icon}
          active={b.isActive ? b.isActive(editor) : false}
          disabled={b.isDisabled ? b.isDisabled(editor) : false}
          spinning={b.key === 'image' && uploadingImage}
          onClick={() => b.command(editor)}
        />
      ))}
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
