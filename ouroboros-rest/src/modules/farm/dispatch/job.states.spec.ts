import type { BuildJobStatus } from "../../db/schema";
import {
  HELD_PHASES,
  InvalidJobTransitionError,
  JOB_PHASES,
  TERMINAL_PHASES,
  TRANSITIONS,
  assertTransition,
  canTransition,
  isTerminal,
  phaseOf,
  statusOf,
  type JobPhase,
} from "./job.states";

/**
 * The state machine every writer is held to (#252) — the whole table, pair by pair, so a move
 * added or removed by accident is a failing line here rather than a stat row that stops adding up.
 */

/** Every legal move, written out independently of the table under test. */
const LEGAL: readonly (readonly [JobPhase, JobPhase])[] = [
  ["waiting", "offered"],
  ["waiting", "canceled"],
  ["offered", "waiting"],
  ["offered", "accepted"],
  ["offered", "running"],
  ["offered", "succeeded"],
  ["offered", "failed"],
  ["offered", "retried"],
  ["offered", "canceled"],
  ["accepted", "waiting"],
  ["accepted", "running"],
  ["accepted", "succeeded"],
  ["accepted", "failed"],
  ["accepted", "retried"],
  ["accepted", "canceled"],
  ["running", "succeeded"],
  ["running", "failed"],
  ["running", "retried"],
  ["running", "canceled"],
];

describe("the build job state machine", () => {
  const pairs = JOB_PHASES.flatMap((from) => JOB_PHASES.map((to) => [from, to] as const));
  const legal = new Set(LEGAL.map(([from, to]) => `${from}→${to}`));

  it.each(pairs)("%s → %s is legal exactly when the lifecycle says so", (from, to) => {
    const expected = legal.has(`${from}→${to}`);

    expect(canTransition(from, to)).toBe(expected);
    if (expected) {
      expect(() => assertTransition(from, to)).not.toThrow();
    } else {
      expect(() => assertTransition(from, to, "job-1")).toThrow(InvalidJobTransitionError);
    }
  });

  it("names the job and both phases when it refuses, so the log says what went wrong", () => {
    let thrown: unknown;
    try {
      assertTransition("succeeded", "running", "5eed0028-0000-4000-8000-000000000479");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(InvalidJobTransitionError);
    expect(thrown).toMatchObject({
      name: "InvalidJobTransitionError",
      from: "succeeded",
      to: "running",
      jobId: "5eed0028-0000-4000-8000-000000000479",
    });
    expect((thrown as Error).message).toContain("cannot move from succeeded to running");
  });

  it("lets nothing leave a terminal phase — the four the stat row counts", () => {
    expect(TERMINAL_PHASES).toEqual(["succeeded", "failed", "retried", "canceled"]);
    for (const phase of TERMINAL_PHASES) {
      expect(TRANSITIONS[phase]).toEqual([]);
      expect(isTerminal(phase)).toBe(true);
    }
    for (const phase of ["waiting", "offered", "accepted", "running"] as const) {
      expect(isTerminal(phase)).toBe(false);
    }
  });

  it("never lets a finished build run again, or a queued one skip straight to running", () => {
    expect(canTransition("waiting", "running")).toBe(false);
    expect(canTransition("waiting", "succeeded")).toBe(false);
    expect(canTransition("running", "waiting")).toBe(false);
    expect(canTransition("running", "accepted")).toBe(false);
  });

  it("counts offered, accepted and running against a runner's cap", () => {
    expect(HELD_PHASES).toEqual(["offered", "accepted", "running"]);
  });

  describe("phases and V040's statuses", () => {
    it("splits queued by whether a runner holds it — which is what q:N counts", () => {
      expect(phaseOf({ status: "queued", runner_id: null })).toBe("waiting");
      expect(phaseOf({ status: "queued", runner_id: "7f000002-0000-4000-8000-000000000001" })).toBe(
        "accepted",
      );
    });

    it.each<BuildJobStatus>(["offered", "running", "succeeded", "failed", "retried", "canceled"])(
      "reads %s as itself",
      (status) => {
        expect(phaseOf({ status, runner_id: "7f000002-0000-4000-8000-000000000001" })).toBe(status);
      },
    );

    it("stores every phase under one of V040's seven statuses, and no other", () => {
      expect(JOB_PHASES.map(statusOf)).toEqual([
        "queued",
        "offered",
        "queued",
        "running",
        "succeeded",
        "failed",
        "retried",
        "canceled",
      ]);
    });
  });
});
