import { RUN_STAGE_STATUSES, type RunStageStatus } from "../db/schema";
import {
  OPENING_STAGE_STATUSES,
  STAGE_TRANSITIONS,
  canTransition,
  hasFinished,
  hasStarted,
  isOpeningStatus,
} from "./ingest.transitions";

/**
 * The stage state machine — decision **R1**'s half that no CHECK can state.
 *
 * The table is asserted **exhaustively** rather than by sample, because the interesting
 * failures are the pairs somebody would not think to write a case for: the lie the issue
 * names (`pending → succeeded`), a terminal status moving again, and a stage beginning in
 * one. An `it.each` over the whole product of statuses is what makes a rule quietly widened
 * in `STAGE_TRANSITIONS` fail here instead of on a stepper.
 */

/** Every ordered pair of statuses — twenty-five, plus five creations. */
const EVERY_PAIR = RUN_STAGE_STATUSES.flatMap((from) =>
  RUN_STAGE_STATUSES.map((to) => [from, to] as const),
);

/** The pairs the machine allows, written out rather than read from the table under test. */
const ALLOWED = new Set(["pending→active", "pending→skipped", "active→succeeded", "active→failed"]);

describe("creating a stage attempt", () => {
  it.each([...RUN_STAGE_STATUSES])("decides %s", (status) => {
    // Rule 1: `succeeded` out of nowhere is the lie the issue names — a ✓ on the stepper for
    // work no row ever recorded starting.
    const openable = status === "pending" || status === "active" || status === "skipped";

    expect(isOpeningStatus(status)).toBe(openable);
    expect(canTransition(null, status)).toBe(openable);
  });

  it("lists exactly the three a stage can begin in", () => {
    expect([...OPENING_STAGE_STATUSES].toSorted()).toEqual(["active", "pending", "skipped"]);
  });
});

describe("moving a stage attempt", () => {
  it.each(EVERY_PAIR)("decides %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(ALLOWED.has(`${from}→${to}`));
  });

  it("refuses a move to the status the row is already in", () => {
    // A redelivery is an idempotency-key replay, answered from the receipt ledger before the
    // machine is consulted. Treating a no-op move as legal would make a *second, different*
    // submission of the same transition silently succeed.
    for (const status of RUN_STAGE_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it("makes every terminal status terminal", () => {
    // A retry is a new row with a higher attempt — decision R1's whole point, and what makes
    // attempt 1 still answerable. Rewriting a terminal row would change history a reader may
    // already have seen.
    for (const status of ["succeeded", "failed", "skipped"] as const) {
      expect(STAGE_TRANSITIONS[status]).toEqual([]);
    }
  });

  it("names a successor for every status, so a sixth cannot arrive with none", () => {
    // The table is an exhaustive `Record`, which is a compile-time guarantee; this is the
    // run-time half — a status present as a key with no entry would refuse every move an
    // executor made, silently.
    expect(Object.keys(STAGE_TRANSITIONS).toSorted()).toEqual([...RUN_STAGE_STATUSES].toSorted());
  });
});

describe("the clock each status implies", () => {
  it.each([
    ["pending", false, false],
    ["active", true, false],
    ["succeeded", true, true],
    ["failed", true, true],
    ["skipped", false, false],
  ] as [RunStageStatus, boolean, boolean][])(
    "%s has started=%s and finished=%s",
    (status, started, finished) => {
      // `run_stages_clock`'s rule, stated once so the writer and the reader of a row cannot
      // disagree. `skipped` is the one that catches people: a stage the path avoided has no
      // clock at all, which is why the CHECK asks only that its `started_at` be null.
      expect(hasStarted(status)).toBe(started);
      expect(hasFinished(status)).toBe(finished);
    },
  );

  it("never finishes something that did not start", () => {
    for (const status of RUN_STAGE_STATUSES) {
      if (hasFinished(status)) {
        expect(hasStarted(status)).toBe(true);
      }
    }
  });
});
