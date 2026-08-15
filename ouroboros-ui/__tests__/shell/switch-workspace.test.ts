import { beforeEach, describe, expect, it, vi } from "vitest";

import { onSummaryRefresh } from "@/app/dashboard/summary-refresh";

import { authStub, menuWorkspaces, signedIn } from "../helpers/account";

/**
 * The one write both menus make — moving the session into another workspace
 * ([#77](https://github.com/NobuData/ouroboros/issues/77)).
 *
 * What each menu *does* around it is its own suite (`tenant-chip.test.tsx`,
 * `user-menu.test.tsx`); what is here is the shared function itself, and it grew a suite of
 * its own with [#87](https://github.com/NobuData/ouroboros/issues/87) because it grew a
 * second effect. A switch has to move three things — the session, the server's render, and
 * now the polling store — and only the third is the same sentence for every caller, so only
 * the third is said here.
 */

vi.mock("@/app/api/auth-client", async () =>
  (await import("../helpers/account")).authClientModule(),
);

const { switchWorkspace } = await import("@/app/shell/switch-workspace");

const OTHER = menuWorkspaces()[1].id;

beforeEach(() => {
  signedIn();
});

describe("switching workspace", () => {
  it("moves the session and reports no refusal", async () => {
    expect(await switchWorkspace(OTHER)).toBeNull();
    expect(authStub.setActive).toHaveBeenCalledWith({ organizationId: OTHER });
  });

  it("tells the polling store that what it holds is another workspace's", async () => {
    // Without this the topbar pills would go on reporting the workspace the reader has just
    // left, for up to a poll interval — `router.refresh()` moves the server's half and knows
    // nothing about client state.
    const heard = vi.fn();
    const stop = onSummaryRefresh(heard);

    await switchWorkspace(OTHER);

    expect(heard).toHaveBeenCalledOnce();
    stop();
  });

  it("says nothing to the store when the switch was refused", async () => {
    // The session is where it was, and asking the poll to re-read a workspace it never left
    // would spend a request to be told the same thing.
    const heard = vi.fn();
    const stop = onSummaryRefresh(heard);
    authStub.setActive.mockResolvedValue({
      data: null,
      error: { status: 403, code: "FORBIDDEN", message: "Not a member." },
    });

    expect(await switchWorkspace(OTHER)).toBe("Not a member.");
    expect(heard).not.toHaveBeenCalled();
    stop();
  });
});
