"use client";

import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from "react";

import type { WorkflowStageType } from "@/app/api/workflows";
import { menuConsumesKey, menuFocusTarget, menuItems, menuKeyAction } from "@/app/shell/menu";
import { Button, type ButtonTone } from "@/app/ui";

import type { EditRule } from "./rules";
import { RULE_REASONS } from "./view";

import "./canvas.css";

/**
 * The catalog as a menu (S.5, [#151](https://github.com/NobuData/ouroboros/issues/151)) — mockup 04's
 * **Add stage ▾**, and the same menu where a stage is inserted into an edge.
 *
 * ### Built from R.3's catalog
 *
 * One row per node type the catalog serves (`GET /api/v1/workflows/catalog`, #145), with the glyph and
 * the label the catalog gives it, so a node type added to the DSL is on the menu without a UI change.
 *
 * ### A row that would break a rule says so, and stays in the walk
 *
 * The caller says which rule picking a type would break (`problemFor` — a second trigger, a trigger
 * or a terminal between two stages), and that row is drawn `aria-disabled` with the reason printed
 * under its name. It is not removed and not skipped: a menu that silently lacked *Trigger* would
 * leave a reader wondering where it went, and the reason is the answer. Pressing it does nothing.
 *
 * ### The keyboard is `app/shell/menu.ts`'s
 *
 * The ARIA menu pattern the shell's menus and the issues page's workflow menu share: focus on the
 * first row when it opens, arrows that wrap, Home and End, Escape closing with focus back on the
 * trigger, Tab dismissing. **Open is the caller's**, because the canvas opens this menu from a
 * double-click as well as from its button.
 */

/** Where the menu's rows appear: above its button on the canvas's toolbar, or in the flow of the inspector. */
export type StageMenuPlacement = "up" | "inline";

/** What the menu takes. */
export interface StageMenuProps {
  /** The button's label. */
  readonly label: ReactNode;
  /** The menu's accessible name, printed as its heading. */
  readonly menuLabel: string;
  /** The catalog's node types. */
  readonly types: readonly WorkflowStageType[];
  /** The rule picking a type would break, or `null` when it may be picked. */
  readonly problemFor: (type: string) => EditRule | null;
  /** Told the type picked. The menu closes itself. */
  readonly onPick: (type: WorkflowStageType) => void;
  /** Whether the rows are showing. */
  readonly open: boolean;
  /** Told to open or close. */
  readonly onOpenChange: (open: boolean) => void;
  /** Why the button cannot act, when it cannot — which also keeps the rows closed. */
  readonly reason?: string;
  /** Where the rows appear. */
  readonly placement: StageMenuPlacement;
  /** The button's treatment. */
  readonly tone?: ButtonTone;
}

/** Each placement's wrapper, as a literal class list. */
const WRAP_CLASS: Readonly<Record<StageMenuPlacement, string>> = {
  up: "studio-stage-menu",
  inline: "studio-stage-menu studio-stage-menu--inline",
};

/** Each placement's panel, as a literal class list. */
const PANEL_CLASS: Readonly<Record<StageMenuPlacement, string>> = {
  up: "studio-stage-menu__panel studio-stage-menu__panel--up",
  inline: "studio-stage-menu__panel studio-stage-menu__panel--inline",
};

/**
 * The menu.
 *
 * @param props See {@link StageMenuProps}.
 * @returns The button, and the rows while open.
 */
export function StageMenu({
  label,
  menuLabel,
  types,
  problemFor,
  onPick,
  open,
  onOpenChange,
  reason,
  placement,
  tone = "default",
}: StageMenuProps) {
  const wrapper = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const showing = open && reason === undefined;

  /**
   * The button, found rather than held: the direct-child selector is exact because the rows are
   * inside the panel.
   *
   * @returns The button, or `null` before the first commit.
   */
  function triggerElement(): HTMLButtonElement | null {
    return wrapper.current?.querySelector<HTMLButtonElement>(":scope > button") ?? null;
  }

  /**
   * Close the menu.
   *
   * @param restoreFocus Whether focus goes back to the button — false for a dismissal the browser is
   *   already resolving.
   */
  function close(restoreFocus: boolean): void {
    onOpenChange(false);
    if (restoreFocus) triggerElement()?.focus();
  }

  // A press anywhere outside dismisses — `pointerdown`, so the menu is gone before what was pressed reacts.
  useEffect(() => {
    if (!showing) return;

    function onPointerDown(event: PointerEvent): void {
      if (!wrapper.current?.contains(event.target as Node)) onOpenChange(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [showing, onOpenChange]);

  // Focus lands on the first row when the menu opens — including when a double-click opened it.
  useEffect(() => {
    if (!showing) return;

    const first = menuItems(menu.current)[0];
    if (first !== undefined && !menu.current?.contains(document.activeElement)) first.focus();
  }, [showing, menuLabel]);

  /**
   * The menu's keyboard.
   *
   * @param event The key press, on the panel.
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const action = menuKeyAction(event, { inSubmenu: false, onBranch: false });

    if (menuConsumesKey(action)) {
      event.preventDefault();
      // Handled here, so an Escape meant for the menu does not also clear the canvas's selection.
      event.stopPropagation();
    }

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

  return (
    <div className={WRAP_CLASS[placement]} ref={wrapper}>
      <Button
        aria-controls={showing ? menuId : undefined}
        aria-expanded={showing}
        aria-haspopup="menu"
        onClick={() => onOpenChange(!showing)}
        reason={reason}
        size="sm"
        tone={tone}
      >
        {label}
      </Button>

      {showing ? (
        <div
          aria-label={menuLabel}
          className={PANEL_CLASS[placement]}
          id={menuId}
          onKeyDown={onKeyDown}
          ref={menu}
          role="menu"
          tabIndex={-1}
        >
          <p aria-hidden="true" className="studio-stage-menu__heading">
            {menuLabel}
          </p>
          {types.map((type) => {
            const problem = problemFor(type.type);

            return (
              <button
                aria-disabled={problem === null ? undefined : true}
                className="studio-stage-menu__item"
                key={type.type}
                onClick={() => {
                  if (problem !== null) return;
                  onPick(type);
                  close(true);
                }}
                role="menuitem"
                type="button"
              >
                <span aria-hidden="true" className="studio-stage-menu__glyph">
                  {type.glyph}
                </span>
                <span className="studio-stage-menu__name">{type.label}</span>
                {problem !== null && <span className="studio-stage-menu__reason">{RULE_REASONS[problem]}</span>}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
