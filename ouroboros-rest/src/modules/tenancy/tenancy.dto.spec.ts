import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
  BRANCH_PATTERN,
  CreateDomainBody,
  CreateOrgBody,
  CreateTenantBody,
  DomainParams,
  InviteMemberBody,
  MemberParams,
  OrgParams,
  RepoParams,
  TENANT_ROLES,
  TENANT_STATUSES,
  TenantParams,
  UpdateDomainBody,
  UpdateMemberBody,
  UpdateOrgBody,
  UpdateRepoBody,
  UpdateTenantBody,
  displayNameFromEmail,
  normaliseEmail,
} from "./tenancy.dto";

/**
 * The shapes a request may take, checked against the shapes the *database* will accept.
 *
 * These DTOs restate the `check` constraints V001–V003 declare, and the pairing only earns
 * its keep if the two agree. A DTO that admitted something a constraint refuses would turn a
 * caller's `422` into a `500`; one that is merely stricter is fine, and is why
 * `constraints.ts` still maps a check violation rather than assuming it cannot happen.
 *
 * So the cases below are the constraints' own edges: the two-character slug, the
 * sixty-fourth, the domain with one label, the branch name that is path traversal.
 */

/** A uuid, for the parameter classes. */
const UUID = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

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
  it("accepts a uuid where a uuid belongs", async () => {
    expect(await refused(TenantParams, { tenantId: UUID })).toEqual([]);
    expect(await refused(DomainParams, { tenantId: UUID, domainId: UUID })).toEqual([]);
    expect(await refused(MemberParams, { tenantId: UUID, userId: UUID })).toEqual([]);
  });

  it("refuses anything else, so a malformed id is a 422 rather than a query", async () => {
    // The reason these are classes instead of a `ParseUUIDPipe`: the answer is the same
    // envelope and the same `details` shape as a malformed body, so a client has one failure
    // mode to handle rather than two.
    expect(await refused(TenantParams, { tenantId: "not-a-uuid" })).toEqual(["tenantId"]);
    expect(await refused(DomainParams, { tenantId: UUID, domainId: "12345" })).toEqual([
      "domainId",
    ]);
  });

  it("inherits the tenant's id into every nested route", async () => {
    expect(await refused(MemberParams, { tenantId: "nope", userId: UUID })).toEqual(["tenantId"]);
  });

  it.each([
    ["a GitHub login", { tenantId: UUID, login: "nobudata" }, []],
    ["an upper-case login", { tenantId: UUID, login: "NobuData" }, ["login"]],
    ["a login with a leading hyphen", { tenantId: UUID, login: "-nope" }, ["login"]],
    ["a login of 39 characters", { tenantId: UUID, login: "a".repeat(39) }, []],
    ["a login of 40", { tenantId: UUID, login: "a".repeat(40) }, ["login"]],
  ])("checks %s against GitHub's own rule", async (_case, params, expected) => {
    expect(await refused(OrgParams, params)).toEqual(expected);
  });

  it.each([
    ["a repository name", "ouroboros", []],
    ["a name with dots and dashes", "ouroboros-2.0_beta", []],
    ["an upper-case name", "Ouroboros", ["name"]],
    ["a name with a slash", "nobudata/ouroboros", ["name"]],
    ["a name of 101 characters", "a".repeat(101), ["name"]],
  ])("checks %s against GitHub's own rule", async (_case, name, expected) => {
    expect(await refused(RepoParams, { tenantId: UUID, login: "nobudata", name })).toEqual(
      expected,
    );
  });
});

describe("creating a tenant", () => {
  it("accepts a slug and a display name", async () => {
    expect(await refused(CreateTenantBody, { slug: "acme", displayName: "Acme, Inc." })).toEqual(
      [],
    );
  });

  it.each([
    ["the shortest slug the constraint admits", "ab", []],
    ["the longest", "a".repeat(63), []],
    ["one character", "a", ["slug"]],
    ["sixty-four", "a".repeat(64), ["slug"]],
    ["upper case", "Acme", ["slug"]],
    ["a leading hyphen", "-acme", ["slug"]],
    ["a trailing hyphen", "acme-", ["slug"]],
    ["a double hyphen", "ac--me", ["slug"]],
    ["hyphen-separated groups", "acme-inc-2", []],
    ["an underscore", "acme_inc", ["slug"]],
    ["a space", "acme inc", ["slug"]],
  ])("checks %s against tenants_slug_format", async (_case, slug, expected) => {
    expect(await refused(CreateTenantBody, { slug, displayName: "Acme" })).toEqual(expected);
  });

  it("refuses a blank display name, as tenants_display_name_present does", async () => {
    expect(await refused(CreateTenantBody, { slug: "acme", displayName: "   " })).toEqual([
      "displayName",
    ]);
  });

  it("refuses a field it does not declare", async () => {
    // Mass assignment, closed: `status` is not a caller's to choose at creation.
    expect(
      await refused(CreateTenantBody, { slug: "acme", displayName: "Acme", status: "suspended" }),
    ).toEqual(["status"]);
  });
});

describe("changing a tenant", () => {
  it("accepts a body that changes nothing", async () => {
    // What `PATCH` means: apply these changes, of which there are none.
    expect(await refused(UpdateTenantBody, {})).toEqual([]);
  });

  it.each(TENANT_STATUSES)("accepts the status %s", async (status) => {
    expect(await refused(UpdateTenantBody, { status })).toEqual([]);
  });

  it("refuses a status tenants_status_valid does not admit", async () => {
    expect(await refused(UpdateTenantBody, { status: "archived" })).toEqual(["status"]);
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

describe("inviting a member", () => {
  it("accepts an address and a role", async () => {
    expect(await refused(InviteMemberBody, { email: "ada@acme.example", role: "owner" })).toEqual(
      [],
    );
  });

  it.each(TENANT_ROLES)("accepts the role %s", async (role) => {
    expect(await refused(InviteMemberBody, { email: "ada@acme.example", role })).toEqual([]);
  });

  it("refuses a role tenant_members_role_valid does not admit", async () => {
    expect(
      await refused(InviteMemberBody, { email: "ada@acme.example", role: "maintainer" }),
    ).toEqual(["role"]);
    expect(await refused(UpdateMemberBody, { role: "maintainer" })).toEqual(["role"]);
  });

  it("refuses something that is not an address", async () => {
    expect(await refused(InviteMemberBody, { email: "ada", role: "owner" })).toEqual(["email"]);
  });

  it("has no way to set joinedAt", async () => {
    // The invitation is a stub. Whether somebody accepted is not an inviter's to assert, and
    // nothing before #33's sign-in can honestly say they did.
    expect(
      await refused(InviteMemberBody, {
        email: "ada@acme.example",
        role: "owner",
        joinedAt: "2026-08-11T10:20:23.114Z",
      }),
    ).toEqual(["joinedAt"]);
  });
});

describe("enabling an organisation", () => {
  it("takes a login and an optional flag", async () => {
    expect(await refused(CreateOrgBody, { login: "nobudata" })).toEqual([]);
    expect(await refused(CreateOrgBody, { login: "nobudata", enabled: true })).toEqual([]);
  });

  it("requires the flag when that is the whole request", async () => {
    expect(await refused(UpdateOrgBody, {})).toEqual(["enabled"]);
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

describe("the two values this module normalises", () => {
  it("folds an address, as users_email_lowercase requires", () => {
    // The one place the API folds rather than refuses: an address is typed by a person into
    // a form, and `Ada@acme.example` is not a mistake worth an error message.
    expect(normaliseEmail("Ada@Acme.Example")).toBe("ada@acme.example");
  });

  it("names somebody nobody named after the local part of their address", () => {
    expect(displayNameFromEmail("grace@acme.example")).toBe("grace");
  });
});
