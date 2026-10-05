import {
  ACTION_FILTER_PATTERN,
  REFERENCE_PATTERN,
  filterFacts,
  parseActionFilter,
  parseReference,
  referenceText,
} from "./audit-plane.filter";

/** The audit plane's filter spellings (#486) — one parser, so list and export read alike. */
describe("the action filter", () => {
  it.each(["policy.*", "policy.published", "pr_merge_plan.armed", "credential.*"])(
    "accepts %p",
    (text) => {
      expect(ACTION_FILTER_PATTERN.test(text)).toBe(true);
    },
  );

  it.each(["policy", "*", "policy.*.x", "Policy.published", "policy.%", "policy.pub lished"])(
    "refuses %p",
    (text) => {
      expect(ACTION_FILTER_PATTERN.test(text)).toBe(false);
    },
  );

  it("splits a wildcard into its plane, and an exact action into plane and action", () => {
    expect(parseActionFilter("policy.*")).toEqual({ plane: "policy" });
    expect(parseActionFilter("policy.published")).toEqual({
      plane: "policy",
      action: "policy.published",
    });
  });
});

describe("the reference search", () => {
  it.each(["pr:509", "run:5eed0010-0000-4000-8000-000000000471", "repo:acme/helios", "key:abc"])(
    "accepts %p",
    (text) => {
      expect(REFERENCE_PATTERN.test(text)).toBe(true);
    },
  );

  it.each(["509", "pr:", "branch:main", "pr:5 09", "run:a,b", `subject:${"x".repeat(201)}`])(
    "refuses %p",
    (text) => {
      expect(REFERENCE_PATTERN.test(text)).toBe(false);
    },
  );

  it("parses each kind — a key is its connection, the event's subject", () => {
    expect(parseReference("pr:509")).toEqual({ kind: "pr", number: 509 });
    expect(parseReference("run:r-1")).toEqual({ kind: "run", value: "r-1" });
    expect(parseReference("repo:acme/helios")).toEqual({ kind: "repo", value: "acme/helios" });
    expect(parseReference("key:conn-1")).toEqual({ kind: "subject", value: "conn-1" });
    expect(parseReference("subject:x")).toEqual({ kind: "subject", value: "x" });
  });

  it("refuses a pr: that names no positive number", () => {
    expect(parseReference("pr:0")).toBeUndefined();
    expect(parseReference("pr:abc")).toBeUndefined();
    expect(parseReference("pr:00509")).toBeUndefined();
    expect(parseReference("pr:99999999999")).toBeUndefined();
  });

  it("spells a reference back as the query string carries it", () => {
    expect(referenceText({ kind: "pr", number: 509 })).toBe("pr:509");
    expect(referenceText({ kind: "run", value: "r-1" })).toBe("run:r-1");
  });
});

describe("the facts an export records", () => {
  it("records every dimension that was set, as flat strings", () => {
    expect(
      filterFacts({
        from: new Date("2026-07-01T00:00:00.000Z"),
        to: new Date("2026-10-01T00:00:00.000Z"),
        actorKind: "bot",
        actorService: "ouroboros-app",
        plane: "policy",
        ref: { kind: "pr", number: 509 },
      }),
    ).toEqual({
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-10-01T00:00:00.000Z",
      actor_kind: "bot",
      actor_service: "ouroboros-app",
      action: "policy.*",
      ref: "pr:509",
    });
  });

  it("records an exact action as itself, and nothing for an unset dimension", () => {
    expect(filterFacts({ plane: "policy", action: "policy.published", actorId: "u" })).toEqual({
      action: "policy.published",
      actor_id: "u",
    });
    expect(filterFacts({})).toEqual({});
  });
});
