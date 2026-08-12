import { AppConfigService } from "../config/config.service";
import { testConfiguration } from "../config/configuration.fixture";
import type { Configuration } from "../config/configuration";
import type { Tenant, User } from "../db/schema";
import { AuthRepository } from "./auth.repository";
import type { MembershipRow } from "./auth.resources";
import { AuthService, sessionTokenFrom } from "./auth.service";
import { issueSession, SESSION_COOKIE } from "./session";
import { epochSeconds, signToken } from "./signing";

/**
 * What the guard asks on every request, and what `GET /api/v1/auth/me` answers.
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
 * What is left here is the session half, which #703 takes.
 */

const SECRET = "dev-session-secret-change-me";
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

/**
 * A configuration service over a validated configuration.
 *
 * @param overrides - Environment variables to change before validating.
 * @returns The accessor, reading a real `Configuration` rather than a literal — so a spec
 *   cannot assert against a shape the schema would never produce.
 */
function configFor(overrides: NodeJS.ProcessEnv = {}): AppConfigService {
  const configuration = testConfiguration(overrides);

  return new AppConfigService({
    getOrThrow: (key: string) => configuration[key as keyof Configuration],
    get: (key: string) => configuration[key as keyof Configuration],
  } as never);
}

/** A repository whose every method is a mock. */
function repositoryDouble(): jest.Mocked<AuthRepository> {
  return {
    findUserByEmail: jest.fn().mockResolvedValue(undefined),
    findUserById: jest.fn().mockResolvedValue(undefined),
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
 * @param overrides - Environment variables to change.
 * @returns The service and the double behind it.
 */
function harness(overrides: NodeJS.ProcessEnv = {}): Harness {
  const repository = repositoryDouble();

  return { auth: new AuthService(configFor(overrides), repository, () => NOW), repository };
}

/**
 * A token of a different shape, signed with the session's own key.
 *
 * The handshake cookie until #702 deleted `oauth.ts`. It stays as a fixture because the
 * property it exercises is the guard's: a valid signature says this service wrote the
 * value, never what it wrote it for, and `readSession`'s shape check is the rest.
 */
function otherShapedToken(): string {
  return signToken({ state: "s", verifier: "v", iat: epochSeconds(NOW) }, SECRET);
}

describe("authenticating a request", () => {
  it("answers with the person a valid session names", async () => {
    const { auth, repository } = harness();
    repository.findUserById.mockResolvedValue(USER);

    const cookie = `${SESSION_COOKIE}=${issueSession(USER.id, SECRET, NOW)}`;

    expect(await auth.authenticate(cookie)).toEqual({ user: USER });
  });

  it("reads the person from the database rather than from the cookie", async () => {
    // Which is what makes a deleted account's outstanding session stop working: the
    // signature is still perfectly good and there is no row behind it.
    const { auth, repository } = harness();
    repository.findUserById.mockResolvedValue(undefined);

    const cookie = `${SESSION_COOKIE}=${issueSession(USER.id, SECRET, NOW)}`;

    expect(await auth.authenticate(cookie)).toBeUndefined();
    expect(repository.findUserById).toHaveBeenCalledWith(USER.id);
  });

  it.each([
    ["no cookie header", undefined],
    ["a header with no session cookie", "other=1"],
    [
      "a session signed with another key",
      `${SESSION_COOKIE}=${issueSession("x", "other-secret-value", NOW)}`,
    ],
    [
      "a session that has expired",
      `${SESSION_COOKIE}=${issueSession("x", SECRET, new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000))}`,
    ],
    ["a token of another shape in the session's place", `${SESSION_COOKIE}=${otherShapedToken()}`],
    ["a value that is not a token", `${SESSION_COOKIE}=nonsense`],
  ])("answers with nobody for %s", async (_description, cookie) => {
    const { auth, repository } = harness();
    repository.findUserById.mockResolvedValue(USER);

    expect(await auth.authenticate(cookie)).toBeUndefined();
  });
});

describe("the development bypass", () => {
  const BYPASS = { OURO_AUTH_DEV_USER: "ken@acme-robotics.dev" };

  it("signs a request in as the named person when it is configured", async () => {
    const { auth, repository } = harness(BYPASS);
    repository.findUserByEmail.mockResolvedValue(USER);

    expect(await auth.authenticate(undefined)).toEqual({ user: USER });
  });

  it("is off in production, whatever the environment said", async () => {
    // The issue's acceptance criterion. `loadConfiguration` drops the variable in
    // production and `AppConfigService.devUserEmail` refuses it again — two checks,
    // because one of them being wrong is authentication turned off for a deployment.
    const { auth, repository } = harness({ ...BYPASS, NODE_ENV: "production" });
    repository.findUserByEmail.mockResolvedValue(USER);

    expect(await auth.authenticate(undefined)).toBeUndefined();
    expect(repository.findUserByEmail).not.toHaveBeenCalled();
  });

  it("is off when the variable is unset, which is what the test fixture leaves it", async () => {
    const { auth, repository } = harness();
    repository.findUserByEmail.mockResolvedValue(USER);

    expect(await auth.authenticate(undefined)).toBeUndefined();
  });

  it("grants nothing when the address names no user", async () => {
    // A bypass that created accounts would be a bypass that writes to the database, and
    // the row it wrote would outlive the machine it was convenient on. There is no longer
    // a `createUser` here to assert was not called — #702 deleted it — so what is asserted
    // is the whole of the answer: nobody.
    const { auth, repository } = harness(BYPASS);
    repository.findUserByEmail.mockResolvedValue(undefined);

    expect(await auth.authenticate(undefined)).toBeUndefined();
  });

  it("loses to a real session, so a real sign-in is still exercisable with it set", async () => {
    const other: User = { ...USER, id: "c7b1e2f4-5a63-4d8e-b0c9-7f2a1d3e6b85" };
    const { auth, repository } = harness(BYPASS);
    repository.findUserById.mockResolvedValue(other);
    repository.findUserByEmail.mockResolvedValue(USER);

    const cookie = `${SESSION_COOKIE}=${issueSession(other.id, SECRET, NOW)}`;

    expect(await auth.authenticate(cookie)).toEqual({ user: other });
  });
});

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

describe("reading the session cookie out of a header", () => {
  it("finds it among others", () => {
    expect(sessionTokenFrom(`a=1; ${SESSION_COOKIE}=token; b=2`)).toBe("token");
  });

  it("answers with nothing when it is not there", () => {
    expect(sessionTokenFrom("a=1")).toBeUndefined();
    expect(sessionTokenFrom(undefined)).toBeUndefined();
  });

  it("keeps the dot that separates a token from its signature", () => {
    const token = issueSession(USER.id, SECRET, NOW);

    expect(sessionTokenFrom(`${SESSION_COOKIE}=${token}`)).toBe(token);
  });

  it("reads its own cookie and no other", () => {
    // Named rather than positional: a header carrying somebody else's `ouro_`-prefixed
    // cookie must not be mistaken for a session, whatever it holds.
    expect(sessionTokenFrom(`ouro_oauth=${otherShapedToken()}`)).toBeUndefined();
  });
});
