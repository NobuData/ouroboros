import { CONTINUATION_DELAY_MS, SOURCE_CONCURRENCY } from "./cadence";
import {
  CONTINUATION_DELAY_MS as BACKLOG_CONTINUATION_DELAY_MS,
  REPO_CONCURRENCY,
} from "../backlog-sync/cadence";

/**
 * Two numbers ([#139](https://github.com/NobuData/ouroboros/issues/139)), and what is worth
 * asserting about each is its *relationship* to the loop that came before rather than its
 * value: `cadence.ts` argues both, and a value that drifted away from the argument without the
 * argument changing is the failure worth catching.
 */

describe("the ticket source cadence", () => {
  it("resumes a capped import as fast as the backlog sync does", () => {
    // Two background loops that resume at different speeds for no stated reason are two
    // numbers somebody later has to reconcile. If one of them moves, this is where the
    // decision gets made again.
    expect(CONTINUATION_DELAY_MS).toBe(BACKLOG_CONTINUATION_DELAY_MS);
  });

  it("does not spin, which is what a zero delay would be", () => {
    expect(CONTINUATION_DELAY_MS).toBeGreaterThan(0);
  });

  it("spreads a cycle no wider than the loop it generalizes", () => {
    // These are requests against somebody else's API budget, one credential at a time. The
    // bound is per source rather than per workspace — see `cadence.ts` — but it is not looser.
    expect(SOURCE_CONCURRENCY).toBe(REPO_CONCURRENCY);
    expect(SOURCE_CONCURRENCY).toBeGreaterThan(0);
  });
});
