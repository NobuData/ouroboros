import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_REGISTRY, RESOLVES } from "@/app/models/chain";
import { TARGETS_LOADING, TARGETS_UNAVAILABLE, ruleTarget } from "@/app/models/rules";

import { seededAliases } from "../helpers/models";

/**
 * The alias swap menu (#202) — the registry list, each row previewing its resolution.
 *
 * Three properties are worth a suite of their own, each a way this control could be wrong
 * while looking right: that a swap is never a blind pick (every row says what it resolves
 * to, and the current row says it is current); that the list is read once for the page and
 * the panel is honest while it is on its way, when it could not be read, and when it is
 * empty; and that the keyboard is the ARIA menu pattern — focus into the menu on open, a
 * roving walk that wraps, Escape closing and returning focus.
 */

const readRuleTargets = vi.fn();

vi.mock("@/app/models/route-actions", () => ({ saveRoutes: vi.fn() }));
vi.mock("@/app/models/rule-actions", () => ({
  readRuleTargets: () => readRuleTargets(),
  setRuleEnabled: vi.fn(),
  addRule: vi.fn(),
  removeRule: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { RouteEditorProvider } = await import("@/app/models/route-editor");
const { AliasMenu } = await import("@/app/models/alias-menu");

/** What a case is told when a row is picked. */
const onPick = vi.fn();

/**
 * The menu, under an editor, with a plain button as its trigger.
 *
 * @param current The alias that is current, for a swap. Omitted for an add.
 * @returns The Testing Library render result.
 */
function menu(current?: string) {
  return render(
    <RouteEditorProvider editable routes={[]}>
      <AliasMenu
        current={current}
        label="Swap hop 1: coder-max"
        menuLabel="Aliases for hop 1"
        onPick={onPick}
        trigger={(props) => <button {...props}>coder-max</button>}
      />
    </RouteEditorProvider>,
  );
}

/** The trigger. */
function trigger(): HTMLElement {
  return screen.getByRole("button", { name: "Swap hop 1: coder-max" });
}

/**
 * Open the menu and wait for the registry.
 *
 * @returns The menu and its rows.
 */
async function open(): Promise<{ menu: HTMLElement; rows: HTMLElement[] }> {
  fireEvent.click(trigger());
  const panel = screen.getByRole("menu", { name: "Aliases for hop 1" });
  const rows = await within(panel).findAllByRole("menuitemradio");

  return { menu: panel, rows };
}

/**
 * A read this suite finishes itself.
 *
 * @returns The promise to answer with, and the function that answers it.
 */
function deferred<T>(): { promise: Promise<T>; answer: (value: T) => void } {
  let answer!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    answer = resolve;
  });

  return { promise, answer };
}

beforeEach(() => {
  onPick.mockReset();
  readRuleTargets.mockReset().mockResolvedValue({ ok: true, aliases: seededAliases().map(ruleTarget) });
});

describe("the trigger", () => {
  it("says it opens a menu, and which one, once it has", () => {
    menu();

    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).not.toHaveAttribute("aria-controls");

    fireEvent.click(trigger());

    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger().getAttribute("aria-controls")).toBe(screen.getByRole("menu").id);
  });

  it("closes the menu on a second press", async () => {
    menu();
    await open();

    fireEvent.click(trigger());

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("the rows", () => {
  it("lists the registry in its order, every row previewing what the alias resolves to", async () => {
    menu();
    const { rows } = await open();

    expect(rows.map((row) => row.querySelector(".models-chain__option-alias")?.textContent)).toEqual([
      "coder-fallback",
      "coder-max",
      "coder-std",
      "gpt5-experiments",
      "local-docs",
      "local-free",
      "second-opinion",
      "sizer",
    ]);
    for (const row of rows) {
      expect(row).toHaveTextContent(RESOLVES);
    }
    expect(rows[2]).toHaveTextContent("claude-sonnet-5 · Anthropic Claude");
  });

  it("offers an unbound alias, and previews it honestly", async () => {
    // Hiding it would make an alias created ahead of its key unreachable from the surface
    // that would bind a route to it; the preview is what says the hop would be dropped.
    menu();
    const { rows } = await open();

    expect(rows[3]).toHaveTextContent("gpt5-experiments");
    expect(rows[3]).toHaveTextContent("no provider");
  });

  it("marks the current alias, and only it, for a swap", async () => {
    menu("coder-std");
    const { rows } = await open();

    expect(rows.map((row) => row.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "true",
      "false",
      "false",
      "false",
      "false",
      "false",
    ]);
  });

  it("marks nothing for an add, which has no current row", async () => {
    menu();
    const { rows } = await open();

    for (const row of rows) expect(row).not.toHaveAttribute("aria-checked");
  });

  it("hands the picked alias and its resolution to the caller, closes, and returns focus", async () => {
    menu();
    const { rows } = await open();

    fireEvent.click(rows[2]);

    expect(onPick).toHaveBeenCalledExactlyOnceWith({ alias: "coder-std", resolution: "claude-sonnet-5 · Anthropic Claude" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });
});

describe("the registry read", () => {
  it("is read on the first open and not again", async () => {
    menu();
    await open();
    fireEvent.click(trigger());
    await open();

    expect(readRuleTargets).toHaveBeenCalledOnce();
  });

  it("says the list is on its way, and moves focus to the first row when it arrives", async () => {
    const { promise, answer } = deferred<{ ok: true; aliases: ReturnType<typeof ruleTarget>[] }>();
    readRuleTargets.mockReturnValue(promise);
    menu();

    fireEvent.click(trigger());

    const panel = screen.getByRole("menu");
    expect(within(panel).getByRole("status")).toHaveTextContent(TARGETS_LOADING);
    expect(panel).toHaveFocus();

    await act(async () => {
      answer({ ok: true, aliases: seededAliases().map(ruleTarget) });
      await promise;
    });

    expect(within(panel).getAllByRole("menuitemradio")[0]).toHaveFocus();
  });

  it("says why when the list could not be read", async () => {
    readRuleTargets.mockResolvedValue({ ok: false, reason: TARGETS_UNAVAILABLE });
    menu();

    fireEvent.click(trigger());

    expect(await screen.findByRole("alert")).toHaveTextContent(TARGETS_UNAVAILABLE);
    expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument();
  });

  it("says so when the registry is empty rather than opening onto a blank", async () => {
    readRuleTargets.mockResolvedValue({ ok: true, aliases: [] });
    menu();

    fireEvent.click(trigger());

    expect(await screen.findByText(EMPTY_REGISTRY)).toBeInTheDocument();
  });
});

describe("the keyboard", () => {
  it("puts focus on the first row when the menu opens", async () => {
    menu();
    const { rows } = await open();

    expect(rows[0]).toHaveFocus();
  });

  it("walks the rows with the arrows, wrapping at both ends", async () => {
    menu();
    const { menu: panel, rows } = await open();

    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(rows[1]).toHaveFocus();

    fireEvent.keyDown(panel, { key: "End" });
    expect(rows[7]).toHaveFocus();

    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(rows[0]).toHaveFocus();

    fireEvent.keyDown(panel, { key: "ArrowUp" });
    expect(rows[7]).toHaveFocus();

    fireEvent.keyDown(panel, { key: "Home" });
    expect(rows[0]).toHaveFocus();
  });

  it("closes on Escape and puts focus back on the trigger", async () => {
    menu();
    const { menu: panel } = await open();

    fireEvent.keyDown(panel, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("closes on Tab without stealing the browser's own move", async () => {
    menu();
    const { menu: panel } = await open();

    const handled = fireEvent.keyDown(panel, { key: "Tab" });

    expect(handled).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger()).not.toHaveFocus();
  });

  it("closes on a press anywhere else", async () => {
    menu();
    await open();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
