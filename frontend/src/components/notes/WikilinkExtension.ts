/** TipTap node for internal note links.
 *
 *  Markup:  <span data-wikilink="Note Title">Note Title</span>
 *
 *  Inline atomic node — same shape as the Mention chip, just a
 *  different `data-*` attribute and CSS class. The shared `@` trigger
 *  popover (see AtSuggestionExtension) picks which one to insert based
 *  on whether the user chose a note or a person.
 *
 *  Click handling lives in `NoteEditor`'s editorProps.handleClickOn:
 *  in read-only mode a click invokes `onNavigate(title)`; in editable
 *  mode the click is inert so the caret can land inside the span. */
import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Commands<ReturnType> {
    wikilink: {
      /** Insert a wikilink span at the current cursor. */
      insertWikilink: (title: string) => ReturnType;
    };
  }
}

export const Wikilink = Node.create({
  name: 'wikilink',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

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
});

export default Wikilink;
