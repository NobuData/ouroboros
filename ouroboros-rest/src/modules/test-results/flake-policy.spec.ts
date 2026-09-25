import type { TestAttemptOutcome } from "../db/schema";
import {
  MAX_SANCTIONED_RETRIES,
  NO_RETRIES,
  applyFlakePolicy,
  parseFlakePolicy,
} from "./flake-policy";

/**
 * Decision T5 (#329): a pass-on-retry is `flaky` only when the policy sanctioned that retry.
 */
describe("parseFlakePolicy", () => {
  it.each([
    ["none", 0],
    ["retry-once", 1],
    ["retry-twice", 2],
    ["retry-0", 0],
    ["retry-3", 3],
    [`retry-${MAX_SANCTIONED_RETRIES}`, MAX_SANCTIONED_RETRIES],
  ])("reads %s as %i sanctioned retries", (spelling, n) => {
    expect(parseFlakePolicy(spelling)).toEqual({ sanctionedRetries: n });
  });

  it.each(["", "retry", "retry-11", "retry--1", "retry-1.5", "Retry-once", "always"])(
    "refuses %j rather than defaulting",
    (spelling) => {
      expect(() => parseFlakePolicy(spelling)).toThrow(RangeError);
    },
  );
});

describe("applyFlakePolicy", () => {
  const once = parseFlakePolicy("retry-once");

  it.each<
    [string, TestAttemptOutcome[], number, string, TestAttemptOutcome[], TestAttemptOutcome[]]
  >([
    ["passed first time", ["passed"], 1, "passed", ["passed"], []],
    [
      "a sanctioned pass-on-retry is flaky",
      ["failed", "passed"],
      1,
      "flaky",
      ["failed", "passed"],
      [],
    ],
    ["an error then a pass is flaky", ["error", "passed"], 1, "flaky", ["error", "passed"], []],
    [
      "an unsanctioned pass-on-retry is failed",
      ["failed", "passed"],
      0,
      "failed",
      ["failed"],
      ["passed"],
    ],
    [
      "a pass past the budget is failed",
      ["failed", "failed", "passed"],
      1,
      "failed",
      ["failed", "failed"],
      ["passed"],
    ],
    [
      "every attempt failing is failed",
      ["failed", "failed"],
      1,
      "failed",
      ["failed", "failed"],
      [],
    ],
    ["an error last is error", ["failed", "error"], 1, "error", ["failed", "error"], []],
    ["a skip is skipped, never retried", ["skipped"], 1, "skipped", ["skipped"], []],
    [
      "skips among runs are not attempts",
      ["skipped", "failed", "passed"],
      1,
      "flaky",
      ["failed", "passed"],
      [],
    ],
    [
      "a pass repeated is still passed",
      ["passed", "passed"],
      1,
      "passed",
      ["passed", "passed"],
      [],
    ],
  ])("%s", (_label, raw, sanctionedRetries, status, outcomes, unsanctioned) => {
    const truth = applyFlakePolicy(raw, { sanctionedRetries });

    expect(truth).toEqual({ status, retries: outcomes.length - 1, outcomes, unsanctioned });
  });

  it("never calls anything flaky under the default policy", () => {
    expect(applyFlakePolicy(["failed", "passed"], NO_RETRIES).status).toBe("failed");
    expect(applyFlakePolicy(["failed", "failed", "passed"], once).status).toBe("failed");
  });

  it("refuses a case with no attempts and a policy that is not a whole number", () => {
    expect(() => applyFlakePolicy([], once)).toThrow(RangeError);
    expect(() => applyFlakePolicy(["passed"], { sanctionedRetries: -1 })).toThrow(RangeError);
    expect(() => applyFlakePolicy(["passed"], { sanctionedRetries: 1.5 })).toThrow(RangeError);
  });
});
