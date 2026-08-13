import type { Organization } from "../db/schema";
import type { DomainError } from "../errors/error.envelope";
import { FIXTURE_ORGANIZATION, FIXTURE_OTHER_ORGANIZATION } from "./organization.fixture";
import type { OrganizationRepository } from "./organization.repository";
import { TENANCY_ERRORS } from "./tenancy.errors";
import {
  headerReference,
  pathReference,
  pathTenantIsMalformed,
  referenceFrom,
  TENANT_HEADER,
  TenantResolver,
  type TenantRequestFacts,
} from "./tenant.resolver";

/**
 * Which workspace a request is in, and whether the caller may be there.
 *
 * Three acceptance criteria meet in this file, and each of them is a *change* to what the
 * shipped resolver did — so each is checked as behaviour rather than as a rename:
 *
 *   * a request with an active organization resolves with its role, and **without a header**;
 *   * a header override naming a workspace the caller is not in answers `404`;
 *   * no active organization and no header answers `400` with a code the UI can act on.
 *
 * The `404` is the one worth being pedantic about, and it predates this issue: *a workspace
 * that does not exist and a workspace the caller is not a member of must be
 * indistinguishable*. There are tests below for each half of that separately and one that
 * asserts the two answers are identical, because a difference in the code, the message or the
 * details would be the leak.
 */

const ORGANIZATION = FIXTURE_ORGANIZATION;
const OTHER = FIXTURE_OTHER_ORGANIZATION;

/** The person every request below is from — `"user".id`, as a session carries it. */
const USER_ID = "5eed0003-0000-4000-8000-000000000001";

/** Everything a test drives the resolver through. */
interface Harness {
  resolver: TenantResolver;
  organizations: jest.Mocked<OrganizationRepository>;
}

/**
 * A resolver over a repository that finds nothing and, where it does, answers `member`.
 *
 * @returns The resolver and the double behind it.
 */
function harness(): Harness {
  const organizations = {
    find: jest.fn().mockResolvedValue(undefined),
    rolesFor: jest.fn().mockResolvedValue(["member"]),
  } as unknown as jest.Mocked<OrganizationRepository>;

  return { resolver: new TenantResolver(organizations), organizations };
}

/**
 * A resolver whose lookups answer with the given workspace, by id and by slug.
 *
 * @param organization - The row to find.
 * @returns The harness.
 */
function harnessFinding(organization: Organization): Harness {
  const built = harness();

  built.organizations.find.mockImplementation((reference: { kind: string; value: string }) => {
    const matches =
      reference.kind === "id"
        ? reference.value === organization.id
        : reference.value === organization.slug;

    return Promise.resolve(matches ? organization : undefined);
  });

  return built;
}

/**
 * The facts of a request, with the session acting in {@link ORGANIZATION} unless a test says
 * otherwise.
 *
 * @param overrides - What this request does differently.
 * @returns The facts to resolve.
 */
function request(overrides: Partial<TenantRequestFacts> = {}): TenantRequestFacts {
  return {
    userId: USER_ID,
    activeOrganizationId: ORGANIZATION.id,
    headers: {},
    params: {},
    ...overrides,
  };
}

/**
 * The envelope a rejection carries.
 *
 * @param work - The call expected to fail.
 * @returns Its code, status, details and message.
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
    expect(referenceFrom(ORGANIZATION.id)).toEqual({ kind: "id", value: ORGANIZATION.id });
  });

  it("recognises a uuid in any casing, because a URL may carry either", () => {
    expect(referenceFrom(ORGANIZATION.id.toUpperCase())?.kind).toBe("id");
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
    // The plugin validates what it writes, so a second and weaker copy of that rule here
    // would only answer 422 where the answer is already 404 — and a 422 would say the value
    // was *well-formed and unknown*, which is worth nothing to a caller and something to a
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
    // A repeated header parses to an array. Two different workspaces in two headers is not a
    // request with an obvious meaning, so neither is picked.
    expect(headerReference({ [TENANT_HEADER]: ["acme", "globex"] })).toBeUndefined();
  });
});

describe("the path parameter", () => {
  it("is read as a uuid", () => {
    expect(pathReference({ orgId: ORGANIZATION.id })).toEqual({
      kind: "id",
      value: ORGANIZATION.id,
    });
  });

  it("is never read as a slug", () => {
    // It is documented as a uuid and validated as one, so anything else is a malformed
    // request rather than a workspace nobody can see — and the validation pipe owns that
    // complaint, because it is what produces the `details.orgId` a form renders.
    expect(pathReference({ orgId: "acme" })).toBeUndefined();
    expect(pathTenantIsMalformed({ orgId: "acme" })).toBe(true);
  });

  it("is nothing on a route that has none", () => {
    expect(pathReference({})).toBeUndefined();
    expect(pathTenantIsMalformed({})).toBe(false);
    expect(pathTenantIsMalformed(undefined)).toBe(false);
  });
});

describe("resolving from the session", () => {
  it("resolves the active organization with the caller's role", async () => {
    // The issue's first acceptance criterion: an active organization resolves context *with
    // role*, and the request said nothing at all.
    const { resolver, organizations } = harnessFinding(ORGANIZATION);
    organizations.rolesFor.mockResolvedValue(["admin"]);

    const membership = await resolver.resolve(request());

    expect(membership).toEqual({ tenant: ORGANIZATION, roles: ["admin"] });
    expect(organizations.find).toHaveBeenCalledWith({ kind: "id", value: ORGANIZATION.id });
    expect(organizations.rolesFor).toHaveBeenCalledWith(ORGANIZATION.id, USER_ID);
  });

  it("carries every role a membership holds, because the column may hold several", async () => {
    const { resolver, organizations } = harnessFinding(ORGANIZATION);
    organizations.rolesFor.mockResolvedValue(["admin", "member"]);

    expect((await resolver.resolve(request())).roles).toEqual(["admin", "member"]);
  });

  it("resolves a membership that holds no role this service recognises", async () => {
    // A member is a member. What they may *do* is the role guard's question, and the answer
    // for somebody holding nothing recognisable is "nothing" — not "you are not here".
    const { resolver, organizations } = harnessFinding(ORGANIZATION);
    organizations.rolesFor.mockResolvedValue([]);

    expect((await resolver.resolve(request())).roles).toEqual([]);
  });
});

describe("resolving from what the request named", () => {
  it("prefers the path, which is the most specific of the three", async () => {
    const { resolver, organizations } = harnessFinding(OTHER);

    const membership = await resolver.resolve(
      request({ activeOrganizationId: ORGANIZATION.id, params: { orgId: OTHER.id } }),
    );

    expect(membership.tenant).toEqual(OTHER);
    expect(organizations.find).toHaveBeenCalledWith({ kind: "id", value: OTHER.id });
    expect(organizations.find).not.toHaveBeenCalledWith({ kind: "id", value: ORGANIZATION.id });
  });

  it("takes the header over the session, which is what an override is", async () => {
    // The header is demoted from #32's primary source to an explicit per-request override —
    // and an override that lost to the session would not be one.
    const { resolver } = harnessFinding(OTHER);

    const membership = await resolver.resolve(
      request({ activeOrganizationId: ORGANIZATION.id, headers: { [TENANT_HEADER]: "globex" } }),
    );

    expect(membership.tenant).toEqual(OTHER);
  });

  it("accepts a uuid in the header as readily as a slug", async () => {
    const { resolver } = harnessFinding(OTHER);

    expect(
      (await resolver.resolve(request({ headers: { [TENANT_HEADER]: OTHER.id } }))).tenant,
    ).toEqual(OTHER);
  });

  it("reads the header on a session that is acting nowhere", async () => {
    const { resolver } = harnessFinding(ORGANIZATION);

    expect(
      (
        await resolver.resolve(
          request({ activeOrganizationId: null, headers: { [TENANT_HEADER]: "acme" } }),
        )
      ).tenant,
    ).toEqual(ORGANIZATION);
  });

  it("accepts a path and a header that name the same workspace differently", async () => {
    // A switcher sending a slug on a path built from an id is the ordinary case, not a
    // mistake, so the two are compared by resolution rather than by string.
    const { resolver } = harnessFinding(ORGANIZATION);

    expect(
      (
        await resolver.resolve(
          request({
            headers: { [TENANT_HEADER]: "acme" },
            params: { orgId: ORGANIZATION.id },
          }),
        )
      ).tenant,
    ).toEqual(ORGANIZATION);
  });
});

describe("refusing what the request named", () => {
  it("answers 404 for a workspace that does not exist", async () => {
    const { resolver } = harness();

    expect(
      await rejection(resolver.resolve(request({ params: { orgId: ORGANIZATION.id } }))),
    ).toMatchObject({ code: TENANCY_ERRORS.tenantNotFound, status: 404 });
  });

  it("answers 404 for a workspace the caller is not a member of", async () => {
    // The acceptance criterion: *header override without membership → 404*.
    const { resolver, organizations } = harnessFinding(ORGANIZATION);
    organizations.rolesFor.mockResolvedValue(undefined);

    expect(
      await rejection(
        resolver.resolve(
          request({ activeOrganizationId: null, headers: { [TENANT_HEADER]: "acme" } }),
        ),
      ),
    ).toMatchObject({ code: TENANCY_ERRORS.tenantNotFound, status: 404 });
  });

  it("answers the two identically, which is the whole of no-existence-leaks", async () => {
    const absent = harness();
    const forbidden = harnessFinding(ORGANIZATION);
    forbidden.organizations.rolesFor.mockResolvedValue(undefined);

    const named = request({ params: { orgId: ORGANIZATION.id } });
    const one = await rejection(absent.resolver.resolve(named));
    const two = await rejection(forbidden.resolver.resolve(named));

    // Same code, same status, same message, same details. A difference in any of them is
    // exactly what somebody enumerating identifiers is looking for.
    expect(one).toEqual(two);
  });

  it("never answers 403 for a workspace the caller cannot see", async () => {
    const { resolver, organizations } = harnessFinding(ORGANIZATION);
    organizations.rolesFor.mockResolvedValue(undefined);

    expect(
      (await rejection(resolver.resolve(request({ params: { orgId: ORGANIZATION.id } })))).status,
    ).not.toBe(403);
  });

  it("answers 422 when the path and the header name different workspaces", async () => {
    const { resolver, organizations } = harness();
    organizations.find.mockImplementation((reference: { kind: string; value: string }) =>
      Promise.resolve(reference.kind === "id" ? ORGANIZATION : OTHER),
    );

    expect(
      await rejection(
        resolver.resolve(
          request({
            headers: { [TENANT_HEADER]: "globex" },
            params: { orgId: ORGANIZATION.id },
          }),
        ),
      ),
    ).toMatchObject({
      code: TENANCY_ERRORS.tenantMismatch,
      status: 422,
      details: { path: ORGANIZATION.id, header: "globex" },
    });
  });

  it("refuses a mismatch before looking a membership up", async () => {
    const { resolver, organizations } = harness();
    organizations.find.mockImplementation((reference: { kind: string; value: string }) =>
      Promise.resolve(reference.kind === "id" ? ORGANIZATION : OTHER),
    );

    await rejection(
      resolver.resolve(
        request({
          headers: { [TENANT_HEADER]: "globex" },
          params: { orgId: ORGANIZATION.id },
        }),
      ),
    );

    expect(organizations.rolesFor).not.toHaveBeenCalled();
  });
});

describe("refusing a session that is acting nowhere", () => {
  /** The three states that reach `organization_required`, and the one answer they share. */
  const NOWHERE: readonly [string, () => Harness, Partial<TenantRequestFacts>][] = [
    ["the session carries no active organization", harness, { activeOrganizationId: null }],
    ["the session's field is absent altogether", harness, { activeOrganizationId: undefined }],
    [
      "the active organization has been deleted",
      harness,
      { activeOrganizationId: ORGANIZATION.id },
    ],
    [
      "the caller has been removed from the active organization",
      () => {
        const built = harnessFinding(ORGANIZATION);
        built.organizations.rolesFor.mockResolvedValue(undefined);
        return built;
      },
      { activeOrganizationId: ORGANIZATION.id },
    ],
  ];

  it.each(NOWHERE)("answers 400 when %s", async (_description, build, overrides) => {
    // The issue's acceptance criterion: *no active org and no header → 400 carrying a "select
    // organization" code the UI can act on*. The same answer for every way of getting there,
    // because the remedy is the same: choose a workspace.
    expect(await rejection(build().resolver.resolve(request(overrides)))).toMatchObject({
      code: TENANCY_ERRORS.organizationRequired,
      status: 400,
    });
  });

  it("says nothing about what exists when it asks for a workspace to be chosen", async () => {
    const { resolver } = harness();

    const failure = await rejection(resolver.resolve(request({ activeOrganizationId: null })));

    expect(failure.details).toEqual({});
    expect(failure.message).toMatch(/choose a workspace/i);
  });

  it("does not answer 404, which would leave a stale pointer unrecoverable", async () => {
    // Nobody is enumerating anything here: the caller named nothing, and the identifier being
    // refused is one this service wrote onto their own session. A 404 would tell somebody
    // whose workspace was deleted that every request fails, and nothing about what to do.
    const { resolver } = harness();

    expect((await rejection(resolver.resolve(request()))).status).toBe(400);
  });
});
