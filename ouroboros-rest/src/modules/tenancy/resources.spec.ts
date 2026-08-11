import type { GithubOrg, GithubRepo, Tenant, TenantDomain } from "../db/schema";
import {
  domainResource,
  memberResource,
  orgResource,
  repoResource,
  tenantResource,
  type MemberRow,
} from "./resources";

/**
 * The translation between the database's names and the API's.
 *
 * Two things are being checked, and the second is the one that matters. The first is that
 * every column arrives under the right key — a `displayName` that silently read
 * `display_name` from the wrong row would be caught by nothing else. The second is that a
 * column the migrations add later does *not* arrive at all: these functions name every field
 * they return, so a new column reaches the wire only when somebody decides it should.
 */

/** A tenant row, as `pg` hands one back. */
const TENANT: Tenant = {
  id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  slug: "acme",
  display_name: "Acme, Inc.",
  status: "active",
  created_at: new Date("2026-08-11T10:20:23.114Z"),
  updated_at: new Date("2026-08-11T11:02:44.900Z"),
};

describe("a tenant", () => {
  it("is rendered under the API's names", () => {
    expect(tenantResource(TENANT)).toEqual({
      id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
      slug: "acme",
      displayName: "Acme, Inc.",
      status: "active",
      createdAt: "2026-08-11T10:20:23.114Z",
      updatedAt: "2026-08-11T11:02:44.900Z",
    });
  });

  it("publishes nothing a migration adds later", () => {
    // The whole reason a controller never returns a row: a column added by a migration
    // would otherwise become part of the contract the day it landed, without anyone
    // deciding it should.
    const withSecret = { ...TENANT, internal_note: "not for the wire" } as Tenant;

    expect(Object.keys(tenantResource(withSecret))).toEqual([
      "id",
      "slug",
      "displayName",
      "status",
      "createdAt",
      "updatedAt",
    ]);
  });
});

describe("a domain", () => {
  it("is rendered under the API's names", () => {
    const row: TenantDomain = {
      id: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
      tenant_id: TENANT.id,
      domain: "acme.example",
      is_primary: true,
      created_at: new Date("2026-08-11T10:20:23.114Z"),
      updated_at: new Date("2026-08-11T10:20:23.114Z"),
    };

    expect(domainResource(row)).toEqual({
      id: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
      tenantId: TENANT.id,
      domain: "acme.example",
      isPrimary: true,
      createdAt: "2026-08-11T10:20:23.114Z",
      updatedAt: "2026-08-11T10:20:23.114Z",
    });
  });
});

describe("a member", () => {
  /** A membership joined to its person, as the listing query returns one. */
  const row: MemberRow = {
    tenant_id: TENANT.id,
    user_id: "c7b1e2f4-5a63-4d8e-b0c9-7f2a1d3e6b85",
    email: "ada@acme.example",
    display_name: "Ada Lovelace",
    avatar_url: "https://avatars.example/ada.png",
    role: "owner",
    invited_at: new Date("2026-08-11T10:20:23.114Z"),
    joined_at: new Date("2026-08-11T10:24:51.400Z"),
  };

  it("is the membership and the person in one flat row", () => {
    expect(memberResource(row)).toEqual({
      tenantId: TENANT.id,
      userId: "c7b1e2f4-5a63-4d8e-b0c9-7f2a1d3e6b85",
      email: "ada@acme.example",
      displayName: "Ada Lovelace",
      avatarUrl: "https://avatars.example/ada.png",
      role: "owner",
      invitedAt: "2026-08-11T10:20:23.114Z",
      joinedAt: "2026-08-11T10:24:51.400Z",
    });
  });

  it("keeps an outstanding invitation null rather than defaulting it", () => {
    // "Not joined yet" and "joined at the epoch" are different facts, and the member list
    // renders them differently.
    const invited = memberResource({ ...row, joined_at: null, avatar_url: null });

    expect(invited.joinedAt).toBeNull();
    expect(invited.avatarUrl).toBeNull();
  });
});

describe("an organisation", () => {
  const row: GithubOrg = {
    id: "2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f",
    tenant_id: TENANT.id,
    login: "nobudata",
    enabled: true,
    installed_at: null,
    created_at: new Date("2026-08-11T10:20:23.114Z"),
    updated_at: new Date("2026-08-11T10:20:23.114Z"),
  };

  it("is rendered under the API's names", () => {
    expect(orgResource(row)).toEqual({
      id: "2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f",
      tenantId: TENANT.id,
      login: "nobudata",
      enabled: true,
      installedAt: null,
      createdAt: "2026-08-11T10:20:23.114Z",
      updatedAt: "2026-08-11T10:20:23.114Z",
    });
  });

  it("renders an installation once there is one", () => {
    const installed = orgResource({
      ...row,
      installed_at: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(installed.installedAt).toBe("2026-08-11T12:00:00.000Z");
  });
});

describe("a repository", () => {
  const row: GithubRepo = {
    id: "7a3d9c21-8e4f-4b5a-9c6d-0e1f2a3b4c5d",
    org_id: "2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f",
    name: "ouroboros",
    enabled: true,
    default_branch: "main",
    created_at: new Date("2026-08-11T10:20:23.114Z"),
    updated_at: new Date("2026-08-11T10:20:23.114Z"),
  };

  it("is rendered under the API's names", () => {
    expect(repoResource(row)).toEqual({
      id: "7a3d9c21-8e4f-4b5a-9c6d-0e1f2a3b4c5d",
      orgId: "2e5f7a19-3b4c-4d6e-8f01-9a2b3c4d5e6f",
      name: "ouroboros",
      enabled: true,
      defaultBranch: "main",
      createdAt: "2026-08-11T10:20:23.114Z",
      updatedAt: "2026-08-11T10:20:23.114Z",
    });
  });

  it("carries no tenant id", () => {
    // V003 hangs a repository off its organisation rather than off the tenant, so a second
    // copy of that fact here could disagree with the organisation's.
    expect(repoResource(row)).not.toHaveProperty("tenantId");
  });

  it("keeps an undiscovered branch null", () => {
    expect(repoResource({ ...row, default_branch: null }).defaultBranch).toBeNull();
  });
});
