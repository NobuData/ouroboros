import { FACT_STATUSES, type FactStatus } from "../db/schema";
import {
  FACT_TRANSITIONS,
  isLegalTransition,
  requiresActor,
  transitionRefusal,
} from "./facts.lifecycle";

/**
 * The fact state machine (#411, K3) — held edge by edge to V071's `facts_guard_transition`, so the
 * service's refusal and the database's are the same set.
 */

/** V071's legal edges, spelled out from the trigger's `in (…)` list. */
const V071_EDGES: readonly (readonly [FactStatus, FactStatus])[] = [
  ["proposed", "confirmed"],
  ["proposed", "rejected"],
  ["confirmed", "stale"],
  ["stale", "expired"],
  ["stale", "confirmed"],
];

/** Every ordered pair of statuses. */
const ALL_PAIRS = FACT_STATUSES.flatMap((from) => FACT_STATUSES.map((to) => [from, to] as const));

describe("the fact lifecycle", () => {
  it.each(ALL_PAIRS)("answers %s → %s exactly as V071 does", (from, to) => {
    const legal = V071_EDGES.some(([a, b]) => a === from && b === to);

    expect(isLegalTransition(from, to)).toBe(legal);
    expect(transitionRefusal(from, to) === null).toBe(legal);
  });

  it("lists every status, and nothing leaves rejected or expired", () => {
    expect([...FACT_TRANSITIONS.keys()].sort()).toEqual([...FACT_STATUSES].sort());
    expect(FACT_TRANSITIONS.get("rejected")).toEqual([]);
    expect(FACT_TRANSITIONS.get("expired")).toEqual([]);
  });

  it("has no confirmed → expired edge — manual expire goes through stale", () => {
    expect(isLegalTransition("confirmed", "expired")).toBe(false);
    expect(isLegalTransition("confirmed", "stale")).toBe(true);
    expect(isLegalTransition("stale", "expired")).toBe(true);
  });

  it.each([
    ["expired", "confirmed", /Re-learn it instead/],
    ["expired", "proposed", /frozen/],
    ["rejected", "confirmed", /final/],
    ["proposed", "expired", /rejected instead/],
    ["proposed", "stale", /Only a confirmed fact can go stale/],
    ["confirmed", "rejected", /Only a proposal can be rejected/],
    ["confirmed", "confirmed", /already confirmed/],
    ["stale", "rejected", /Only a proposal can be rejected/],
  ] as const)("states why %s → %s is refused", (from, to, reason) => {
    expect(transitionRefusal(from, to)).toMatch(reason);
  });

  it.each([
    ["confirmed", true],
    ["rejected", true],
    ["expired", true],
    ["stale", false],
    ["proposed", false],
  ] as const)("needs a person for %s: %s", (to, needed) => {
    expect(requiresActor(to)).toBe(needed);
  });
});
