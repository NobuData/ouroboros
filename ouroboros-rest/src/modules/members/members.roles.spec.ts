import { DISPLAY_ROLE_TIERS, displayRoleOf, roleHierarchyLine } from "./members.roles";

/**
 * Decision S3's display mapping (#485): the plugin's roles, in the card's words.
 */

describe("the display mapping", () => {
  it("maps owner → Owner, admin → Maintainer, member and viewer → Viewer", () => {
    expect(displayRoleOf(["owner"])).toBe("Owner");
    expect(displayRoleOf(["admin"])).toBe("Maintainer");
    expect(displayRoleOf(["member"])).toBe("Viewer");
    expect(displayRoleOf(["viewer"])).toBe("Viewer");
  });

  it("shows a member holding several roles at the highest", () => {
    expect(displayRoleOf(["viewer", "admin"])).toBe("Maintainer");
    expect(displayRoleOf(["admin", "owner"])).toBe("Owner");
  });

  it("shows a member holding nothing recognised as a Viewer", () => {
    expect(displayRoleOf([])).toBe("Viewer");
  });

  it("covers every plugin role exactly once", () => {
    expect(DISPLAY_ROLE_TIERS.flatMap((tier) => tier.roles).sort()).toEqual([
      "admin",
      "member",
      "owner",
      "viewer",
    ]);
  });
});

describe("the footer line", () => {
  it("reads as the mockup does, from the same mapping the API enforces", () => {
    expect(roleHierarchyLine()).toBe("Owner > Maintainer (approve/merge) > Viewer (read-only)");
  });
});
