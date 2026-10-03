import type { DatabaseService } from "../db/db.service";
import { statesOf } from "./lifecycle.fixture";
import { ACTIVE_STANDING, LifecycleDispatchGate, WorkspaceStateReader } from "./lifecycle.state";

/** A connection whose one select answers `row`. */
function databaseAnswering(row: unknown): DatabaseService {
  const query = {
    select: () => query,
    where: () => query,
    executeTakeFirst: () => Promise.resolve(row),
  };

  return { db: { selectFrom: () => query } } as unknown as DatabaseService;
}

describe("reading a workspace's standing (#489)", () => {
  it("reads a workspace with no row as active", async () => {
    await expect(
      new WorkspaceStateReader(databaseAnswering(undefined)).standing("org"),
    ).resolves.toBe(ACTIVE_STANDING);
  });

  it("maps a row to a standing", async () => {
    const at = new Date("2026-10-03T00:00:00Z");
    const reader = new WorkspaceStateReader(
      databaseAnswering({ state: "paused", purge_after: null, changed_at: at, changed_by: "u" }),
    );

    await expect(reader.standing("org")).resolves.toEqual({
      state: "paused",
      purgeAfter: null,
      changedAt: at,
      changedBy: "u",
    });
    await expect(reader.stateOf("org")).resolves.toBe("paused");
  });
});

describe("the farm's dispatch gate (#489)", () => {
  it("admits only an active workspace", async () => {
    const gate = new LifecycleDispatchGate(
      statesOf(
        new Map([
          ["paused-org", "paused"],
          ["deleting-org", "pending_delete"],
        ]),
      ),
    );

    await expect(gate.admits("active-org")).resolves.toBe(true);
    await expect(gate.admits("paused-org")).resolves.toBe(false);
    await expect(gate.admits("deleting-org")).resolves.toBe(false);
  });
});
