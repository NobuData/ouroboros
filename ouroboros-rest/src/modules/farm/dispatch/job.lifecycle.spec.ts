import { AUTOMATIC_RETRIES } from "./dispatch.policy";
import { infrastructureOutcome } from "./job.lifecycle";

/**
 * The retry policy (#252): *requeue once, then terminal failure*. The statements beside it —
 * numbering, the attempt walk and the retry insert — run against PostgreSQL in
 * `dispatch.integration-spec.ts`.
 */
describe("the retry policy", () => {
  it("retries an infrastructure failure exactly once", () => {
    expect(AUTOMATIC_RETRIES).toBe(1);
    expect(infrastructureOutcome(1)).toBe("retried");
    expect(infrastructureOutcome(2)).toBe("failed");
  });

  it("never retries an attempt past the bound, however long the chain", () => {
    for (const attempt of [3, 4, 64]) expect(infrastructureOutcome(attempt)).toBe("failed");
  });
});
