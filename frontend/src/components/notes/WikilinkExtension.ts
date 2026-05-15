/** TipTap node for internal note links.
 *
 *  Markup:  <span data-wikilink="Note Title">Note Title</span>
 *
 *  Inline atomic node — same shape as the Mention chip, just a
 *  different `data-*` attribute and CSS class. The shared `@` trigger
 *  popover (see AtSuggestionExtension) picks which one to insert based
 *  on whether the user chose a note or a person.
 *
 *  Click handling lives in the React NodeView (WikilinkNodeView).
 *  Single tap navigates in both edit and read-only modes; a hover-
 *  revealed × button (always visible on touch) removes the chip.
 *
 *  The HTML serialization is unchanged from earlier iterations so
 *  bleach, backlinks, and the wikilink-stash in markdown migration
 *  all keep round-tripping the same string.
 */
import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { WikilinkNodeView } from './WikilinkNodeView';

declare module '@tiptap/core' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Commands<ReturnType> {
    wikilink: {
      /** Insert a wikilink span at the current cursor. */
      insertWikilink: (title: string) => ReturnType;
    };
  }
}

export interface WikilinkExtensionOptions {
  /** Per-editor wiring for the React NodeView. The host (NoteEditor)
   *  supplies these via `.configure({ wikilink: {...} })`. */
  wikilink?: {
    onNavigate?: (title: string) => void;
    editable: boolean;
  };
}

export const Wikilink = Node.create<WikilinkExtensionOptions>({
  name: 'wikilink',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addOptions() {
    return {
      wikilink: { onNavigate: undefined, editable: true },
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
    return [{ tag: 'span[data-wikilink]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    // This is what gets written to the SAVED HTML (the doc on disk
    // and the share view's read-only render). The in-editor visual
    // comes from the NodeView below.
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

  // React NodeView — owns the in-editor visual + click behavior.
  // ReactNodeViewRenderer accepts the component directly; the
  // component reads its config from `extension.options.wikilink`.
  addNodeView() {
    return ReactNodeViewRenderer(WikilinkNodeView);
  },
});

export default Wikilink;
