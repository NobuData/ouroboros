import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthError } from "@/app/api/auth-client";
import { resetRestUrlCache } from "@/app/env";
// Types only, so this import is erased and nothing loads before the mocks below.
import type { Member, MemberPage } from "@/app/api/members";

// The resource sits on the auth client, so importing it pulls in the same server-only
// modules `session.test.ts` answers. The cookie jar below is the one the auth client reads.
vi.mock("server-only", () => ({}));

/** The cookies of the request under test. */
const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
      set: () => {},
      delete: () => {},
    }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { members } = await import("@/app/api/members");

/**
 * The members resource — **the auth family's since
 * [#714](https://github.com/NobuData/ouroboros/issues/714)**.
 *
 * `GET /api/v1/tenants/{tenantId}/members` was this module's source until then; that issue
 * deleted every member operation from `ouroboros-rest`, because the organization plugin
 * serves them natively and two write paths to one membership table is how two role checks
 * drift apart. So the assertions here changed shape with the source: the route called is
 * BetterAuth's, the generated client is *not* involved — the auth family is excluded from
 * codegen and importing across that line is what the rule prevents — and the window is
 * applied here rather than sent, because the plugin offers no pagination.
 *
 * The dashboard reads a count from here, which is why one case below is about `total`
 * specifically: it is the workspace's whole membership whatever the window was, and a card
 * that counted `items` instead would report twenty-five for a workspace of four hundred.
 */

const REST = "http://rest.test:4000";

const TENANT = "5eed0001-0000-4000-8000-000000000001";

/** One membership, as `get-full-organization` returns it — the library's vocabulary. */
const KEN = {
  id: "5eed0007-0000-4000-8000-000000000001",
  organizationId: TENANT,
  userId: "5eed0003-0000-4000-8000-000000000001",
  role: "owner",
  createdAt: "2026-08-11T10:20:23.114Z",
  user: { email: "ken@acme-robotics.dev", name: "Ken Suenobu", image: null },
};

/** What each request was asked for, and what it answered. */
interface Stub {
  readonly urls: string[];
}

/**
 * Answer `get-full-organization`.
 *
 * @param body What the route answers. `null` is what the plugin sends when there is no
 *   organization to answer about.
 * @param status The status. Defaults to `200`.
 * @returns What was asked, in order.
 */
function organizationAnswering(body: unknown, status = 200): Stub {
  const urls: string[] = [];

  vi.stubGlobal("fetch", (input: string) => {
    urls.push(input);

    return Promise.resolve(
      new Response(body === null ? "null" : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  return { urls };
}

/** One workspace with its members, as the plugin answers. */
const withMembers = (members: unknown[]): unknown => ({ id: TENANT, members });

describe("members.list", () => {
  beforeEach(() => {
    jar.clear();
    resetRestUrlCache();
    process.env.OURO_REST_URL = REST;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OURO_REST_URL;
    resetRestUrlCache();
  });

  it("asks the organization plugin rather than this service's own routes", async () => {
    // The acceptance criterion of #714, from the consumer's side. A call to anything under
    // `/api/v1/…/members` would be the second write path the issue exists to remove — and
    // there is no such route to call any more.
    const stub = organizationAnswering(withMembers([KEN]));

    await members.list(TENANT);

    expect(stub.urls).toEqual([
      `${REST}/api/auth/organization/get-full-organization?organizationId=${TENANT}`,
    ]);
  });

  it("escapes the workspace id rather than pasting it into the query", async () => {
    const stub = organizationAnswering(withMembers([]));

    await members.list("a workspace/with?punctuation");

    expect(stub.urls[0]).toContain("organizationId=a%20workspace%2Fwith%3Fpunctuation");
  });

  it("renders the library's vocabulary as this application's", async () => {
    organizationAnswering(withMembers([KEN]));

    const page = await members.list(TENANT);

    expect(page.items).toEqual([
      {
        orgId: TENANT,
        userId: "5eed0003-0000-4000-8000-000000000001",
        role: "owner",
        joinedAt: "2026-08-11T10:20:23.114Z",
        email: "ken@acme-robotics.dev",
        displayName: "Ken Suenobu",
        avatarUrl: null,
      },
    ]);
  });

  it("keeps the person's own fields null when the listing did not join them in", async () => {
    // "We did not ask for the person" and "the person has no name" are different facts, and a
    // member table renders them differently — so neither is defaulted into the other.
    organizationAnswering(withMembers([{ ...KEN, user: undefined }]));

    const [member] = (await members.list(TENANT)).items;

    expect(member?.email).toBeNull();
    expect(member?.displayName).toBeNull();
    expect(member?.avatarUrl).toBeNull();
  });

  it("applies the window itself, because the plugin offers none", async () => {
    // The plugin answers with the whole membership. Slicing here is what keeps
    // `{items, total, limit, offset}` an honest description of what a caller got.
    organizationAnswering(
      withMembers([KEN, { ...KEN, userId: "second" }, { ...KEN, userId: "third" }]),
    );

    const page = await members.list(TENANT, { limit: 1, offset: 1 });

    expect(page.items.map((member) => member.userId)).toEqual(["second"]);
    expect(page).toMatchObject({ limit: 1, offset: 1 });
  });

  it("reports the workspace's whole membership in `total`, not the size of the window", async () => {
    // The count on the dashboard is this field. Reading `items.length` instead would cap
    // every workspace at the page size and call it the truth.
    organizationAnswering(
      withMembers([KEN, { ...KEN, userId: "second" }, { ...KEN, userId: "third" }]),
    );

    const page = await members.list(TENANT, { limit: 1 });

    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(3);
  });

  it("defaults the window to the contract's own default", async () => {
    organizationAnswering(withMembers([KEN]));

    expect(await members.list(TENANT)).toMatchObject({ limit: 25, offset: 0 });
  });

  it("returns an empty page as a page, not as an absence", async () => {
    organizationAnswering(withMembers([]));

    const page = await members.list(TENANT);

    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("reads a workspace the plugin answers `null` for as an empty page", async () => {
    // `null` is what a session with no active organization gets, and a missing organization
    // is not this call's news — the dashboard draws a card with no members rather than a
    // failed one.
    organizationAnswering(null);

    expect(await members.list(TENANT)).toMatchObject({ items: [], total: 0 });
  });

  it("rejects when the caller is not a member of the workspace", async () => {
    // The plugin's own refusal, in its own envelope — `{message, code}` rather than this
    // service's `{code, message, details}`, which is why `AuthError` is a class of its own.
    organizationAnswering({ message: "You are not a member.", code: "FORBIDDEN" }, 403);

    const caught: unknown = await members.list(TENANT).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).status).toBe(403);
  });
});

describe("the typing", () => {
  beforeEach(() => {
    resetRestUrlCache();
    process.env.OURO_REST_URL = REST;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OURO_REST_URL;
    resetRestUrlCache();
  });

  it("types a page's fields end to end", async () => {
    organizationAnswering(withMembers([KEN]));

    const page: MemberPage = await members.list(TENANT);
    const first: Member | undefined = page.items[0];

    expect(first?.displayName).toBe("Ken Suenobu");
    expect(first?.role).toBe("owner");
    expect(first?.avatarUrl).toBeNull();
  });

  it("rejects a role the contract does not list", () => {
    // @ts-expect-error — `role` is "owner" | "admin" | "member" | "viewer", shared with
    // `app/api/membership.ts` so the screens and this agree about who may act.
    const role: Member["role"] = "superuser";

    expect(role).toBe("superuser");
  });

  it("rejects a window field the listing does not accept", async () => {
    organizationAnswering(withMembers([KEN]));

    // @ts-expect-error — the window is `limit` and `offset`; there is no `role` filter.
    await members.list(TENANT, { role: "owner" });

    expect(true).toBe(true);
  });
});
