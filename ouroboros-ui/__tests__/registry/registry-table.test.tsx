import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ALIAS_PARAM, PROVIDERS_PATH } from "@/app/paths";
import {
  EM_DASH,
  FIX_IN_PROVIDERS,
  INSPECTOR_NEXT_TITLE,
  MANAGE_PROVIDERS,
  NO_PROVIDER,
  ORG_OVERRIDE,
  SWITCH_READ_ONLY,
  SWITCH_UNBOUND,
  TABLE_CAPTION,
  TABLE_NOTE,
  TABLE_TITLE,
  type TableRow,
  selectionAnnouncement,
  switchLabel,
  tableRows,
} from "@/app/registry/table";

import { PALETTES, maskIds, renderInBothPalettes, renderInPalette } from "../helpers/palettes";
import {
  CATALOG_VERSION,
  NO_KEY_NOTE,
  registryAlias,
  seededRegistry,
  tokenPrice,
} from "../helpers/registry";

/**
 * The allowed-models table as it is drawn (#592) — mockup 21's densest region, and the
 * selection that drives the inspector's seat beneath it.
 *
 * What every cell *says* is `table.test.ts`'s, decided as functions over the dev seed's own
 * rows. What is here is what only a render can show: that the eight rows come out as the
 * mockup draws them, cell for cell; that the monogram is the AE.2 component and not a second
 * one; that the orphan row is dimmed with its health cell exempt and its fix a real link; that
 * selection is a real state with a real address; that the keyboard reaches every row; and that
 * the two palettes produce identical markup, so nothing about any cell is decided in
 * JavaScript from the theme.
 */

// The switch's write sits on the server-only client and is `switch-actions.test.ts`'s
// subject; the switch itself is `alias-switch.test.tsx`'s.
vi.mock("@/app/registry/switch-actions", () => ({ setAliasEnabled: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { RegistryTable } = await import("@/app/registry/registry-table");

/** The mockup this table is drawn from, read once. */
const MOCKUP = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "docs", "mockups", "21-model-registry.html"),
  "utf8",
);

/** The seeded table's rows, decided. */
const ROWS: readonly TableRow[] = tableRows(seededRegistry());

/**
 * Where these tests pretend to be, so an assertion about the address bar is about
 * `/models/registry`. Relative, because `replaceState` refuses a cross-origin URL.
 */
const AT = "/models/registry";

beforeEach(() => {
  window.history.replaceState(null, "", AT);
});

afterEach(() => {
  window.history.replaceState(null, "", AT);
});

/**
 * The table.
 *
 * @param props.rows Which rows. Defaults to the seeded eight.
 * @param props.selected Which row the URL asked for. Defaults to none.
 * @param props.mayAdminister Whether the reader may press the switches. Defaults to yes.
 * @returns The Testing Library render result.
 */
function table({
  rows = ROWS,
  selected = null,
  mayAdminister = true,
}: { rows?: readonly TableRow[]; selected?: string | null; mayAdminister?: boolean } = {}) {
  return render(<RegistryTable mayAdminister={mayAdminister} rows={rows} selected={selected} />);
}

/** Every body row, in order. */
function bodyRows(): HTMLElement[] {
  return screen.getAllByRole("row").slice(1);
}

/** One body row, by the alias in it. */
function rowFor(alias: string): HTMLElement {
  const found = bodyRows().find((row) => row.dataset.rowKey === alias);

  if (found === undefined) throw new Error(`no rendered row for ${alias}`);
  return found;
}

/** What the address bar's `?alias=` currently says. */
function reflected(): string | null {
  return new URL(window.location.href).searchParams.get(ALIAS_PARAM);
}

describe("the card frame", () => {
  it("names itself and counts what it holds, and the count is the row count", () => {
    table();

    expect(screen.getByRole("heading", { level: 2, name: TABLE_TITLE })).toBeInTheDocument();
    expect(screen.getByText("8 aliases")).toHaveClass("ou-tag");
  });

  it("links to Providers & keys from the head, as the mockup does", () => {
    table();

    expect(screen.getByRole("link", { name: MANAGE_PROVIDERS })).toHaveAttribute("href", PROVIDERS_PATH);
  });

  it("prints the caption line under the table, verbatim", () => {
    table();

    expect(screen.getByText(TABLE_NOTE)).toHaveClass("registry-table__caption");
  });

  it("names the table itself, for a reader moving by table rather than by landmark", () => {
    table();

    expect(screen.getByRole("grid", { name: TABLE_CAPTION })).toBeInTheDocument();
  });
});

describe("the table, row for row", () => {
  it("heads the eight columns the mockup does, in its order", () => {
    // Read off the mockup's own `<th>` row rather than typed twice.
    const drawn = [...MOCKUP.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((match) => match[1]);

    table();

    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(drawn);
    expect(drawn).toHaveLength(8);
  });

  it("draws the eight seeded aliases in the payload's order", () => {
    table();

    expect(bodyRows().map((row) => row.dataset.rowKey)).toEqual([
      "coder-fallback",
      "coder-max",
      "coder-std",
      "gpt5-experiments",
      "local-docs",
      "local-free",
      "second-opinion",
      "sizer",
    ]);
  });

  it("draws the mockup's `coder-max` row whole — every one of the eight cells", () => {
    table();

    const row = within(rowFor("coder-max"));
    const cells = row.getAllByRole("cell");

    expect(cells).toHaveLength(8);
    // The alias pill: accent-tinted, mono — the mockup's `.pill.alias`.
    expect(row.getByText("coder-max")).toHaveClass("ou-chip", "ou-chip--accent", "ou-chip--mono");
    // The provider: the shared monogram at its cell size, and the name.
    const monogram = cells[1]?.querySelector(".providers-card__monogram");
    expect(monogram).toHaveTextContent("AN");
    expect(monogram).toHaveClass("providers-card__monogram--model", "providers-card__monogram--cell");
    expect(cells[1]).toHaveTextContent("Anthropic Claude");
    // The raw id, mono.
    expect(cells[2]).toHaveTextContent("claude-fable-5");
    expect(cells[2]).toHaveClass("ou-table__cell--mono");
    // The server's chips, as tags.
    expect(within(cells[3] as HTMLElement).getAllByText(/./, { selector: ".ou-tag" }).map((tag) => tag.textContent)).toEqual([
      "max thinking",
      "400k budget",
    ]);
    // Health, price with its provenance, used by, and the switch.
    expect(cells[4]).toHaveTextContent("ok");
    expect(cells[5]).toHaveTextContent("$10 · $50");
    expect(cells[5]?.querySelector("[title]")).toHaveAttribute("title", `bundled@${CATALOG_VERSION}`);
    expect(cells[6]).toHaveTextContent("4 routes");
    expect(within(cells[7] as HTMLElement).getByRole("switch", { name: switchLabel("coder-max") })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("draws the degraded Copilot row amber, with the check's own note and no chips", () => {
    table();

    const row = within(rowFor("coder-fallback"));
    const cells = row.getAllByRole("cell");

    expect(cells[1]?.querySelector(".providers-card__monogram")).toHaveClass("providers-card__monogram--warn");
    expect(cells[3]).toHaveTextContent(EM_DASH);
    expect(cells[4]?.querySelector(".registry-table__health-cell")).toHaveClass("registry-table__health-cell--warn");
    expect(row.getByText("degraded")).toHaveClass("registry-table__state");
    expect(row.getByText("elevated latency")).toHaveClass("registry-table__detail");
    expect(cells[5]).toHaveTextContent("seat-based");
  });

  it("prints the three other price shapes as the service rendered them", () => {
    table();

    expect(within(rowFor("second-opinion")).getByText("usage-based")).toBeInTheDocument();
    expect(within(rowFor("local-docs")).getByText("$0")).toBeInTheDocument();
    expect(within(rowFor("gpt5-experiments")).getAllByRole("cell")[5]).toHaveTextContent(EM_DASH);
  });

  it("names an override's provenance on hover", () => {
    const price = tokenPrice("anthropic", "claude-fable-5", 1500, 7500, "$15 · $75");
    const rows = tableRows([
      registryAlias({
        price: {
          ...price,
          price: {
            ...price.price!,
            provenance: { source: "override", catalogVersion: null, effectiveAt: "2026-08-20T00:00:00.000Z" },
          },
        },
      }),
    ]);
    table({ rows });

    expect(within(rowFor("coder-max")).getByText("$15 · $75")).toHaveAttribute("title", ORG_OVERRIDE);
  });

  it("draws the monogram through the AE.2 component and nothing else — one square per bound row", () => {
    const { container } = table();

    expect(container.querySelectorAll(".providers-card__monogram")).toHaveLength(7);
    expect(container.querySelectorAll(".providers-card__monogram--cell")).toHaveLength(7);
    for (const square of container.querySelectorAll(".providers-card__monogram")) {
      expect(square).toHaveAttribute("aria-hidden", "true");
    }
  });
});

describe("the unbound row", () => {
  it("is dimmed, and no other row is", () => {
    table();

    expect(rowFor("gpt5-experiments")).toHaveClass("registry-table__row--dim");
    for (const alias of ["coder-max", "coder-fallback", "sizer"]) {
      expect(rowFor(alias)).not.toHaveClass("registry-table__row--dim");
    }
  });

  it("says *no provider* in the faint ink, and an em-dash where the params and the price would be", () => {
    table();

    const cells = within(rowFor("gpt5-experiments")).getAllByRole("cell");

    expect(cells[1]).toHaveTextContent(NO_PROVIDER);
    expect(cells[1]?.querySelector(".registry-table__none")).toBeInTheDocument();
    expect(cells[1]?.querySelector(".providers-card__monogram")).toBeNull();
    expect(cells[3]).toHaveTextContent(EM_DASH);
    expect(cells[5]).toHaveTextContent(EM_DASH);
    expect(cells[5]?.querySelector("[title]")).toBeNull();
  });

  it("carries the fix in its health cell, which wears the column class the dim rule exempts", () => {
    table();

    const cells = within(rowFor("gpt5-experiments")).getAllByRole("cell");
    const health = cells[4] as HTMLElement;

    expect(health).toHaveClass("registry-table__health");
    expect(within(health).getByText(NO_KEY_NOTE)).toHaveClass("registry-table__state");
    expect(health.querySelector(".registry-table__health-cell")).toHaveClass("registry-table__health-cell--err");
    expect(within(health).getByRole("link", { name: FIX_IN_PROVIDERS })).toHaveAttribute("href", PROVIDERS_PATH);
  });

  it("draws the fix nowhere else — a provider failing upstream is not something that page can fix", () => {
    table();

    expect(screen.getAllByRole("link", { name: FIX_IN_PROVIDERS })).toHaveLength(1);
  });

  it("leaves its switch off, inert, and explained", () => {
    table();

    const control = within(rowFor("gpt5-experiments")).getByRole("switch");

    expect(control).toHaveAttribute("aria-checked", "false");
    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).toHaveAttribute("title", SWITCH_UNBOUND);
  });
});

describe("the selection", () => {
  it("selects nothing until a row is chosen, and the seat says so", () => {
    table();

    expect(screen.queryByRole("row", { selected: true })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Edit" })).toBeInTheDocument();
  });

  it("starts on the row the server read out of the URL", () => {
    table({ selected: "coder-max" });

    expect(screen.getByRole("row", { selected: true })).toBe(rowFor("coder-max"));
    expect(screen.getAllByRole("row", { selected: true })).toHaveLength(1);
  });

  it("selects in the accent, which is mockup 21's `.selected` and not mockup 06's", () => {
    table({ selected: "coder-max" });

    expect(screen.getByRole("grid")).toHaveClass("ou-table--accent");
    expect(rowFor("coder-max")).toHaveClass("ou-table__row--selected");
    expect(rowFor("sizer")).not.toHaveClass("ou-table__row--selected");
  });

  it("moves to the row that was clicked, and records it in `?alias=`", () => {
    table();

    fireEvent.click(rowFor("sizer"));

    expect(screen.getByRole("row", { selected: true })).toBe(rowFor("sizer"));
    expect(reflected()).toBe("sizer");
  });

  it("selects the row when its Used by cell is clicked — the inspector answers which ones", () => {
    table();

    fireEvent.click(within(rowFor("coder-std")).getByText("2 routes"));

    expect(screen.getByRole("row", { selected: true })).toBe(rowFor("coder-std"));
  });

  it("replaces rather than pushes, so arrowing through rows does not fill the back stack", () => {
    const before = window.history.length;

    table();
    fireEvent.click(rowFor("sizer"));
    fireEvent.click(rowFor("coder-std"));

    expect(window.history.length).toBe(before);
  });

  it("keeps the path and anything else the URL was carrying", () => {
    window.history.replaceState(null, "", `${AT}?tab=history#table`);

    table();
    fireEvent.click(rowFor("local-docs"));

    const url = new URL(window.location.href);

    expect(url.pathname).toBe(AT);
    expect(url.searchParams.get("tab")).toBe("history");
    expect(url.hash).toBe("#table");
    expect(url.searchParams.get(ALIAS_PARAM)).toBe("local-docs");
  });

  it("drives the inspector's seat: the mockup's `EDIT — CODER-MAX`, with the pill beside it", () => {
    table({ selected: "coder-max" });

    const seat = screen.getByRole("region", { name: "Edit — coder-max" });

    expect(within(seat).getByText("coder-max")).toHaveClass("ou-chip--accent");
    expect(within(seat).getByText(INSPECTOR_NEXT_TITLE)).toBeInTheDocument();
    expect(within(seat).getByText(/#593/)).toBeInTheDocument();
  });

  it("moves the seat's title with the selection", () => {
    table({ selected: "coder-max" });

    fireEvent.click(rowFor("local-free"));

    expect(screen.getByRole("heading", { level: 2, name: "Edit — local-free" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Edit — coder-max" })).not.toBeInTheDocument();
  });
});

describe("the keyboard", () => {
  it("puts exactly one row in the tab order", () => {
    table({ selected: "coder-max" });

    expect(bodyRows().filter((row) => row.tabIndex === 0)).toEqual([rowFor("coder-max")]);
  });

  it("moves the selection down and up with the arrow keys, and focus with it", () => {
    table({ selected: "coder-max" });

    fireEvent.keyDown(rowFor("coder-max"), { key: "ArrowDown" });
    expect(screen.getByRole("row", { selected: true })).toBe(rowFor("coder-std"));
    expect(rowFor("coder-std")).toHaveFocus();

    fireEvent.keyDown(rowFor("coder-std"), { key: "ArrowUp" });
    expect(screen.getByRole("row", { selected: true })).toBe(rowFor("coder-max"));
  });

  it("jumps to the ends with Home and End, and stays put there", () => {
    table({ selected: "coder-max" });

    fireEvent.keyDown(rowFor("coder-max"), { key: "End" });
    expect(screen.getByRole("row", { selected: true })).toBe(rowFor("sizer"));

    fireEvent.keyDown(rowFor("sizer"), { key: "ArrowDown" });
    expect(screen.getByRole("row", { selected: true })).toBe(rowFor("sizer"));

    fireEvent.keyDown(rowFor("sizer"), { key: "Home" });
    expect(screen.getByRole("row", { selected: true })).toBe(rowFor("coder-fallback"));
  });

  it("records a keyboard selection in the URL exactly as a click does", () => {
    table({ selected: "coder-max" });

    fireEvent.keyDown(rowFor("coder-max"), { key: "ArrowDown" });

    expect(reflected()).toBe("coder-std");
  });

  it("leaves a key pressed on a switch to the switch", () => {
    // Space on a switch toggles; it must not move the selection underneath it.
    table({ selected: "coder-max" });

    const control = within(rowFor("coder-max")).getByRole("switch");
    fireEvent.keyDown(control, { key: "ArrowDown" });

    expect(screen.getByRole("row", { selected: true })).toBe(rowFor("coder-max"));
  });
});

describe("what is announced", () => {
  it("says which alias was selected, in a sentence", () => {
    table();

    fireEvent.click(rowFor("sizer"));

    expect(screen.getByRole("status")).toHaveTextContent(selectionAnnouncement("sizer"));
  });

  it("keeps the region in the document while nothing is selected, so the first move is heard", () => {
    table();

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("a reader who may not administer", () => {
  it("draws every switch in its real position, read-only, with the reason", () => {
    table({ mayAdminister: false });

    const switches = screen.getAllByRole("switch");

    expect(switches).toHaveLength(8);
    for (const control of switches) {
      expect(control).toHaveAttribute("aria-disabled", "true");
      expect(control).toHaveAttribute("title", SWITCH_READ_ONLY);
    }
    expect(within(rowFor("coder-max")).getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("still lets them select a row — reading is not gated", () => {
    table({ mayAdminister: false });

    fireEvent.click(rowFor("sizer"));

    expect(screen.getByRole("row", { selected: true })).toBe(rowFor("sizer"));
  });
});

describe("the shell's scroll rule", () => {
  it("scrolls sideways inside the table's own wrapper, never the content pane", () => {
    const { container } = table();

    expect(container.querySelector(".ou-table-scroll")).toBeInTheDocument();
    expect(container.querySelector(".ou-table-scroll--open")).toBeNull();
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders the table in the %s palette", (palette) => {
    renderInPalette(palette, <RegistryTable mayAdminister rows={ROWS} selected="coder-max" />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("row", { selected: true })).toHaveClass("ou-table__row--selected");
    expect(rowFor("gpt5-experiments")).toHaveClass("registry-table__row--dim");
  });

  it("draws the same markup in both, selection, dim row and switches included", () => {
    const [light, dark] = renderInBothPalettes(
      <RegistryTable mayAdminister rows={ROWS} selected="coder-max" />,
    );

    expect(maskIds(light)).toBe(maskIds(dark));
  });
});
