import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ASSIGN_LABEL,
  ASSIGN_MENU_LABEL,
  SUGGESTED_LABEL,
  SUGGESTED_NOTE,
  WORKFLOWS,
  type WorkflowChoice,
} from "@/app/issues/bar";
import { WorkflowMenu } from "@/app/issues/workflow-menu";

/**
 * **Assign workflow ▾** (#118), as a component.
 *
 * The rows are the fixed set behind *use suggested*, one of them checked; a pick reports the
 * choice and closes; the keyboard is the shell's menu pattern — arrows that wrap, Home and End,
 * Escape back to the trigger, Tab dismissing without stealing focus — and a press elsewhere on
 * the page closes it too.
 */

/** The menu, with what it was last told. */
function menu(choice: WorkflowChoice = null) {
  const onChoose = vi.fn();
  render(
    <div>
      <WorkflowMenu choice={choice} onChoose={onChoose} />
      <button type="button">Elsewhere</button>
    </div>,
  );
  return onChoose;
}

/** The trigger. */
function trigger(): HTMLElement {
  return screen.getByRole("button", { name: ASSIGN_LABEL });
}

/** Open the menu, and hand back its rows. */
function open(): HTMLElement[] {
  fireEvent.click(trigger());
  return screen.getAllByRole("menuitemradio");
}

/** Press a key on the open panel. */
function press(key: string): void {
  fireEvent.keyDown(screen.getByRole("menu"), { key });
}

describe("closed", () => {
  it("is a trigger that owns a menu, drawn shut", () => {
    menu();

    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).not.toHaveAttribute("aria-controls");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("open", () => {
  it("lists use suggested first, then the fixed set in order, under the menu's name", () => {
    menu();
    const rows = open();

    expect(screen.getByRole("menu", { name: ASSIGN_MENU_LABEL })).toBeInTheDocument();
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger()).toHaveAttribute("aria-controls", screen.getByRole("menu").id);
    expect(rows.map((row) => row.textContent)).toEqual([`${SUGGESTED_LABEL}${SUGGESTED_NOTE}`, ...WORKFLOWS]);
  });

  it("checks the current choice — use suggested by default", () => {
    menu();
    open();

    expect(screen.getByRole("menuitemradio", { name: /Use suggested/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "docs-loop" })).toHaveAttribute("aria-checked", "false");
  });

  it("checks a chosen workflow instead", () => {
    menu("docs-loop");
    open();

    expect(screen.getByRole("menuitemradio", { name: "docs-loop" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: /Use suggested/ })).toHaveAttribute("aria-checked", "false");
  });

  it("puts focus on the first row", () => {
    menu();
    const [first] = open();

    expect(first).toHaveFocus();
  });

  it("reports a pick and closes, with focus back on the trigger", () => {
    const onChoose = menu();
    open();

    fireEvent.click(screen.getByRole("menuitemradio", { name: "feature-loop" }));

    expect(onChoose).toHaveBeenCalledExactlyOnceWith("feature-loop");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("reports use suggested as null", () => {
    const onChoose = menu("docs-loop");
    open();

    fireEvent.click(screen.getByRole("menuitemradio", { name: /Use suggested/ }));

    expect(onChoose).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("closes on a press elsewhere on the page", () => {
    menu();
    open();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));

    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("the keyboard", () => {
  it("walks the rows with the arrows, wrapping at both ends", () => {
    menu();
    const rows = open();

    press("ArrowDown");
    expect(rows[1]).toHaveFocus();

    press("End");
    expect(rows[rows.length - 1]).toHaveFocus();

    press("ArrowDown");
    expect(rows[0]).toHaveFocus();

    press("ArrowUp");
    expect(rows[rows.length - 1]).toHaveFocus();

    press("Home");
    expect(rows[0]).toHaveFocus();
  });

  it("closes on Escape and puts focus back on the trigger", () => {
    menu();
    open();

    press("Escape");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("dismisses on Tab without taking the browser's own move", () => {
    menu();
    open();

    // `fireEvent` answers `false` when the handler called `preventDefault()` — the move the
    // browser is about to make is the right one, so the menu must not.
    const browserMoves = fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });

    expect(browserMoves).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
