import { CORE_RULE_IDS } from "../policies/org-policy.document";
import { GUARD_VOCABULARY, isKnownGuard } from "./copilot.guards";

describe("the guard vocabulary", () => {
  it("is exactly the org policy's core rules, each described", () => {
    expect(GUARD_VOCABULARY.map((guard) => guard.name)).toEqual([...CORE_RULE_IDS]);
    for (const guard of GUARD_VOCABULARY) expect(guard.description.length).toBeGreaterThan(10);
  });

  it("knows spend_guard and nothing invented", () => {
    expect(isKnownGuard("spend_guard")).toBe(true);
    expect(isKnownGuard("time_guard")).toBe(false);
  });
});
