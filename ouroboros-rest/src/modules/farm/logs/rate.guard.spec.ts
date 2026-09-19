import { LOG_ORG_BURST_BYTES, LOG_ORG_RATE_BYTES_PER_S } from "./log.policy";
import { RateGuard } from "./rate.guard";

/** The per-workspace rate guard (#253): a token bucket per workspace, and nothing shared. */
describe("the ingest rate guard", () => {
  it("admits a burst, then refuses what the bucket cannot pay for", () => {
    const guard = new RateGuard(1_000, 4_000);

    expect(guard.admit("org-a", 3_000, 0)).toBe(true);
    expect(guard.admit("org-a", 1_000, 0)).toBe(true);
    expect(guard.admit("org-a", 1, 0)).toBe(false);
  });

  it("refills at its rate, up to the burst and no further", () => {
    const guard = new RateGuard(1_000, 4_000);
    guard.admit("org-a", 4_000, 0);

    expect(guard.admit("org-a", 1_500, 1_000)).toBe(false);
    expect(guard.admit("org-a", 1_500, 1_500)).toBe(true);
    expect(guard.admit("org-a", 4_001, 60_000)).toBe(false);
    expect(guard.admit("org-a", 4_000, 60_000)).toBe(true);
  });

  it("keeps one workspace's runaway from spending another's share", () => {
    const guard = new RateGuard(1_000, 4_000);
    guard.admit("org-runaway", 4_000, 0);

    expect(guard.admit("org-runaway", 10, 0)).toBe(false);
    expect(guard.admit("org-quiet", 4_000, 0)).toBe(true);
  });

  it("is never paid back by a clock that went backwards", () => {
    const guard = new RateGuard(1_000, 4_000);
    guard.admit("org-a", 4_000, 10_000);

    expect(guard.admit("org-a", 1, 5_000)).toBe(false);
  });

  it("forgets a workspace whose bucket has refilled, and keeps one still paying", () => {
    const guard = new RateGuard(1_000, 4_000);
    guard.admit("org-idle", 4_000, 0);
    guard.admit("org-busy", 4_000, 3_000);

    guard.prune(4_000);

    // org-busy is still short, so pruning kept its debt; org-idle starts over as a fresh bucket.
    expect(guard.admit("org-busy", 2_000, 4_000)).toBe(false);
    expect(guard.admit("org-idle", 4_000, 4_000)).toBe(true);
  });

  it("defaults to eight agents' worth of rate and an 8 MiB burst", () => {
    expect(LOG_ORG_RATE_BYTES_PER_S).toBe(2 * 1_048_576);
    expect(LOG_ORG_BURST_BYTES).toBe(8 * 1_048_576);
    expect(new RateGuard().admit("org-a", LOG_ORG_BURST_BYTES, 0)).toBe(true);
  });
});
