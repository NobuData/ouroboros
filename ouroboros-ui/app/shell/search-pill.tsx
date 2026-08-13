"use client";

import { Search } from "lucide-react";
import { useEffect, useState } from "react";

import { useClientValue } from "./client-value";
import { ShellOverlay } from "./overlay";

/**
 * The header's search pill, and the ⌘K that opens it
 * ([#643](https://github.com/NobuData/ouroboros/issues/643)).
 *
 * First of the right-hand cluster, where the shell specification puts it
 * (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 1.1). Two of the three parts are this issue's: the
 * pill, and the keyboard shortcut wired to it. The third — what the palette *searches* — is
 * [#79](https://github.com/NobuData/ouroboros/issues/79), and the panel says so rather than
 * miming a result list, which is the design system's honesty rule (§ 3.5): a surface that is
 * not ready is labelled, never dead.
 *
 * That leaves this the shell's own demonstration that the overlay layer works, which is worth
 * more than a fixture would be. The acceptance criterion *"opening an overlay locks pane
 * scroll; closing it restores the previous position"* is exercised by the one control in the
 * product that opens one, so the mechanism cannot rot between here and #79.
 */

/** What the shortcut is called on a Mac keyboard, which is what the specification draws. */
const MAC_HINT = "⌘K";

/** What it is called everywhere else. */
const OTHER_HINT = "Ctrl K";

/**
 * Which of the two names the keyboard in front of the reader uses.
 *
 * `userAgent` rather than the deprecated `navigator.platform`, and the answer is only ever
 * *displayed* — both modifiers are accepted below — so a wrong guess costs a label and
 * nothing else.
 *
 * One of two module constants, never a fresh string: {@link useClientValue} compares what it
 * reads by identity, and a value rebuilt on every render would be a change on every render.
 *
 * @returns The name of the modifier this platform spells the shortcut with.
 */
function shortcutHint(): string {
  return /Mac|iPhone|iPad/i.test(navigator.userAgent) ? MAC_HINT : OTHER_HINT;
}

/**
 * The pill, and the panel it opens.
 *
 * @returns The control and, while open, its overlay.
 */
export function SearchPill() {
  const [open, setOpen] = useState(false);

  /**
   * The shortcut's own name, which is not the same on every keyboard.
   *
   * The server has no keyboard to ask, so it renders the specification's own spelling and the
   * browser corrects it in the same hydration pass — `app/shell/client-value.ts` sets out why
   * that is a `useSyncExternalStore` rather than an effect that calls `setState`.
   */
  const hint = useClientValue(shortcutHint, MAC_HINT);

  useEffect(() => {
    /**
     * Open on ⌘K or Ctrl+K, wherever focus happens to be.
     *
     * Both modifiers, not one per platform: a Mac user on an external PC keyboard presses
     * Control, and the cost of accepting the other is nothing. `preventDefault` matters —
     * Ctrl+K is the browser's own search shortcut in Firefox, and a palette that opens behind
     * the address bar is a palette nobody can type into.
     *
     * @param event The key press.
     */
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key.toLowerCase() !== "k") return;
      if (!event.metaKey && !event.ctrlKey) return;

      event.preventDefault();
      setOpen(true);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        className="shell-search"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Search className="shell-search__icon" size={14} aria-hidden />
        <span className="shell-search__label">Search</span>
        {/* The key cap is decoration beside a control that already has a name — the shortcut
            is announced by neither, because a screen-reader user reaches this by Tab. */}
        <kbd className="shell-search__key" aria-hidden>
          {hint}
        </kbd>
      </button>

      <ShellOverlay open={open} onClose={() => setOpen(false)} label="Search">
        <h2 className="shell-overlay__title">Search</h2>
        <p className="shell-overlay__note">
          The navigation palette arrives with #79. Until it does, the sidebar is how the
          product is navigated — every module it lists is one press away.
        </p>
        <button type="button" className="shell-overlay__close" onClick={() => setOpen(false)}>
          Close
        </button>
      </ShellOverlay>
    </>
  );
}
