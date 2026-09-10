import { ISSUE_ESTIMATE_EFFORTS, QUEUE_EFFORTS, type QueueItem } from "../db/schema";
import {
  MAX_QUEUE_EST_MINUTES,
  MIN_QUEUE_EST_MINUTES,
  queueEffort,
  queueEstMinutes,
  queuedSelection,
} from "./queue.resources";

/**
 * The mapping, which is the contract, and the two reconciliations a queue write has to make
 * (M.3, [#112](https://github.com/NobuData/ouroboros/issues/112)).
 *
 * V026 and V009 declared the same two facts with different bounds, and the intake roadmap left
 * reconciling them to this ticket *"at the statement that copies one into the other"*. Both
 * rules are pure functions precisely so they can be stated here, without a database:
 *
 *   * the effort scale, which is five values in both places and two types on purpose, and
 *   * the estimate, which V026 lets run to 100 000 and V009 holds to `1 … 20160` or null.
 */

/** One inserted row, as `returning *` hands it back. */
function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "b0b0b0b0-0000-4000-8000-000000000001",
    organization_id: "acme-robotics-id",
    github_repo_id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
    issue_number: 485,
    issue_title: "Watchdog reset on I²C bus lockup",
    effort: "m",
    workflow_tag: "standard-fix",
    position: 4,
    est_minutes: 45,
    enqueued_at: new Date("2026-09-10T15:41:12.000Z"),
    created_at: new Date("2026-09-10T15:41:12.000Z"),
    updated_at: new Date("2026-09-10T15:41:12.000Z"),
    ...overrides,
  };
}

describe("the effort a queue row carries", () => {
  it("is the estimate's own chip, for every size either scale has", () => {
    // Two types deliberately — `schema.ts` says a shared declaration would make widening one
    // silently widen the other — so this is the one place they are checked against each other.
    for (const effort of ISSUE_ESTIMATE_EFFORTS) {
      expect(queueEffort(effort)).toBe(effort);
    }
  });

  it("maps onto the five chips V009 will accept and no others", () => {
    const mapped = ISSUE_ESTIMATE_EFFORTS.map(queueEffort);

    expect(new Set(mapped)).toEqual(new Set(QUEUE_EFFORTS));
  });
});

describe("the estimate a queue row carries", () => {
  it("is the breakdown's number, copied", () => {
    // The acceptance criterion: `est_minutes` comes from the estimate breakdown, not from a
    // recomputation off the effort chip.
    expect(queueEstMinutes(45)).toBe(45);
  });

  it("takes both ends of what the column will hold", () => {
    expect(queueEstMinutes(MIN_QUEUE_EST_MINUTES)).toBe(1);
    expect(queueEstMinutes(MAX_QUEUE_EST_MINUTES)).toBe(20_160);
  });

  it("writes null rather than zero for an estimate of no minutes", () => {
    // V026 permits `0` and V009 refuses it, because zero would claim the loop finishes the
    // issue instantly. `null` is the column's own word for *not estimated*, and `sum` skips it.
    expect(queueEstMinutes(0)).toBeNull();
  });

  it("writes null rather than clamping an estimate past a fortnight", () => {
    // Clamping would publish a number no estimator produced and would make the *Queued issues*
    // stat quietly wrong in the direction that looks fine.
    expect(queueEstMinutes(MAX_QUEUE_EST_MINUTES + 1)).toBeNull();
    expect(queueEstMinutes(100_000)).toBeNull();
  });
});

describe("what a queue write answers with", () => {
  it("publishes the created rows in the queue's own shape", () => {
    // The same mapper `GET /api/v1/queue` and the dashboard card use, which is what makes the
    // cross-roadmap criterion structural rather than a coincidence two mappers agree on today.
    expect(queuedSelection([item()])).toEqual({
      items: [
        {
          id: "b0b0b0b0-0000-4000-8000-000000000001",
          issueNumber: 485,
          issueTitle: "Watchdog reset on I²C bus lockup",
          effort: "m",
          workflowTag: "standard-fix",
          position: 4,
          estMinutes: 45,
          enqueuedAt: "2026-09-10T15:41:12.000Z",
        },
      ],
      estMinutes: 45,
    });
  });

  it("combines the estimates into the number the action bar renders", () => {
    // Mockup 03's three selected rows, as the seed sizes them: 45 + 50 + 30.
    const selection = queuedSelection([
      item({ issue_number: 485, est_minutes: 45, position: 1 }),
      item({ issue_number: 484, est_minutes: 50, position: 2 }),
      item({ issue_number: 491, est_minutes: 30, position: 3 }),
    ]);

    expect(selection.items).toHaveLength(3);
    expect(selection.estMinutes).toBe(125);
  });

  it("keeps the rows in the order they were appended", () => {
    const selection = queuedSelection([
      item({ issue_number: 485, position: 1 }),
      item({ issue_number: 484, position: 2 }),
    ]);

    expect(selection.items.map((queued) => queued.position)).toEqual([1, 2]);
  });

  it("skips an item with no estimate rather than counting it as zero", () => {
    // So `items.length` may speak for more issues than `estMinutes` does — the honest shape of
    // a queue holding something nobody could size, and the same sentence the stat row is.
    const selection = queuedSelection([item({ est_minutes: 45 }), item({ est_minutes: null })]);

    expect(selection.items).toHaveLength(2);
    expect(selection.estMinutes).toBe(45);
  });

  it("answers zero minutes for rows that carry no estimate at all", () => {
    expect(queuedSelection([item({ est_minutes: null })]).estMinutes).toBe(0);
  });
});
