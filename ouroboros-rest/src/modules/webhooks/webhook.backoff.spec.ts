import { BACKOFF_BASE_MS, BACKOFF_CAP_MS, retryDelayMs } from "./webhook.backoff";

/** Exponential, capped, jittered within ±10% (#487). */

const MIDDLE = () => 0.5;

describe("the retry delay", () => {
  it("doubles from thirty seconds", () => {
    expect([1, 2, 3, 4, 5].map((attempt) => retryDelayMs(attempt, MIDDLE))).toEqual([
      30_000, 60_000, 120_000, 240_000, 480_000,
    ]);
  });

  it("is capped at an hour, however many attempts", () => {
    expect(retryDelayMs(12, MIDDLE)).toBe(BACKOFF_CAP_MS);
    expect(retryDelayMs(1000, MIDDLE)).toBe(BACKOFF_CAP_MS);
  });

  it("jitters within ten percent either way", () => {
    expect(retryDelayMs(1, () => 0)).toBe(BACKOFF_BASE_MS * 0.9);
    expect(retryDelayMs(1, () => 0.999999)).toBeLessThanOrEqual(BACKOFF_BASE_MS * 1.1);
  });
});
