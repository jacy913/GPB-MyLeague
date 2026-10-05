import React from 'react';

/**
 * ============================================================================
 * THE BOUNDARY A RENDER THROW CANNOT GET PAST
 * ============================================================================
 *
 * There was no error boundary anywhere in `src/`, and the consequence is much worse than it
 * sounds. React does not recover from a throw during render on its own: with no boundary above it,
 * it unmounts the ENTIRE tree and leaves an empty document. One bad prop in one panel does not take
 * out one panel -- it takes out the application, including the navigation, so there is no way back
 * except a reload.
 *
 * That is exactly what happened in `MediaHub.clubsOf`: it returned `Game.awayTeam` (a `string // Team
 * ID`) where a `Team` was expected, `TeamLogo` was handed a string, it threw, and The Media came up
 * as a completely blank page. Measured at the time: `document.body.innerText` length 0, `#root`
 * child count 0. Diagnosing that from a screenshot cost an hour.
 *
 * WHAT THIS ACTUALLY CATCHES, and the limit is worth knowing before relying on it:
 *
 *   Errors thrown during render, in constructors, and in lifecycle methods. That is the class that
 *   blanks the application, and it is the class this exists for.
 *
 *   It does NOT catch errors in event handlers, in `setTimeout` callbacks, or in rejected promises.
 *   Those are outside React's render cycle and will still surface as nothing at all -- which is how
 *   two later defects stayed invisible: the Terminate Universe modal's Preview button called an
 *   `undefined` prop, and Commissioner's Export Backup awaited one the router had dropped. Both threw
 *   on click, and neither this boundary nor any other would have reported them. `tools/qaClicks.mjs`
 *   is what finds those, because finding them means clicking them.
 *
 * So this is a floor, not a net. What it buys is that the next render throw costs one panel instead
 * of the whole app, and says so on screen instead of showing nothing.
 *
 * ============================================================================
 * WHY IT LIVES INSIDE `<main>` AND NOT AROUND THE APP
 * ============================================================================
 *
 * Placement is the whole design decision. Wrapped around `<AppViewRouter>`, the shell -- the nav
 * rail, the score ticker, the header -- is outside the boundary and survives a throw in any view, so
 * the manager can navigate somewhere that works instead of reloading and losing their place. Wrapped
 * around the whole application instead, a throw in any view would still blank everything, which is
 * the failure this exists to remove.
 */

/** What the failure screen needs to know, and nothing more. */
interface ViewBoundaryProps {
  children: React.ReactNode;
  /**
   * Changes whenever the view changes, and CLEARS any caught error when it does.
   *
   * This is not optional and it is the part that is easy to forget. A React error boundary does not
   * retry just because its children changed: once it has caught an error it keeps rendering the
   * fallback until it is unmounted or explicitly reset. Without this prop the failure screen would
   * follow the manager around the application -- break one view, and every view after it is dead
   * too, with no reload and no way back. That is a strictly worse failure than the one being fixed.
   *
   * It also makes "try again" honest, because the component identity is unchanged on a retry and the
   * state has to be cleared deliberately rather than by remounting.
   */
  resetKey: string;
  /** The view's name, so the screen says which screen failed rather than "an error occurred". */
  viewLabel: string;
  /** Where to send the reader from the failure screen. Always available, unlike a reload. */
  onGoHome: () => void;
  /** Dev-only extra detail. Left to the console in production builds. */
  showStack?: boolean;
}

interface ViewBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

export class ViewBoundary extends React.Component<ViewBoundaryProps, ViewBoundaryState> {
  override state: ViewBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<ViewBoundaryState> {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    /*
      LOGGED, ALWAYS, AND LOUDLY.

      The failure screen already shows the reader what went wrong, which makes it tempting to treat
      this as sufficient. It is not: the screen is read by one person having a bad day, the console is
      read by whoever fixes it. A boundary that swallowed the error and rendered a tidy message would
      turn a loud failure into a silent one, which is a far worse thing to hand back -- it looks like
      a handled case, and nobody goes looking for a bug nobody reported.

      The component stack is retained into state rather than only logged, so `showStack` can put the
      frame that threw in front of the person debugging it instead of only in a console they may never
      open.
    */
    this.setState({ componentStack: info.componentStack ?? null });
    console.error(
      `[ViewBoundary] ${this.props.viewLabel} threw during render; showing the failure screen.`,
      error,
      info.componentStack,
    );
  }

  override componentDidUpdate(prevProps: ViewBoundaryProps): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, componentStack: null });
    }
  }

  /** Clear the caught error and render the children again. */
  private readonly retry = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  private renderFallback(): React.ReactElement {
    const { error, componentStack } = this.state;
    const { viewLabel, onGoHome, showStack } = this.props;

    return (
      <div className="mx-auto max-w-3xl p-2" role="alert">
        <div className="border-l-[3px] border-l-[var(--color-warn)] bg-[var(--color-sunken)] p-4">
          <p className="t-label text-[var(--color-warn)]">{viewLabel} could not be drawn</p>
          <h2 className="t-h2 mt-1">Something on this screen failed to render</h2>

          {/*
            THE ACTUAL MESSAGE, on screen, not a generic apology.

            "Something went wrong" tells the reader nothing they can act on and tells whoever is
            fixing it nothing at all. The message is the one piece of information that identifies the
            defect, and a manager who sees it can say so. It is rendered as text, never as markup --
            an error message is untrusted input, and an error boundary is exactly where untrusted
            strings turn up.
          */}
          <p className="t-body mt-3 break-words text-[var(--color-ink-dim)]">
            {error?.message ?? 'No message was attached to the error.'}
          </p>

          {showStack && componentStack && (
            <pre className="t-caption mt-3 max-h-48 overflow-auto whitespace-pre-wrap text-[var(--color-ink-faint)]">
              {componentStack}
            </pre>
          )}

          <p className="t-caption mt-3 text-[var(--color-ink-faint)]">
            The rest of the app is still running, so you can carry on from the sidebar. If this screen
            is one you need, the details are in the browser console.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {/*
              RETRY FIRST, because the most common cause is data rather than code: a game that names a
              club the league does not have, a save from an older build. Those clear on their own once
              the reader is somewhere else, and re-rendering is the honest first suggestion.

              HOME SECOND, and the note above it says why this exists -- the point is that there is a
              way out that does not involve a reload and losing your place.
            */}
            <button
              type="button"
              onClick={this.retry}
              className="border border-[var(--color-chrome-hi)] bg-[var(--color-panel-2)] px-4 py-2 t-label transition-colors hover:border-[var(--color-gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={onGoHome}
              className="border border-[var(--color-chrome-lo)] bg-transparent px-4 py-2 t-label text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-chrome-hi)] hover:text-[var(--color-gold-hi)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  override render(): React.ReactNode {
    if (this.state.error) return this.renderFallback();
    return this.props.children;
  }
}