/** TipTap node for user mentions inside a note.
 *
 *  Markup:  <span data-mention="42">@Anna</span>
 *
 *  Inline atomic node — same shape as the Wikilink chip, just a
 *  different `data-*` attribute and a different visual scope. Backend
 *  sanitisation requires `data-mention` to be all-digits (so a paste
 *  from elsewhere can't forge an integer-shaped mention into the
 *  document); the extension itself never emits anything but a
 *  user-id from the popover, so the constraint only really exists
 *  for defence-in-depth.
 *
 *  This extension does NOT own the @-trigger Suggestion plugin —
 *  that's hosted by NoteEditor so the same trigger can populate
 *  both a "Notizen" and a "Personen" section in one popover. */
import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Commands<ReturnType> {
    mention: {
      /** Insert a mention span at the current cursor. The `name` is
       *  what the user sees; the `userId` is what the backend uses
       *  to deliver notifications. */
      insertMention: (userId: number, name: string) => ReturnType;
    };
  }
}

export const Mention = Node.create({
  name: 'mention',
  inline: true,
  group: 'inline',
  // Atomic: cursor treats the span as a single thing — Left/Right
  // skip over it, Delete removes the whole chip. Same UX as wikilink.
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      userId: {
        default: null,
        // Backend stores the id in `data-mention`. We parse it back to
        // a number so commands and rendering have a consistent type.
        parseHTML: (el) => {
          const raw = el.getAttribute('data-mention');
          if (!raw) return null;
          const n = Number(raw);
          return Number.isFinite(n) ? n : null;
        },
        renderHTML: (attrs) =>
          attrs.userId !== null && attrs.userId !== undefined
            ? { 'data-mention': String(attrs.userId) }
            : {},
      },
      name: {
        default: '',
        parseHTML: (el) => {
          const txt = el.textContent ?? '';
          // The visible label is `@Name` — strip the leading @ so
          // commands receive just the name. Round-trips fine.
          return txt.startsWith('@') ? txt.slice(1) : txt;
        },
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-mention]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const name = (node.attrs.name as string) || '';
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'mention-chip',
      }),
      `@${name}`,
    ];
  },

  addCommands() {
    return {
      insertMention:
        (userId: number, name: string) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { userId, name },
          }),
    };
  },
});

export default Mention;
