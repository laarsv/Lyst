/** React node-view for the wikilink chip.
 *
 *  Why a NodeView instead of plain renderHTML: in edit mode TipTap's
 *  view captures clicks on inline atoms to move the caret rather
 *  than triggering DOM handlers. Owning the click in React lets us
 *  navigate on single-tap in BOTH edit and read-only modes, AND
 *  surface a small remove (×) control hover-only on desktop /
 *  always-visible on mobile so users can dispose of a stray chip
 *  without going through arrow-key-then-delete.
 *
 *  The chip's HTML serialization is still
 *      <span data-wikilink="<title>">Title</span>
 *  via the WikilinkExtension's renderHTML — bleach + backlinks +
 *  the @-popover insertion path all read that shape. The NodeView
 *  is purely an in-editor enhancement; the wire format is unchanged.
 */
import { useEffect, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { X } from 'lucide-react';

interface WikilinkNodeViewOptions {
  /** Pulled from the parent NoteEditor via the extension's
   *  configure(). The receiver routes to the linked note (resolves
   *  the title server-side, falls back to a toast). */
  onNavigate?: (title: string) => void;
  /** When false (read-only viewers), the remove button is hidden.
   *  Navigation still works. */
  editable: boolean;
}

interface ProvidedOptions {
  wikilink?: WikilinkNodeViewOptions;
}

export function WikilinkNodeView({
  node,
  deleteNode,
  extension,
}: NodeViewProps) {
  const title = (node.attrs.title as string) || '';
  // Hover-visibility on desktop for the remove button — always-show
  // on touch where hover doesn't exist. We detect via media query so
  // a hybrid device (Surface, laptop with touch) gets the always-show
  // behaviour as soon as it's used as a touch device.
  const [isTouch, setIsTouch] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(hover: none)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(hover: none)');
    const onChange = () => setIsTouch(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // TipTap stores configure() options on extension.options. Cast via
  // the type union — the WikilinkExtension defines a matching shape.
  const opts = (extension.options as ProvidedOptions).wikilink ?? {
    onNavigate: undefined,
    editable: true,
  };

  const onClick = (e: React.MouseEvent) => {
    // Stop the chip's text click from bubbling to ProseMirror (which
    // would set the selection and fight the navigation gesture).
    e.preventDefault();
    e.stopPropagation();
    if (title && opts.onNavigate) opts.onNavigate(title);
  };

  const onRemove = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    deleteNode();
  };

  return (
    <NodeViewWrapper
      as="span"
      // contentEditable=false so the cursor doesn't try to land
      // INSIDE the chip during selection — the whole thing acts as
      // a single inline atom.
      contentEditable={false}
      className="wikilink-chip group"
      // The `data-wikilink` attribute is also written by renderHTML
      // for the saved shape; mirroring it here keeps the live editor
      // DOM in sync with what backlinks see.
      data-wikilink={title}
    >
      <button
        type="button"
        onClick={onClick}
        // Use mousedown for the stop-propagation so the click doesn't
        // get a chance to land in the editor before navigation fires.
        onMouseDown={(e) => e.stopPropagation()}
        className="wikilink-chip-text"
        title={`Notiz öffnen: ${title}`}
      >
        {title}
      </button>
      {opts.editable && (
        <button
          type="button"
          aria-label={`Verweis "${title}" entfernen`}
          onClick={onRemove}
          onMouseDown={(e) => e.stopPropagation()}
          className={`wikilink-chip-remove ${
            isTouch ? 'is-touch' : 'is-hover'
          }`}
        >
          <X size={11} />
        </button>
      )}
    </NodeViewWrapper>
  );
}
