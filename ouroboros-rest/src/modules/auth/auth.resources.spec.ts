import type { Tenant, User } from "../db/schema";
import {
  membershipResource,
  tenantSuggestionResource,
  userResource,
  type MembershipRow,
} from "./auth.resources";

/**
 * The translation from rows to the wire.
 *
 * One rule, checked three ways: **the database's names never reach a client**. A resource
 * that leaked `display_name` would make the UI's field names an artefact of a schema no
 * browser has seen, and the first migration to rename a column would be a breaking change
 * to the API by accident.
 */

const INSTANT = new Date("2026-08-11T10:20:23.114Z");

const USER = {
  id: "5eed0003-0000-4000-8000-000000000001",
  email: "ken@acme-robotics.dev",
  display_name: "Ken Suenobu",
  avatar_url: null,
  created_at: INSTANT,
  updated_at: INSTANT,
} satisfies User;

const MEMBERSHIP = {
  tenant_id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  slug: "acme",
  display_name: "Acme, Inc.",
  status: "active",
  role: "owner",
  invited_at: INSTANT,
  joined_at: null,
} satisfies MembershipRow;

const TENANT = {
  id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  slug: "acme",
  display_name: "Acme, Inc.",
  status: "active",
  created_at: INSTANT,
  updated_at: INSTANT,
} satisfies Tenant;

describe("a user resource", () => {
  it("is the row with the API's names and ISO timestamps", () => {
    expect(userResource(USER)).toEqual({
      id: "5eed0003-0000-4000-8000-000000000001",
      email: "ken@acme-robotics.dev",
      displayName: "Ken Suenobu",
      avatarUrl: null,
      createdAt: "2026-08-11T10:20:23.114Z",
      updatedAt: "2026-08-11T10:20:23.114Z",
    });
  });

  it("carries none of the database's names", () => {
    const rendered = JSON.stringify(userResource(USER));

    expect(rendered).not.toContain("display_name");
    expect(rendered).not.toContain("avatar_url");
    expect(rendered).not.toContain("created_at");
  });

  it("keeps an avatar when there is one", () => {
    expect(userResource({ ...USER, avatar_url: "https://avatars.example/1" }).avatarUrl).toBe(
      "https://avatars.example/1",
    );
  });
});

describe("a membership resource", () => {
  it("is flattened, because it is one row of a workspace switcher", () => {
    expect(membershipResource(MEMBERSHIP)).toEqual({
      tenantId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
      slug: "acme",
      displayName: "Acme, Inc.",
      status: "active",
      role: "owner",
      invitedAt: "2026-08-11T10:20:23.114Z",
      joinedAt: null,
    });
  });

  it("preserves a null joinedAt rather than defaulting it", () => {
    // "Invited, not yet accepted" and "joined at the epoch" are different facts, and the
    // member list renders the first as a state.
    expect(membershipResource(MEMBERSHIP).joinedAt).toBeNull();
  });

  it("renders a joinedAt when the invitation was accepted", () => {
    expect(membershipResource({ ...MEMBERSHIP, joined_at: INSTANT }).joinedAt).toBe(
      "2026-08-11T10:20:23.114Z",
    );
  });

  it("carries the tenant's status, so a suspended workspace can be rendered as one", () => {
    expect(membershipResource({ ...MEMBERSHIP, status: "suspended" }).status).toBe("suspended");
  });
});

describe("a tenant suggestion", () => {
  it("carries three fields and no more", () => {
    expect(tenantSuggestionResource(TENANT)).toEqual({
      tenantId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
      slug: "acme",
      displayName: "Acme, Inc.",
    });
  });

  it("says nothing about the tenant's lifecycle or history", () => {
    // It is shown to somebody who is *not* a member. Whether their employer's workspace is
    // suspended, and when it was created, is none of their business.
    const suggestion = tenantSuggestionResource(TENANT);

    expect(suggestion).not.toHaveProperty("status");
    expect(suggestion).not.toHaveProperty("createdAt");
    expect(suggestion).not.toHaveProperty("updatedAt");
  });
});
