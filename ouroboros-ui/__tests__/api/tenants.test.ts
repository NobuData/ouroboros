import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
// Types only, so this import is erased and nothing loads before the mocks below.
import type { OrgRow, OrgRowPage } from "@/app/api/tenants";

import { clientAnswering } from "../helpers/api";

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
 *
 * The resource moved from `/api/v1/tenants` to `/api/v1/orgs` in
 * [#714](https://github.com/NobuData/ouroboros/issues/714), and its rows gained everything
 * mockup 01 Step 2 draws — so the fixture below is one of those rows rather than a workspace
 * with a lifecycle. `read` went with the move: one workspace on its own is
 * `GET /api/auth/organization/get-full-organization`, which is the plugin's.
 */

/** One workspace row, as the contract describes it — the mockup's first. */
const ACME: OrgRow = {
  id: "5eed0001-0000-4000-8000-000000000001",
  slug: "acme-robotics",
  name: "Acme Robotics",
  monogram: "AR",
  personal: false,
  roles: ["owner"],
  enabled: true,
  repoCounts: { enabled: 4, total: 4 },
  featuredRepo: "helios-firmware",
  githubOrgs: [{ login: "acme-robotics", enabled: true, repoCounts: { enabled: 4, total: 4 } }],
  createdAt: "2026-08-11T10:20:23.114Z",
};

/** A page carrying it. */
const PAGE = { items: [ACME], total: 1, limit: 25, offset: 0 };

describe("tenants.list", () => {
  it("calls the listing operation and returns the page itself", async () => {
    const { client, requests } = clientAnswering(PAGE);

    const page = await tenants.list({}, client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/orgs");
    expect(page).toEqual(PAGE);
  });

  it("passes the window through as the contract's query parameters", async () => {
    const { client, requests } = clientAnswering(PAGE);

    await tenants.list({ limit: 10, offset: 20 }, client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/orgs?limit=10&offset=20");
  });

  it("sends no window at all when none is given, leaving the service's defaults", async () => {
    const { client, requests } = clientAnswering(PAGE);

    await tenants.list({}, client);

    expect(new URL(requests[0]?.url ?? "").search).toBe("");
  });

  it("names no workspace, because its answer is which workspaces there are", async () => {
    // The one operation in the contract with no `{orgId}` in its path. A client that had to
    // name a workspace to be told which workspaces it has would be asking a circular
    // question, and it is exactly the state `400 organization_required` tells somebody to
    // leave.
    const { client, requests } = clientAnswering(PAGE);

    await tenants.list({}, client);

    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/api/v1/orgs");
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

describe("the typing, which is the reason the client is generated", () => {
  it("types a page's fields end to end", async () => {
    const { client } = clientAnswering(PAGE);

    const page: OrgRowPage = await tenants.list({}, client);
    const first: OrgRow | undefined = page.items[0];

    // Every one of these is a compile-time assertion as much as a runtime one: the
    // fields come from the generated schema, so a rename in openapi.yaml breaks this
    // file after `yarn api:sync`.
    expect(first?.slug).toBe("acme-robotics");
    expect(first?.name).toBe("Acme Robotics");
    expect(first?.monogram).toBe("AR");
    expect(first?.personal).toBe(false);
    expect(first?.roles).toEqual(["owner"]);
    expect(page.limit + page.offset).toBe(25);
  });

  it("types the counts the mockup's line is drawn from", () => {
    // `4 repos enabled · incl. helios-firmware`, as data. The service derives both so that a
    // screen does not have to, which is what makes them assertable here at all.
    expect(ACME.repoCounts.enabled).toBe(4);
    expect(ACME.featuredRepo).toBe("helios-firmware");
    expect(ACME.githubOrgs[0]?.login).toBe("acme-robotics");
  });

  it("rejects a field the contract does not describe", () => {
    const row = ACME as unknown as OrgRow;

    // @ts-expect-error — a workspace row has `name`, never `displayName`. If this line ever
    // compiles, the generated types no longer describe the committed contract.
    expect(row.displayName).toBeUndefined();
  });

  it("rejects a role the contract does not list", () => {
    // @ts-expect-error — `roles` holds "owner" | "admin" | "member" | "viewer".
    const roles: OrgRow["roles"] = ["superuser"];

    expect(roles).toEqual(["superuser"]);
  });

  it("rejects a query parameter the operation does not accept", async () => {
    const { client } = clientAnswering(PAGE);

    // @ts-expect-error — the listing is `?limit=&offset=`; there is no `pageSize`.
    await tenants.list({ pageSize: 10 }, client);

    expect(true).toBe(true);
  });

  it("rejects a path the contract no longer publishes", async () => {
    const { client } = clientAnswering(PAGE);

    // @ts-expect-error — `/api/v1/tenants` was deleted by #714. Only paths the document
    // describes are callable at all, which is what makes the deletion reach this module.
    await client.GET("/api/v1/tenants");

    expect(true).toBe(true);
  });
});
