import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { membership, sessionUser } from "../helpers/login";

/**
 * The settings save model story's route (BS.1,
 * [#491](https://github.com/NobuData/ouroboros/issues/491)): two lines — the gate is asked
 * first, and the story, which reads nothing, is drawn behind it.
 */

/** What the gate answers this case with, or the signal it throws instead. */
const requireWorkspace = vi.fn();

vi.mock("@/app/api/access", () => ({ requireWorkspace: () => requireWorkspace() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  unstable_rethrow: () => {},
}));

const { default: Page, metadata } = await import("@/app/(app)/workshop/settings-save/page");

beforeEach(() => {
  requireWorkspace.mockReset();
  requireWorkspace.mockResolvedValue({ user: sessionUser(), membership: membership() });
});

describe("the route", () => {
  it("asks the gate before it draws anything", async () => {
    render(await Page());

    expect(requireWorkspace).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Settings save model");
  });

  it("lets the gate's redirect travel rather than drawing a story behind it", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    requireWorkspace.mockRejectedValue(redirect);

    await expect(Page()).rejects.toBe(redirect);
  });

  it("titles the tab as a workshop page", () => {
    expect(metadata.title).toBe("Workshop · Settings save model · Ouroboros");
  });
});
