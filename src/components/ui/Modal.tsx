import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Modal.
 *
 * A popup in the shell's own language: a chrome bar carrying a title and a close
 * control, a hard border, a scrim, and nothing decorative inside the content area.
 *
 * Built as a primitive rather than a one-off on the media page because the app
 * already had four separate ad-hoc dialogs, each with its own scrim opacity, its
 * own z-index guess, and its own idea of whether Escape worked. A shared
 * primitive is what makes the accessibility behaviour the default rather than
 * something each screen has to remember:
 *
 *   - Escape closes.
 *   - Focus moves into the dialog on open, because a dialog that appears without
 *     taking focus leaves a keyboard user tabbing through the page behind it,
 *     which is the same bug as a modal that is only visually modal.
 *   - Focus returns to whatever opened it on close, so the next Tab continues
 *     from where the user left off rather than jumping to the top of the document.
 *   - Tab is trapped inside. Without this, a long dialog scrolls the page behind
 *     it to the end and back, which is disorienting and, on a page this tall,
 *     genuinely hard to recover from.
 *   - The page behind does not scroll. A scrim that stops working halfway through
 *     a read because the mouse reached the edge is worse than no scrim.
 *   - The backdrop closes, but only on the backdrop itself. A click that starts
 *     inside the dialog and ends outside must not dismiss, because on a dialog
 *     full of price buttons that is a text selection rather than a dismissal.
 *
 * The dialog is rendered into a portal on document.body. Without that it is
 * clipped by any ancestor with overflow hidden -- and on this app both the media
 * page and the betting page sit inside scroll containers, so an in-place dialog
 * would be cut off at the fold.
 */
export const Modal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  /** Rendered under the title in the chrome bar, right-aligned. */
  barRight?: React.ReactNode;
  /** Accent token family, so each outlet's popup carries its own colour. */
  accent?: string;
  /** Widest the dialog may grow. */
  widthClass?: string;
  children: React.ReactNode;
  className?: string;
}> = ({
  isOpen, onClose, title, barRight, accent, widthClass = 'max-w-3xl', children, className = '',
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return undefined;

    const opener = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] => {
      const root = panelRef.current;
      if (!root) return [];
      const nodes: HTMLElement[] = [];
      root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ).forEach((node) => { if (node.offsetParent !== null) nodes.push(node); });
      return nodes;
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const nodes = focusables();
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);

    // Scroll lock, by position rather than by overflow, so the page does not jump
    // to the top when its scrollbar disappears.
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    const frame = window.requestAnimationFrame(() => {
      const nodes = focusables();
      (nodes[0] ?? panelRef.current)?.focus();
    });

    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.cancelAnimationFrame(frame);
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
      opener?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[92] flex items-start justify-center overflow-y-auto bg-black/75 px-3 py-6 backdrop-blur-sm sm:py-10"
      // Only the backdrop itself dismisses. See the note on mousedown above.
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`w-full ${widthClass} border border-[var(--color-chrome-hi)] bg-[var(--color-panel)] shadow-[0_18px_48px_rgba(0,0,0,0.65)] ${className}`}
        style={accent ? { borderLeft: `3px solid var(--color-media-${accent})` } : undefined}
      >
        <div
          className="chrome-bar flex items-center justify-between gap-3 px-4"
          style={accent ? { borderLeft: `3px solid var(--color-media-${accent})` } : undefined}
        >
          <h2 id={titleId} className="t-h3 truncate" style={accent ? { color: `var(--color-media-${accent}-hi)` } : undefined}>
            {title}
          </h2>
          <div className="flex shrink-0 items-center gap-3">
            {barRight}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex h-7 w-7 items-center justify-center border border-[var(--color-chrome-lo)] bg-[var(--color-panel-2)] text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-chrome-hi)] hover:text-[var(--color-gold-hi)]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
};
