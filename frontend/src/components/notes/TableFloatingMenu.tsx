/** Floating menu for table cells.
 *
 *  Renders only when the editor's selection is inside a table cell.
 *  Desktop: a horizontal toolbar anchored above the active cell via
 *  Floating UI. Mobile: a bottom-sheet popover triggered by long-press
 *  on a cell (the floating bar would fight the on-screen keyboard /
 *  selection handles on iOS).
 *
 *  Wires the standard built-in TipTap commands — no custom state.
 *  Closing happens automatically when the editor's selection leaves
 *  the table (we listen to `selectionUpdate`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import { computePosition, flip, offset, shift } from '@floating-ui/dom';
import {
  ChevronsRight,
  ChevronsLeft,
  ChevronsUp,
  ChevronsDown,
  Heading,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';

interface Props {
  editor: Editor;
}

interface Action {
  key: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
  /** When true, the button is rendered as a danger variant (red text). */
  danger?: boolean;
}

const MOBILE_MQ = '(max-width: 767.98px)';

export function TableFloatingMenu({ editor }: Props) {
  // `cellEl` is the DOM cell the selection currently lives in. We use
  // it as the Floating UI reference. Null when the cursor is outside
  // any table.
  const [cellEl, setCellEl] = useState<HTMLElement | null>(null);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(MOBILE_MQ).matches,
  );
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Track viewport size so we can swap menus when the user rotates
  // their device or resizes a desktop window.
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Watch the editor's selection — whenever it changes, look up the
  // DOM node the head of the selection lives in, walk up to the
  // nearest <td>/<th>, and store it. Null when out of any table.
  useEffect(() => {
    const update = () => {
      if (!editor.isActive('table')) {
        setCellEl(null);
        setMobileSheetOpen(false);
        return;
      }
      const dom = editor.view.domAtPos(editor.state.selection.from);
      let node: Node | null = dom.node;
      // domAtPos returns either a text node or its parent — climb up to
      // the cell. nodeType=ELEMENT_NODE === 1.
      while (node && (node as HTMLElement).nodeType !== 1) {
        node = node.parentNode;
      }
      let el = node as HTMLElement | null;
      while (el && el.tagName !== 'TD' && el.tagName !== 'TH') {
        el = el.parentElement;
      }
      setCellEl(el ?? null);
    };
    update();
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor]);

  // Long-press detection — only when in mobile mode. We listen on the
  // editor surface; if the touch dwells on a cell for 500ms without
  // significant movement, open the bottom sheet.
  useEffect(() => {
    if (!isMobile) return;
    const editorRoot = editor.view.dom as HTMLElement;
    let timer: number | null = null;
    let startX = 0;
    let startY = 0;

    const cancel = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      const cell = target?.closest('td, th') as HTMLElement | null;
      if (!cell) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      timer = window.setTimeout(() => {
        timer = null;
        setCellEl(cell);
        setMobileSheetOpen(true);
        // Suppress the synthetic click that would otherwise fire after
        // the long-press lifts.
        (cell as HTMLElement).blur();
      }, 500);
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (Math.abs(t.clientX - startX) > 8 || Math.abs(t.clientY - startY) > 8) {
        cancel();
      }
    };

    editorRoot.addEventListener('touchstart', onTouchStart, { passive: true });
    editorRoot.addEventListener('touchmove', onTouchMove, { passive: true });
    editorRoot.addEventListener('touchend', cancel);
    editorRoot.addEventListener('touchcancel', cancel);
    return () => {
      cancel();
      editorRoot.removeEventListener('touchstart', onTouchStart);
      editorRoot.removeEventListener('touchmove', onTouchMove);
      editorRoot.removeEventListener('touchend', cancel);
      editorRoot.removeEventListener('touchcancel', cancel);
    };
  }, [editor, isMobile]);

  // Position the desktop menu near the cell via Floating UI. Re-runs
  // whenever the active cell changes or the user scrolls.
  useEffect(() => {
    if (!cellEl || !menuRef.current || isMobile) return;
    const reference = cellEl;
    const menu = menuRef.current;
    const reposition = () => {
      void computePosition(reference, menu, {
        placement: 'top',
        middleware: [offset(8), flip(), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        Object.assign(menu.style, {
          left: `${x}px`,
          top: `${y}px`,
        });
      });
    };
    reposition();
    // Reposition on scroll inside the editor's scroll container too.
    const scrollContainers: (Window | HTMLElement)[] = [window];
    let p: HTMLElement | null = reference.parentElement;
    while (p) {
      const style = getComputedStyle(p);
      if (
        style.overflow === 'auto' ||
        style.overflow === 'scroll' ||
        style.overflowY === 'auto' ||
        style.overflowY === 'scroll'
      ) {
        scrollContainers.push(p);
      }
      p = p.parentElement;
    }
    scrollContainers.forEach((c) => {
      c.addEventListener('scroll', reposition, { passive: true });
    });
    window.addEventListener('resize', reposition);
    return () => {
      scrollContainers.forEach((c) => {
        c.removeEventListener('scroll', reposition);
      });
      window.removeEventListener('resize', reposition);
    };
  }, [cellEl, isMobile]);

  const run = useCallback(
    (fn: () => void) => {
      fn();
      setMobileSheetOpen(false);
    },
    [],
  );

  const actions: Action[] = [
    {
      key: 'col-before',
      label: 'Spalte links hinzufügen',
      icon: ChevronsLeft,
      run: () => run(() => editor.chain().focus().addColumnBefore().run()),
    },
    {
      key: 'col-after',
      label: 'Spalte rechts hinzufügen',
      icon: ChevronsRight,
      run: () => run(() => editor.chain().focus().addColumnAfter().run()),
    },
    {
      key: 'col-delete',
      label: 'Spalte löschen',
      icon: X,
      run: () => run(() => editor.chain().focus().deleteColumn().run()),
    },
    {
      key: 'row-before',
      label: 'Zeile oben hinzufügen',
      icon: ChevronsUp,
      run: () => run(() => editor.chain().focus().addRowBefore().run()),
    },
    {
      key: 'row-after',
      label: 'Zeile unten hinzufügen',
      icon: ChevronsDown,
      run: () => run(() => editor.chain().focus().addRowAfter().run()),
    },
    {
      key: 'row-delete',
      label: 'Zeile löschen',
      icon: X,
      run: () => run(() => editor.chain().focus().deleteRow().run()),
    },
    {
      key: 'header-toggle',
      label: 'Header-Zeile umschalten',
      icon: Heading,
      run: () => run(() => editor.chain().focus().toggleHeaderRow().run()),
    },
    {
      key: 'table-delete',
      label: 'Tabelle löschen',
      icon: Trash2,
      run: () => run(() => editor.chain().focus().deleteTable().run()),
      danger: true,
    },
  ];

  if (!cellEl) return null;

  // Mobile: bottom-sheet popover, only open after long-press.
  if (isMobile) {
    if (!mobileSheetOpen) return null;
    return createPortal(
      <div
        className="fixed inset-0 z-[60] bg-ink/40 flex items-end"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setMobileSheetOpen(false);
        }}
        onTouchStart={(e) => {
          if (e.target === e.currentTarget) setMobileSheetOpen(false);
        }}
      >
        <div
          className="w-full bg-surface rounded-t-card border-t border-line p-2 shadow-flat"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
        >
          <div className="text-xs text-muted px-3 py-2 font-medium">Tabelle</div>
          <div className="grid grid-cols-1 gap-0.5">
            {actions.map((a) => (
              <SheetButton key={a.key} action={a} />
            ))}
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // Desktop: horizontal toolbar floating above the cell.
  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[55] flex items-center gap-0.5 p-1 rounded-ctl border border-line bg-surface shadow-flat"
      // Don't blur the editor when a button is mouse-downed — the table
      // commands need a live selection inside the cell to operate on.
      onMouseDown={(e) => e.preventDefault()}
      role="toolbar"
      aria-label="Tabelle bearbeiten"
    >
      {actions.map((a) => (
        <ToolbarBtn key={a.key} action={a} />
      ))}
    </div>,
    document.body,
  );
}

function ToolbarBtn({ action }: { action: Action }) {
  const Icon = action.icon;
  return (
    <button
      type="button"
      title={action.label}
      aria-label={action.label}
      onClick={action.run}
      className={`size-8 inline-flex items-center justify-center rounded-ctl transition ${
        action.danger
          ? 'text-danger hover:bg-danger/10'
          : 'text-muted hover:text-ink hover:bg-page'
      }`}
    >
      <Icon size={15} />
    </button>
  );
}

function SheetButton({ action }: { action: Action }) {
  const Icon = action.icon;
  return (
    <button
      type="button"
      onClick={action.run}
      className={`w-full inline-flex items-center gap-3 px-3 py-3 rounded-ctl text-left text-sm transition ${
        action.danger
          ? 'text-danger active:bg-danger/10'
          : 'text-ink active:bg-page'
      }`}
    >
      <Icon size={18} className={action.danger ? '' : 'text-muted'} />
      <span className="flex-1">{action.label}</span>
    </button>
  );
}
