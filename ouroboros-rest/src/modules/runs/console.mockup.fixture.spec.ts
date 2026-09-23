import { readFileSync } from "node:fs";

import { MOCKUP_PATH, readMockup, seconds } from "./console.mockup.fixture";

/**
 * The mockup parser AP.6's parity suite rests on
 * ([#308](https://github.com/NobuData/ouroboros/issues/308)).
 *
 * The integration suite compares the console page against whatever this parser reads, so a
 * parser that read nothing — or read the wrong row — would make that suite pass vacuously. This
 * pins what the committed mockup says today, and that a markup change the parser cannot follow
 * is an error rather than a silent `undefined`.
 */
describe("readMockup", () => {
  const mockup = readMockup();

  it("reads the page head", () => {
    expect(mockup).toMatchObject({
      loopSeq: 1847,
      issueNumber: 482,
      issueTitle: "Fix flaky CAN-bus telemetry test",
      status: "coding",
      workflowTag: "standard-fix",
      workflowVersion: 14,
      model: "claude-fable-5",
      elapsedSeconds: 760,
      branchName: "loop/482-canbus-flake",
    });
  });

  it("reads all eight stepper nodes, with captions, the attempt and the note", () => {
    expect(mockup.stages.map((stage) => [stage.state, stage.label])).toEqual([
      ["done", "Queued"],
      ["done", "Analyze"],
      ["done", "Plan"],
      ["active", "Implement"],
      ["pending", "Build"],
      ["pending", "Test"],
      ["pending", "Review"],
      ["pending", "Open PR"],
    ]);
    expect(mockup.stages.slice(0, 3).map((stage) => stage.durationSeconds)).toEqual([4, 72, 125]);
    expect(mockup.stages[3]).toEqual({
      state: "active",
      label: "Implement",
      attempt: { current: 2, max: 3 },
      note: "attempt 1 failed tests — loop returned from gate ↺",
    });
  });

  it("reads the nine transcript chips", () => {
    expect(mockup.transcript).toEqual([
      { actor: "plan" },
      { actor: "tool", toolTag: "read_file" },
      { actor: "model", modelId: "claude-fable-5" },
      { actor: "tool", toolTag: "edit_file" },
      { actor: "tool", toolTag: "run_tests" },
      { actor: "gate" },
      { actor: "model", modelId: "claude-fable-5" },
      { actor: "tool", toolTag: "edit_file" },
      { actor: "tool", toolTag: "run_tests" },
    ]);
  });

  it("reads the three cards", () => {
    expect(mockup.files).toEqual([
      { path: "drivers/can/telemetry_buf.c", additions: 38, deletions: 12 },
      { path: "drivers/can/isr_fastpath.c", additions: 9, deletions: 3 },
      { path: "tests/telemetry/test_frame_order.c", additions: 21, deletions: 0 },
    ]);
    expect(mockup.commits.map((commit) => commit.shortSha)).toEqual(["a41c9e2", "7f03b8d"]);
    expect(mockup.mergeStrategy).toBe("squash");
    expect(mockup.tokens).toEqual({ used: 212_000, budget: 400_000 });
    expect(mockup.cost).toEqual({ costCents: 114, capCents: 250 });
    expect(mockup.farmRunner).toBe("forge-02");
    expect(mockup.guardrailStatus).toBe("clean");
    expect(mockup.guardrails).toEqual([
      { check: "allowed_paths", verdict: "pass" },
      { check: "ci_config", verdict: "pass" },
      { check: "secrets", verdict: "pass" },
      { check: "review_required", verdict: "not_applicable" },
    ]);
    expect(mockup.policy).toEqual({
      workflowTag: "standard-fix",
      workflowVersion: 14,
      tenant: "acme-robotics",
    });
  });

  it("follows an edit to the mockup, so a drift reaches the parity suite", () => {
    const html = readFileSync(MOCKUP_PATH, "utf8").replace(
      "212k / 400k budget",
      "250k / 400k budget",
    );

    expect(readMockup(html).tokens.used).toBe(250_000);
  });

  it("throws, naming the value, when the markup no longer draws it", () => {
    const html = readFileSync(MOCKUP_PATH, "utf8").replace(/Policy: [^<]*/, "");

    expect(() => readMockup(html)).toThrow("the policy footer");
  });

  it("throws on a guardrail mark nobody mapped", () => {
    const html = readFileSync(MOCKUP_PATH, "utf8").replace(
      '<span class="mark ok">✓</span>',
      '<span class="mark ok">?</span>',
    );

    expect(() => readMockup(html)).toThrow("a mark nobody mapped");
  });

  it("reads a duration as seconds, and refuses one it cannot", () => {
    expect(seconds("0m 04s")).toBe(4);
    expect(seconds("12m 40s")).toBe(760);
    expect(() => seconds("soon")).toThrow("a duration");
  });
});
