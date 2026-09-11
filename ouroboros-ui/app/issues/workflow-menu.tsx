"use client";

import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import { menuConsumesKey, menuFocusTarget, menuItems, menuKeyAction } from "@/app/shell/menu";
import { Button } from "@/app/ui";

import {
  ASSIGN_CARET,
  ASSIGN_LABEL,
  ASSIGN_MENU_LABEL,
  SUGGESTED_LABEL,
  SUGGESTED_NOTE,
  WORKFLOWS,
  type WorkflowChoice,
} from "./bar";

/**
 * **Assign workflow ▾** ([#118](https://github.com/NobuData/ouroboros/issues/118)) — the menu
 * that decides what the selection is queued under.
 *
 * ### Five rows, one of them checked
 *
 * *Use suggested* first, which is the default and what the page head's **Queue N selected ⟳**
 * always does: no workflow in the request, each issue under the one its own estimate suggested.
 * Then the fixed set (decision K5), in `app/issues/bar.ts`'s order. The rows are
 * `menuitemradio` rather than `menuitem`, because the choice *is* one among alternatives with
 * one current — `aria-checked` on the current row is how a reader hears where they already are,
 * and the primary action beside the trigger reflects the same choice in its label.
 *
 * ### The keyboard is `app/shell/menu.ts`'s
 *
 * The ARIA menu pattern as decisions — roving focus that wraps, Escape closing and restoring
 * focus, Tab dismissing without stealing the browser's own move — written once for the shell's
 * menus and reused here as the registry's import menu and the routing page's alias menu reuse
 * it. The wiring is theirs too: open state, the outside-press dismissal, focus onto the first
 * row on open and back on the trigger on close.
 *
 * @param props.choice The workflow chosen, or `null` for *use suggested*.
 * @param props.onChoose What to do with a row picked. The menu closes itself.
 * @returns The trigger, and the panel while it is open.
 */
export function WorkflowMenu({
  choice,
  onChoose,
}: Readonly<{ choice: WorkflowChoice; onChoose: (choice: WorkflowChoice) => void }>) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  /**
   * The trigger, found rather than held: the direct-child selector is exact because the rows
   * are inside the panel.
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
   *   browser is already resolving — a Tab, or a press elsewhere on the page.
   */
  function close(restoreFocus: boolean): void {
    setOpen(false);
    if (restoreFocus) triggerElement()?.focus();
  }

  // A press anywhere outside dismisses — `pointerdown` rather than `click`, so the menu is
  // gone before whatever was pressed reacts.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent): void {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  // Focus lands on the first row when the menu opens, so a keyboard reader is never left on a
  // trigger whose menu opened somewhere they are not.
  useEffect(() => {
    if (!open) return;

    const first = menuItems(menu.current)[0];
    if (first !== undefined && !menu.current?.contains(document.activeElement)) first.focus();
  }, [open]);

  /**
   * The menu's keyboard.
   *
   * @param event The key press, on the panel — the rows do not listen individually.
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
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
    const target = menuFocusTarget(
      action,
      rows.indexOf(document.activeElement as HTMLElement),
      rows.length,
    );

    if (target !== undefined) rows[target]?.focus();
  }

  /**
   * Pick a row.
   *
   * @param picked The workflow, or `null` for *use suggested*.
   */
  function pick(picked: WorkflowChoice): void {
    onChoose(picked);
    close(true);
  }

  return (
    <div className="issues-bar__menu-wrap" ref={wrapper}>
      <Button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
        size="sm"
        tone="ghost"
      >
        {ASSIGN_LABEL}
        <span aria-hidden className="issues-bar__caret">
          {ASSIGN_CARET}
        </span>
      </Button>

      {open ? (
        <div
          aria-label={ASSIGN_MENU_LABEL}
          className="issues-bar__menu"
          id={menuId}
          onKeyDown={onKeyDown}
          ref={menu}
          role="menu"
          tabIndex={-1}
        >
          <button
            aria-checked={choice === null}
            className="issues-bar__option"
            onClick={() => pick(null)}
            role="menuitemradio"
            type="button"
          >
            <span className="issues-bar__option-name">{SUGGESTED_LABEL}</span>
            <span className="issues-bar__option-note">{SUGGESTED_NOTE}</span>
          </button>
          {WORKFLOWS.map((workflow) => (
            <button
              aria-checked={choice === workflow}
              className="issues-bar__option"
              key={workflow}
              onClick={() => pick(workflow)}
              role="menuitemradio"
              type="button"
            >
              <span className="issues-bar__option-name issues-bar__option-name--tag">{workflow}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
