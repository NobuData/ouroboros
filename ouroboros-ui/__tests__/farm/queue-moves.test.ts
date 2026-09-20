import { describe, expect, it } from "vitest";

import type { FarmPage } from "@/app/api/farm";
import { NO_QUEUE_MOVES, queueMoves, queueMovesAnnouncement } from "@/app/farm/queue-moves";

import { farmRunner, seededFarm } from "../helpers/farm";

/**
 * Which runners' `q:N` has just moved (#260) — what makes a submitted build visible on the rows
 * it lands on. Two pages in, the moves out.
 */

/**
 * The seeded farm with some queue depths replaced.
 *
 * @param depths Depth by runner name.
 * @returns The page.
 */
function withDepths(depths: Readonly<Record<string, number>>): FarmPage {
  const page = seededFarm();

  return {
    ...page,
    runners: page.runners.map((runner) =>
      runner.name in depths ? { ...runner, queueDepth: depths[runner.name] } : runner,
    ),
  };
}

/**
 * A runner's id, by name.
 *
 * @param name The runner's name.
 * @returns Its id in the seeded farm.
 */
function idOf(name: string): string {
  const runner = seededFarm().runners.find((candidate) => candidate.name === name);
  if (runner === undefined) throw new Error(`no seeded ${name}`);

  return runner.id;
}

describe("what moved", () => {
  it("marks the runner a submitted build landed on, with both depths", () => {
    const moves = queueMoves(seededFarm(), withDepths({ "forge-01": 3 }));

    expect([...moves.keys()]).toEqual([idOf("forge-01")]);
    expect(moves.get(idOf("forge-01"))).toEqual({ name: "forge-01", from: 2, to: 3 });
  });

  it("marks a queue that emptied as well as one that grew", () => {
    expect(queueMoves(seededFarm(), withDepths({ bigiron: 0 })).get(idOf("bigiron"))).toEqual({
      name: "bigiron",
      from: 1,
      to: 0,
    });
  });

  it("marks every runner that moved, and none that did not", () => {
    const moves = queueMoves(seededFarm(), withDepths({ "forge-01": 1, "forge-02": 1 }));

    expect([...moves.keys()].sort()).toEqual([idOf("forge-01"), idOf("forge-02")].sort());
  });

  it("is the same empty map every time nothing moved, so nothing re-renders", () => {
    expect(queueMoves(seededFarm(), seededFarm())).toBe(NO_QUEUE_MOVES);
  });

  it("marks nothing on the first page there is", () => {
    // Nothing came before it, so nothing on it is a change.
    expect(queueMoves(null, seededFarm())).toBe(NO_QUEUE_MOVES);
    expect(queueMoves(seededFarm(), null)).toBe(NO_QUEUE_MOVES);
  });

  it("does not read a machine's first appearance as a move in its queue", () => {
    const page = seededFarm();
    const joined: FarmPage = {
      ...page,
      runners: [...page.runners, farmRunner({ id: "new", name: "forge-09", queueDepth: 4 })],
    };

    expect(queueMoves(page, joined)).toBe(NO_QUEUE_MOVES);
  });

  it("does not read a machine that left as a move", () => {
    const page = seededFarm();

    expect(queueMoves(page, { ...page, runners: page.runners.slice(1) })).toBe(NO_QUEUE_MOVES);
  });
});

describe("what is said out loud", () => {
  it("names the runner and both depths, in the chip's own words", () => {
    expect(queueMovesAnnouncement(queueMoves(seededFarm(), withDepths({ "forge-01": 3 })))).toBe(
      "forge-01 queue q:2 → q:3",
    );
  });

  it("says several in name order, whatever order the payload served them in", () => {
    const moves = queueMoves(seededFarm(), withDepths({ "forge-02": 1, bigiron: 2 }));

    expect(queueMovesAnnouncement(moves)).toBe("bigiron queue q:1 → q:2; forge-02 queue q:0 → q:1");
  });

  it("says nothing when nothing moved", () => {
    expect(queueMovesAnnouncement(NO_QUEUE_MOVES)).toBe("");
  });
});
