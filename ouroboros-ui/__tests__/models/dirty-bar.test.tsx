import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DISCARD, ROUTES_REFUSED, ROUTES_SAVED, SAVE_ROUTES, SAVING, savedRoutes } from "@/app/models/chain";

import { seededTaskKinds } from "../helpers/models";
import { PALETTES, renderInBothPalettes } from "../helpers/palettes";

/**
 * The dirty-state bar (#202) — `2 routes changed · [Save routes] [Discard]`, present exactly
 * while there is something to decide.
 *
 * Driven through the chain editor beside it rather than through the hook, because what is
 * being asserted is the composition: an edit over there makes a bar appear here, the bar's
 * count is the editor's, and its two actions are the editor's save and discard.
 */

const saveRoutes = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/models/route-actions", () => ({ saveRoutes: (routes: unknown) => saveRoutes(routes) }));
vi.mock("@/app/models/rule-actions", () => ({
  readRuleTargets: vi.fn().mockResolvedValue({ ok: true, aliases: [] }),
  setRuleEnabled: vi.fn(),
  addRule: vi.fn(),
  removeRule: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { RouteEditorProvider } = await import("@/app/models/route-editor");
const { ChainEditor } = await import("@/app/models/chain-editor");
const { DirtyBar } = await import("@/app/models/dirty-bar");

const ROUTES = savedRoutes(seededTaskKinds());

/**
 * The bar, with a chain to edit beside it.
 *
 * @param editable Whether the reader may edit. Defaults to yes.
 * @returns The Testing Library render result.
 */
function bar(editable = true) {
  return render(
    <RouteEditorProvider editable={editable} routes={ROUTES}>
      <DirtyBar />
      <ChainEditor kind="implement" />
      {/* A second chain naming none of implement's aliases, so every control's name is one control. */}
      <ChainEditor kind="estimate" />
    </RouteEditorProvider>,
  );
}

/** One edit, on the implement chain. */
function edit(): void {
  fireEvent.click(screen.getByRole("button", { name: "Move coder-max down" }));
}

/** The bar's element, or `null`. */
function stuck(): HTMLElement | null {
  return document.querySelector(".ou-sticky-bar");
}

/**
 * A write this suite finishes itself.
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
  saveRoutes.mockReset().mockResolvedValue({ ok: true, revisionId: "rev-1" });
  refresh.mockReset();
});

describe("when the bar is there", () => {
  it("is absent while nothing has changed, and appears on the first edit", () => {
    bar();
    expect(stuck()).toBeNull();

    edit();

    expect(stuck()).not.toBeNull();
    expect(screen.getByText("1 route changed")).toBeInTheDocument();
  });

  it("counts routes, and follows the count down as edits are undone", () => {
    bar();
    edit();
    fireEvent.click(screen.getByRole("button", { name: "Move sizer down" }));
    expect(screen.getByText("2 routes changed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Move sizer up" }));
    expect(screen.getByText("1 route changed")).toBeInTheDocument();
  });

  it("is the CP.4 sticky bar in its asking manner, so it sticks within the pane", () => {
    bar();
    edit();

    expect(stuck()).toHaveClass("ou-sticky-bar", "ou-sticky-bar--asking", "models-dirty");
  });

  it("never appears for a role that may not edit", () => {
    bar(false);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(stuck()).toBeNull();
  });
});

describe("Discard", () => {
  it("restores the last saved state and takes the bar with it", () => {
    bar();
    edit();

    fireEvent.click(screen.getByRole("button", { name: DISCARD }));

    expect(stuck()).toBeNull();
    const chain = screen.getAllByRole("list", { name: "Chain" })[0];
    expect(within(chain).getAllByRole("listitem")[0]).toHaveTextContent("coder-max");
  });
});

describe("Save routes", () => {
  it("commits the batch, says so, and leaves", async () => {
    bar();
    edit();

    await act(async () => {
      fireEvent.click(within(stuck() as HTMLElement).getByRole("button", { name: SAVE_ROUTES }));
    });

    expect(saveRoutes).toHaveBeenCalledOnce();
    expect(stuck()).toBeNull();
    expect(screen.getAllByRole("status").map((region) => region.textContent)).toContain(ROUTES_SAVED);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps its live region on the page while clean, so the save's notice is heard", () => {
    // A live region added at the same moment as its content is not announced — and *Routes
    // saved* is said at the exact moment the bar leaves. The bar alone, so the one region on
    // the page is its own.
    render(
      <RouteEditorProvider editable routes={ROUTES}>
        <DirtyBar />
      </RouteEditorProvider>,
    );

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(stuck()).toBeNull();
  });

  it("holds both actions inert while the batch is in flight, and says so", async () => {
    const { promise, answer } = deferred<{ ok: true; revisionId: string }>();
    saveRoutes.mockReturnValue(promise);
    bar();
    edit();

    fireEvent.click(within(stuck() as HTMLElement).getByRole("button", { name: SAVE_ROUTES }));

    const inflight = within(stuck() as HTMLElement).getByRole("button", { name: SAVING });
    expect(inflight).toHaveAttribute("aria-disabled", "true");
    expect(within(stuck() as HTMLElement).getByRole("button", { name: DISCARD })).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      answer({ ok: true, revisionId: "rev-2" });
      await promise;
    });

    expect(stuck()).toBeNull();
  });

  it("stays, with the reason as an alert, when the server refused the batch", async () => {
    saveRoutes.mockResolvedValue({ ok: false, kind: "refused", problems: { implement: { taskKind: ["No."] } } });
    bar();
    edit();

    await act(async () => {
      fireEvent.click(within(stuck() as HTMLElement).getByRole("button", { name: SAVE_ROUTES }));
    });

    expect(stuck()).not.toBeNull();
    expect(within(stuck() as HTMLElement).getByRole("alert")).toHaveTextContent(ROUTES_REFUSED);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("stays, with the reason, when the save failed outright", async () => {
    saveRoutes.mockResolvedValue({ ok: false, kind: "failed", reason: "Routing is down." });
    bar();
    edit();

    await act(async () => {
      fireEvent.click(within(stuck() as HTMLElement).getByRole("button", { name: SAVE_ROUTES }));
    });

    expect(within(stuck() as HTMLElement).getByRole("alert")).toHaveTextContent("Routing is down.");
  });
});

describe("both palettes", () => {
  it("draws the same markup in both", () => {
    const [light, dark] = renderInBothPalettes(
      <RouteEditorProvider editable routes={ROUTES}>
        <DirtyBar />
      </RouteEditorProvider>,
    );

    expect(light).toBe(dark);
    expect(PALETTES).toHaveLength(2);
  });
});
