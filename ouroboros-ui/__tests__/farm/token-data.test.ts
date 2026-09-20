import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthError } from "@/app/api/auth-client";
import { ApiError } from "@/app/api/errors";
import { TOKENS_FORBIDDEN, TOKENS_UNAVAILABLE } from "@/app/farm/enroll";

import { FARM_READ_AT, enrollmentToken, seededFarm } from "../helpers/farm";
import { membership } from "../helpers/login";

const api = vi.hoisted(() => ({
  tokens: vi.fn(),
  pools: vi.fn(),
  members: vi.fn(),
  currentAccess: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/farm", () => ({ farm: { tokens: () => api.tokens(), pools: () => api.pools() } }));
vi.mock("@/app/api/members", () => ({
  members: { list: (tenantId: string, query: unknown) => api.members(tenantId, query) },
}));
vi.mock("@/app/api/access", () => ({ currentAccess: () => api.currentAccess() }));

const { readTokenListing } = await import("@/app/farm/token-data");

/**
 * The token list's one reader (#258): the tokens, with the pools' and the members' names beside
 * them — and the rule that only the tokens' own read can fail the list.
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

  api.tokens.mockResolvedValue([enrollmentToken()]);
  api.pools.mockResolvedValue(seededFarm().pools);
  api.members.mockResolvedValue({ items: [member("user-ken", "Ken")], total: 1, limit: 1000, offset: 0 });
  api.currentAccess.mockResolvedValue({ session: {}, membership: membership() });
});

describe("the listing", () => {
  it("is the tokens as served, with pool and people lookups and the instant it was read", async () => {
    await expect(readTokenListing(() => FARM_READ_AT)).resolves.toEqual({
      ok: true,
      tokens: [enrollmentToken()],
      pools: {
        "5eed0400-0000-4000-8000-0000000000b1": "pool-a",
        "5eed0400-0000-4000-8000-0000000000b2": "pool-b",
      },
      people: { "user-ken": "Ken" },
      readAt: FARM_READ_AT,
    });
  });

  it("reads the members of the workspace the session is acting in", async () => {
    await readTokenListing();

    expect(api.members).toHaveBeenCalledExactlyOnceWith(membership().id, { limit: 1000 });
  });

  it("names a member with no display name by their address, and skips one with neither", async () => {
    api.members.mockResolvedValue({
      items: [member("a", null, "a@acme.dev"), member("b", null)],
      total: 2,
      limit: 1000,
      offset: 0,
    });

    const listing = await readTokenListing();

    expect(listing.ok && listing.people).toEqual({ a: "a@acme.dev" });
  });
});

describe("a refused token read", () => {
  it("is a sentence for a reader who may not, and costs no further read", async () => {
    api.tokens.mockRejectedValue(new ApiError(403, "forbidden", "No."));

    await expect(readTokenListing()).resolves.toEqual({ ok: false, reason: TOKENS_FORBIDDEN });
    expect(api.pools).not.toHaveBeenCalled();
    expect(api.members).not.toHaveBeenCalled();
  });

  it("is a sentence for any other refusal", async () => {
    api.tokens.mockRejectedValue(new ApiError(500, "internal_error", "Broken."));

    await expect(readTokenListing()).resolves.toEqual({ ok: false, reason: TOKENS_UNAVAILABLE });
  });

  it("lets the redirect signal travel", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    api.tokens.mockRejectedValue(redirect);

    await expect(readTokenListing()).rejects.toBe(redirect);
  });
});

describe("the names are decoration", () => {
  it("keeps the list when the pools could not be read — null, not an empty lookup", async () => {
    api.pools.mockRejectedValue(new ApiError(500, "internal_error", "Broken."));

    await expect(readTokenListing()).resolves.toMatchObject({ ok: true, pools: null, people: { "user-ken": "Ken" } });
  });

  it("keeps the list when the members could not be read", async () => {
    api.members.mockRejectedValue(new AuthError(403, "FORBIDDEN", "No.", "/organization/get-full-organization"));

    await expect(readTokenListing()).resolves.toMatchObject({ ok: true, people: null });
  });

  it("keeps the list for a session acting in no workspace, without asking for members", async () => {
    api.currentAccess.mockResolvedValue({ session: {}, membership: undefined });

    await expect(readTokenListing()).resolves.toMatchObject({ ok: true, people: null });
    expect(api.members).not.toHaveBeenCalled();
  });

  it("still lets a redirect raised by either read travel", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    api.members.mockRejectedValue(redirect);

    await expect(readTokenListing()).rejects.toBe(redirect);

    api.members.mockResolvedValue({ items: [], total: 0, limit: 1000, offset: 0 });
    api.pools.mockRejectedValue(redirect);

    await expect(readTokenListing()).rejects.toBe(redirect);
  });
});
