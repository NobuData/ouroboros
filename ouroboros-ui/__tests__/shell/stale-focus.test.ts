import { beforeEach, describe, expect, it, vi } from "vitest";

import { focusRepoIn, focusRepoState, resetFocusRepos, setFocusRepo } from "@/app/shell/focus-repo";
import type { FocusRepoReading } from "@/app/shell/repo-actions";

/** What the chip's list read answers, per case. */
const readFocusRepos = vi.fn<() => Promise<FocusRepoReading>>();

vi.mock("@/app/shell/repo-actions", () => ({ readFocusRepos: () => readFocusRepos() }));

const { dropStaleFocus, reconcileFocusRepo } = await import("@/app/shell/stale-focus");

/**
 * Clearing a stored focus repository that is no longer offered — after a repository is
 * disabled, or the ticket source covering it is removed under Settings → Sources.
 */

const WORKSPACE = "5eed0001-0000-4000-8000-000000000002";
const OTHER_WORKSPACE = "5eed0001-0000-4000-8000-000000000001";
const DOTFILES = { id: "repo-dotfiles", name: "dotfiles" };

/**
 * A listing that offers the given repositories.
 *
 * @param repos What it offers.
 * @param organizationId The workspace it describes.
 * @returns The answer.
 */
function offering(
  repos: { id: string; name: string }[],
  organizationId = WORKSPACE,
): FocusRepoReading {
  return {
    ok: true,
    organizationId,
    repos: repos.map((one) => ({ ...one, login: "kensuenobu" })),
  };
}

beforeEach(() => {
  resetFocusRepos();
  readFocusRepos.mockReset();
  setFocusRepo(WORKSPACE, DOTFILES);
});

describe("dropStaleFocus", () => {
  it("goes back to all repositories when the focus is no longer offered", () => {
    dropStaleFocus(offering([]));

    expect(focusRepoIn(focusRepoState(), WORKSPACE)).toBeNull();
  });

  it("keeps a focus that is still offered", () => {
    dropStaleFocus(offering([DOTFILES]));

    expect(focusRepoIn(focusRepoState(), WORKSPACE)).toEqual(DOTFILES);
  });

  it("touches only the workspace the listing describes", () => {
    dropStaleFocus(offering([], OTHER_WORKSPACE));

    expect(focusRepoIn(focusRepoState(), WORKSPACE)).toEqual(DOTFILES);
  });

  it("changes nothing on a refusal, which says nothing about what is offered", () => {
    dropStaleFocus({ ok: false, reason: "The service is not answering." });

    expect(focusRepoIn(focusRepoState(), WORKSPACE)).toEqual(DOTFILES);
  });
});

describe("reconcileFocusRepo", () => {
  it("reads the list again and clears a focus it no longer offers", async () => {
    readFocusRepos.mockResolvedValue(offering([]));

    await reconcileFocusRepo();

    expect(readFocusRepos).toHaveBeenCalledOnce();
    expect(focusRepoIn(focusRepoState(), WORKSPACE)).toBeNull();
  });

  it("leaves the focus as it was when the read fails", async () => {
    readFocusRepos.mockRejectedValue(new TypeError("fetch failed"));

    await expect(reconcileFocusRepo()).resolves.toBeUndefined();
    expect(focusRepoIn(focusRepoState(), WORKSPACE)).toEqual(DOTFILES);
  });
});
