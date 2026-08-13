"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { useClientValue } from "./client-value";
import { lockPaneScroll } from "./pane-scroll";
import { shellOverlayLayer, shellPane } from "./regions";

import "./shell.css";

/**
 * The overlay layer's one component: a dialog that renders outside the content pane and holds
 * the pane still while it is open
 * ([#643](https://github.com/NobuData/ouroboros/issues/643)).
 *
 * The shell specification's last scroll clause (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.3) names
 * three things that behave this way — dialogs, sheets and the command palette — and they have
 * exactly one requirement in common, which is this component. Where they differ is what they
 * draw, so this takes children and decides nothing about them.
 *
 * ### Outside the pane, not merely above it
 *
 * The panel is portalled into `app/shell/app-shell.tsx`'s overlay layer, which is a *sibling*
 * of the pane in the shell grid. Rendered inside the pane instead, a dialog would be clipped
 * by the pane's own `overflow`, scrolled by the pane's scrollbar, and unable to cover the
 * header — a grid cell cannot paint outside its own row. Portalling is the only way a subtree
 * can leave a scroll container without leaving the React tree that owns its state.
 *
 * Outside the shell — the login screen, the onboarding wizard (design system § 5) — there is
 * no layer and no pane. The fallback is `<body>`, which is still outside both, and the lock is
 * simply not taken because there is nothing holding a scroll position to hold still.
 *
 * ### What it owns, and what it does not
 *
 * It owns the modal contract: Escape closes, a press on the backdrop closes, focus moves into
 * the panel on open and returns to the control that opened it on close, and Tab cycles within
 * the panel rather than walking the page behind it. It owns **no** appearance beyond the
 * panel's box — a palette, a confirmation and a sheet are three different things inside the
 * same frame.
 *
 * `open` is a prop rather than internal state, and the panel is unmounted rather than hidden
 * when it is false: an overlay that is merely invisible is one the keyboard can still reach
 * and a screen reader can still read.
 */

/** What an overlay needs to be told. */
export interface ShellOverlayProps {
  /** Whether it is open. False renders nothing at all — see the note above. */
  readonly open: boolean;
  /**
   * Called when the reader dismisses it: Escape, or a press outside the panel. The caller
   * owns `open`, so nothing closes without it agreeing.
   */
  readonly onClose: () => void;
  /**
   * The dialog's accessible name. Required rather than optional: a modal without one is
   * announced as "dialog" and nothing else, which is the least useful moment in a screen
   * reader's day to say nothing.
   */
  readonly label: string;
  /** What the panel draws. */
  readonly children: React.ReactNode;
}

/**
 * The elements Tab can reach, in document order.
 *
 * Deliberately a selector rather than a walk of the accessibility tree: the panel's contents
 * are this application's own markup, so the list of shapes that can hold focus is known.
 * `disabled` is excluded by the selector; `aria-disabled` is not, because a control that
 * stays reachable to explain itself — the pattern the header's settings gear keeps — is one
 * the keyboard should still stop on.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog outside the content pane.
 *
 * @param props See {@link ShellOverlayProps}.
 * @returns The portalled overlay while open; `null` otherwise, and `null` on the server,
 *   where there is no DOM to portal into.
 */
export function ShellOverlay({ open, onClose, label, children }: ShellOverlayProps) {
  /**
   * The portal's target: `null` on the server, where there is no DOM to portal into, and the
   * shell's overlay layer in the browser. `app/shell/client-value.ts` is why it is read this
   * way rather than in an effect.
   *
   * The same node every render, so the store below it is stable — the layer is markup the
   * shell renders once, and `<body>` outside the shell is likewise a fixture of the document.
   */
  const layer = useClientValue<HTMLElement | null>(
    () => shellOverlayLayer() ?? document.body,
    null,
  );
  const panel = useRef<HTMLDivElement>(null);

  /**
   * The pane lock, for exactly as long as the overlay is open.
   *
   * The cleanup is the release, which is what ties "restores the previous position" to the
   * component's lifetime rather than to any particular way of closing: Escape, the backdrop,
   * a route change that unmounts the whole thing — all three run this cleanup.
   */
  useEffect(() => {
    if (!open) return;

    const pane = shellPane();
    if (pane === null) return;

    return lockPaneScroll(pane);
  }, [open]);

  /**
   * Focus in, and focus back out again.
   *
   * `layer` is in the dependencies because the panel does not exist until the portal has
   * somewhere to render: without it this would run once, against a ref that is still null,
   * and the dialog would open with focus left on the page behind it.
   */
  useEffect(() => {
    if (!open || layer === null) return;

    const returnTo = document.activeElement;
    panel.current?.focus();

    return () => {
      // The opener may have been unmounted while the overlay was up — a menu item that closed
      // its own menu — in which case there is nowhere to go back to and the browser's default
      // (the body) is the honest answer.
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
    };
  }, [open, layer]);

  if (!open || layer === null) return null;

  /**
   * Escape closes; Tab cycles inside the panel.
   *
   * The trap is a cycle rather than a guard on every focus event, because the guard version
   * fights the browser — it cannot tell a Tab from a click, and stealing focus back from a
   * click is how a reader ends up unable to use the address bar.
   *
   * @param event The key press, from anywhere inside the panel.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      // Stopped here so an Escape meant for the dialog does not also close a menu the dialog
      // was opened from.
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== "Tab" || panel.current === null) return;

    const stops = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];

    // A panel with nothing focusable in it keeps focus on the panel, which is where the
    // effect above put it — Tab out of a modal is the one thing the trap exists to prevent.
    if (stops.length === 0) {
      event.preventDefault();
      return;
    }

    const first = stops[0];
    const last = stops[stops.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || active === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /**
   * A press on the ground outside the panel dismisses it.
   *
   * `mousedown` rather than `click`: a click fires on the element the press *ended* over, so a
   * drag that starts on a text selection inside the panel and finishes on the backdrop would
   * close the dialog the reader was selecting from. The target check is what makes it the
   * backdrop rather than the panel — the event bubbles from both.
   *
   * @param event The press.
   */
  function onBackdropPress(event: React.MouseEvent<HTMLDivElement>): void {
    if (event.target === event.currentTarget) onClose();
  }

  return createPortal(
    // The backdrop is a dismissal surface rather than a control, which is why it takes
    // `role="presentation"` and no key handler of its own: Escape on the panel is the
    // keyboard's way out, and it is the same way out.
    <div className="shell-overlay" role="presentation" onMouseDown={onBackdropPress}>
      <div
        className="shell-overlay__panel"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        // A target for the effect above, and not a tab stop: the trap cycles through the
        // panel's contents, never through the panel itself.
        tabIndex={-1}
        ref={panel}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>,
    layer,
  );
}
