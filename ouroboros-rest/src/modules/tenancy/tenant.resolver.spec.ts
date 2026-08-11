import type { DomainError } from "../errors/error.envelope";
import type { Tenant, User } from "../db/schema";
import type { MembersRepository } from "./members.repository";
import type { MemberRow } from "./resources";
import { TENANCY_ERRORS } from "./tenancy.errors";
import {
  headerReference,
  pathReference,
  pathTenantIsMalformed,
  referenceFrom,
  SOLE_MEMBERSHIP_LIMIT,
  TENANT_HEADER,
  TenantResolver,
} from "./tenant.resolver";
import type { TenantsRepository } from "./tenants.repository";

/**
 * Which tenant a request is in, and whether the caller may be there.
 *
 * The two acceptance criteria this file carries are the `404` and where the tenant comes
 * from, and the first is the one worth being pedantic about: *a tenant that does not exist
 * and a tenant the caller is not a member of must be indistinguishable*. There are tests
 * below for each half of that separately and one that asserts the two answers are identical,
 * because a difference in the code, the message or the details would be the leak.
 */

const TENANT: Tenant = {
  id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  slug: "acme",
  display_name: "Acme, Inc.",
  status: "active",
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
};

const OTHER: Tenant = { ...TENANT, id: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94", slug: "globex" };

const USER: User = {
  id: "5eed0003-0000-4000-8000-000000000001",
  email: "ken@acme-robotics.dev",
  display_name: "Ken Suenobu",
  avatar_url: null,
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T10:20:23.114Z"),
};

const MEMBERSHIP: MemberRow = {
  tenant_id: TENANT.id,
  user_id: USER.id,
  email: USER.email,
  display_name: USER.display_name,
  avatar_url: null,
  role: "member",
  invited_at: new Date("2026-08-11T10:20:23.114Z"),
  joined_at: new Date("2026-08-11T10:20:23.114Z"),
};

/** Everything a test drives the resolver through. */
interface Harness {
  resolver: TenantResolver;
  tenants: jest.Mocked<TenantsRepository>;
  members: jest.Mocked<MembersRepository>;
}

/**
 * A resolver over repositories that answer with {@link TENANT} and a membership.
 *
 * @returns The resolver and the doubles behind it.
 */
function harness(): Harness {
  const tenants = {
    find: jest.fn().mockResolvedValue(undefined),
    findBySlug: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<TenantsRepository>;

  const members = {
    find: jest.fn().mockResolvedValue(MEMBERSHIP),
    tenantIdsFor: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<MembersRepository>;

  return { resolver: new TenantResolver(tenants, members), tenants, members };
}

/** A resolver whose lookups both answer with the given tenant. */
function harnessFinding(tenant: Tenant): Harness {
  const built = harness();
  built.tenants.find.mockImplementation((id: string) =>
    Promise.resolve(id === tenant.id ? tenant : undefined),
  );
  built.tenants.findBySlug.mockImplementation((slug: string) =>
    Promise.resolve(slug === tenant.slug ? tenant : undefined),
  );

  return built;
}

/**
 * The envelope a rejection carries.
 *
 * @param work - The call expected to fail.
 * @returns Its code, status and details.
 * @throws {Error} If the call succeeded.
 */
async function rejection(work: Promise<unknown>): Promise<{
  code: string;
  status: number;
  details: unknown;
  message: string;
}> {
  try {
    await work;
  } catch (error) {
    const failure = error as DomainError;
    return {
      code: failure.code,
      status: failure.getStatus(),
      details: failure.details,
      message: failure.message,
    };
  }

  throw new Error("the call was expected to fail and did not");
}

describe("reading a value as a reference", () => {
  it("recognises a uuid", () => {
    expect(referenceFrom(TENANT.id)).toEqual({ kind: "id", value: TENANT.id });
  });

  it("recognises a uuid in any casing, because a URL may carry either", () => {
    expect(referenceFrom(TENANT.id.toUpperCase())?.kind).toBe("id");
  });

  it("treats anything else as a slug", () => {
    expect(referenceFrom("acme")).toEqual({ kind: "slug", value: "acme" });
  });

  it("trims, because a header copied from somewhere has spaces on it", () => {
    expect(referenceFrom("  acme  ")).toEqual({ kind: "slug", value: "acme" });
  });

  it.each([
    ["empty", ""],
    ["only whitespace", "   "],
  ])("is nothing when it is %s", (_description, value) => {
    expect(referenceFrom(value)).toBeUndefined();
  });

  it("does not validate the slug's shape", () => {
    // A second, weaker copy of `tenants_slug_format` whose only effect would be to answer
    // 422 where the answer is already 404 — and a 422 would say the value was *well-formed
    // and unknown*, which is a distinction worth nothing to a caller and something to a
    // prober.
    expect(referenceFrom("Not A Slug")).toEqual({ kind: "slug", value: "Not A Slug" });
  });
});

describe("the header", () => {
  it("is read case-insensitively, because Node lower-cases header names", () => {
    expect(headerReference({ [TENANT_HEADER]: "acme" })).toEqual({ kind: "slug", value: "acme" });
    expect(TENANT_HEADER).toBe("x-ouro-tenant");
  });

  it("is nothing when absent", () => {
    expect(headerReference({})).toBeUndefined();
    expect(headerReference(undefined)).toBeUndefined();
  });

  it("is refused when it was sent twice", () => {
    // A repeated header parses to an array. Two different tenants in two headers is not a
    // request with an obvious meaning, so neither is picked.
    expect(headerReference({ [TENANT_HEADER]: ["acme", "globex"] })).toBeUndefined();
  });
});

describe("the path parameter", () => {
  it("is read as a uuid", () => {
    expect(pathReference({ tenantId: TENANT.id })).toEqual({ kind: "id", value: TENANT.id });
  });

  it("is never read as a slug", () => {
    // It is documented as a uuid and validated as one, so anything else is a malformed
    // request rather than a workspace nobody can see — and the validation pipe owns that
    // complaint, because it is what produces the `details.tenantId` a form renders.
    expect(pathReference({ tenantId: "acme" })).toBeUndefined();
    expect(pathTenantIsMalformed({ tenantId: "acme" })).toBe(true);
  });

  it("is nothing on a route that has none", () => {
    expect(pathReference({})).toBeUndefined();
    expect(pathTenantIsMalformed({})).toBe(false);
    expect(pathTenantIsMalformed(undefined)).toBe(false);
  });
});

describe("resolving", () => {
  it("prefers the path, which is the more specific of the two", async () => {
    const { resolver, tenants } = harnessFinding(TENANT);

    const membership = await resolver.resolve(USER, {}, { tenantId: TENANT.id });

    expect(membership.tenant).toEqual(TENANT);
    expect(tenants.find).toHaveBeenCalledWith(TENANT.id);
  });

  it("reads the header when the path names nothing", async () => {
    const { resolver } = harnessFinding(TENANT);

    const membership = await resolver.resolve(USER, { [TENANT_HEADER]: "acme" }, {});

    expect(membership.tenant).toEqual(TENANT);
  });

  it("accepts a uuid in the header as readily as a slug", async () => {
    const { resolver } = harnessFinding(TENANT);

    expect((await resolver.resolve(USER, { [TENANT_HEADER]: TENANT.id }, {})).tenant).toEqual(
      TENANT,
    );
  });

  it("falls back to a sole membership when neither names one", async () => {
    const { resolver, members } = harnessFinding(TENANT);
    members.tenantIdsFor.mockResolvedValue([TENANT.id]);

    expect((await resolver.resolve(USER, {}, {})).tenant).toEqual(TENANT);
    expect(members.tenantIdsFor).toHaveBeenCalledWith(USER.id, SOLE_MEMBERSHIP_LIMIT);
    expect(SOLE_MEMBERSHIP_LIMIT).toBe(2);
  });

  it("answers with the role the membership carries", async () => {
    const { resolver, members } = harnessFinding(TENANT);
    members.find.mockResolvedValue({ ...MEMBERSHIP, role: "admin" });

    expect((await resolver.resolve(USER, {}, { tenantId: TENANT.id })).role).toBe("admin");
  });

  it("accepts a path and a header that name the same tenant differently", async () => {
    // A switcher sending a slug on a path built from an id is the ordinary case, not a
    // mistake, so the two are compared by resolution rather than by string.
    const { resolver } = harnessFinding(TENANT);

    expect(
      (await resolver.resolve(USER, { [TENANT_HEADER]: "acme" }, { tenantId: TENANT.id })).tenant,
    ).toEqual(TENANT);
  });
});

describe("refusing", () => {
  it("answers 404 for a tenant that does not exist", async () => {
    const { resolver } = harness();

    expect(await rejection(resolver.resolve(USER, {}, { tenantId: TENANT.id }))).toMatchObject({
      code: TENANCY_ERRORS.tenantNotFound,
      status: 404,
    });
  });

  it("answers 404 for a tenant the caller is not a member of", async () => {
    // The issue's first acceptance criterion.
    const { resolver, members } = harnessFinding(TENANT);
    members.find.mockResolvedValue(undefined);

    expect(await rejection(resolver.resolve(USER, {}, { tenantId: TENANT.id }))).toMatchObject({
      code: TENANCY_ERRORS.tenantNotFound,
      status: 404,
    });
  });

  it("answers the two identically, which is the whole of no-existence-leaks", async () => {
    const absent = harness();
    const forbidden = harnessFinding(TENANT);
    forbidden.members.find.mockResolvedValue(undefined);

    const one = await rejection(absent.resolver.resolve(USER, {}, { tenantId: TENANT.id }));
    const two = await rejection(forbidden.resolver.resolve(USER, {}, { tenantId: TENANT.id }));

    // Same code, same status, same message, same details. A difference in any of them is
    // exactly what somebody enumerating identifiers is looking for.
    expect(one).toEqual(two);
  });

  it("never answers 403 for a tenant the caller cannot see", async () => {
    const { resolver, members } = harnessFinding(TENANT);
    members.find.mockResolvedValue(undefined);

    expect((await rejection(resolver.resolve(USER, {}, { tenantId: TENANT.id }))).status).not.toBe(
      403,
    );
  });

  it("answers 422 when the path and the header name different tenants", async () => {
    const { resolver, tenants } = harness();
    tenants.find.mockResolvedValue(TENANT);
    tenants.findBySlug.mockResolvedValue(OTHER);

    expect(
      await rejection(
        resolver.resolve(USER, { [TENANT_HEADER]: "globex" }, { tenantId: TENANT.id }),
      ),
    ).toMatchObject({
      code: TENANCY_ERRORS.tenantMismatch,
      status: 422,
      details: { path: TENANT.id, header: "globex" },
    });
  });

  it("refuses a mismatch before looking a membership up", async () => {
    const { resolver, tenants, members } = harness();
    tenants.find.mockResolvedValue(TENANT);
    tenants.findBySlug.mockResolvedValue(OTHER);

    await rejection(resolver.resolve(USER, { [TENANT_HEADER]: "globex" }, { tenantId: TENANT.id }));

    expect(members.find).not.toHaveBeenCalled();
  });

  it("answers 422 when nothing names a tenant and the caller belongs to none", async () => {
    const { resolver } = harness();

    expect(await rejection(resolver.resolve(USER, {}, {}))).toMatchObject({
      code: TENANCY_ERRORS.tenantRequired,
      status: 422,
    });
  });

  it("answers 422 when nothing names a tenant and the caller belongs to several", async () => {
    const { resolver, members } = harness();
    members.tenantIdsFor.mockResolvedValue([TENANT.id, OTHER.id]);

    expect(await rejection(resolver.resolve(USER, {}, {}))).toMatchObject({
      code: TENANCY_ERRORS.tenantRequired,
      status: 422,
    });
  });

  it("says nothing about what exists when it asks for a tenant to be named", async () => {
    const { resolver } = harness();

    const failure = await rejection(resolver.resolve(USER, {}, {}));

    expect(failure.details).toEqual({});
    expect(failure.message).toContain("X-Ouro-Tenant");
  });
});
