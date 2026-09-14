import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { StageMenu, type StageMenuProps } from "@/app/workflows/canvas/stage-menu";
import { RULE_REASONS } from "@/app/workflows/canvas/view";

import { stageCatalog } from "../../helpers/workflows";

/**
 * The catalog as a menu (#151) — **Add stage ▾** and **Insert stage ▾**: one row per node type the
 * catalog serves, a row that would break a rule drawn inert with its reason and kept in the walk, and
 * the shell's menu keyboard.
 */

/** The seeded catalog's five node types. */
const TYPES = stageCatalog().nodeTypes;

/** The button's label in these cases. */
const LABEL = "Add stage ▾";

/**
 * The menu with its open state held, as the canvas and the edge panel hold it.
 *
 * @param props What this case overrides.
 * @returns The menu.
 */
function Held(props: Partial<Omit<StageMenuProps, "open" | "onOpenChange">>) {
  const [open, setOpen] = useState(false);

  return (
    <StageMenu
      label={LABEL}
      menuLabel="Stage types"
      onOpenChange={setOpen}
      onPick={vi.fn()}
      open={open}
      placement="up"
      problemFor={() => null}
      types={TYPES}
      {...props}
    />
  );
}

/** Open the menu with its button. */
function openMenu(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: LABEL }));
  return screen.getByRole("menu", { name: "Stage types" });
}

describe("the menu", () => {
  it("opens on its button, lists every catalog type with its glyph hidden, and focuses the first row", () => {
    render(<Held />);

    const menu = openMenu();
    const rows = within(menu).getAllByRole("menuitem");

    expect(screen.getByRole("button", { name: LABEL })).toHaveAttribute("aria-expanded", "true");
    expect(rows.map((row) => row.textContent)).toEqual(["▸Trigger", "◆Model stage", "▣Build or test", "◇Decision or gate", "●Terminal"]);
    expect(rows.map((row) => row.getAttribute("aria-label") ?? row.textContent?.slice(1))).toContain("Model stage");
    expect(rows[0].querySelector(".studio-stage-menu__glyph")).toHaveAttribute("aria-hidden", "true");
    expect(document.activeElement).toBe(rows[0]);
  });

  it("hands up the type picked, closes, and puts focus back on its button", () => {
    const onPick = vi.fn();
    render(<Held onPick={onPick} />);

    fireEvent.click(within(openMenu()).getByRole("menuitem", { name: "Model stage" }));

    expect(onPick).toHaveBeenCalledExactlyOnceWith(TYPES[1]);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: LABEL }));
  });

  it("draws a row that would break a rule inert, with the rule's reason, and does nothing when it is pressed", () => {
    const onPick = vi.fn();
    render(<Held onPick={onPick} problemFor={(type) => (type === "trigger" ? "document.multiple_triggers" : null)} />);

    const menu = openMenu();
    const trigger = within(menu).getAllByRole("menuitem")[0];

    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(trigger).toHaveTextContent(RULE_REASONS["document.multiple_triggers"]);
    fireEvent.click(trigger);

    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(within(menu).getAllByRole("menuitem")[1]).not.toHaveAttribute("aria-disabled");
  });
});

describe("the keyboard", () => {
  it("walks the rows with the arrows, wrapping, and jumps with Home and End — inert rows included", () => {
    render(<Held problemFor={(type) => (type === "term" ? "edge.out_of_terminal" : null)} />);

    const menu = openMenu();
    const rows = within(menu).getAllByRole("menuitem");

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(rows[4]);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows[4]);
  });

  it("closes on Escape with focus back on the button, and on a press outside", () => {
    render(<Held />);

    fireEvent.keyDown(openMenu(), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: LABEL }));

    openMenu();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("an inert button, and the inline placement", () => {
  it("says why it cannot open, and does not", () => {
    render(<Held reason="The stage catalog could not be read." />);

    const button = screen.getByRole("button", { name: LABEL });
    fireEvent.click(button);

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("title", "The stage catalog could not be read.");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens in the flow of the panel when placed inline", () => {
    const { container } = render(<Held placement="inline" />);

    openMenu();

    expect(container.firstElementChild).toHaveClass("studio-stage-menu", "studio-stage-menu--inline");
    expect(screen.getByRole("menu")).toHaveClass("studio-stage-menu__panel", "studio-stage-menu__panel--inline");
  });
});
