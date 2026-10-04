import React from 'react';
import { createPortal } from 'react-dom';

/**
 * A panel that floats next to the thing that opened it, instead of expanding it.
 *
 * ============================================================================
 * WHY THIS IS A PORTAL AND NOT A DIV INSIDE THE CELL
 * ============================================================================
 *
 * The disclosure this replaces rendered at the BOTTOM of the whole board. That was chosen so that
 * opening one club's numbers could not change the height of any cell -- a disclosure that expands
 * its own cell changes that cell's height, which changes its row's height, which leaves a visible
 * hole under its four neighbours. On a grid whose entire purpose is comparing clubs side by side,
 * that hole is worse than the scrolling.
 *
 * But pushing the panel to the bottom of the board has its own cost, and it is the one the user
 * actually felt: you click a club's numbers and the answer appears somewhere else on the page, so
 * your eye has to leave the cell and travel. For a control whose whole job is "tell me about THIS
 * club", the answer belongs beside the club.
 *
 * A floating panel has neither problem. It is positioned against the cell's rectangle, so it does
 * not participate in layout at all -- no cell grows, no row changes, no hole appears -- and it is
 * painted on top of everything at the coordinates of the thing you clicked. Both properties at
 * once, which is why this is a portal and not a CSS trick on the cell.
 *
 * `createPortal` into `document.body` also gets it out from under the grid's `overflow` and stacking
 * context, which is what would otherwise clip it against a neighbouring card.
 *
 * ============================================================================
 * WHY THE POSITION IS MEASURED RATHER THAN GUESSED
 * ============================================================================
 *
 * The panel has to flip ABOVE its target when there is no room below, and its width has to be
 * clamped to the viewport. Both need the panel's own height, which does not exist until it has
 * been laid out once. So it is measured in `useLayoutEffect` -- before paint -- which means the
 * position is settled on the same frame the panel appears and there is no visible jump from a
 * default position to the real one.
 *
 * The initial guess is deliberately below-and-aligned: that is right for the overwhelming majority
 * of clicks, and being wrong for one frame is imperceptible where being wrong for a second is not.
 */
export interface AnchoredPanelProps {
  /** The element the panel is anchored to. The panel tracks its rectangle, not its DOM parent. */
  anchor: HTMLElement | null;
  /** Called on outside click, Escape, scroll and resize -- every way to lose interest. */
  onClose: () => void;
  /** Names the panel for assistive tech. */
  label: string;
  /**
   * The panel's DOM id.
   *
   * Carried rather than generated, because the thing that opens this panel has to name it in
   * `aria-controls` and the two have to be the same string. Generating it in here instead would put
   * the two halves in different files with no way to check they agree, which is exactly how a
   * toggle ends up pointing at nothing.
   */
  id?: string;
  /** Widest the panel will grow, in pixels, before it starts wrapping its own rows. */
  maxWidth?: number;
  children: React.ReactNode;
}

interface Placement {
  top: number;
  left: number;
  width: number;
  /** True when the panel had to go above its anchor rather than below it. */
  above: boolean;
}

/** Gap between the anchor and the panel, in pixels. */
const GAP = 8;

/** How close to the viewport edge a panel may sit before it is nudged inward. */
const EDGE = 8;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));

export const AnchoredPanel: React.FC<AnchoredPanelProps> = ({
  anchor,
  onClose,
  label,
  id,
  maxWidth = 460,
  children,
}) => {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = React.useState<Placement | null>(null);

  /*
    * THE MEASUREMENT.
    *
    * Reads the anchor's rectangle and the panel's own, and picks the side with room. Re-runs
    * whenever `anchor` changes identity, which is how a scrolled or resized page keeps the panel
    * attached -- the alternative is a panel left behind at stale coordinates, which reads as the
    * app having lost track of it.
    */
  React.useLayoutEffect(() => {
    if (!anchor) return;

    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const panel = panelRef.current;
      const height = panel?.offsetHeight ?? 0;
      const viewportHeight = window.innerHeight;

      /*
        * Flip above only when below would genuinely overflow. The `gap` in the comparison is what
        * stops a panel that exactly fits from being flipped for no reason -- it would still fit
        * below, and flipping is a visual jump for no reason.
        */
      const fitsBelow = rect.bottom + GAP + height <= viewportHeight - EDGE;
      const above = !fitsBelow;

      const width = Math.min(
        Math.max(rect.width, maxWidth),
        window.innerWidth - EDGE * 2,
      );

      setPlacement({
        top: above
          ? Math.max(EDGE, rect.top - GAP - height)
          : rect.bottom + GAP,
        left: clamp(rect.left, EDGE, window.innerWidth - width - EDGE),
        width,
        above,
      });
    };

    place();

    /*
     * Anchoring is to a RECTANGLE, so anything that moves the rectangle has to be re-read:
     * scrolling (the page and any scrollable ancestor), window resize, and layout shifts from
     * images finishing decode. All three, because a popover that detaches on any one of them is a
     * popover the user has to dismiss and start again.
     */
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor, maxWidth]);

  /*
    * DISMISSAL, three ways.
    *
    * Escape because it is the universal "I am finished with this" and costs nothing. Outside click
    * because that is what a click on a popover means. Neither is a nicety -- a panel that can only
    * be closed by re-clicking the same button is a panel that can trap a manager who changed their
    * mind, and on a 32-club board that is thirty-two traps.
    */
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [anchor, onClose]);

  /*
    * No document means no portal, and no anchor means no panel.
    *
    * The component is rendered by check scripts through `renderToStaticMarkup`, where
    * `document.body` does not exist, and a portal to `null` would throw and take every other
    * assertion in the file with it.
    *
    * The anchor check is not defensive coding, it is the whole dismissal mechanism. The caller
    * clears `anchor` to close the panel, so rendering unconditionally left a stale panel sitting
    * on the board with its last placement and no content -- a dialog that reported itself open,
    * could not be dismissed, and never left the DOM. An earlier version of this measured exactly
    * that: `aria-expanded` toggled correctly while a `[role=dialog]` was permanently present, so
    * every dismissal test "failed" against an element that was never really there.
    */
  if (typeof document === 'undefined' || !anchor) return null;

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-label={label}
      data-anchored={placement?.above ? 'above' : 'below'}
      className="fixed z-[60] flex flex-col gap-1.5 border-2 border-[var(--color-chrome-hi)] bg-[var(--color-panel-3)] p-3 text-[var(--color-ink)] shadow-[var(--shadow-bev-lg)]"
      style={{
        top: placement?.top ?? 0,
        left: placement?.left ?? 0,
        width: placement?.width,
        // Hidden only until the first measurement lands, so an unplaced panel is never seen at the
        // top-left of the screen for a frame.
        visibility: placement ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
};
