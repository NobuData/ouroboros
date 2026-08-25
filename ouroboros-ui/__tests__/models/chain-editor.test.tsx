import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADD_HOP,
  AT_BOTTOM_REASON,
  AT_TOP_REASON,
  DRAG_HINT,
  LAST_HOP_REASON,
  NO_ROUTE_NOTE,
  POLICY_NOTE,
  floorReason,
  savedRoutes,
} from "@/app/models/chain";
import { ruleTarget } from "@/app/models/rules";

import { seededAliases, seededTaskKinds } from "../helpers/models";
import { PALETTES, renderInBothPalettes } from "../helpers/palettes";

/**
 * The chain as it is drawn and edited (#202) — mockup 06's numbered rail, and the controls the
 * ticket adds to each hop.
 *
 * What every edit *does* is `chain.test.ts`'s and what the editor *holds* is
 * `route-editor.test.tsx`'s. What is here is what only a render can show: that the rail comes
 * out as the mockup draws it, that every drag has a button that does the same thing, that
 * focus stays on the button a reader pressed after the hop it is on has moved, that every
 * edit is said out loud, that a refused removal is refused at the control with its reason on
 * the page, and that a member gets the chain and nothing that looks like a control.
 */

const saveRoutes = vi.fn();
const readRuleTargets = vi.fn();

vi.mock("@/app/models/route-actions", () => ({ saveRoutes: (routes: unknown) => saveRoutes(routes) }));
vi.mock("@/app/models/rule-actions", () => ({
  readRuleTargets: () => readRuleTargets(),
  setRuleEnabled: vi.fn(),
  addRule: vi.fn(),
  removeRule: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { RouteEditorProvider, useRouteEditor } = await import("@/app/models/route-editor");
const { ChainEditor } = await import("@/app/models/chain-editor");

/** The seeded routes, as the screen hands them to the provider. */
const ROUTES = savedRoutes(seededTaskKinds());

/**
 * The chain for one route, under an editor.
 *
 * @param props.kind Which route. Defaults to the mockup's `implement`.
 * @param props.editable Whether the reader may edit. Defaults to yes.
 * @param props.routes The baseline. Defaults to the seed.
 * @param props.focusToken The matrix's shortcut.
 * @returns The Testing Library render result.
 */
function chain({
  kind = "implement",
  editable = true,
  routes = ROUTES,
  focusToken,
}: { kind?: string; editable?: boolean; routes?: typeof ROUTES; focusToken?: number } = {}) {
  return render(
    <RouteEditorProvider editable={editable} routes={routes}>
      <ChainEditor focusToken={focusToken} kind={kind} />
    </RouteEditorProvider>,
  );
}

/** The rail's hops, in order. */
function hops(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Chain" })).getAllByRole("listitem");
}

/** The aliases down the rail, in order. */
function aliases(): string[] {
  return hops().map((hop) => hop.querySelector(".ou-chip")?.textContent ?? "");
}

/** Every announcement region's text. */
function announced(): string[] {
  return screen.getAllByRole("status").map((region) => region.textContent ?? "");
}

beforeEach(() => {
  saveRoutes.mockReset().mockResolvedValue({ ok: true, revisionId: "rev-1" });
  readRuleTargets.mockReset().mockResolvedValue({ ok: true, aliases: seededAliases().map(ruleTarget) });
});

describe("the rail, as the mockup draws it", () => {
  it("draws the seeded implement chain — three hops, numbered, each with its resolution", () => {
    chain();

    expect(aliases()).toEqual(["coder-max", "coder-fallback", "local-docs"]);
    expect(screen.getByText("→ claude-fable-5 · Anthropic Claude")).toBeInTheDocument();
    expect(screen.getByText("→ gpt-5-codex · GitHub Copilot")).toBeInTheDocument();
    expect(screen.getByText("→ qwen3-coder:32b · Ollama · workstation")).toBeInTheDocument();
    expect(hops().map((hop) => hop.querySelector(".models-chain__idx")?.textContent)).toEqual(["1", "2", "3"]);
  });

  it("prints the operator's note under the hops that have one, and nothing under the rest", () => {
    chain();

    expect(screen.getByText("Fallback on 5xx / timeouts")).toBeInTheDocument();
    expect(screen.getByText("Offline mode — keeps the loop turning without a network")).toBeInTheDocument();
    expect(hops()[0].querySelector(".models-chain__meta")).toBeNull();
  });

  it("draws the primary in the model hue and the fallbacks in the quiet neutral, as the matrix does", () => {
    chain();

    const [primary, fallback] = hops().map((hop) => hop.querySelector(".ou-chip"));

    expect(primary).toHaveClass("ou-chip--model");
    expect(fallback).not.toHaveClass("ou-chip--model");
  });

  it("draws the line between rings on every hop but the last", () => {
    chain();

    expect(hops().map((hop) => hop.querySelector(".models-chain__line") !== null)).toEqual([true, true, false]);
  });

  it("names the issue that brings the policy switches rather than drawing switches that persist nothing", () => {
    chain();

    expect(screen.getByText(POLICY_NOTE)).toBeInTheDocument();
    expect(POLICY_NOTE).toMatch(/#203/);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("says so for a kind with no route rather than drawing an empty rail", () => {
    chain({ kind: "deploy" });

    expect(screen.getByText("deploy")).toBeInTheDocument();
    expect(screen.getByText(NO_ROUTE_NOTE)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Chain" })).not.toBeInTheDocument();
  });
});

describe("the keyboard path — every drag has a button", () => {
  it("moves a hop down and up with its buttons, and the rail redraws", () => {
    chain();

    fireEvent.click(screen.getByRole("button", { name: "Move coder-max down" }));
    expect(aliases()).toEqual(["coder-fallback", "coder-max", "local-docs"]);

    fireEvent.click(screen.getByRole("button", { name: "Move coder-max up" }));
    expect(aliases()).toEqual(["coder-max", "coder-fallback", "local-docs"]);
  });

  it("keeps focus on the button the reader pressed, on the hop that moved", () => {
    // React moves the hop's element to reorder it and a browser blurs a moved element, so
    // the focus is put back by name — which is what lets a reader press again without
    // finding the control.
    chain();
    const down = screen.getByRole("button", { name: "Move coder-max down" });
    down.focus();

    fireEvent.click(down);

    expect(screen.getByRole("button", { name: "Move coder-max down" })).toHaveFocus();
    expect(hops()[1]).toContainElement(document.activeElement as HTMLElement);
  });

  it("announces the position and the count after a move", () => {
    chain();

    fireEvent.click(screen.getByRole("button", { name: "Move local-docs up" }));

    expect(announced()).toContain("local-docs moved to hop 2 of 3.");
  });

  it("leaves the end controls reachable but inert, with the reason", () => {
    // `aria-disabled` rather than `disabled`: the control keeps its place in the tab order,
    // which is what lets focus stay on it after a hop reaches the top.
    chain();

    const up = screen.getByRole("button", { name: "Move coder-max up" });
    const down = screen.getByRole("button", { name: "Move local-docs down" });

    expect(up).toHaveAttribute("aria-disabled", "true");
    expect(up).toHaveAttribute("title", AT_TOP_REASON);
    expect(down).toHaveAttribute("aria-disabled", "true");
    expect(down).toHaveAttribute("title", AT_BOTTOM_REASON);
    expect(up.tabIndex).toBe(0);

    fireEvent.click(up);
    expect(aliases()[0]).toBe("coder-max");
  });

  it("puts focus on the first control when the matrix's shortcut asks", () => {
    const { rerender } = chain({ focusToken: 0 });
    expect(document.activeElement).toBe(document.body);

    rerender(
      <RouteEditorProvider editable routes={ROUTES}>
        <ChainEditor focusToken={1} kind="implement" />
      </RouteEditorProvider>,
    );

    expect(hops()[0]).toContainElement(document.activeElement as HTMLElement);
  });
});

describe("the pointer path — the drag", () => {
  it("drops a hop onto another and moves it there, announcing the same sentence as a key would", () => {
    chain();
    const [first, , third] = hops();
    const handle = within(third).getByTitle(DRAG_HINT);

    fireEvent.dragStart(handle);
    fireEvent.dragOver(first);
    fireEvent.drop(first);

    expect(aliases()).toEqual(["local-docs", "coder-max", "coder-fallback"]);
    expect(announced()).toContain("local-docs moved to hop 1 of 3.");
  });

  it("marks the hop a drag is over as the target, and clears the mark when the drag ends", () => {
    chain();
    const [first, , third] = hops();

    fireEvent.dragStart(within(third).getByTitle(DRAG_HINT));
    fireEvent.dragOver(first);
    expect(first).toHaveClass("models-chain__hop--over");
    expect(third).toHaveClass("models-chain__hop--dragging");

    fireEvent.dragEnd(within(third).getByTitle(DRAG_HINT));
    expect(first).not.toHaveClass("models-chain__hop--over");
    expect(third).not.toHaveClass("models-chain__hop--dragging");
  });

  it("ignores a drop that no hop's handle started", () => {
    chain();

    fireEvent.dragOver(hops()[0]);
    fireEvent.drop(hops()[0]);

    expect(aliases()).toEqual(["coder-max", "coder-fallback", "local-docs"]);
  });

  it("keeps the handle out of the accessibility tree — the buttons are its accessible equivalent", () => {
    chain();

    for (const hop of hops()) {
      expect(within(hop).getByTitle(DRAG_HINT)).toHaveAttribute("aria-hidden", "true");
      expect(within(hop).getByTitle(DRAG_HINT)).toHaveAttribute("draggable", "true");
    }
  });
});

describe("the swap menu", () => {
  it("opens from the hop's pill, and offers the registry with every resolution previewed", async () => {
    chain();

    fireEvent.click(screen.getByRole("button", { name: "Swap hop 2: coder-fallback" }));

    const menu = await screen.findByRole("menu", { name: "Aliases for hop 2" });
    const rows = await within(menu).findAllByRole("menuitemradio");

    expect(rows).toHaveLength(8);
    expect(rows.map((row) => row.textContent)).toContain("coder-std→ resolves: claude-sonnet-5 · Anthropic Claude");
    expect(rows.find((row) => row.textContent?.startsWith("gpt5-experiments"))).toHaveTextContent("no provider");
  });

  it("marks the alias the hop names now as the current row", async () => {
    chain();

    fireEvent.click(screen.getByRole("button", { name: "Swap hop 2: coder-fallback" }));
    const rows = await screen.findAllByRole("menuitemradio");

    expect(rows.filter((row) => row.getAttribute("aria-checked") === "true").map((row) => row.textContent)).toEqual([
      "coder-fallback→ resolves: gpt-5-codex · GitHub Copilot",
    ]);
  });

  it("swaps the hop, redraws its resolution line, and says so", async () => {
    chain();

    fireEvent.click(screen.getByRole("button", { name: "Swap hop 2: coder-fallback" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /^coder-std/ }));

    expect(aliases()).toEqual(["coder-max", "coder-std", "local-docs"]);
    expect(screen.getByText("→ claude-sonnet-5 · Anthropic Claude")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Swap hop 2: coder-std" })).toBeInTheDocument();
    expect(announced()).toContain("Hop 2 now uses coder-std instead of coder-fallback.");
  });

  it("keeps the hop's note across a swap, because the note is about the hop's role", async () => {
    chain();

    fireEvent.click(screen.getByRole("button", { name: "Swap hop 2: coder-fallback" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /^coder-std/ }));

    expect(screen.getByText("Fallback on 5xx / timeouts")).toBeInTheDocument();
  });
});

describe("adding and removing hops", () => {
  it("appends a hop from the registry as the last resort, and says where it landed", async () => {
    chain();

    fireEvent.click(screen.getByRole("button", { name: ADD_HOP }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /^sizer/ }));

    expect(aliases()).toEqual(["coder-max", "coder-fallback", "local-docs", "sizer"]);
    expect(announced()).toContain("sizer added as hop 4.");
  });

  it("removes a hop and says how many remain", () => {
    chain();

    fireEvent.click(screen.getByRole("button", { name: "Remove coder-fallback" }));

    expect(aliases()).toEqual(["coder-max", "local-docs"]);
    expect(announced()).toContain("coder-fallback removed. The chain has 2 hops.");
  });

  it("blocks emptying the chain at the control, with the reason on the page", () => {
    chain({ kind: "analyze" });
    fireEvent.click(screen.getByRole("button", { name: "Remove local-docs" }));
    expect(aliases()).toEqual(["coder-std"]);

    const remove = screen.getByRole("button", { name: "Remove coder-std" });

    expect(remove).toHaveAttribute("aria-disabled", "true");
    expect(remove).toHaveAttribute("title", LAST_HOP_REASON);
    expect(screen.getByText(LAST_HOP_REASON)).toBeInTheDocument();

    fireEvent.click(remove);
    expect(aliases()).toEqual(["coder-std"]);
  });

  it("blocks breaching the floor at the control, naming the floor", () => {
    const floored = ROUTES.map((route) => (route.kind === "implement" ? { ...route, floorHopIndex: 3 } : route));
    chain({ routes: floored });

    for (const alias of ["coder-max", "coder-fallback", "local-docs"]) {
      expect(screen.getByRole("button", { name: `Remove ${alias}` })).toHaveAttribute("title", floorReason(3));
    }
    expect(screen.getAllByText(floorReason(3))).toHaveLength(3);
  });
});

describe("what the server refused", () => {
  it("prints the route's problems under the chain, addressed by hop", async () => {
    saveRoutes.mockResolvedValue({
      ok: false,
      kind: "refused",
      problems: { implement: { "hops.1.alias": ["No such alias."] } },
    });
    // The save is the bar's; here it is driven through a sibling that reads the same editor.
    function Save() {
      const editor = useRouteEditor();
      return (
        <button onClick={editor.save} type="button">
          save
        </button>
      );
    }
    render(
      <RouteEditorProvider editable routes={ROUTES}>
        <ChainEditor kind="implement" />
        <Save />
      </RouteEditorProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Move coder-max down" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Hop 2: No such alias.");
  });
});

describe("a role that may not edit", () => {
  it("gets the chain and nothing that looks like a control", () => {
    chain({ editable: false });

    expect(aliases()).toEqual(["coder-max", "coder-fallback", "local-docs"]);
    expect(screen.getByText("→ claude-fable-5 · Anthropic Claude")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByTitle(DRAG_HINT)).not.toBeInTheDocument();
    expect(screen.queryByText(ADD_HOP)).not.toBeInTheDocument();
  });
});

describe("both palettes", () => {
  it("draws the same markup in both, controls included", () => {
    const [light, dark] = renderInBothPalettes(
      <RouteEditorProvider editable routes={ROUTES}>
        <ChainEditor kind="implement" />
      </RouteEditorProvider>,
    );

    expect(light).toBe(dark);
    expect(PALETTES).toHaveLength(2);
  });
});
