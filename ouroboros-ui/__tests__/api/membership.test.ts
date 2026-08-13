import { describe, expect, it } from "vitest";

import {
  ADMIN_ROLES,
  type Membership,
  activeMembership,
  isAdminRole,
  selectableMemberships,
} from "@/app/api/membership";

/**
 * The membership rules, which are the whole of "which workspace did they mean" and "may they
 * change it".
 *
 * Nothing here touches a cookie or the network — that is the point of the module being
 * framework-free — so every case is the rule itself rather than a route exercising it.
 */

/**
 * One membership, with the fields a case cares about overridden.
 *
 * @param over What this case is about.
 * @returns A complete membership.
 */
function membership(over: Partial<Membership> = {}): Membership {
  return {
    tenantId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
    slug: "acme-robotics",
    displayName: "Acme Robotics",
    status: "active",
    role: "owner",
    ...over,
  };
}

describe("isAdminRole", () => {
  it("admits the two roles the contract lets administer a workspace", () => {
    expect(isAdminRole("owner")).toBe(true);
    expect(isAdminRole("admin")).toBe(true);
  });

  it("refuses the two that may only read it", () => {
    // The contract states this once for every mutation it describes: "Administering a
    // workspace is `owner` or `admin`; `member` and `viewer` may read it."
    expect(isAdminRole("member")).toBe(false);
    expect(isAdminRole("viewer")).toBe(false);
  });

  it("agrees with the published list, so the two cannot drift", () => {
    expect([...ADMIN_ROLES]).toEqual(["owner", "admin"]);
  });
});

describe("selectableMemberships", () => {
  it("keeps the live workspaces in the order the service returned them", () => {
    const list = [
      membership({ slug: "one", tenantId: "1" }),
      membership({ slug: "two", tenantId: "2" }),
    ];

    expect(selectableMemberships(list).map((one) => one.slug)).toEqual(["one", "two"]);
  });

  it("drops a suspended workspace, because it is not somewhere to operate", () => {
    const list = [
      membership({ slug: "live", tenantId: "1" }),
      membership({ slug: "held", tenantId: "2", status: "suspended" }),
      membership({ slug: "gone", tenantId: "3", status: "deleted" }),
    ];

    expect(selectableMemberships(list).map((one) => one.slug)).toEqual(["live"]);
  });

  it("returns nothing for somebody who belongs nowhere", () => {
    expect(selectableMemberships([])).toEqual([]);
  });
});

describe("activeMembership", () => {
  const acme = membership();

  it("resolves a slug, which is what a person types", () => {
    expect(activeMembership([acme], "acme-robotics")).toBe(acme);
  });

  it("resolves a uuid, which is the other form the contract accepts", () => {
    expect(activeMembership([acme], acme.tenantId)).toBe(acme);
  });

  it("resolves nothing when there is no reference to resolve", () => {
    expect(activeMembership([acme], undefined)).toBeUndefined();
  });

  it("resolves nothing for a workspace this person does not belong to", () => {
    // The property that makes an edited `ouro_tenant` cookie inert: the reference is
    // matched against what the service just said, not trusted.
    expect(activeMembership([acme], "someone-elses-workspace")).toBeUndefined();
  });

  it("resolves nothing for a suspended workspace they do belong to", () => {
    const held = membership({ slug: "held", tenantId: "2", status: "suspended" });

    expect(activeMembership([held], "held")).toBeUndefined();
    expect(activeMembership([held], held.tenantId)).toBeUndefined();
  });

  it("does not match a slug case-insensitively or as a prefix", () => {
    expect(activeMembership([acme], "ACME-ROBOTICS")).toBeUndefined();
    expect(activeMembership([acme], "acme")).toBeUndefined();
  });
});
