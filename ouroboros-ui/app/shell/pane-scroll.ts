/**
 * Holding the content pane still while an overlay is open
 * ([#643](https://github.com/NobuData/ouroboros/issues/643)).
 *
 * The last clause of the shell specification's scroll rule
 * (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.3): *"Full-viewport overlays (dialogs, sheets,
 * command palette) portal outside the pane and lock its scroll while open."* Without it a
 * wheel over a dialog scrolls the page behind the thing the reader is looking at, and closing
 * the dialog leaves them somewhere they never navigated to.
 *
 * **Framework-free and DOM-only**, so the mechanism can be tested as a mechanism —
 * `app/shell/overlay.tsx` is the React component that calls it, and the two are separable on
 * purpose: an effect that locks, restores and counts is the part with the interesting bugs.
 *
 * ### Why the lock is not simply `overflow: hidden`
 *
 * The pane carries `scrollbar-gutter: stable`, which reserves the classic scrollbar's width
 * whether or not the page is long enough to need one — that is what stops a short page and a
 * long page from being laid out at different widths. The gutter is only reserved for an
 * `overflow` of `scroll` or `auto` (CSS Overflow 3 § 3.4); the moment the lock sets it to
 * `hidden` the gutter is gone, the content box grows by its width, and every line in the pane
 * reflows *underneath the dialog that was opened over it*. On a platform with overlay
 * scrollbars that width is zero and nothing moves; on one without it, it is the layout shift
 * this whole issue exists to design out.
 *
 * So the lock measures the gutter before it removes it and hands the width back as padding.
 * `offsetWidth - clientWidth` is exactly that width — `clientWidth` excludes the scrollbar and
 * includes padding, and the pane has no border — and it is read *before* the class lands,
 * while there is still a gutter to measure.
 *
 * ### Why the count is per element
 *
 * Two overlays can be open at once — a dialog that opens a confirmation — and the first to
 * close must not unlock the pane the second is still holding. The depth is kept in a
 * {@link WeakMap} keyed by the pane rather than in a module-level counter, so a lock belongs
 * to the element it was taken on: a suite that renders a fresh shell gets a fresh count, and
 * a pane that is unmounted mid-lock takes its entry with it instead of leaving the next one
 * permanently held.
 */

/** The class the pane wears while a lock is held. Defined in `app/shell/shell.css`. */
export const PANE_LOCKED_CLASS = "app-shell__pane--locked";

/**
 * The custom property carrying the measured gutter width, set on the pane for the duration of
 * a lock and read by the rule that compensates for it.
 */
export const PANE_GUTTER_PROPERTY = "--shell-pane-gutter";

/** What is remembered about a pane while it is held. */
interface PaneLock {
  /** How many overlays are holding it. The lock lifts at zero. */
  depth: number;
  /** Where it was scrolled to when the first of them opened, restored when the last closes. */
  top: number;
}

/** The panes currently held, and by how many. Keyed by element — see the module note. */
const LOCKS = new WeakMap<HTMLElement, PaneLock>();

/**
 * Hold the pane still.
 *
 * The first caller records the scroll position, measures the scrollbar gutter and puts the
 * pane into its locked state; a nested caller only deepens the count. The **last** release
 * lifts the class and puts the scroll position back, which is the half of this that the
 * acceptance criterion is about: an overlay that restores nothing leaves the reader at the
 * top of a page they had scrolled halfway down.
 *
 * @param pane The content pane, as {@link import("./regions").shellPane} finds it.
 * @returns The release function for *this* lock. Idempotent — calling it twice releases once,
 *   so a React effect whose cleanup runs again under Strict Mode cannot decrement a count it
 *   no longer holds.
 */
export function lockPaneScroll(pane: HTMLElement): () => void {
  const held = LOCKS.get(pane);

  if (held === undefined) {
    // Measured first, while the gutter is still reserved: after the class lands there is
    // nothing left to measure.
    const gutter = pane.offsetWidth - pane.clientWidth;

    LOCKS.set(pane, { depth: 1, top: pane.scrollTop });
    pane.style.setProperty(PANE_GUTTER_PROPERTY, `${gutter}px`);
    pane.classList.add(PANE_LOCKED_CLASS);
  } else {
    held.depth += 1;
  }

  let released = false;

  return () => {
    if (released) return;
    released = true;

    const lock = LOCKS.get(pane);
    if (lock === undefined) return;

    lock.depth -= 1;
    if (lock.depth > 0) return;

    LOCKS.delete(pane);
    pane.classList.remove(PANE_LOCKED_CLASS);
    pane.style.removeProperty(PANE_GUTTER_PROPERTY);
    // Last, and deliberately after the class: an element cannot be scrolled back to a
    // position its own overflow rule is still refusing.
    pane.scrollTop = lock.top;
  };
}

/**
 * Is the pane currently held?
 *
 * Exists for the tests and for a caller that needs to know whether it is the first overlay
 * open — not for deciding whether to lock, which {@link lockPaneScroll} already counts.
 *
 * @param pane The content pane.
 * @returns True while at least one lock is outstanding.
 */
export function isPaneLocked(pane: HTMLElement): boolean {
  return LOCKS.has(pane);
}
