"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { menuFocusTarget, menuItems, menuKeyAction, menuConsumesKey } from "@/app/shell/menu";
import { Button } from "@/app/ui";

import { ImportWizard } from "./import-wizard";
import {
  IMPORT_CARET,
  IMPORT_LABEL,
  IMPORT_MENU_LABEL,
  type ImportSource,
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
 * ### The menu chooses; the wizard behind it does the work
 *
 * The list is **real** — these are the connections the workspace actually has, in the order the
 * service serves them — and since CI.4
 * ([#594](https://github.com/NobuData/ouroboros/issues/594)) a row opens
 * `app/registry/import-wizard.tsx` scoped to that connection. Choosing here *is* the wizard's
 * first step, which is why the wizard has no connection screen of its own: the answer arrived
 * with the press, and a step that only ever echoed a choice already made would be a step
 * nobody could act on.
 *
 * Pressing a row closes the menu, for the reason every menu closes on a choice: the panel would
 * otherwise sit over the dialog it just opened.
 *
 * ### `aria-disabled`, never `disabled`
 *
 * The house rule (`app/ui/button.tsx`): a `disabled` control leaves the tab order and takes
 * its own explanation with it, so the keyboard reader who most needs the tooltip is the one
 * who could never reach it. It is the **trigger** that this applies to now — inert with its
 * reason for a member, for a workspace with nothing connected, and for a failed read — since
 * the rows themselves can act.
 *
 * ### The keyboard is `app/shell/menu.ts`'s, not this file's
 *
 * That module is the ARIA menu pattern as decisions — roving focus, Escape closing, Tab
 * dismissing without stealing the browser's own move — written framework-free for the shell's
 * two menus. This is the third, and a second copy of that logic would be a second copy to keep
 * correct. What is left here is the wiring: open state, the outside-press dismissal, and
 * putting focus on the first row when the menu opens and back on the trigger when it closes.
 *
 * A Client Component. So is the head's other action since CI.4, and so is the table's switch;
 * what stays a Server Component is everything that only draws.
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
  /**
   * Every alias name this workspace has, handed through to the wizard's row-level uniqueness
   * check.
   *
   * It passes through rather than being read again: the table on the page behind has the list
   * already, and a second read would be a second answer to *what is taken*.
   */
  readonly aliasNames: readonly string[];
}

/**
 * The import action.
 *
 * @param props See {@link ImportMenuProps}.
 * @returns The ghost button on its own when the action is blocked, and the button with its
 *   menu when it is not.
 */
export function ImportMenu({ state, aliasNames }: ImportMenuProps) {
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState<ImportSource | null>(null);

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
              className="registry-import__item"
              key={source.id}
              onClick={() => {
                // Focus goes back to the trigger and the wizard takes it from there: the
                // overlay reads the focused element when it opens, so the way out of the dialog
                // lands on the control the whole flow started from.
                close(true);
                setImporting(source);
              }}
              role="menuitem"
              type="button"
            >
              {source.name}
            </button>
          ))}
        </div>
      ) : null}

      {/*
        Rendered only while a connection is chosen, and keyed by it: mounting the wizard is
        opening it, so the read it makes and the state it holds start clean for every open
        without a reset path anybody has to keep correct.
      */}
      {importing !== null && (
        <ImportWizard
          aliasNames={aliasNames}
          key={importing.id}
          onClose={() => { setImporting(null); }}
          source={importing}
        />
      )}
    </div>
  );
}
