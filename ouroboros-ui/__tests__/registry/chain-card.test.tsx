import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ALIAS_UNBOUND,
  CHAIN_CAPTION,
  CHAIN_EMPTY_TITLE,
  CHAIN_TITLE,
  DROPPED,
  RUN_CONSOLE_SOON,
  SIMULATED_LABEL,
  UNROUTED_NOTE,
  UNROUTED_TITLE,
  type ChainReading,
  type RouteLookup,
  chainLoading,
} from "@/app/registry/chain";
import { type TableRow, tableRows } from "@/app/registry/table";

import { FLOOR_BREACHED, failRunExample } from "../helpers/models";
import { PALETTES, maskIds, renderInPalette } from "../helpers/palettes";
import {
  DISABLED_DROPPED,
  analyzeSimulation,
  disabledSimulation,
  seededRegistry,
  seededSnapshot,
} from "../helpers/registry";

/**
 * Mockup 21's **RESOLUTION CHAIN** card as it is drawn (#595).
 *
 * What the rail *says* is `chain.test.ts`'s; where it comes from is `chain-actions.test.ts`'s.
 * What is here is what only a render can show — the ticket's acceptance criteria as a reader
 * meets them: run #482 reproduces the mockup card, an alias with no snapshot carries the
 * simulated label and never a run number, re-viewing a disabled alias shows the dropped hop, an
 * unbound alias explains itself rather than drawing an empty card, and the run tag is an honest
 * inert stub.
 */

/** What the Server Action answers, per case. */
const readChain = vi.fn<(alias: string, route: RouteLookup) => Promise<ChainReading>>();

vi.mock("@/app/registry/chain-actions", () => ({
  readChain: (alias: string, route: RouteLookup) => readChain(alias, route),
}));

const { ChainCard } = await import("@/app/registry/chain-card");

/** The seeded rows, decided, by alias. */
const ROWS = new Map(tableRows(seededRegistry()).map((row) => [row.alias, row]));

/**
 * One seeded row.
 *
 * @param alias Which.
 * @returns The row.
 */
function row(alias: string): TableRow {
  const found = ROWS.get(alias);
  if (found === undefined) throw new Error(`no seeded row ${alias}`);
  return found;
}

/** Where `coder-max` is primary first — the lookup the page computes for it. */
const PLAN: RouteLookup = { kind: "routed", taskKind: "plan" };

/** …and `coder-std`. */
const ANALYZE: RouteLookup = { kind: "routed", taskKind: "analyze" };

/**
 * An answer, already arrived.
 *
 * @param reading The reading.
 * @returns A resolved promise of it.
 */
function answering(reading: ChainReading): Promise<ChainReading> {
  return Promise.resolve(reading);
}

beforeEach(() => {
  readChain.mockReset().mockImplementation(() => new Promise(() => {}));
});

describe("with nothing selected", () => {
  it("says so, and asks nothing", () => {
    render(<ChainCard route={null} row={null} />);

    expect(screen.getByRole("region", { name: CHAIN_TITLE })).toBeInTheDocument();
    expect(screen.getByText(CHAIN_EMPTY_TITLE)).toBeInTheDocument();
    expect(readChain).not.toHaveBeenCalled();
  });
});

describe("while the chain is on its way", () => {
  it("says what it is reading, rather than drawing an empty rail", () => {
    render(<ChainCard route={PLAN} row={row("coder-max")} />);

    expect(screen.getByRole("status")).toHaveTextContent(chainLoading("coder-max"));
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("asks once per question, however often it renders", () => {
    const { rerender } = render(<ChainCard route={PLAN} row={row("coder-max")} />);

    rerender(<ChainCard route={PLAN} row={row("coder-max")} />);
    rerender(<ChainCard route={{ ...PLAN }} row={{ ...row("coder-max") }} />);

    expect(readChain).toHaveBeenCalledOnce();
    expect(readChain).toHaveBeenCalledWith("coder-max", PLAN);
  });
});

describe("the seeded run #482, for coder-max", () => {
  beforeEach(() => {
    readChain.mockImplementation(() =>
      answering({ ok: true, source: { kind: "snapshot", snapshot: seededSnapshot() } }),
    );
  });

  it("reproduces the mockup card's five hops, verbatim", async () => {
    render(<ChainCard route={PLAN} row={row("coder-max")} />);

    await screen.findByText("resolved · 42ms");

    const hops = within(screen.getByRole("list", { name: CHAIN_TITLE })).getAllByRole("listitem");

    // The mockup's `.arrow` is decoration, so it is in the text a reader's eye sees and hidden
    // from the one a screen reader hears.
    expect(hops.map((hop) => hop.textContent)).toEqual([
      'route.task("implement")',
      "→route implement-primary",
      "→alias coder-max",
      "→provider Anthropic (key …Xq4A)",
      "→model claude-fable-5resolved · 42ms",
    ]);
  });

  it("draws the alias in the accent's class, the model in the model hue's, and the last dot ok", async () => {
    const { container } = render(<ChainCard route={PLAN} row={row("coder-max")} />);

    await screen.findByText("resolved · 42ms");

    expect(screen.getByText("coder-max")).toHaveClass("registry-chain__alias");
    expect(screen.getByText("claude-fable-5")).toHaveClass("registry-chain__model");
    expect(container.querySelector(".registry-chain__hop:last-child")).toHaveClass("registry-chain__hop--ok");
    expect(container.querySelector(".registry-chain--dropped")).toBeNull();
  });

  it("tags the run as an inert control that says why, rather than a link to a page that is not there", async () => {
    render(<ChainCard route={PLAN} row={row("coder-max")} />);

    const tag = await screen.findByRole("button", { name: "run #482" });

    expect(tag).toHaveAttribute("aria-disabled", "true");
    expect(tag).toHaveAttribute("title", RUN_CONSOLE_SOON);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("prints the caption, verbatim", async () => {
    render(<ChainCard route={PLAN} row={row("coder-max")} />);

    expect(await screen.findByText(CHAIN_CAPTION)).toHaveClass("registry-chain__caption");
  });

  it("shows the hop the run dropped, struck, when the dropped alias is the one selected", async () => {
    const { container } = render(<ChainCard route={{ kind: "routed", taskKind: "test-gen" }} row={row("coder-fallback")} />);

    await screen.findByText(DROPPED);

    // Still run #482: an alias being skipped is what somebody inspecting it needs to see.
    expect(screen.getByRole("button", { name: "run #482" })).toBeInTheDocument();
    expect(container.querySelector(".registry-chain")).toHaveClass("registry-chain--dropped");
    expect(screen.getByText(/GitHub Copilot is unreachable/)).toHaveClass("registry-chain__explanation");
  });
});

describe("an alias with no snapshot", () => {
  it("renders the simulate-driven chain with the simulated label, and never a run number", async () => {
    readChain.mockImplementation(() =>
      answering({ ok: true, source: { kind: "simulated", resolution: analyzeSimulation() } }),
    );

    const { container } = render(<ChainCard route={ANALYZE} row={row("coder-std")} />);

    expect(await screen.findByText(SIMULATED_LABEL)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/run #/);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("resolved")).toHaveClass("registry-chain__status");
    expect(readChain).toHaveBeenCalledWith("coder-std", ANALYZE);
  });

  it("shows the dropped hop with its explanation after the alias is disabled and re-viewed", async () => {
    readChain.mockImplementationOnce(() =>
      answering({ ok: true, source: { kind: "simulated", resolution: analyzeSimulation() } }),
    );

    const { container, rerender } = render(<ChainCard route={ANALYZE} row={row("coder-std")} />);

    await screen.findByText("resolved");

    // The switch refreshes the page, and the row comes back switched off.
    readChain.mockImplementationOnce(() =>
      answering({ ok: true, source: { kind: "simulated", resolution: disabledSimulation() } }),
    );
    rerender(<ChainCard route={ANALYZE} row={{ ...row("coder-std"), enabled: false }} />);

    expect(await screen.findByText(DISABLED_DROPPED)).toHaveClass("registry-chain__explanation");
    expect(screen.getByText(DROPPED)).toHaveClass("registry-chain__status");
    expect(container.querySelector(".registry-chain")).toHaveClass("registry-chain--dropped");
    expect(container.querySelector(".registry-chain__hop:last-child")).toHaveClass("registry-chain__hop--err");
    expect(readChain).toHaveBeenCalledTimes(2);
  });

  it("renders a refused run's reason under the rail", async () => {
    readChain.mockImplementation(() =>
      answering({ ok: true, source: { kind: "simulated", resolution: failRunExample() } }),
    );

    render(<ChainCard route={{ kind: "routed", taskKind: "implement" }} row={row("coder-max")} />);

    expect(await screen.findByText(FLOOR_BREACHED)).toHaveClass("registry-chain__failure");
  });
});

describe("an alias nothing resolves through", () => {
  it("renders the unbound explanation rather than an empty card", async () => {
    readChain.mockImplementation(() => answering({ ok: true, source: { kind: "unrouted" } }));

    render(<ChainCard route={{ kind: "unrouted" }} row={row("gpt5-experiments")} />);

    expect(await screen.findByText(ALIAS_UNBOUND)).toBeInTheDocument();
    expect(screen.getByText(UNROUTED_TITLE)).toBeInTheDocument();
    expect(screen.getByText(UNROUTED_NOTE)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    // No rail, so nothing to tag.
    expect(screen.queryByText(SIMULATED_LABEL)).not.toBeInTheDocument();
  });
});

describe("a refused read", () => {
  it("is the service's sentence where the rail would be", async () => {
    readChain.mockImplementation(() => answering({ ok: false, reason: "snapshots away" }));

    render(<ChainCard route={PLAN} row={row("coder-max")} />);

    const status = await screen.findByText("snapshots away");

    expect(status).toHaveClass("registry-chain__failure");
    expect(status).toHaveAttribute("role", "status");
  });
});

describe("both themes", () => {
  it("draws the same markup in both, because the palette is CSS's business", async () => {
    readChain.mockImplementation(() =>
      answering({ ok: true, source: { kind: "snapshot", snapshot: seededSnapshot() } }),
    );

    const markup: string[] = [];

    for (const palette of PALETTES) {
      const { container, unmount } = renderInPalette(palette, <ChainCard route={PLAN} row={row("coder-max")} />);

      await screen.findByText("resolved · 42ms");
      markup.push(maskIds(container.innerHTML));
      unmount();
    }

    expect(markup[0]).toBe(markup[1]);
  });
});
