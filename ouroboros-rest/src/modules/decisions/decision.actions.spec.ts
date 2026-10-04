import { holdsRole, resolveActions } from "./decision.actions";
import { SHIPPED_KINDS } from "./decision.kinds.fixture";

/** Action resolution (#461): which buttons a viewer may press — roles, and the approver capability. */

describe("holdsRole", () => {
  it("climbs the ladder: a higher role holds every lower one", () => {
    const admin = { roles: ["admin" as const], canApproveLoops: false };

    expect(holdsRole("viewer", admin)).toBe(true);
    expect(holdsRole("member", admin)).toBe(true);
    expect(holdsRole("admin", admin)).toBe(true);
    expect(holdsRole("owner", admin)).toBe(false);
  });

  it("reads approver as the capability, not a role", () => {
    expect(holdsRole("approver", { roles: ["owner"], canApproveLoops: false })).toBe(false);
    expect(holdsRole("approver", { roles: ["viewer"], canApproveLoops: true })).toBe(true);
  });

  it("gives a member with no recognised role nothing, not even viewer", () => {
    expect(holdsRole("viewer", { roles: [], canApproveLoops: false })).toBe(false);
  });

  it("takes the highest of several roles", () => {
    expect(holdsRole("admin", { roles: ["member", "admin"], canApproveLoops: false })).toBe(true);
  });
});

describe("resolveActions", () => {
  it("keeps the declared order, marks what the viewer may press, and which actions only navigate", () => {
    const resolved = resolveActions(SHIPPED_KINDS.merge_approval.actions, {
      roles: ["member"],
      canApproveLoops: false,
    });

    expect(resolved.map((action) => [action.id, action.allowed, action.navigates])).toEqual([
      ["approve_merge", false, false],
      ["open_verification", true, true],
      ["return_to_loop", true, false],
    ]);
  });
});
