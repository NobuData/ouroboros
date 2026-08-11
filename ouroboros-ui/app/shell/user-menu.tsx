"use client";

import { CircleUser } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

/**
 * The account menu in the top-right corner of the header.
 *
 * ### What it can honestly show today
 *
 * Sessions are #33 and the profile menu's real contents are CP.3 (#645) — identity,
 * the font-size stepper, the theme control, the settings link and sign out. None of
 * those surfaces exist yet, so this ships the *menu*, with its two eventual actions
 * present and marked unavailable rather than absent: the design system's rule is that a
 * control which cannot act explains itself (§ 3.5), and a menu that silently omits
 * "Sign out" teaches the wrong shape.
 *
 * The items therefore carry `aria-disabled` rather than `disabled`. A disabled button
 * leaves the tab order, taking its explanation with it; an `aria-disabled` one is still
 * reachable, still announces why, and — having no handler — still does nothing.
 *
 * ### What it does own
 *
 * The interaction, which does not change when the items become real: the menu opens
 * from the avatar, closes on Escape, on a click outside, or when focus leaves; Escape
 * returns focus to the button it came from; and Arrow/Home/End move a roving focus
 * through the items. Building that once here is why CP.3 is a content change.
 *
 * @returns The avatar button and, while open, its menu.
 */
export function UserMenu() {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  /**
   * Close the menu, optionally putting focus back where it came from.
   *
   * @param restoreFocus Whether to focus the avatar again. True for a keyboard
   *   dismissal, where focus would otherwise fall to the document; false for a click
   *   elsewhere, where stealing focus back is the wrong answer.
   */
  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }, []);

  // Dismissal from outside the menu: a pointer press anywhere else, which includes the
  // avatar itself — the button's own handler toggles, and this effect is registered
  // only while open, so the two do not fight over the same press.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && wrapper.current?.contains(target)) return;
      close(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  // Opening moves focus into the menu, which is what makes the keyboard path work: the
  // arrow keys below are handled on the menu, and Escape has somewhere to return from.
  useEffect(() => {
    if (open) items(menu.current)[0]?.focus();
  }, [open]);

  /**
   * Keyboard handling for the open menu.
   *
   * @param event The key press, captured on the menu container so every item shares
   *   one handler and the roving focus has a single source of truth: the DOM.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const entries = items(menu.current);
    const at = entries.indexOf(document.activeElement as HTMLElement);

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      case "ArrowDown":
        event.preventDefault();
        entries[(at + 1) % entries.length]?.focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        entries[(at - 1 + entries.length) % entries.length]?.focus();
        break;
      case "Home":
        event.preventDefault();
        entries[0]?.focus();
        break;
      case "End":
        event.preventDefault();
        entries[entries.length - 1]?.focus();
        break;
      case "Tab":
        // Tabbing out is a dismissal, and the browser's own focus move is the right
        // one — so this closes without preventing it or dragging focus back.
        close(false);
        break;
    }
  };

  return (
    <div className="shell-menu" ref={wrapper}>
      <button
        type="button"
        className="shell-avatar"
        ref={trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Account menu"
        onClick={() => setOpen((was) => !was)}
      >
        <CircleUser size={20} aria-hidden />
      </button>

      {open && (
        <div
          className="shell-menu__panel"
          id={menuId}
          role="menu"
          aria-label="Account"
          ref={menu}
          onKeyDown={onKeyDown}
        >
          <p className="shell-menu__identity">
            Not signed in.
            <span className="shell-menu__note">
              Accounts and sessions arrive with #33; the full profile menu — identity,
              font size, theme — with #645.
            </span>
          </p>
          <button
            type="button"
            className="shell-menu__item"
            role="menuitem"
            tabIndex={-1}
            aria-disabled="true"
            title="Workspace settings arrive with #491."
          >
            Workspace settings
          </button>
          <button
            type="button"
            className="shell-menu__item"
            role="menuitem"
            tabIndex={-1}
            aria-disabled="true"
            title="Sign out arrives with sessions (#33)."
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The menu's focusable items, in document order.
 *
 * Read from the DOM rather than held in a ref array so that CP.3 can add, remove or
 * reorder items without touching the keyboard handling above.
 *
 * @param panel The open menu, or null when it is closed.
 * @returns The items, or an empty list when there is no menu.
 */
function items(panel: HTMLElement | null): HTMLElement[] {
  return Array.from(panel?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
}
