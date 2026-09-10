import { fanout } from "./estimation.resources";

/**
 * The fan-out's three numbers ([#108](https://github.com/NobuData/ouroboros/issues/108)).
 *
 * Small enough to look like arithmetic not worth testing, and it is the one place this ticket
 * can quietly report something untrue: `skipped` is what a confirmation dialog shows a person
 * to explain why *Re-estimate all* took fewer issues than it offered to.
 */

describe("what one Re-estimate all took", () => {
  it("reports the whole backlog when it claimed all of it", () => {
    expect(fanout(9, 9)).toEqual({ enqueued: 9, skipped: 0, total: 9 });
  });

  it("counts everything it did not take as skipped", () => {
    // Defined as the remainder rather than counted separately, so the three numbers cannot
    // disagree with each other — which is what makes them safe to render in one sentence.
    expect(fanout(9, 7)).toEqual({ enqueued: 7, skipped: 2, total: 9 });
  });

  it("reports zeros for an empty backlog", () => {
    // Not a failure: *your backlog is empty* is a state N.6 (#120) renders, and it is a
    // different one from *your backlog is busy*, which is a 409.
    expect(fanout(0, 0)).toEqual({ enqueued: 0, skipped: 0, total: 0 });
  });

  it("never reports a negative skip", () => {
    // An issue mirrored between the count and the claim is claimed and queued, which can push
    // `enqueued` past a `total` read a moment earlier. A negative count in a dialog would be a
    // worse answer than a rounded one.
    expect(fanout(9, 10)).toEqual({ enqueued: 10, skipped: 0, total: 9 });
  });
});
