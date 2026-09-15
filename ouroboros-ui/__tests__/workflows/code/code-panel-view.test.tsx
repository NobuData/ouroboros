import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CodeSymbol, LoopCheckRow } from "@/app/api/workflows";
import {
  CHECKS_EMPTY_NOTE,
  CHECKS_FAILED_TITLE,
  CHECKS_STALE_NOTE,
  OUTLINE_EMPTY_NOTE,
  type OutlineRow,
  PANEL_LABEL,
  PANEL_TOGGLE_LABEL,
  SYMBOLS_FAILED_NOTE,
} from "@/app/workflows/code/code-panel";
import { CodePanel, type CodePanelProps, CodePanelToggle } from "@/app/workflows/code/code-panel-view";

import { CODE_SYMBOLS } from "../../helpers/code-symbols";
import { renderInBothPalettes } from "../../helpers/palettes";
import { codeChecks, panelReadings } from "../../helpers/workflow-code";

/**
 * The right panel, drawn (V.5, #173) — mockup 05's `.rp` with the ticket's honesty criteria:
 *
 * - **no infra row appears in MVP — verified**, here against the mockup's own third row;
 * - **an unknown symbol produces no hover card**;
 * - **both themes**: identical markup in both palettes, and every hue a token both palettes define
 *   (`code-panel-styles.test.ts`).
 */

const MOCKUP = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "..", "docs", "mockups", "05-workflow-code.html"),
  "utf8",
);

/** The text of mockup 05's third Loop Checks row, the infra row decision C7 omits. */
const MOCKUP_INFRA_ROW = /<div class="ck warn">[\s\S]*?<span>([^<]+)<\/span><\/div>/.exec(MOCKUP)?.[1] ?? "";

/** The golden table's `route.task`. */
const ROUTE_TASK = CODE_SYMBOLS.symbols.find((entry) => entry.symbol === "route.task") as CodeSymbol;

/** A loopback row and the row it returns to. */
const OUTLINE: readonly OutlineRow[] = [
  { number: "01", node: "implement", startLine: 3, loop: null },
  { number: "02", node: "checks-green", startLine: 9, loop: [{ node: "implement", number: "01" }] },
];

/**
 * The panel with what a case is about.
 *
 * @param overrides The props this case sets.
 * @returns The element.
 */
function panel(overrides: Partial<CodePanelProps> = {}) {
  return (
    <CodePanel
      etag={codeChecks().etag}
      id="right-panel"
      onJump={() => undefined}
      open={false}
      outline={OUTLINE}
      readings={panelReadings()}
      symbol={ROUTE_TASK}
      {...overrides}
    />
  );
}

/** The panel's landmark. */
function aside(): HTMLElement {
  return screen.getByRole("complementary", { name: PANEL_LABEL });
}

describe("Loop Checks", () => {
  it("draws mockup 05's first two rows, each glyph's status said in words", () => {
    render(panel());

    const items = within(aside()).getAllByRole("listitem").filter((item) => item.classList.contains("code-panel__check"));
    expect(items.map((item) => item.textContent)).toEqual([
      "✓passed: Graph acyclic except declared gate loop",
      "✓passed: All task routes resolve" + "models configured for analyze · plan · split · implement · review",
    ]);
    expect(items[0]).toHaveClass("code-panel__check--ok");
  });

  it("draws a warning with the warn dot and an error with the error mark", () => {
    const rows: LoopCheckRow[] = [
      { id: "graph", status: "err", title: "2 validation errors", note: "A model stage needs a route." },
      { id: "references", status: "warn", title: "1 reference does not resolve", note: "unresolved in split" },
    ];
    render(panel({ readings: panelReadings({ checks: { ok: true, value: codeChecks({ rows }) } }) }));

    const [err, warn] = within(aside()).getAllByRole("listitem");
    expect(err).toHaveClass("code-panel__check--err");
    expect(err.querySelector(".code-panel__icon--err")?.textContent).toBe("✕");
    expect(err).toHaveTextContent("failed: 2 validation errors");
    expect(warn).toHaveClass("code-panel__check--warn");
    expect(warn.querySelector(".code-panel__dot")).not.toBeNull();
    expect(warn).toHaveTextContent("warning: 1 reference does not resolve");
  });

  it("never draws an infra row — the mockup's pool-a warning is omitted, not faked (C7)", () => {
    expect(MOCKUP_INFRA_ROW).toContain("runner offline");
    const infra = { id: "infra", status: "warn", title: MOCKUP_INFRA_ROW } as unknown as LoopCheckRow;
    const rows = [...codeChecks().rows, infra];

    render(panel({ readings: panelReadings({ checks: { ok: true, value: codeChecks({ rows }) } }) }));

    expect(aside()).not.toHaveTextContent("runner offline");
    expect(aside()).not.toHaveTextContent("pool-a");
    expect(aside().querySelectorAll(".code-panel__check")).toHaveLength(2);
  });

  it("says why when the rows could not be read, and still draws the rest", () => {
    render(panel({ readings: panelReadings({ checks: { ok: false, reason: "The checks are unavailable." } }) }));

    expect(aside()).toHaveTextContent(CHECKS_FAILED_TITLE);
    expect(aside()).toHaveTextContent("The checks are unavailable.");
    expect(aside().querySelector(".code-hover-doc")).not.toBeNull();
    expect(within(aside()).getAllByRole("button")).toHaveLength(2);
  });

  it("says nothing was checked for no rows, rather than an empty list", () => {
    render(panel({ readings: panelReadings({ checks: { ok: true, value: codeChecks({ rows: [] }) } }) }));

    expect(aside()).toHaveTextContent(CHECKS_EMPTY_NOTE);
    expect(aside().querySelector(".code-panel__checks")).toBeNull();
  });

  it("says the rows are about an older file once a save has moved the draft", () => {
    const { rerender } = render(panel());
    expect(aside()).not.toHaveTextContent(CHECKS_STALE_NOTE);

    rerender(panel({ etag: "a-later-save" }));
    expect(aside()).toHaveTextContent(CHECKS_STALE_NOTE);
  });
});

describe("Types", () => {
  it("draws the mockup's route.task card for the symbol at the cursor", () => {
    render(panel());

    expect(aside().querySelector(".code-hover-doc")?.textContent).toBe(
      "route.task(name: TaskKind): ModelRoute" + "Resolves the model assigned to a task kind in Model Routing.",
    );
  });

  it("draws no card at all when the cursor is on nothing the table describes", () => {
    render(panel({ symbol: null }));

    expect(aside().querySelector(".code-hover-doc")).toBeNull();
    expect(screen.getByRole("heading", { name: "Types" }).nextElementSibling).toHaveTextContent("Outline");
  });

  it("says the table could not be read, and draws no card", () => {
    render(panel({ readings: panelReadings({ symbols: { ok: false, reason: "Down." } }) }));

    expect(aside()).toHaveTextContent(SYMBOLS_FAILED_NOTE);
    expect(aside().querySelector(".code-hover-doc")).toBeNull();
  });
});

describe("Outline", () => {
  it("draws numbered stage rows, and the loopback row in its accent treatment with its note", () => {
    render(panel());

    const [implement, gate] = within(aside()).getAllByRole("button");
    expect(implement).toHaveTextContent("01▸implement");
    expect(implement).not.toHaveClass("code-panel__row--loopback");
    expect(gate).toHaveTextContent("02⟲checks-greenback-edge → 01");
    expect(gate).toHaveClass("code-panel__row--loopback");
    expect(gate).toHaveAttribute("title", "Go to checks-green in the file");
  });

  it("hands the pressed row to the jump", () => {
    const onJump = vi.fn();
    render(panel({ onJump }));

    fireEvent.click(within(aside()).getByRole("button", { name: /checks-green/ }));

    expect(onJump).toHaveBeenCalledExactlyOnceWith(OUTLINE[1]);
  });

  it("says a file with no stages has none", () => {
    render(panel({ outline: [] }));

    expect(aside()).toHaveTextContent(OUTLINE_EMPTY_NOTE);
    expect(within(aside()).queryAllByRole("button")).toEqual([]);
  });
});

describe("the narrow viewport", () => {
  it("marks the panel open when its toggle has shown it", () => {
    const { rerender } = render(panel());
    expect(aside()).not.toHaveClass("code-panel--open");

    rerender(panel({ open: true }));
    expect(aside()).toHaveClass("code-panel--open");
  });

  it("toggles as a disclosure button that names the panel it controls", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<CodePanelToggle controls="right-panel" onToggle={onToggle} open={false} />);

    const button = screen.getByRole("button", { name: PANEL_TOGGLE_LABEL });
    expect(button).toHaveAttribute("aria-controls", "right-panel");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveClass("code-panel-toggle");

    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(<CodePanelToggle controls="right-panel" onToggle={onToggle} open />);
    expect(button).toHaveAttribute("aria-expanded", "true");
  });
});

describe("both palettes", () => {
  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(panel());

    expect(light).toBe(dark);
  });
});
