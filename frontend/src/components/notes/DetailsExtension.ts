/** Custom Details / Summary nodes for collapsible blocks.
 *
 *  We build this ourselves rather than installing @tiptap-pro/extension-
 *  details because the official one is Pro-tier. The schema is small:
 *
 *    - `details`        : top-level block, children = summary + content
 *    - `detailsSummary` : title row, plain inline content (single line)
 *    - `detailsContent` : free block content (paragraphs, lists, nested
 *                          details, etc.)
 *
 *  Serialises to plain HTML5:
 *
 *    <details open>
 *      <summary>Title</summary>
 *      <div data-type="details-content">…body…</div>
 *    </details>
 *
 *  Browsers handle the open/close toggle natively (clicking the
 *  summary flips the `open` attribute); we don't need any JS for that.
 *  The bleach allowlist permits `<details>` + `<summary>` so the
 *  markup round-trips through save.
 */
import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Commands<ReturnType> {
    details: {
      /** Insert a fresh details block at the current selection, open
       *  by default, with placeholder summary "Details" and an empty
       *  body paragraph. */
      insertDetails: () => ReturnType;
    };
  }
}

export const Details = Node.create({
  name: 'details',
  group: 'block',
  // The schema is: a summary node followed by a content wrapper. The
  // wrapper holds arbitrary block content — that's where TipTap drops
  // the user's body paragraphs / lists / nested details.
  content: 'detailsSummary detailsContent',
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) => el.hasAttribute('open'),
        renderHTML: (attrs) => (attrs.open ? { open: '' } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'details' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'details',
      mergeAttributes(HTMLAttributes, { class: 'note-details' }),
      0,
    ];
  },

  addCommands() {
    return {
      insertDetails:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { open: true },
            content: [
              {
                type: 'detailsSummary',
                content: [{ type: 'text', text: 'Details' }],
              },
              {
                type: 'detailsContent',
                content: [{ type: 'paragraph' }],
              },
            ],
          }),
    };
  },
});

export const DetailsSummary = Node.create({
  name: 'detailsSummary',
  // Plain text / inline-only — a summary line is a single visual row.
  content: 'inline*',
  defining: true,
  isolating: true,
  // Selectable so the user can click into it; not draggable as a
  // standalone block (drag handle should target the parent details).
  selectable: false,

  parseHTML() {
    return [{ tag: 'summary' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'summary',
      mergeAttributes(HTMLAttributes, { class: 'note-details-summary' }),
      0,
    ];
  },
});

export const DetailsContent = Node.create({
  name: 'detailsContent',
  content: 'block+',
  defining: true,

  parseHTML() {
    return [
      {
        tag: 'div[data-type="details-content"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'details-content',
        class: 'note-details-content',
      }),
      0,
    ];
  },
});

export const DetailsKit = [Details, DetailsSummary, DetailsContent];
