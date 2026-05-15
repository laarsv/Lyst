/** `/` slash-command palette for the note editor.
 *
 *  Built on top of @tiptap/suggestion (the same plugin powering the
 *  @-trigger). The character is `/`, but with two guards layered on
 *  top of Suggestion's defaults to satisfy the "only on empty line or
 *  after whitespace" rule:
 *
 *    1. `allowSpaces: false` — Suggestion abandons the trigger as
 *       soon as a space is typed.
 *    2. A custom `allow` predicate runs on every potential match: the
 *       character immediately before the `/` MUST be either nothing
 *       (start of node) or whitespace. This is what stops the menu
 *       from popping up when the user types `/` mid-word
 *       (e.g. "Spam/Eggs"). The community alternative (`startOfLine:
 *       true`) is too strict — it blocks `- /` and the like.
 *
 *  Commands list is supplied by the host (NoteEditor) via the
 *  `commands` option so all the editor-aware insertion logic stays in
 *  one place.
 *
 *  Renderer plumbing is identical to AtSuggestionExtension's — we
 *  re-use the same `createAtRenderer` helper there because both
 *  popovers position the same way and only differ in their item
 *  content.
 */
import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import type { Editor, Range } from '@tiptap/core';
import { computePosition, flip, offset, shift } from '@floating-ui/dom';
import { ReactRenderer } from '@tiptap/react';

export const SlashCommandPluginKey = new PluginKey('slash-command');

export interface SlashCommand {
  key: string;
  label: string;
  /** Optional aliases that also match the typed query. Useful for
   *  German↔English (e.g. "heading"/"überschrift"). */
  aliases?: string[];
  /** Executes the command — receives the editor and the range to
   *  replace (the typed `/query`). */
  run: (args: { editor: Editor; range: Range }) => void;
  /** Lucide icon component (typed loosely so the host doesn't have
   *  to import LucideIcon from this file). Lucide's prop type accepts
   *  string|number for `size`, which is why we widen here. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon?: React.ComponentType<any>;
}

export interface SlashCommandOptions {
  commands: SlashCommand[];
  renderItems: NonNullable<SuggestionOptions<SlashCommand>['render']>;
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: 'slashCommand',

  addOptions() {
    return {
      commands: [],
      renderItems: () => ({}),
    };
  },

  addProseMirrorPlugins() {
    const opts = this.options;
    return [
      Suggestion<SlashCommand>({
        editor: this.editor,
        char: '/',
        pluginKey: SlashCommandPluginKey,
        allowSpaces: false,
        // Only allow when `/` sits at the start of the node or right
        // after whitespace. Keeps `Vorher/Nachher` from triggering.
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          // `nodeBefore` is null at the start of a textblock — that's
          // a valid trigger position. Otherwise we need a whitespace
          // character right before.
          if ($from.parentOffset === 0) return true;
          const charBefore = state.doc.textBetween(range.from - 1, range.from);
          return /\s/.test(charBefore);
        },
        items: ({ query }) => {
          const q = query.trim().toLowerCase();
          if (!q) return opts.commands;
          return opts.commands.filter((c) => {
            if (c.label.toLowerCase().includes(q)) return true;
            return (c.aliases ?? []).some((a) => a.toLowerCase().includes(q));
          });
        },
        command: ({ editor, range, props }) => {
          // The Suggestion plugin passes the matched command as
          // `props`. The command itself is responsible for replacing
          // the `/query` range — we forward the range as-is.
          (props as SlashCommand).run({ editor, range });
        },
        render: opts.renderItems,
      }),
    ];
  },
});

/** Renderer for the slash-command popover. Same Floating UI dance as
 *  AtSuggestion; couldn't share the exact function because TipTap's
 *  generic on `SuggestionOptions['render']` is per-item-type. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function createSlashRenderer(
  Popover: React.ComponentType<any>,
): SuggestionOptions<SlashCommand>['render'] {
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
