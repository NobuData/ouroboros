import {
  LIFECYCLE_MOVES,
  RECOVERY_WINDOW_DAYS,
  admitsNewWork,
  canMove,
  purgeAfter,
} from "./lifecycle.states";

describe("the workspace state machine (#489)", () => {
  it("draws exactly the issue's diagram", () => {
    expect(LIFECYCLE_MOVES).toEqual({
      pause: { from: ["active"], to: "paused" },
      resume: { from: ["paused"], to: "active" },
      delete: { from: ["active", "paused"], to: "pending_delete" },
      restore: { from: ["pending_delete"], to: "active" },
    });
  });

  it.each([
    ["pause", "active", true],
    ["pause", "paused", false],
    ["pause", "pending_delete", false],
    ["resume", "paused", true],
    ["resume", "active", false],
    ["resume", "pending_delete", false],
    ["delete", "active", true],
    ["delete", "paused", true],
    ["delete", "pending_delete", false],
    ["restore", "pending_delete", true],
    ["restore", "active", false],
    ["restore", "paused", false],
  ] as const)("%s from %s is %s", (move, from, allowed) => {
    expect(canMove(move, from)).toBe(allowed);
  });

  it("closes the recovery window thirty days after the request", () => {
    expect(RECOVERY_WINDOW_DAYS).toBe(30);
    expect(purgeAfter(new Date("2026-10-03T12:00:00Z"))).toEqual(new Date("2026-11-02T12:00:00Z"));
  });

  it("admits new work only while active", () => {
    expect(admitsNewWork("active")).toBe(true);
    expect(admitsNewWork("paused")).toBe(false);
    expect(admitsNewWork("pending_delete")).toBe(false);
  });
});
