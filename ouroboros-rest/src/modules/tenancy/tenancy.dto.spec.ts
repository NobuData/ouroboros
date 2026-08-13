import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { TENANT_PARAMETER } from "./tenant.resolver";
import {
  BRANCH_PATTERN,
  CreateDomainBody,
  CreateGithubOrgBody,
  DomainParams,
  GithubOrgParams,
  OrgParams,
  RepoParams,
  UpdateDomainBody,
  UpdateGithubOrgBody,
  UpdateRepoBody,
} from "./tenancy.dto";

/**
 * The shapes a request may take, checked against the shapes the *database* will accept.
 *
 * These DTOs restate the `check` constraints V001 and V003 declare, and the pairing only earns
 * its keep if the two agree. A DTO that admitted something a constraint refuses would turn a
 * caller's `422` into a `500`; one that is merely stricter is fine, and is why
 * `constraints.ts` still maps a check violation rather than assuming it cannot happen.
 *
 * So the cases below are the constraints' own edges: the domain with one label, the login of
 * forty characters, the branch name that is path traversal.
 */

/** A uuid, for the parameter classes. */
const UUID = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

/**
 * An organization id of the shape BetterAuth's `generateId` mints — 32 mixed-case alphanumerics.
 *
 * The other half of what `organization."id"` holds, and the half that was refused until
 * [#715](https://github.com/NobuData/ouroboros/issues/715). Copied from a real one rather than
 * invented, and that the plugin still mints this shape is asserted where only a real library
 * can answer — `organizations.integration-spec.ts`.
 */
const PLUGIN_ID = "OIQ354GBlvNySIlDShHcoNjqiJ21A5PG";

/**
 * Which fields a body was refused for.
 *
 * @param Dto - The class to validate against.
 * @param body - What the client sent.
 * @returns The field names that failed, sorted. Empty when the body is acceptable.
 */
async function refused<T extends object>(
  Dto: new () => T,
  body: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(Dto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  return errors.map((error) => error.property).sort();
}

describe("the path parameters", () => {
  it("names the workspace the same way the resolver reads it", () => {
    // Two files have to agree on one string: `OrgParams` validates the value and
    // `tenant.resolver.ts` reads it off the request to resolve the workspace. If they drifted,
    // every route below `/orgs/{orgId}` would validate an id nothing then resolved — and the
    // symptom would be `400 organization_required` on a request that named a workspace
    // perfectly well.
    expect(TENANT_PARAMETER).toBe("orgId");
  });

  it("accepts a uuid where a uuid belongs", async () => {
    expect(await refused(OrgParams, { orgId: UUID })).toEqual([]);
    expect(await refused(DomainParams, { orgId: UUID, domainId: UUID })).toEqual([]);
  });

  it("accepts the id the organization plugin actually mints", async () => {
    // **The #715 regression, as a unit.** `orgId` was `@IsUUID()`, and the only route that
    // creates a workspace has minted 32-character ids since #714 — so every workspace anybody
    // made answered `422` on every route beneath it. A uuid is still accepted because V006
    // back-filled the pre-cut-over rows with them; both shapes are real, which is why the
    // rule names two.
    expect(await refused(OrgParams, { orgId: PLUGIN_ID })).toEqual([]);
    expect(await refused(DomainParams, { orgId: PLUGIN_ID, domainId: UUID })).toEqual([]);
  });

  it("refuses anything else, so a malformed id is a 422 rather than a query", async () => {
    // The reason these are classes instead of a `ParseUUIDPipe`: the answer is the same
    // envelope and the same `details` shape as a malformed body, so a client has one failure
    // mode to handle rather than two.
    //
    // Widening the rule for the plugin's ids did not widen it to *anything*, and these are the
    // edges that say so: a value of the right length carrying a character the generator never
    // emits, one a character short, and one a character long.
    expect(await refused(OrgParams, { orgId: "not-an-id" })).toEqual(["orgId"]);
    expect(await refused(OrgParams, { orgId: `${"a".repeat(31)}-` })).toEqual(["orgId"]);
    expect(await refused(OrgParams, { orgId: "a".repeat(31) })).toEqual(["orgId"]);
    expect(await refused(OrgParams, { orgId: "a".repeat(33) })).toEqual(["orgId"]);
    expect(await refused(DomainParams, { orgId: UUID, domainId: "12345" })).toEqual(["domainId"]);
  });

  it("keeps the domain id a uuid, because this service is what mints one", async () => {
    // Only `orgId` moved. `tenant_domains.id` is `gen_random_uuid()` and nothing else writes
    // it, so widening that one would admit values no row can ever hold.
    expect(await refused(DomainParams, { orgId: UUID, domainId: PLUGIN_ID })).toEqual(["domainId"]);
  });

  it("inherits the workspace's id into every nested route", async () => {
    expect(await refused(GithubOrgParams, { orgId: "nope", login: "nobudata" })).toEqual(["orgId"]);
    expect(
      await refused(RepoParams, { orgId: "nope", login: "nobudata", name: "ouroboros" }),
    ).toEqual(["orgId"]);
  });

  it.each([
    ["a GitHub login", { orgId: UUID, login: "nobudata" }, []],
    ["an upper-case login", { orgId: UUID, login: "NobuData" }, ["login"]],
    ["a login with a leading hyphen", { orgId: UUID, login: "-nope" }, ["login"]],
    ["a login of 39 characters", { orgId: UUID, login: "a".repeat(39) }, []],
    ["a login of 40", { orgId: UUID, login: "a".repeat(40) }, ["login"]],
  ])("checks %s against GitHub's own rule", async (_case, params, expected) => {
    expect(await refused(GithubOrgParams, params)).toEqual(expected);
  });

  it.each([
    ["a repository name", "ouroboros", []],
    ["a name with dots and dashes", "ouroboros-2.0_beta", []],
    ["an upper-case name", "Ouroboros", ["name"]],
    ["a name with a slash", "nobudata/ouroboros", ["name"]],
    ["a name of 101 characters", "a".repeat(101), ["name"]],
  ])("checks %s against GitHub's own rule", async (_case, name, expected) => {
    expect(await refused(RepoParams, { orgId: UUID, login: "nobudata", name })).toEqual(expected);
  });
});

describe("adding a domain", () => {
  it.each([
    ["two labels", "acme.example", []],
    ["three", "mail.acme.example", []],
    ["one", "example", ["domain"]],
    ["upper case", "Acme.example", ["domain"]],
    ["an email address", "ada@acme.example", ["domain"]],
    ["a trailing dot", "acme.example.", ["domain"]],
    ["a label with a leading hyphen", "-acme.example", ["domain"]],
    ["254 characters", `${"a".repeat(250)}.com`, ["domain"]],
  ])("checks %s against tenant_domains_domain_format", async (_case, domain, expected) => {
    expect(await refused(CreateDomainBody, { domain })).toEqual(expected);
  });

  it("takes isPrimary as an optional boolean", async () => {
    expect(await refused(CreateDomainBody, { domain: "acme.example", isPrimary: true })).toEqual(
      [],
    );
    expect(await refused(CreateDomainBody, { domain: "acme.example", isPrimary: "yes" })).toEqual([
      "isPrimary",
    ]);
  });

  it("requires isPrimary when that is the whole request", async () => {
    expect(await refused(UpdateDomainBody, {})).toEqual(["isPrimary"]);
    expect(await refused(UpdateDomainBody, { isPrimary: false })).toEqual([]);
  });
});

describe("enabling a GitHub organisation", () => {
  it("takes a login and an optional flag", async () => {
    expect(await refused(CreateGithubOrgBody, { login: "nobudata" })).toEqual([]);
    expect(await refused(CreateGithubOrgBody, { login: "nobudata", enabled: true })).toEqual([]);
  });

  it("requires the flag when that is the whole request", async () => {
    expect(await refused(UpdateGithubOrgBody, {})).toEqual(["enabled"]);
    expect(await refused(UpdateGithubOrgBody, { enabled: false })).toEqual([]);
  });

  it("refuses a field it does not declare", async () => {
    // Mass assignment, closed. `installedAt` is discovered from GitHub, not asserted by a
    // client, and a caller that could set it could claim an installation that never happened.
    expect(
      await refused(CreateGithubOrgBody, { login: "nobudata", installedAt: "2026-08-11" }),
    ).toEqual(["installedAt"]);
  });
});

describe("enabling a repository", () => {
  it("requires the flag and takes an optional branch", async () => {
    expect(await refused(UpdateRepoBody, {})).toEqual(["enabled"]);
    expect(await refused(UpdateRepoBody, { enabled: true })).toEqual([]);
    expect(await refused(UpdateRepoBody, { enabled: true, defaultBranch: "main" })).toEqual([]);
  });

  it.each([
    ["a plain branch", "main", true],
    ["a namespaced branch", "release/2026.08", true],
    ["a dotted branch", "v1.2.3", true],
    ["path traversal", "../../etc/passwd", false],
    ["a leading slash", "/main", false],
    ["a trailing slash", "main/", false],
    ["an empty segment", "release//2026", false],
    ["a leading dot", ".hidden", false],
    ["a dot-dot inside a segment", "release/..2026", false],
    ["a space", "my branch", false],
  ])("checks %s against github_repos_default_branch_format", (_case, branch, acceptable) => {
    // The one constraint restated as a single expression rather than as the migration's
    // allow-list plus four exclusions, so it is worth checking the edges directly. `..`
    // anywhere is the case that matters: a slash is permitted, so it would otherwise be
    // path traversal in anything that builds a checkout directory from the value.
    expect(BRANCH_PATTERN.test(branch)).toBe(acceptable);
  });
});
