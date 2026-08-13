import { describe, expect, it } from "vitest";

import {
  ADMIN_ROLES,
  ROLES,
  activeMembership,
  isAdminRole,
  mayAdminister,
  primaryRole,
} from "@/app/api/membership";

import { membership } from "../helpers/login";

/**
 * The membership rules, which are the whole of "which workspace did they mean" and "may they
 * change it".
 *
 * Nothing here touches a cookie or the network — that is the point of the module being
 * framework-free — so every case is the rule itself rather than a route exercising it.
 *
 * *`selectableMemberships` and its three cases were here* until
 * [#719](https://github.com/NobuData/ouroboros/issues/719). It filtered a workspace's
 * lifecycle, and the row model the memberships are read from now
 * ([#714](https://github.com/NobuData/ouroboros/issues/714)) publishes none: the organization
 * plugin has no lifecycle column, so every workspace the listing returns is one you can work
 * in and there is nothing left to filter. The rule was not relaxed; the state it excluded
 * cannot be reported any more.
 */

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

describe("mayAdminister", () => {
  it("admits a membership holding an administering role", () => {
    expect(mayAdminister(["owner"])).toBe(true);
    expect(mayAdminister(["viewer", "admin"])).toBe(true);
  });

  it("refuses one holding only roles that may read", () => {
    expect(mayAdminister(["member"])).toBe(false);
    expect(mayAdminister(["member", "viewer"])).toBe(false);
  });

  it("refuses an empty list rather than reading it as unrestricted", () => {
    // The contract admits one: "possibly none, for a membership carrying only roles this
    // service does not recognise". A screen that guessed high would render a control the
    // service then refuses.
    expect(mayAdminister([])).toBe(false);
  });
});

describe("primaryRole", () => {
  it("names the strongest role held, because that is what the person may do", () => {
    expect(primaryRole(["member", "owner"])).toBe("owner");
    expect(primaryRole(["viewer", "admin"])).toBe("admin");
  });

  it("names the only one when there is only one", () => {
    expect(primaryRole(["member"])).toBe("member");
  });

  it("degrades an empty list to the least this API grants", () => {
    expect(primaryRole([])).toBe("viewer");
  });

  it("reads the published order rather than one of its own", () => {
    expect([...ROLES]).toEqual(["owner", "admin", "member", "viewer"]);
  });
});

describe("activeMembership", () => {
  const acme = membership();

  it("resolves a slug, which is what a person types", () => {
    expect(activeMembership([acme], "acme-robotics")).toBe(acme);
  });

  it("resolves an id, which is the other form the contract accepts", () => {
    expect(activeMembership([acme], acme.id)).toBe(acme);
  });

  it("resolves nothing when there is no reference to resolve", () => {
    expect(activeMembership([acme], undefined)).toBeUndefined();
  });

  it("resolves nothing for a workspace this person does not belong to", () => {
    // The property that makes a form field naming a workspace inert: the reference is
    // matched against what the service just said, not trusted. It is the same check that
    // made an edited `ouro_tenant` cookie inert before #719 moved the reference's source.
    expect(activeMembership([acme], "someone-elses-workspace")).toBeUndefined();
  });

  it("resolves nothing out of an empty list, whatever is asked for", () => {
    expect(activeMembership([], acme.id)).toBeUndefined();
  });

  it("does not match a slug case-insensitively or as a prefix", () => {
    expect(activeMembership([acme], "ACME-ROBOTICS")).toBeUndefined();
    expect(activeMembership([acme], "acme")).toBeUndefined();
  });
});
