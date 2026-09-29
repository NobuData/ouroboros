import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthError } from "@/app/api/auth-client";

import { membership } from "../helpers/login";

const api = vi.hoisted(() => ({ members: vi.fn(), currentAccess: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/members", () => ({
  members: { list: (tenantId: string, query: unknown) => api.members(tenantId, query) },
}));
vi.mock("@/app/api/access", () => ({ currentAccess: () => api.currentAccess() }));

const { readPeople } = await import("@/app/api/people");

/**
 * The workspace's names by id (#258's reader, shared since #340): what turns the user id on a
 * record into a name — and the rule that a name is decoration, so a listing that failed is
 * `null` rather than an error.
 */

/**
 * One member, as `members.list` answers.
 *
 * @param userId The person.
 * @param displayName Their name, or `null`.
 * @param email Their address, or `null`.
 * @returns The member.
 */
function member(userId: string, displayName: string | null, email: string | null = null) {
  return { orgId: "org", userId, role: "admin", joinedAt: "", email, displayName, avatarUrl: null };
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();

  api.currentAccess.mockResolvedValue({ session: {}, membership: membership() });
});

describe("readPeople", () => {
  it("reads the active workspace's whole membership, by id", async () => {
    api.members.mockResolvedValue({
      items: [member("user-ken", "Ken"), member("user-mel", "Mel")],
      total: 2,
      limit: 1000,
      offset: 0,
    });

    expect(await readPeople()).toEqual({ "user-ken": "Ken", "user-mel": "Mel" });
    expect(api.members).toHaveBeenCalledExactlyOnceWith(membership().id, { limit: 1000 });
  });

  it("lists a member with no display name under their address, and leaves out one with neither", async () => {
    api.members.mockResolvedValue({
      items: [member("user-ana", null, "ana@acme.example"), member("user-ghost", null)],
      total: 2,
      limit: 1000,
      offset: 0,
    });

    expect(await readPeople()).toEqual({ "user-ana": "ana@acme.example" });
  });

  it("is null, not an error, when the auth family refuses the listing", async () => {
    api.members.mockRejectedValue(new AuthError(403, "forbidden", "Not a member.", "/organization/get-full-organization"));

    expect(await readPeople()).toBeNull();
  });

  it("is null without a workspace, and asks for nothing", async () => {
    api.currentAccess.mockResolvedValue({ session: null, membership: undefined });

    expect(await readPeople()).toBeNull();
    expect(api.members).not.toHaveBeenCalled();
  });

  it("rethrows what is not the auth family's refusal — the redirect signal above all", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    api.members.mockRejectedValue(redirect);

    await expect(readPeople()).rejects.toBe(redirect);
  });
});
