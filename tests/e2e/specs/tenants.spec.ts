/**
 * Leg 3 — *the API leg: a workspace roundtrip against a migrated database*.
 *
 * Scripted rather than driven through a browser, because it is a contract test against the
 * running container: the point of this leg is that the API a client is given actually works
 * against a migrated database rather than against a mocked repository.
 *
 * ## The contract moved, and this leg moved with it
 *
 * This file asserted a `/api/v1/tenants` CRUD surface until #647 first ran it against the
 * stack — where every request answered 404, because that surface no longer exists.
 * [#704](https://github.com/NobuData/ouroboros/issues/704) made BetterAuth's organization
 * plugin the one write path (`POST /api/auth/organization/create`, `set-active`, the
 * plugin's own update), and [#714](https://github.com/NobuData/ouroboros/issues/714) left
 * this service exactly one read: `GET /api/v1/orgs`, the caller's workspaces with the
 * enablement counts and roles the plugin cannot answer. The deep matrix lives in
 * `ouroboros-rest`'s own integration suite (`organizations.integration-spec.ts`); what only
 * this leg can see is the same roundtrip through the *composed images*: plugin write, then
 * service read, one database underneath.
 *
 * The rows it leaves behind are prefixed `e2e-` and are reclaimed by `docker compose
 * down -v`; `support/seed.ts` says why they are not reused between runs.
 */

import { expect, test } from "@playwright/test";

import { asUser, expectError, expectJson, getAnonymously, restUrl } from "../support/api";
import { SEED_OWNER, SEED_TENANT, ephemeralSlug } from "../support/seed";
import { AUTH_BASE_PATH, mintSession } from "../support/session";
import { REST_URL } from "../support/stack";

/** One row of `GET /api/v1/orgs` — `OrgRowResource`, as `openapi.json` defines it. */
interface OrgRow {
  id: string;
  slug: string;
  name: string;
  monogram: string;
  personal: boolean;
  roles: string[];
  enabled: boolean;
  repoCounts: { enabled: number; total: number };
  featuredRepo: string | null;
  githubOrgs: unknown[];
  createdAt: string;
}

/** One page of them. */
interface OrgPage {
  items: OrgRow[];
  total: number;
  limit: number;
  offset: number;
}

/** What the plugin answers a create with — the fields this leg reads back. */
interface CreatedOrganization {
  id: string;
  slug: string;
  name: string;
  members: { userId: string; role: string }[];
}

test.describe("workspace roundtrip: plugin write, service read", () => {
  test("create → the creator is its owner → the listing carries it", async ({ request }) => {
    const { token } = await mintSession(SEED_OWNER.id);
    const headers = asUser(token);
    const slug = ephemeralSlug("roundtrip");

    // ---- Create, through the one write path there is (#704) --------------------------
    const created = await expectJson<CreatedOrganization>(
      await request.post(`${REST_URL}${AUTH_BASE_PATH}/organization/create`, {
        headers,
        data: { name: "E2E Roundtrip", slug },
      }),
      200,
    );

    expect(created.slug).toBe(slug);
    // The membership is written in the same transaction as the workspace — the fact the
    // old CRUD leg proved through an admin-gated PATCH, read here directly.
    expect(created.members).toEqual([
      expect.objectContaining({ userId: SEED_OWNER.id, role: "owner" }),
    ]);

    // ---- Read it back through this service's one read (#714) -------------------------
    const page = await expectJson<OrgPage>(
      await request.get(restUrl("/api/v1/orgs?limit=100"), { headers }),
      200,
    );

    const row = page.items.find((item) => item.slug === slug);

    expect(row, `the listing should carry ${slug}`).toBeDefined();
    // The service's own derivations over the plugin's rows: the role read from `member`,
    // the monogram from the name, and the enablement shape a fresh workspace starts with.
    expect(row).toMatchObject({
      name: "E2E Roundtrip",
      monogram: "ER",
      personal: false,
      roles: ["owner"],
      enabled: false,
      repoCounts: { enabled: 0, total: 0 },
      featuredRepo: null,
    });

    // And the seeded workspace is beside it — one database under both routes.
    expect(page.items.map((item) => item.slug)).toContain(SEED_TENANT.slug);
  });

  test("a duplicate slug is refused", async ({ request }) => {
    const { token } = await mintSession(SEED_OWNER.id);

    const response = await request.post(`${REST_URL}${AUTH_BASE_PATH}/organization/create`, {
      headers: asUser(token),
      // The seed's own workspace: guaranteed to exist without this test creating anything.
      data: { name: "Not Acme", slug: SEED_TENANT.slug },
    });

    expect(response.status(), await response.text()).toBe(400);

    const body = (await response.json()) as { code?: string };

    // The plugin's own vocabulary, not this service's envelope — the route is BetterAuth's.
    expect(body.code).toBe("ORGANIZATION_ALREADY_EXISTS");
  });

  test("the listing is closed to strangers", async ({ request }) => {
    // The service's error envelope this time: `/api/v1/*` is behind the global guard
    // (#703), and an unauthenticated read of *anything* under it is refused by name.
    await expectError(await getAnonymously(request, "/api/v1/orgs"), 401, "unauthenticated");
  });
});
