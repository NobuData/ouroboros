import type { Tenant, User } from "../db/schema";
import { AuthRepository } from "./auth.repository";
import type { MembershipRow } from "./auth.resources";
import { AuthService } from "./auth.service";

/**
 * What `GET /api/v1/auth/me` answers.
 *
 * **Signing in used to be the larger half of this file.**
 * [#702](https://github.com/NobuData/ouroboros/issues/702) moved the flow to BetterAuth, so
 * the suites that covered the handshake, the code exchange and `resolveUser`'s three
 * branches went with the code they covered — deleted rather than skipped, which is the
 * issue's own acceptance criterion. What replaced each of them:
 *
 *   * the state check that made the callback CSRF-safe is the library's, exercised against
 *     a real instance in `auth.integration-spec.ts` rather than against a signed cookie
 *     this service composed;
 *   * the identity upsert that made a repeat sign-in reuse a row is `account(providerId,
 *     accountId)` and #706's back-fill into it, asserted in
 *     `ouroboros-db/tests/constraints.sql`;
 *   * the invited-stub branch is the account-linking policy, whose values are asserted in
 *     `src/auth/github.provider.spec.ts`.
 *
 * **And the session half went the same way.**
 * [#703](https://github.com/NobuData/ouroboros/issues/703) replaced the stateless cookie
 * with the library's database-backed session and its guard, so `authenticate` and the
 * `OURO_AUTH_DEV_USER` bypass are gone and so are their suites. What each of them covered
 * is still covered, somewhere it can be checked against the mechanism that replaced it:
 *
 *   * *a valid session names a person* is `guard.surface.spec.ts` and
 *     `auth.integration-spec.ts`, over a real `session` row;
 *   * *a session this service will not honour authenticates nobody* is the same two, with
 *     the row deleted or expired instead of the signature wrong;
 *   * *the bypass is off in production* is `configuration.spec.ts`, which is where the
 *     variable is dropped — the check that outlived the reader.
 *
 * What is left is one question, and it is not about authentication at all: given a person,
 * where do they belong.
 */

const NOW = new Date("2026-08-11T10:20:23.114Z");

const USER = {
  id: "5eed0003-0000-4000-8000-000000000001",
  email: "ken@acme-robotics.dev",
  display_name: "Ken Suenobu",
  avatar_url: null,
  created_at: NOW,
  updated_at: NOW,
} satisfies User;

const TENANT = {
  id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  slug: "acme",
  display_name: "Acme, Inc.",
  status: "active",
  created_at: NOW,
  updated_at: NOW,
} satisfies Tenant;

const MEMBERSHIP = {
  tenant_id: TENANT.id,
  slug: "acme",
  display_name: "Acme, Inc.",
  status: "active",
  role: "owner",
  invited_at: NOW,
  joined_at: NOW,
} satisfies MembershipRow;

/** A repository whose every method is a mock. */
function repositoryDouble(): jest.Mocked<AuthRepository> {
  return {
    listMemberships: jest.fn().mockResolvedValue([]),
    findTenantByDomain: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuthRepository>;
}

/** Everything a test drives the service through. */
interface Harness {
  auth: AuthService;
  repository: jest.Mocked<AuthRepository>;
}

/**
 * Build the service over a repository double.
 *
 * @returns The service and the double behind it.
 */
function harness(): Harness {
  const repository = repositoryDouble();

  return { auth: new AuthService(repository), repository };
}

describe("describing a session", () => {
  it("carries the person and their memberships", async () => {
    const { auth, repository } = harness();
    repository.listMemberships.mockResolvedValue([MEMBERSHIP]);

    const described = await auth.describe(USER);

    expect(described.user.id).toBe(USER.id);
    expect(described.memberships).toHaveLength(1);
    expect(described.memberships[0].role).toBe("owner");
  });

  it("suggests the tenant an address's domain resolves to, for somebody who belongs nowhere", async () => {
    const { auth, repository } = harness();
    repository.findTenantByDomain.mockResolvedValue(TENANT);

    const described = await auth.describe(USER);

    expect(repository.findTenantByDomain).toHaveBeenCalledWith("acme-robotics.dev");
    expect(described.tenantSuggestion).toEqual({
      tenantId: TENANT.id,
      slug: "acme",
      displayName: "Acme, Inc.",
    });
  });

  it("suggests nothing to somebody who is already a member", async () => {
    const { auth, repository } = harness();
    repository.listMemberships.mockResolvedValue([MEMBERSHIP]);
    repository.findTenantByDomain.mockResolvedValue(TENANT);

    expect((await auth.describe(USER)).tenantSuggestion).toBeNull();
    expect(repository.findTenantByDomain).not.toHaveBeenCalled();
  });

  it("suggests nothing when no tenant claims the domain", async () => {
    const { auth } = harness();

    expect((await auth.describe(USER)).tenantSuggestion).toBeNull();
  });

  it("does not query for a domain an address cannot have", async () => {
    // `tenant_domains.domain` is non-blank, so the query could not match — and asking
    // anyway would be a round trip that cannot succeed.
    const { auth, repository } = harness();

    await auth.describe({ ...USER, email: "not-an-address" });

    expect(repository.findTenantByDomain).not.toHaveBeenCalled();
  });
});
