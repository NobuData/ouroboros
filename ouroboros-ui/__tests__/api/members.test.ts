import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
// Types only, so this import is erased and nothing loads before the mocks below.
import type { Member, MemberPage } from "@/app/api/members";

import { clientAnswering } from "../helpers/api";

// The facade sits on the server-side client, so importing it pulls in the same three
// server-only modules `server.test.ts` answers. Nothing here calls the wired client —
// every case passes its own — but the mocks have to exist for the import to succeed.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { members } = await import("@/app/api/members");

/**
 * The members resource, in the shape `tenants.test.ts` established: the path, the query
 * passed through, the body returned rather than the envelope around it — and the
 * `@ts-expect-error` cases, which fail `yarn typecheck` if they ever start compiling.
 *
 * The dashboard reads a count from here, which is why one case below is about `total`
 * specifically: it is the workspace's whole membership whatever the window was, and a card
 * that counted `items` instead would report a hundred for a workspace of four hundred.
 */

const TENANT = "5eed0001-0000-4000-8000-000000000001";

/** One member, as the contract describes them. */
const KEN = {
  tenantId: TENANT,
  userId: "5eed0003-0000-4000-8000-000000000001",
  email: "ken@acme-robotics.dev",
  displayName: "Ken Suenobu",
  avatarUrl: null,
  role: "owner",
  invitedAt: "2026-08-11T10:20:23.114Z",
  joinedAt: "2026-08-11T10:20:23.114Z",
};

/** A page carrying them. */
const PAGE = { items: [KEN], total: 1, limit: 25, offset: 0 };

describe("members.list", () => {
  it("puts the workspace in the path and returns the page itself", async () => {
    const { client, requests } = clientAnswering(PAGE);

    const page = await members.list(TENANT, {}, client);

    expect(requests[0]?.url).toBe(`http://rest.test:4000/api/v1/tenants/${TENANT}/members`);
    expect(page).toEqual(PAGE);
  });

  it("passes the window through as the contract's query parameters", async () => {
    const { client, requests } = clientAnswering(PAGE);

    await members.list(TENANT, { limit: 100, offset: 20 }, client);

    expect(new URL(requests[0]?.url ?? "").search).toBe("?limit=100&offset=20");
  });

  it("sends no window at all when none is given, leaving the service's defaults", async () => {
    const { client, requests } = clientAnswering(PAGE);

    await members.list(TENANT, {}, client);

    expect(new URL(requests[0]?.url ?? "").search).toBe("");
  });

  it("reports the workspace's whole membership in `total`, not the size of the window", async () => {
    // The count on the dashboard is this field. Reading `items.length` instead would cap
    // every workspace at the page size and call it the truth.
    const { client } = clientAnswering({ items: [KEN], total: 412, limit: 1, offset: 0 });

    const page = await members.list(TENANT, { limit: 1 }, client);

    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(412);
  });

  it("returns an empty page as a page, not as an absence", async () => {
    const { client } = clientAnswering({ items: [], total: 0, limit: 25, offset: 0 });

    const page = await members.list(TENANT, {}, client);

    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("rejects with the 404 the contract answers for a workspace one cannot see", async () => {
    // The same answer for a workspace that does not exist and one the caller does not
    // belong to — the contract deliberately does not distinguish them.
    const { client } = clientAnswering(
      { code: "tenant_not_found", message: "No such tenant.", details: {} },
      404,
    );

    const caught: unknown = await members.list(TENANT, {}, client).catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("tenant_not_found");
  });
});

describe("the typing, which is the reason the client is generated", () => {
  it("types a page's fields end to end", async () => {
    const { client } = clientAnswering(PAGE);

    const page: MemberPage = await members.list(TENANT, {}, client);
    const first: Member | undefined = page.items[0];

    expect(first?.displayName).toBe("Ken Suenobu");
    expect(first?.role).toBe("owner");
    expect(first?.avatarUrl).toBeNull();
  });

  it("rejects a role the contract does not list", () => {
    // @ts-expect-error — `role` is "owner" | "admin" | "member" | "viewer".
    const role: Member["role"] = "superuser";

    expect(role).toBe("superuser");
  });

  it("rejects a query parameter the operation does not accept", async () => {
    const { client } = clientAnswering(PAGE);

    // @ts-expect-error — the listing is `?limit=&offset=`; there is no `role`.
    await members.list(TENANT, { role: "owner" }, client);

    expect(true).toBe(true);
  });
});
