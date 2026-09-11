import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Workspace } from "@/app/api/access";
import { ApiError } from "@/app/api/errors";

import { backlogListing } from "../helpers/issues";
import { TENANT_ID, membership, sessionUser } from "../helpers/login";

/**
 * The intake page's reader (#115).
 *
 * One call, and the suite is about the three properties it has to keep: **it asks the one question
 * that answers the head and the confirmation at once** — `state=all`, one row — **a refused read is
 * a value rather than a throw**, and **anything that is not a refusal keeps travelling**, which is
 * what keeps a session that expired mid-render from being drawn as an uncounted backlog instead of
 * reaching the login screen.
 */

vi.mock("server-only", () => ({}));

/** What the listing answers this case with, or the signal it throws instead. */
const list = vi.fn();

vi.mock("@/app/api/backlog", () => ({ backlog: { list: (query: unknown) => list(query) } }));

const { readIssues } = await import("@/app/issues/data");

/** The workspace the gate hands over — typed as the gate's own return, since nothing on it is read. */
const ACCESS: Workspace = {
  session: {
    user: sessionUser(),
    memberships: [membership()],
    membershipTotal: 1,
    activeOrganizationId: TENANT_ID,
    tenantSuggestion: null,
  },
  membership: membership(),
};

beforeEach(() => {
  list.mockReset().mockResolvedValue(backlogListing());
});

describe("reading the page head", () => {
  it("asks for every state, one row long, and asks once", async () => {
    // `state=all` makes `total` the mirrored count without moving `meta`'s open-scoped figures;
    // one row because the head draws none. See `app/issues/data.ts`.
    await readIssues(ACCESS);

    expect(list).toHaveBeenCalledExactlyOnceWith({ state: "all", limit: 1 });
  });

  it("reads the seeded workspace as nine open, seven sized, nine mirrored", async () => {
    expect(await readIssues(ACCESS)).toEqual({
      counts: { ok: true, value: { openCount: 9, sizedCount: 7, mirroredCount: 9 } },
    });
  });

  it("takes the mirrored count from total, so closed issues are in the confirmation's scope", async () => {
    list.mockResolvedValue(backlogListing({ openCount: 9, total: 12 }));

    const { counts } = await readIssues(ACCESS);

    expect(counts).toEqual({ ok: true, value: { openCount: 9, sizedCount: 7, mirroredCount: 12 } });
  });

  it("keeps a refusal as the reason the backlog could not be counted", async () => {
    list.mockRejectedValue(new ApiError(400, "organization_required", "Choose a workspace."));

    expect(await readIssues(ACCESS)).toEqual({
      counts: { ok: false, reason: "Choose a workspace." },
    });
  });

  it("lets a redirect through rather than drawing around it", async () => {
    list.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(readIssues(ACCESS)).rejects.toThrow("NEXT_REDIRECT /login");
  });

  it("lets a dropped connection through too, since it is not an answer from the service", async () => {
    list.mockRejectedValue(new TypeError("fetch failed"));

    await expect(readIssues(ACCESS)).rejects.toThrow(TypeError);
  });
});
