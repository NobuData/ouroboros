"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { menuFocusTarget, menuItems, menuKeyAction, menuConsumesKey } from "@/app/shell/menu";
import { Button } from "@/app/ui";

import {
  IMPORT_CARET,
  IMPORT_ITEM_REASON,
  IMPORT_LABEL,
  IMPORT_MENU_LABEL,
  type ImportState,
} from "./view";

import "./registry.css";

/**
 * Mockup 21's **Import from provider ▾** — the ghost action and the menu behind it
 * ([#591](https://github.com/NobuData/ouroboros/issues/591)).
 *
 * The mockup draws a button with a caret and nothing about what happens next. What the ticket
 * asks for is the part the drawing leaves out: a dropdown over the workspace's **connected
 * providers**, and a state the mockup never shows but a fresh workspace hits immediately —
 * nothing connected at all.
 *
 * ### The menu is this ticket's; the wizard behind it is not
 *
 * CI.4 ([#594](https://github.com/NobuData/ouroboros/issues/594)) owns the import wizard, and
 * this ticket blocks it. So the list is **real** — these are the connections the workspace
 * actually has, in the order the service serves them — and each row is inert with a sentence
 * naming the issue that will wire it (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.5). That is the
 * honest shape of a frame: the page already answers *which providers could I import from*,
 * and says plainly that the import itself is not built. A row that silently did nothing when
 * pressed would be the one dishonest thing on a page built to be honest.
 *
 * When CI.4 lands, the change here is an `onClick` per row and one deleted constant.
 *
 * ### `aria-disabled`, never `disabled` — including inside the menu
 *
 * The house rule (`app/ui/button.tsx`): a `disabled` control leaves the tab order and takes
 * its own explanation with it, so the keyboard reader who most needs the tooltip is the one
 * who could never reach it. The rows are therefore in the menu's roving focus and carry their
 * reason as a `title`, exactly as the shell's own menu does for a stepper at the end of its
 * range.
 *
 * ### The keyboard is `app/shell/menu.ts`'s, not this file's
 *
 * That module is the ARIA menu pattern as decisions — roving focus, Escape closing, Tab
 * dismissing without stealing the browser's own move — written framework-free for the shell's
 * two menus. This is the third, and a second copy of that logic would be a second copy to keep
 * correct. What is left here is the wiring: open state, the outside-press dismissal, and
 * putting focus on the first row when the menu opens and back on the trigger when it closes.
 *
 * A Client Component, and the only one on this page: the head's other action and everything
 * below the tab set are static.
 */

/** What the control needs to be told. */
export interface ImportMenuProps {
  /**
   * Whether there is anything to import from, and what to say when there is not.
   *
   * Decided in `app/registry/view.ts` rather than here, so that *which of three reasons this
   * control is inert for* is a unit test on a small object rather than an assertion about a
   * tooltip.
   */
  readonly state: ImportState;
}

/**
 * The import action.
 *
 * @param props See {@link ImportMenuProps}.
 * @returns The ghost button on its own when the action is blocked, and the button with its
 *   menu when it is not.
 */
export function ImportMenu({ state }: ImportMenuProps) {
  const [open, setOpen] = useState(false);

  const wrapper = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  /**
   * The trigger, found rather than held.
   *
   * `Button` (`app/ui/button.tsx`) takes no `ref`, and giving the shared primitive one for
   * this page's sake would be a change to #46's set that no other screen has asked for. The
   * direct-child selector is what makes the lookup exact: the rows are inside the panel, so
   * `:scope > button` can only ever be the trigger.
   *
   * @returns The trigger element, or `null` before the first render has committed.
   */
  function triggerElement(): HTMLButtonElement | null {
    return wrapper.current?.querySelector<HTMLButtonElement>(":scope > button") ?? null;
  }

  /**
   * Close the menu.
   *
   * @param restoreFocus Whether focus goes back to the trigger. False for a dismissal the
   *   browser is already resolving — a Tab, or a press somewhere else on the page — because
   *   moving focus back would undo the move the reader just made.
   */
  function close(restoreFocus: boolean): void {
    setOpen(false);
    if (restoreFocus) triggerElement()?.focus();
  }

  // A press anywhere outside dismisses. `pointerdown` rather than `click`, so the menu is gone
  // before whatever was pressed reacts — the same choice `app/shell/user-menu.tsx` makes, and
  // for the same reason: a menu that closed on `click` would still be over the control the
  // reader was aiming at when the press landed.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent): void {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); };
  }, [open]);

  // Focus lands on the first row when the menu opens, which is the ARIA menu pattern and also
  // the only way a keyboard reader learns it opened at all.
  useEffect(() => {
    if (open) menuItems(menu.current)[0]?.focus();
  }, [open]);

  /**
   * The menu's keyboard.
   *
   * @param event The key press, on the menu itself — the rows do not listen individually,
   *   because the walk is over whatever is rendered rather than over a list held in a ref.
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    // No submenu here, so both flags are false and the pattern reduces to Escape, the arrows,
    // Home/End and Tab. Passing them explicitly rather than defaulting them is what keeps this
    // call readable against the shell's, which does have one.
    const action = menuKeyAction(event, { inSubmenu: false, onBranch: false });

    if (menuConsumesKey(action)) event.preventDefault();

    if (action === "close") {
      close(true);
      return;
    }

    if (action === "dismiss") {
      close(false);
      return;
    }

    const rows = menuItems(menu.current);
    const target = menuFocusTarget(action, rows.indexOf(document.activeElement as HTMLElement), rows.length);

    if (target !== undefined) rows[target]?.focus();
  }

  if (state.kind === "blocked") {
    // No menu, no client state that matters, and no caret: a caret promises a list, and
    // there is not one. `reason` is what makes the button inert, so it cannot be switched off
    // without saying why.
    return (
      <Button reason={state.reason} tone="ghost">
        {IMPORT_LABEL}
      </Button>
    );
  }

  return (
    <div className="registry-import" ref={wrapper}>
      <Button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => { setOpen(!open); }}
        tone="ghost"
      >
        {IMPORT_LABEL}
        <span aria-hidden className="registry-import__caret">
          {IMPORT_CARET}
        </span>
      </Button>

      {open ? (
        <div
          aria-label={IMPORT_MENU_LABEL}
          className="registry-import__panel"
          id={menuId}
          onKeyDown={onKeyDown}
          ref={menu}
          role="menu"
        >
          {state.sources.map((source) => (
            <button
              aria-disabled
              className="registry-import__item"
              key={source.id}
              role="menuitem"
              title={IMPORT_ITEM_REASON}
              type="button"
            >
              {source.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
