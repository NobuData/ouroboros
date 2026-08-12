import { adminAc, memberAc, ownerAc } from "better-auth/plugins/organization/access";

import {
  CREATOR_ROLE,
  ORGANIZATION_ROLE_IDS,
  ORGANIZATION_ROLES,
  ORGANIZATION_STATEMENTS,
  VIEWER_PERMISSIONS,
  VIEWER_ROLE,
  organizationAccessControl,
  viewerAc,
} from "./organization.roles";

/**
 * What each role may do, asked of the library rather than of a stand-in.
 *
 * [#704](https://github.com/NobuData/ouroboros/issues/704)'s third acceptance criterion is
 * that the custom `viewer` role *maps to a custom access-control role and is **asserted**,
 * not assumed* — so this is the one suite under `src/auth/` that loads part of
 * `better-auth` for real. `jest.config.mjs` converts `better-auth/plugins/access` and
 * `better-auth/plugins/organization/access` instead of replacing them, and its comment says
 * why: a `viewer` minted by a fake `createAccessControl` would only prove that the fake
 * returns what it was given.
 *
 * Every `authorize` call below is therefore the library's own answer, reached by the same
 * code path the plugin takes when it decides whether a request may remove a member.
 */

describe("the statement surface", () => {
  it("is the plugin's own, with nothing of ours bolted on", () => {
    // A statement here would be a permission the plugin's endpoints never check — they
    // authorize against this list and only this list — so it would read like policy and
    // enforce nothing. This service's own permissions are `RolesGuard`'s.
    expect(Object.keys(ORGANIZATION_STATEMENTS).sort()).toEqual([
      "ac",
      "invitation",
      "member",
      "organization",
      "team",
    ]);
  });

  it("is a copy, so the library's shared export cannot be mutated through it", () => {
    // `createAccessControl` takes ownership of what it is given, and the library's
    // `defaultStatements` is one object shared with every other consumer in the process.
    expect(organizationAccessControl.statements).toBe(ORGANIZATION_STATEMENTS);
    expect(ORGANIZATION_STATEMENTS.member).toEqual(["create", "update", "delete"]);
  });
});

describe("the role table", () => {
  it("is exactly V002's vocabulary, so #708 is a rename rather than a re-think", () => {
    // `tenant_members.role` has been CHECK-constrained to these four words since #21, and
    // #708 migrates rows carrying them into `member.role`. `V005` leaves that column
    // unconstrained on purpose — the vocabulary is configuration — which makes this list
    // the place it is actually decided.
    expect(ORGANIZATION_ROLE_IDS.sort()).toEqual(["admin", "member", "owner", "viewer"]);
  });

  it("uses the library's own role objects for the three it ships", () => {
    // Rebuilt copies would be this service quietly redefining what an owner may do, and the
    // redefinition would drift at the next upgrade — silently, and in the permissive
    // direction, because nothing would fail.
    expect(ORGANIZATION_ROLES.owner).toBe(ownerAc);
    expect(ORGANIZATION_ROLES.admin).toBe(adminAc);
    expect(ORGANIZATION_ROLES.member).toBe(memberAc);
  });

  it("mints the fourth from the same access control the plugin authorizes against", () => {
    // Identity, not equivalence. The plugin resolves a role out of `roles` and authorizes
    // against `ac`; a role built from a second, equivalent instance would authorize nothing,
    // with no error anywhere to say why.
    expect(ORGANIZATION_ROLES[VIEWER_ROLE]).toBe(viewerAc);
    expect(VIEWER_ROLE).toBe("viewer");
  });

  it("gives the creator of an organization the one role nobody else can grant", () => {
    // An organization whose creator were an `admin` would have no owner at all: nobody
    // could delete it, and nobody could hand it over.
    expect(CREATOR_ROLE).toBe("owner");
    expect(ORGANIZATION_ROLE_IDS).toContain(CREATOR_ROLE);
  });
});

/**
 * A permission request, as the role built from {@link ORGANIZATION_STATEMENTS} takes one.
 *
 * Derived from the role rather than written out, so the cases below are checked against the
 * *library's* statement types: a resource or an action the plugin does not have stops
 * compiling here rather than quietly asserting that an undefined permission is refused —
 * which every role would pass.
 */
type PermissionRequest = Parameters<typeof viewerAc.authorize>[0];

describe("what a viewer may do", () => {
  // The role exists to be able to look, and to be refused everything else. Each mutation is
  // named separately rather than folded into one assertion, because the failure message
  // naming the one permission that leaked is the whole value of the test.
  const REFUSED: [string, PermissionRequest][] = [
    ["update the organization", { organization: ["update"] }],
    ["delete the organization", { organization: ["delete"] }],
    ["add a member", { member: ["create"] }],
    ["change somebody's role", { member: ["update"] }],
    ["remove a member", { member: ["delete"] }],
    ["invite somebody", { invitation: ["create"] }],
    ["cancel an invitation", { invitation: ["cancel"] }],
  ];

  it.each(REFUSED)("is refused permission to %s", (_what, request) => {
    expect(viewerAc.authorize(request).success).toBe(false);
  });

  it("holds no permission over any resource at all", () => {
    // Every resource granted the empty list, written out rather than left as `{}` — see
    // `VIEWER_PERMISSIONS` for why the difference matters the day the plugin adds a fifth.
    expect(Object.keys(VIEWER_PERMISSIONS).sort()).toEqual(
      Object.keys(ORGANIZATION_STATEMENTS).sort(),
    );
    for (const granted of Object.values(VIEWER_PERMISSIONS)) {
      expect(granted).toEqual([]);
    }
  });

  it("is stricter than the plugin's own member role, which may read role definitions", () => {
    // The one place the two differ at the plugin's level. What actually separates them in
    // this product is what *this service's* routes let them do, which is `RolesGuard`'s
    // business — `viewer` exists here so the vocabulary is shared and the plugin's own
    // mutations refuse it too.
    expect(memberAc.authorize({ ac: ["read"] }).success).toBe(true);
    expect(viewerAc.authorize({ ac: ["read"] }).success).toBe(false);
  });
});

describe("what the roles above a viewer may do", () => {
  // The other half of the acceptance criterion #715 verifies end to end: the roles that
  // administer a workspace really do hold the permissions a viewer is refused, so the
  // assertions above are a rule rather than a role that authorizes nothing.
  it("lets an owner and an admin add a member, and refuses a member", () => {
    expect(ownerAc.authorize({ member: ["create"] }).success).toBe(true);
    expect(adminAc.authorize({ member: ["create"] }).success).toBe(true);
    expect(memberAc.authorize({ member: ["create"] }).success).toBe(false);
  });

  it("lets only an owner delete the organization", () => {
    // The one permission that separates owner from admin, and the reason `creatorRole`
    // matters: an organization with no owner could never be deleted by anybody in it.
    expect(ownerAc.authorize({ organization: ["delete"] }).success).toBe(true);
    expect(adminAc.authorize({ organization: ["delete"] }).success).toBe(false);
  });
});
