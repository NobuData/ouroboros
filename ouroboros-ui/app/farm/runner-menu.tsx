"use client";

import {
  type KeyboardEvent,
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { menuConsumesKey, menuFocusTarget, menuItems, menuKeyAction } from "@/app/shell/menu";
import { shellOverlayLayer } from "@/app/shell/regions";
import { Button } from "@/app/ui";

import { type RunnerMenuAction, runnerMenu } from "./lifecycle";
import {
  RUNNER_ACTIONS_GLYPH,
  type RunnerIntent,
  type RunnerStatus,
  runnerActionsLabel,
} from "./runners";

import "./runner-actions.css";

/**
 * A runner row's `⋯` and the menu it opens (AI.5,
 * [#260](https://github.com/NobuData/ouroboros/issues/260)) — Drain or Undrain, the guarded
 * Remove, and View details.
 *
 * What the menu holds is `app/farm/lifecycle.ts`'s ({@link runnerMenu}); this is the wiring. It
 * **does nothing itself**: a chosen item is handed to `onAction` and the card decides what
 * follows — a confirmation, a write, the sheet.
 *
 * ### The keyboard is `app/shell/menu.ts`'s
 *
 * The ARIA menu pattern — roving focus, `Escape`, `Tab` dismissing without stealing the move —
 * is that module's, shared with the shell's, the registry's and the providers' menus. The `⋯`
 * itself **is in the tab order**: `app/farm/runner-cells.tsx` kept the inert one out because *a
 * control that cannot act for anybody is no loss to a keyboard*, and said the menu's keyboard
 * path would arrive with the menu. A key pressed here is the control's, and the row's handler
 * leaves it alone (`app/ui/table.tsx`).
 *
 * ### The panel is placed against the viewport, in the overlay layer
 *
 * The table sits in a sideways scroller (`.ou-table-scroll`), and a scroll container clips an
 * absolutely positioned child in both axes — the last row's menu would open inside a box one
 * row tall. So the panel is portalled into the shell's overlay layer and placed under its
 * trigger from the trigger's own rectangle, flipping above it when there is no room below.
 *
 * A panel placed against the viewport does not move when the page does, so it **re-anchors on
 * every scroll and resize** and **closes once its trigger has left the viewport** — it is never
 * left floating away from the row it belongs to. It follows rather than closing outright,
 * because opening it is itself a scroll: the click selects and focuses the row, and the browser
 * nudges the table's sideways scroller to reveal it, a few milliseconds after the menu appears.
 * React events still bubble through a portal, which is why a click on an item reaches the row
 * like any other click in it.
 *
 * ### Focus goes back to the `⋯` before anything opens
 *
 * A chosen item unmounts with the menu. `ShellOverlay` returns focus to whatever held it when
 * the overlay opened, so the trigger takes focus **first** — and a confirmation dismissed with
 * `Escape` lands the reader back on the row they were acting on rather than on `<body>`.
 *
 * ### The memo
 *
 * Primitives and one identity-stable callback, like every cell in this table: a poll that
 * changed one machine's CPU does not re-render five menus
 * (`__tests__/farm/runners-live.test.tsx`).
 */

/** The gap between the trigger and its panel, in CSS pixels — geometry, measured at run time. */
const PANEL_GAP = 4;

/**
 * Put a menu's panel under its trigger — above it when there is no room below.
 *
 * A function of the two elements and the viewport, and of nothing in the component, so the
 * effects that call it depend on nothing but whether the menu is open.
 *
 * @param wrapper The cell's wrapper, whose first child is the trigger.
 * @param panel The panel.
 * @returns Whether the trigger is still in the viewport. `false` means there is nothing left on
 *   screen to anchor to, and nothing was placed.
 */
function placePanel(wrapper: HTMLElement | null, panel: HTMLElement | null): boolean {
  const trigger = wrapper?.querySelector<HTMLButtonElement>(":scope > button") ?? null;
  if (trigger === null || panel === null) return false;

  const anchor = trigger.getBoundingClientRect();
  const gone =
    anchor.bottom < 0 ||
    anchor.top > window.innerHeight ||
    anchor.right < 0 ||
    anchor.left > window.innerWidth;
  if (gone) return false;

  const below = anchor.bottom + PANEL_GAP;
  const height = panel.getBoundingClientRect().height;
  const fitsBelow = below + height <= window.innerHeight;
  const top = fitsBelow ? below : Math.max(0, anchor.top - PANEL_GAP - height);

  panel.style.setProperty("--runner-menu-top", `${top}px`);
  panel.style.setProperty("--runner-menu-right", `${window.innerWidth - anchor.right}px`);

  return true;
}

/** What the cell is told. */
export interface RunnerMenuProps {
  /** The runner — what `onAction` is called with. */
  readonly runnerId: string;
  /** `forge-01` — the trigger's and the menu's name. */
  readonly name: string;
  /** What the fleet last observed. */
  readonly status: RunnerStatus;
  /** What an operator last intended. */
  readonly desiredState: RunnerIntent;
  /** Whether this reader may act on the fleet. A member's menu holds View details alone. */
  readonly mayAdminister: boolean;
  /**
   * Told what was chosen, for which runner, and that runner's name — so the card's handler
   * needs nothing that changes on a poll. Identity-stable, or the memo is for nothing.
   */
  readonly onAction: (action: RunnerMenuAction, runnerId: string, name: string) => void;
}

/**
 * The `⋯` cell.
 *
 * @param props See {@link RunnerMenuProps}.
 * @returns The trigger, and — while open — its menu.
 */
export const RunnerMenu = memo(function RunnerMenu({
  runnerId,
  name,
  status,
  desiredState,
  mayAdminister,
  onAction,
}: RunnerMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const items = runnerMenu(status, desiredState, mayAdminister);

  /** The trigger, found rather than held — `Button` takes no ref. */
  function triggerElement(): HTMLButtonElement | null {
    return wrapper.current?.querySelector<HTMLButtonElement>(":scope > button") ?? null;
  }

  /** Close the menu, optionally putting focus back on the trigger. */
  function close(restoreFocus: boolean): void {
    setOpen(false);
    if (restoreFocus) triggerElement()?.focus();
  }

  // Before paint, so the panel never flashes at the corner its custom properties default to.
  useLayoutEffect(() => {
    if (open) placePanel(wrapper.current, panel.current);
  }, [open]);

  // From outside: a press elsewhere dismisses; a scroll or a resize re-anchors, and dismisses
  // only once the trigger has left the viewport.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent): void {
      const target = event.target as Node;
      if (wrapper.current?.contains(target) || panel.current?.contains(target)) return;

      setOpen(false);
    }

    function follow(): void {
      if (!placePanel(wrapper.current, panel.current)) setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    // Capturing: the pane is the scroll container, and `scroll` does not bubble.
    document.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open]);

  // Focus the first item when the menu opens.
  useEffect(() => {
    if (open) menuItems(panel.current)[0]?.focus();
  }, [open]);

  /** The menu's keyboard, over whatever is rendered. */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const action = menuKeyAction(event, { inSubmenu: false, onBranch: false });

    if (menuConsumesKey(action)) event.preventDefault();
    // `Tab` is not consumed, and the panel is at the end of the document: focus returns to the
    // trigger first, so the browser's own move carries on from the row and not from the layer.
    if (action === "close" || action === "dismiss") return close(true);

    const rows = menuItems(panel.current);
    const target = menuFocusTarget(
      action,
      rows.indexOf(document.activeElement as HTMLElement),
      rows.length,
    );
    if (target !== undefined) rows[target]?.focus();
  }

  /** Hand a chosen item to the card — see the module note's *Focus goes back*. */
  function choose(action: RunnerMenuAction): void {
    close(true);
    onAction(action, runnerId, name);
  }

  return (
    <span className="runner-menu" ref={wrapper}>
      <Button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={runnerActionsLabel(name)}
        onClick={() => setOpen(!open)}
        size="sm"
        tone="ghost"
      >
        <span aria-hidden="true">{RUNNER_ACTIONS_GLYPH}</span>
      </Button>

      {open &&
        createPortal(
          <div
            aria-label={runnerActionsLabel(name)}
            className="runner-menu__panel"
            id={menuId}
            onKeyDown={onKeyDown}
            ref={panel}
            role="menu"
          >
            {items.map((item) =>
              item.reason === null ? (
                <button
                  className={
                    item.danger
                      ? "runner-menu__item runner-menu__item--danger"
                      : "runner-menu__item"
                  }
                  key={item.action}
                  onClick={() => choose(item.action)}
                  role="menuitem"
                  type="button"
                >
                  {item.label}
                </button>
              ) : (
                // Blocked, with the explanation inside it: inert rather than absent, reachable
                // by the arrow keys, and saying why in words rather than in a tooltip. Named by
                // its word and described by its reason, so the sentence is read once.
                <button
                  aria-describedby={`${menuId}-${item.action}-reason`}
                  aria-disabled="true"
                  aria-labelledby={`${menuId}-${item.action}`}
                  className="runner-menu__item runner-menu__item--blocked"
                  key={item.action}
                  role="menuitem"
                  type="button"
                >
                  <span id={`${menuId}-${item.action}`}>{item.label}</span>
                  <span className="runner-menu__reason" id={`${menuId}-${item.action}-reason`}>
                    {item.reason}
                  </span>
                </button>
              ),
            )}
          </div>,
          shellOverlayLayer() ?? document.body,
        )}
    </span>
  );
});
