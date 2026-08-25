import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SAVE_ROUTES, SAVING, savedRoutes } from "@/app/models/chain";

import { seededTaskKinds } from "../helpers/models";

/**
 * The head's **Save routes** (#202) — AA.1's inert control, enabled by the editor's count.
 */

const saveRoutes = vi.fn();

vi.mock("@/app/models/route-actions", () => ({ saveRoutes: (routes: unknown) => saveRoutes(routes) }));
vi.mock("@/app/models/rule-actions", () => ({
  readRuleTargets: vi.fn().mockResolvedValue({ ok: true, aliases: [] }),
  setRuleEnabled: vi.fn(),
  addRule: vi.fn(),
  removeRule: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { RouteEditorProvider } = await import("@/app/models/route-editor");
const { ChainEditor } = await import("@/app/models/chain-editor");
const { SaveRoutesButton } = await import("@/app/models/save-routes-button");

/** The button, with a chain to edit beside it. */
function button() {
  return render(
    <RouteEditorProvider editable routes={savedRoutes(seededTaskKinds())}>
      <SaveRoutesButton />
      <ChainEditor kind="implement" />
    </RouteEditorProvider>,
  );
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
});

describe("Save routes, in the head", () => {
  it("is inert with AA.1's reason while nothing has changed", () => {
    button();

    const save = screen.getByRole("button", { name: SAVE_ROUTES });

    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save.getAttribute("title")).toMatch(/Nothing to save/);
  });

  it("enables itself on the first edit and commits the batch when pressed", async () => {
    button();
    fireEvent.click(screen.getByRole("button", { name: "Move coder-max down" }));

    const save = screen.getByRole("button", { name: SAVE_ROUTES });
    expect(save).not.toHaveAttribute("aria-disabled");

    await act(async () => {
      fireEvent.click(save);
    });

    expect(saveRoutes).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: SAVE_ROUTES })).toHaveAttribute("aria-disabled", "true");
  });

  it("says it is saving, and is inert, while the batch is in flight", async () => {
    const { promise, answer } = deferred<{ ok: true; revisionId: string }>();
    saveRoutes.mockReturnValue(promise);
    button();
    fireEvent.click(screen.getByRole("button", { name: "Move coder-max down" }));

    fireEvent.click(screen.getByRole("button", { name: SAVE_ROUTES }));

    expect(screen.getByRole("button", { name: SAVING })).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      answer({ ok: true, revisionId: "rev-2" });
      await promise;
    });

    expect(screen.getByRole("button", { name: SAVE_ROUTES })).toBeInTheDocument();
  });
});
