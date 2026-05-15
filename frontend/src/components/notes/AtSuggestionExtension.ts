/** Shared @-trigger Suggestion plugin for the note editor.
 *
 *  Replaces the old WikilinkExtension-internal suggestion. One `@`
 *  triggers ONE popover that lists matches from two sources:
 *    - Notizen — note titles (insert a wikilink chip)
 *    - Personen — users with access to the current note (insert a
 *      mention chip)
 *
 *  The fetch is fired concurrently against SearchApi.noteTitles and
 *  NotesApi.mentionableUsers; the popover renders sections in the
 *  same order regardless of which one returns first. Keyboard nav
 *  treats the visible item list as a flat sequence so arrow-down
 *  glides across both groups.
 *
 *  Extension boundary: this file owns the trigger + items fetching +
 *  the render glue (creating the React popover via ReactRenderer).
 *  The actual `WikilinkPopover` component is supplied by the host
 *  (NoteEditor) to keep the React layer with the rest of the editor
 *  components — passed in via the `renderItems` option.
 */
import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import { computePosition, flip, offset, shift } from '@floating-ui/dom';
import { ReactRenderer } from '@tiptap/react';
import { SearchApi, NotesApi, type NoteTitleResult, type MentionableUser } from '@/api/endpoints';

export const AtSuggestionPluginKey = new PluginKey('at-suggestion');

export type AtItem =
  | { kind: 'note'; id: number; title: string }
  | { kind: 'user'; id: number; name: string; email: string };

export interface AtSuggestionOptions {
  /** The note we're currently editing — drives the user-list fetch. */
  noteId: number;
  /** Renders the actual popover. The host (NoteEditor) supplies a
   *  React component via ReactRenderer; this extension just hands it
   *  the suggestion props and lets it draw. */
  renderItems: NonNullable<SuggestionOptions<AtItem>['render']>;
}

export const AtSuggestion = Extension.create<AtSuggestionOptions>({
  name: 'atSuggestion',

  addOptions() {
    return {
      noteId: 0,
      // No-op default so the build doesn't error if the extension is
      // wired up before its options are supplied.
      renderItems: () => ({}),
    };
  },

  addProseMirrorPlugins() {
    const { noteId, renderItems } = this.options;
    return [
      Suggestion<AtItem>({
        editor: this.editor,
        char: '@',
        pluginKey: AtSuggestionPluginKey,
        // Allow @ anywhere — the popover only shows when there's at
        // least one match anyway, and Suggestion already won't fire
        // mid-word because it requires a non-alphanumeric char before
        // the trigger.
        allowSpaces: false,
        items: async ({ query }) => {
          // Fire both lookups concurrently. Either side erroring
          // resolves to an empty list — the popover still renders the
          // half that succeeded.
          const [notes, users] = await Promise.all([
            SearchApi.noteTitles(query).catch(() => [] as NoteTitleResult[]),
            noteId > 0
              ? NotesApi.mentionableUsers(noteId, query || undefined).catch(
                  () => [] as MentionableUser[],
                )
              : Promise.resolve([] as MentionableUser[]),
          ]);
          const items: AtItem[] = [
            ...notes.map<AtItem>((n) => ({
              kind: 'note',
              id: n.id,
              title: n.title,
            })),
            ...users.map<AtItem>((u) => ({
              kind: 'user',
              id: u.id,
              name: u.name,
              email: u.email,
            })),
          ];
          return items;
        },
        command: ({ editor, range, props }) => {
          const chain = editor.chain().focus();
          if (props.kind === 'note') {
            chain
              .insertContentAt(range, [
                { type: 'wikilink', attrs: { title: props.title } },
                { type: 'text', text: ' ' },
              ])
              .run();
          } else {
            chain
              .insertContentAt(range, [
                {
                  type: 'mention',
                  attrs: { userId: props.id, name: props.name },
                },
                { type: 'text', text: ' ' },
              ])
              .run();
          }
        },
        render: renderItems,
      }),
    ];
  },
});

/** Reusable render helper: produces the `render()` function the
 *  Suggestion plugin expects, given a React popover component. Keeps
 *  the Floating UI + ReactRenderer plumbing out of the host file. */
// The renderer's job is plumbing only — Floating UI positioning, mount,
// destroy. We type the React component loosely (`any`) because TipTap's
// SuggestionProps shape isn't expressible as the popover's prop type
// without an ugly mapping, and the host (NoteEditor) already owns a
// strongly-typed `AtPopover` implementation.
/* eslint-disable @typescript-eslint/no-explicit-any */
export function createAtRenderer(
  Popover: React.ComponentType<any>,
): SuggestionOptions<AtItem>['render'] {
  return () => {
    let component: ReactRenderer<any, any> | null = null;
    let popupEl: HTMLDivElement | null = null;

    const reposition = (clientRect: (() => DOMRect | null) | null | undefined) => {
      if (!popupEl) return;
      const rect = clientRect?.();
      if (!rect) return;
      const reference = { getBoundingClientRect: () => rect } as Element;
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
        component = new ReactRenderer(Popover, {
          props,
          editor: props.editor,
        });
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
        if (props.event.key === 'Escape') return true;
        const ref = component?.ref as
          | { onKeyDown?: (event: KeyboardEvent) => boolean }
          | undefined;
        return ref?.onKeyDown?.(props.event) ?? false;
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
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
