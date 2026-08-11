import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "@/app/api/client";
import { ApiError } from "@/app/api/errors";
// Types only, so this import is erased and nothing loads before the mocks below.
import type { Tenant, TenantPage } from "@/app/api/tenants";

// The facade sits on the server-side client, so importing it pulls in the same three
// server-only modules `server.test.ts` answers. Nothing here calls the wired client —
// every case passes its own — but the mocks have to exist for the import to succeed.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { tenants } = await import("@/app/api/tenants");

/**
 * The workspaces resource, and the typing that is the point of generating a client.
 *
 * Two things are under test here and they are different in kind. The first is behaviour:
 * the right path, the query passed through, the body returned rather than the envelope
 * around it. The second is the **compile**: the `@ts-expect-error` cases below fail
 * `yarn typecheck` if they ever start compiling, which is how "renaming a REST DTO field
 * breaks the UI typecheck after a sync" is held to be true by CI rather than by hand.
 */

/** One workspace, as the contract describes it. */
const ACME = {
  id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  slug: "acme",
  displayName: "Acme, Inc.",
  status: "active",
  createdAt: "2026-08-11T10:20:23.114Z",
  updatedAt: "2026-08-11T10:20:23.114Z",
};

/** A page carrying it. */
const PAGE = { items: [ACME], total: 1, limit: 25, offset: 0 };

/**
 * A client answering every call with one body, recording what it was asked.
 *
 * @param body What the service answers with.
 * @param status The status to answer with. Defaults to `200`.
 * @returns The client and the requests it made.
 */
function clientAnswering(body: unknown, status = 200) {
  const requests: Request[] = [];
  const client = createApiClient({
    baseUrl: "http://rest.test:4000",
    fetch: (request) => {
      requests.push(request);
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
  });
  return { client, requests };
}

describe("tenants.list", () => {
  it("calls the listing operation and returns the page itself", async () => {
    const { client, requests } = clientAnswering(PAGE);

    const page = await tenants.list({}, client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/tenants");
    expect(page).toEqual(PAGE);
  });

  it("passes the window through as the contract's query parameters", async () => {
    const { client, requests } = clientAnswering(PAGE);

    await tenants.list({ limit: 10, offset: 20 }, client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/tenants?limit=10&offset=20");
  });

  it("sends no window at all when none is given, leaving the service's defaults", async () => {
    const { client, requests } = clientAnswering(PAGE);

    await tenants.list({}, client);

    expect(new URL(requests[0]?.url ?? "").search).toBe("");
  });

  it("returns an empty page as a page, not as an absence", async () => {
    const { client } = clientAnswering({ items: [], total: 0, limit: 25, offset: 0 });

    const page = await tenants.list({}, client);

    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("rejects with the parsed envelope when the service refuses", async () => {
    const { client } = clientAnswering(
      { code: "validation_failed", message: "limit must be at most 100.", details: {} },
      422,
    );

    const caught: unknown = await tenants.list({ limit: 100 }, client).catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("validation_failed");
  });
});

describe("tenants.read", () => {
  it("puts the id in the path, escaped by the client rather than by the caller", async () => {
    const { client, requests } = clientAnswering(ACME);

    const tenant = await tenants.read(ACME.id, client);

    expect(requests[0]?.url).toBe(`http://rest.test:4000/api/v1/tenants/${ACME.id}`);
    expect(tenant.slug).toBe("acme");
  });

  it("rejects with the 404 the contract answers for a workspace one cannot see", async () => {
    const { client } = clientAnswering(
      { code: "tenant_not_found", message: "No such tenant.", details: {} },
      404,
    );

    await expect(tenants.read(ACME.id, client)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("the typing, which is the reason the client is generated", () => {
  it("types a page's fields end to end", async () => {
    const { client } = clientAnswering(PAGE);

    const page: TenantPage = await tenants.list({}, client);
    const first: Tenant | undefined = page.items[0];

    // Every one of these is a compile-time assertion as much as a runtime one: the
    // fields come from the generated schema, so a rename in openapi.yaml breaks this
    // file after `yarn api:sync`.
    expect(first?.slug).toBe("acme");
    expect(first?.displayName).toBe("Acme, Inc.");
    expect(first?.status).toBe("active");
    expect(page.limit + page.offset).toBe(25);
  });

  it("rejects a field the contract does not describe", () => {
    const tenant = ACME as unknown as Tenant;

    // @ts-expect-error — a tenant has `displayName`, never `name`. If this line ever
    // compiles, the generated types no longer describe the committed contract.
    expect(tenant.name).toBeUndefined();
  });

  it("rejects a status the contract does not list", () => {
    // @ts-expect-error — `status` is "active" | "suspended" | "deleted".
    const status: Tenant["status"] = "archived";

    expect(status).toBe("archived");
  });

  it("rejects a query parameter the operation does not accept", async () => {
    const { client } = clientAnswering(PAGE);

    // @ts-expect-error — the listing is `?limit=&offset=`; there is no `pageSize`.
    await tenants.list({ pageSize: 10 }, client);

    expect(true).toBe(true);
  });

  it("rejects a path the contract does not publish", async () => {
    const { client } = clientAnswering(PAGE);

    // @ts-expect-error — nothing serves `/api/v1/workspaces`; only paths the document
    // describes are callable at all.
    await client.GET("/api/v1/workspaces");

    expect(true).toBe(true);
  });
});
