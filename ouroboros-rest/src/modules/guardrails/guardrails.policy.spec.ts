import { readFixture } from "../workflows/dsl.golden.fixture";
import {
  asQueueEffort,
  countVoteRules,
  readPinnedPolicy,
  resolvePermissions,
  reviewPolicy,
  type PinnedPolicy,
} from "./guardrails.policy";

/**
 * The pinned policy, read — from the product's own `standard-fix` document, the one mockup 10's
 * run pins.
 */

const STANDARD_FIX = readFixture("valid/standard-fix.json");

describe("readPinnedPolicy", () => {
  it("reads every model stage's touch_ci and the auto-merge terminal from standard-fix", () => {
    const policy = readPinnedPolicy(STANDARD_FIX);

    expect(policy?.autoMerges).toBe(true);
    expect([...(policy?.touchCi ?? [])]).toEqual([
      ["analyze", false],
      ["plan", false],
      ["split", false],
      ["implement", false],
      ["review", false],
    ]);
  });

  it("is undefined for something that is not a workflow document", () => {
    expect(readPinnedPolicy({ nodes: "no" })).toBeUndefined();
    expect(readPinnedPolicy(null)).toBeUndefined();
  });

  it("sees no auto-merge in a document whose terminal routes to review", () => {
    const document = structuredClone(STANDARD_FIX) as {
      nodes: { id: string; config: Record<string, unknown> }[];
    };
    const terminal = document.nodes.find((node) => node.id === "open-pr");

    if (terminal !== undefined) {
      terminal.config = { action: "needs_review", options: {} };
    }

    expect(readPinnedPolicy(document)?.autoMerges).toBe(false);
  });
});

describe("resolvePermissions", () => {
  const policy: PinnedPolicy = {
    touchCi: new Map([
      ["plan", false],
      ["implement", true],
      ["review", false],
    ]),
    autoMerges: true,
  };

  it("uses the most recently reported model stage", () => {
    expect(resolvePermissions(policy, ["build", "implement", "plan"])).toEqual({
      stageKey: "implement",
      touchCi: true,
    });
  });

  it("falls back to the most restrictive stage when no model stage has reported", () => {
    expect(resolvePermissions(policy, ["issue-queued"])).toEqual({
      stageKey: "plan",
      touchCi: false,
    });
  });

  it("allows CI only when every model stage does, if none has reported", () => {
    const permissive: PinnedPolicy = { touchCi: new Map([["implement", true]]), autoMerges: true };

    expect(resolvePermissions(permissive, [])).toEqual({ stageKey: "implement", touchCi: true });
  });

  it("is undefined for a document with no model stage", () => {
    expect(resolvePermissions({ touchCi: new Map(), autoMerges: true }, [])).toBeUndefined();
  });
});

describe("countVoteRules", () => {
  const vote = { add_vote: { task_kind: "review", alias: "second-opinion" } };
  const local = { route_local: {} };

  it("counts add_vote rules whose predicate matches the ticket, and nothing else", () => {
    const rules = [
      { when: { label: "security" }, then: vote },
      { when: { effort_gte: "l" as const }, then: vote },
      { when: { label: "security" }, then: local },
      { when: { diff_kind: "docs_only" as const }, then: vote },
    ];

    expect(countVoteRules(rules, { labels: ["security"], effort: "m" })).toBe(1);
    expect(countVoteRules(rules, { labels: ["security"], effort: "xl" })).toBe(2);
    expect(countVoteRules(rules, { labels: [] })).toBe(0);
  });
});

describe("reviewPolicy and asQueueEffort", () => {
  it("is undefined when the pin could not be read", () => {
    expect(reviewPolicy(undefined, 2)).toBeUndefined();
    expect(reviewPolicy({ touchCi: new Map(), autoMerges: true }, 2)).toEqual({
      autoMerges: true,
      voteRules: 2,
    });
  });

  it("narrows the five sizes and nothing else", () => {
    expect(asQueueEffort("l")).toBe("l");
    expect(asQueueEffort("huge")).toBeUndefined();
    expect(asQueueEffort(undefined)).toBeUndefined();
  });
});
