import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
// Types only, so this import is erased and nothing loads before the mocks below.
import type { Org, OrgPage } from "@/app/api/orgs";

import { STUB_BASE_URL, clientAnswering } from "../helpers/api";

// The resource sits on the server-side client — see `server.test.ts` for what each of these
// three answers. Every case passes its own client; the mocks only make the import succeed.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { orgs } = await import("@/app/api/orgs");

/**
 * The organisations resource — the workspace's enablement list.
 */

/** The seeded workspace, whose id every path below carries. */
const TENANT = "5eed0001-0000-4000-8000-000000000001";

/** One organisation, as the contract describes it. */
const ORG = {
  id: "5eed0005-0000-4000-8000-000000000001",
  tenantId: TENANT,
  login: "acme-robotics",
  enabled: true,
  installedAt: null,
  createdAt: "2026-08-11T10:20:23.114Z",
  updatedAt: "2026-08-11T10:20:23.114Z",
};

/** A page carrying it. */
const PAGE = { items: [ORG], total: 1, limit: 25, offset: 0 };

describe("orgs.list", () => {
  it("puts the workspace in the path and returns the page itself", async () => {
    const { client, requests } = clientAnswering(PAGE);

    const page = await orgs.list(TENANT, {}, client);

    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/tenants/${TENANT}/orgs`);
    expect(page).toEqual(PAGE);
  });

  it("passes the window through as the contract's query parameters", async () => {
    const { client, requests } = clientAnswering(PAGE);

    await orgs.list(TENANT, { limit: 100, offset: 0 }, client);

    expect(new URL(requests[0]?.url ?? "").search).toBe("?limit=100&offset=0");
  });

  it("returns the disabled organisations too, which a switch that is off needs", async () => {
    const off = { ...ORG, enabled: false };
    const { client } = clientAnswering({ ...PAGE, items: [off] });

    const page = await orgs.list(TENANT, {}, client);

    expect(page.items[0]?.enabled).toBe(false);
  });

  it("returns an empty page as a page, not as an absence", async () => {
    const { client } = clientAnswering({ items: [], total: 0, limit: 25, offset: 0 });

    expect((await orgs.list(TENANT, {}, client)).items).toEqual([]);
  });

  it("rejects with the parsed envelope when the workspace is not visible", async () => {
    const { client } = clientAnswering(
      { code: "tenant_not_found", message: "No such tenant.", details: {} },
      404,
    );

    const caught: unknown = await orgs.list(TENANT, {}, client).catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("tenant_not_found");
  });
});

describe("orgs.setEnabled", () => {
  it("patches the organisation, sending only the flag", async () => {
    const { client, requests } = clientAnswering({ ...ORG, enabled: false });

    const org = await orgs.setEnabled(TENANT, "acme-robotics", false, client);

    expect(requests[0]?.method).toBe("PATCH");
    expect(requests[0]?.url).toBe(
      `${STUB_BASE_URL}/api/v1/tenants/${TENANT}/orgs/acme-robotics`,
    );
    expect(await requests[0]?.json()).toEqual({ enabled: false });
    expect(org.enabled).toBe(false);
  });

  it("escapes the login into the path rather than leaving that to the caller", async () => {
    const { client, requests } = clientAnswering(ORG);

    await orgs.setEnabled(TENANT, "a b", true, client);

    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/tenants/${TENANT}/orgs/a%20b`);
  });

  it("rejects with the 403 the contract answers a role that may only read", async () => {
    const { client } = clientAnswering(
      {
        code: "insufficient_role",
        message: "Administering a workspace is owner or admin.",
        details: {},
      },
      403,
    );

    const caught: unknown = await orgs
      .setEnabled(TENANT, "acme-robotics", true, client)
      .catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(403);
    expect((caught as ApiError).code).toBe("insufficient_role");
  });
});

describe("the typing, which is the reason the client is generated", () => {
  it("types the page and its rows end to end", async () => {
    const { client } = clientAnswering(PAGE);

    const page: OrgPage = await orgs.list(TENANT, {}, client);
    const first: Org | undefined = page.items[0];

    expect(first?.login).toBe("acme-robotics");
    expect(first?.installedAt).toBeNull();
  });

  it("rejects a field the contract does not describe", () => {
    const org = ORG as unknown as Org;

    // @ts-expect-error — an organisation has `login`, never `name`.
    expect(org.name).toBeUndefined();
  });

  it("rejects a flag of the wrong type in the update body", async () => {
    const { client } = clientAnswering(ORG);

    await client.PATCH("/api/v1/tenants/{tenantId}/orgs/{login}", {
      params: { path: { tenantId: TENANT, login: "acme-robotics" } },
      // @ts-expect-error — `enabled` is a boolean, and the truthiness of "yes" is not the
      // contract's business.
      body: { enabled: "yes" },
    });

    expect(true).toBe(true);
  });

  it("rejects a path the contract does not publish", async () => {
    const { client } = clientAnswering(ORG);

    // @ts-expect-error — nothing serves `/api/v1/tenants/{tenantId}/organisations`; only
    // paths the document describes are callable at all.
    await client.GET("/api/v1/tenants/{tenantId}/organisations");

    expect(true).toBe(true);
  });
});
