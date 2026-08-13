/**
 * Keeping Tab inside a surface that has covered the page.
 *
 * Two of them exist in the shell and they are not the same component: the overlay
 * (`app/shell/overlay.tsx`, CP.1) is a centred dialog, and the sidebar drawer
 * (`app/shell/sidebar-nav.tsx`, CP.2) is navigation sliding over the pane below 768px. What
 * they share is the trap — the same selector, the same cycle, the same two edges — and a
 * second copy of *that* is a second copy to keep correct.
 *
 * **Framework-free**: the event is taken as the three fields the logic reads, which a DOM
 * `KeyboardEvent` and a React synthetic event both satisfy, so neither caller has to convert
 * anything and this module imports nothing.
 */

/**
 * The elements Tab can reach, in document order.
 *
 * Deliberately a selector rather than a walk of the accessibility tree: what it is pointed at
 * is this application's own markup, so the list of shapes that can hold focus is known.
 * `disabled` is excluded by the selector; `aria-disabled` is not, because a control that stays
 * reachable to explain itself — the pattern the header's settings gear keeps — is one the
 * keyboard should still stop on.
 */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The parts of a key press this module reads — satisfied by a DOM event and a React one. */
export interface TrappableKeyEvent {
  /** Which key. Anything but `Tab` is ignored. */
  readonly key: string;
  /** Whether Shift was held, which is what reverses the cycle. */
  readonly shiftKey: boolean;
  /** Stop the browser moving focus itself. */
  preventDefault(): void;
}

/**
 * The tab stops inside a surface, in document order.
 *
 * @param root The surface.
 * @returns Its focusable descendants.
 */
export function focusStops(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

/**
 * Cycle Tab within a surface instead of letting it walk out into the page behind.
 *
 * A cycle rather than a guard on every focus event, because the guard version fights the
 * browser: it cannot tell a Tab from a click, and stealing focus back from a click is how a
 * reader ends up unable to use the address bar.
 *
 * @param event The key press, from anywhere inside the surface. Anything but Tab is left
 *   alone — Escape belongs to the caller, which is the only one that knows what closing means.
 * @param root The surface focus must stay inside.
 * @returns Nothing. Focus is moved, and the browser's own move prevented, only at the two
 *   edges — in the middle of the list Tab is left to do exactly what it would have done.
 */
export function trapTab(event: TrappableKeyEvent, root: HTMLElement): void {
  if (event.key !== "Tab") return;

  const stops = focusStops(root);

  // A surface with nothing focusable in it keeps focus where the caller put it, which is the
  // surface itself — Tab out of a modal is the one thing the trap exists to prevent.
  if (stops.length === 0) {
    event.preventDefault();
    return;
  }

  const first = stops[0];
  const last = stops[stops.length - 1];
  const active = root.ownerDocument.activeElement;

  // `active === root` is the state right after opening, where focus is on the surface itself
  // and a backwards Tab should reach the last stop rather than leaving.
  if (event.shiftKey && (active === first || active === root)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
