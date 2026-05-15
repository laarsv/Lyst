/** TipTap node + Suggestion plugin for internal note links.
 *
 *  Markup:  <span data-wikilink="Note Title">Note Title</span>
 *
 *  - `@` triggers a suggestion popover (note-titles autocomplete via
 *    SearchApi.noteTitles). Selecting an entry inserts the span at the
 *    cursor and removes the trigger character.
 *  - In read-only mode, clicking a wikilink fires `onNavigate(title)` so
 *    the host (Notes page / public note view) can resolve the title to a
 *    note id and route. In edit mode, clicks are inert — the user is
 *    presumably editing the link text.
 *
 *  Parses back from HTML on load (round-tripping with the migrated
 *  rendered output `<span data-wikilink="…">…</span>`). */
import { mergeAttributes, Node } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';

export interface WikilinkOptions {
  /** Fired when a wikilink is clicked while the editor is non-editable.
   *  No-op in editable mode; the user is editing the link text instead. */
  onNavigate?: (title: string) => void;
  /** Plugged into the Suggestion plugin's `items` callback — the host
   *  supplies the title-lookup against the backend. */
  suggestion: Pick<SuggestionOptions<{ id: number; title: string }>, 'items' | 'render'>;
}

declare module '@tiptap/core' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Commands<ReturnType> {
    wikilink: {
      /** Insert a wikilink span at the current cursor. */
      insertWikilink: (title: string) => ReturnType;
    };
  }
}

export const WikilinkPluginKey = new PluginKey('wikilink-suggestion');

export const Wikilink = Node.create<WikilinkOptions>({
  name: 'wikilink',
  // Inline so it sits inside paragraphs alongside text.
  inline: true,
  group: 'inline',
  // Atomic: cursor treats the span as a single block — Left/Right skip
  // over it, Delete removes the whole thing. Matches the "chip" feel
  // the spec asks for.
  atom: true,
  selectable: true,

  addOptions() {
    return {
      onNavigate: undefined,
      suggestion: {
        items: () => [],
        render: () => ({}),
      },
    };
  },

  addAttributes() {
    return {
      title: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-wikilink') ?? el.textContent ?? '',
        renderHTML: (attrs) =>
          attrs.title ? { 'data-wikilink': attrs.title } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-wikilink]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const title = (node.attrs.title as string) || '';
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-wikilink': title,
        class: 'wikilink-chip',
      }),
      title,
    ];
  },

  // Clickable in read-only mode — TipTap surfaces clicks via editorProps;
  // we handle them in the host component (NoteEditor) because the click
  // target check works equally well there and keeps the extension
  // portable.

  addCommands() {
    return {
      insertWikilink:
        (title: string) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { title },
          }),
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '@',
        pluginKey: WikilinkPluginKey,
        // After the user picks an entry, replace the `@query` range with
        // the wikilink node (atomic insertion handles whitespace).
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              {
                type: 'wikilink',
                attrs: { title: (props as { title: string }).title },
              },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        // The renderer is injected by the host (NoteEditor) so it can use
        // React state for the popover. The extension itself only owns
        // the trigger + insertion plumbing.
        ...this.options.suggestion,
      }),
    ];
  },
});

export default Wikilink;
