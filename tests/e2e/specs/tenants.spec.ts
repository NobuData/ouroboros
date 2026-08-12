/**
 * Leg 3 — *the API leg: tenant CRUD roundtrip*.
 *
 * Scripted rather than driven through a browser, because it is a contract test against the
 * running container: the UI has no screen for creating a workspace, and the point of this
 * leg is that the API a client is given actually works against a migrated database rather
 * than against a mocked repository.
 *
 * It is a *roundtrip* rather than a lifecycle: `ouroboros-rest` publishes no tenant delete
 * route (`ouroboros-rest/openapi.json` — `POST`, `GET`, `PATCH` and nothing else), because
 * a workspace is retired by moving its `status` rather than by being removed. So the leg
 * creates, reads it back, updates it, reads the update, finds it in the caller's listing,
 * and finally suspends it — which is as close to a teardown as the contract offers. The
 * rows it leaves behind are prefixed `e2e-` and are reclaimed by `docker compose down -v`;
 * `support/seed.ts` says why they are not reused between runs.
 *
 * Every request carries the same session the browser legs carry, and that matters twice:
 * the creator is made `owner` in the same transaction, so the `PATCH` — which requires an
 * administrator — proves the membership was written as well as the tenant.
 */

import { expect, test } from "@playwright/test";

import { asUser, expectError, expectJson, getAnonymously, restUrl } from "../support/api";
import { SEED_OWNER, SEED_TENANT, ephemeralSlug } from "../support/seed";
import { mintSession, SESSION_PARKED } from "../support/session";

/** The `Tenant` resource, as `openapi.json` defines it. */
interface Tenant {
  id: string;
  slug: string;
  displayName: string;
  status: "active" | "suspended" | "deleted";
  createdAt: string;
  updatedAt: string;
}

/** One page of them. */
interface TenantPage {
  items: Tenant[];
  total: number;
  limit: number;
  offset: number;
}

test.describe("tenant CRUD roundtrip", () => {
  // Every leg below but the last carries a session, and those are parked — see
  // `support/session.ts`. "The collection is closed to strangers" needs none and still
  // runs, which is the half of this group that guards the boundary.
  test("create → read → update → list → suspend", async ({ request }) => {
    test.fixme(true, SESSION_PARKED);

    const { token } = mintSession(SEED_OWNER.id);
    const headers = asUser(token);
    const slug = ephemeralSlug("crud");

    // ---- Create ----------------------------------------------------------------------
    const created = await expectJson<Tenant>(
      await request.post(restUrl("/api/v1/tenants"), {
        headers,
        data: { slug, displayName: "E2E Roundtrip" },
      }),
      201,
    );

    expect(created.slug).toBe(slug);
    expect(created.displayName).toBe("E2E Roundtrip");
    expect(created.status, "a new workspace starts active").toBe("active");
    // A uuid the *database* generated, not one this suite sent — the contract has no
    // field for a caller-chosen id, and a service that accepted one would be letting a
    // client pick primary keys.
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

    // ---- Read ------------------------------------------------------------------------
    //
    // Read back rather than trusting the create response. They are two code paths — one
    // returns what it wrote, the other selects what is stored — and a transaction that
    // rolled back after answering would only be visible here.
    const read = await expectJson<Tenant>(
      await request.get(restUrl(`/api/v1/tenants/${created.id}`), { headers }),
      200,
    );

    expect(read).toEqual(created);

    // ---- Update ----------------------------------------------------------------------
    //
    // `PATCH` is `@Roles(...ADMINISTRATORS)`. It succeeding is the assertion that the
    // creator's `owner` membership was written in the same transaction as the tenant —
    // if it had not been, the `404` rule would have put this workspace out of reach of
    // the person who had just made it.
    const renamed = await expectJson<Tenant>(
      await request.patch(restUrl(`/api/v1/tenants/${created.id}`), {
        headers,
        data: { displayName: "E2E Roundtrip, renamed" },
      }),
      200,
    );

    expect(renamed.displayName).toBe("E2E Roundtrip, renamed");
    expect(renamed.slug, "a rename must not move the handle").toBe(slug);
    expect(Date.parse(renamed.updatedAt), "an update must move updatedAt").toBeGreaterThanOrEqual(
      Date.parse(created.updatedAt),
    );

    // ---- List ------------------------------------------------------------------------
    //
    // Scoped to the caller (#32), so this is also the assertion that the listing is not
    // enumerating the installation: the seeded workspace and the new one are both here
    // because this person belongs to both.
    const page = await expectJson<TenantPage>(
      await request.get(restUrl("/api/v1/tenants?limit=100"), { headers }),
      200,
    );

    const slugs = page.items.map((tenant) => tenant.slug);

    expect(slugs).toContain(slug);
    expect(slugs, "the seed's workspace is one of the caller's").toContain(SEED_TENANT.slug);
    expect(page.total).toBeGreaterThanOrEqual(2);

    // ---- Suspend ---------------------------------------------------------------------
    //
    // The contract's retirement, and the nearest thing to a teardown it offers.
    const suspended = await expectJson<Tenant>(
      await request.patch(restUrl(`/api/v1/tenants/${created.id}`), {
        headers,
        data: { status: "suspended" },
      }),
      200,
    );

    expect(suspended.status).toBe("suspended");
  });

  test("a duplicate slug is refused", async ({ request }) => {
    test.fixme(true, SESSION_PARKED);

    const { token } = mintSession(SEED_OWNER.id);
    const headers = asUser(token);

    // The seed's own slug: the uniqueness constraint is enforced across the installation,
    // and asserting it against a row this suite did not create is what proves the check is
    // the database's rather than a cache of what this run has written.
    const response = await request.post(restUrl("/api/v1/tenants"), {
      headers,
      data: { slug: SEED_TENANT.slug, displayName: "Not Acme" },
    });

    await expectError(response, 409, "slug_taken");
  });

  test("a malformed slug is refused before anything is written", async ({ request }) => {
    test.fixme(true, SESSION_PARKED);

    const { token } = mintSession(SEED_OWNER.id);

    const response = await request.post(restUrl("/api/v1/tenants"), {
      headers: asUser(token),
      data: { slug: "Not A Slug", displayName: "Rejected" },
    });

    await expectError(response, 422, "validation_failed");
  });

  test("an unknown property is refused rather than ignored", async ({ request }) => {
    test.fixme(true, SESSION_PARKED);

    const { token } = mintSession(SEED_OWNER.id);

    // Request schemas are closed (`CreateTenantRequest.additionalProperties: false`),
    // which is what shuts mass assignment for every route at once. It is asserted here
    // because it is a property of the *running validation pipe*, and a pipe configured
    // without `forbidNonWhitelisted` would drop this field silently.
    const response = await request.post(restUrl("/api/v1/tenants"), {
      headers: asUser(token),
      data: { slug: ephemeralSlug("closed"), displayName: "Closed", status: "active" },
    });

    await expectError(response, 422, "validation_failed");
  });

  test("the collection is closed to strangers", async ({ request }) => {
    const response = await getAnonymously(request, "/api/v1/tenants");

    await expectError(response, 401, "unauthenticated");
  });
});
