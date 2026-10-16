import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { DomainError } from "../errors/error.envelope";
import { RUN_PUSH_ERRORS } from "./run-push.errors";
import {
  RUN_BRANCH_PATTERN,
  pushRefusal,
  type LatestGuardrail,
  type PushFacts,
} from "./run-push.policy";

/**
 * The push grant's database refusals (DI.2, #1310), in order — every one decided from rows,
 * none from the network.
 */

const BRANCH = "ouro/run-5eed0051-0000-4000-8000-000000000001-1";

/** Every check judged change-set 3, all passing. */
const EVALUATED: readonly LatestGuardrail[] = [
  { check: "allowed_paths", verdict: "pass", mode: "block", changeSetSeq: 3 },
  { check: "ci_config", verdict: "not_applicable", mode: "block", changeSetSeq: 3 },
  { check: "secrets", verdict: "pass", mode: "warn", changeSetSeq: 3 },
  { check: "review_required", verdict: "pass", mode: "block", changeSetSeq: null },
];

/** A push every rule lets through. */
function facts(overrides: Partial<PushFacts> = {}): PushFacts {
  return {
    branch: BRANCH,
    force: false,
    changeSetSeq: 3,
    runBranch: BRANCH,
    runChangeSetSeq: 3,
    defaultBranch: "main",
    guardrails: EVALUATED,
    githubConfigured: true,
    ...overrides,
  };
}

/** The same verdicts with one check replaced. */
function withCheck(row: LatestGuardrail): LatestGuardrail[] {
  return EVALUATED.map((existing) => (existing.check === row.check ? row : existing));
}

/** The code a refusal carries, or undefined. */
function codeOf(input: PushFacts): string | undefined {
  const refusal = pushRefusal(input);
  return refusal instanceof DomainError ? refusal.code : undefined;
}

describe("the push grant's refusals", () => {
  it("lets through a run branch whose evaluated change-set nothing blocks", () => {
    expect(pushRefusal(facts())).toBeUndefined();
  });

  it.each<[string, Partial<PushFacts>, string]>([
    ["a force push", { force: true }, RUN_PUSH_ERRORS.forcePushRefused],
    [
      "another branch than the run's",
      { branch: "ouro/run-other-1" },
      RUN_PUSH_ERRORS.branchMismatch,
    ],
    ["a run with no branch", { runBranch: null }, RUN_PUSH_ERRORS.branchMismatch],
    [
      "a run branch outside ouro/run-*",
      { branch: "loop/482-fix", runBranch: "loop/482-fix" },
      RUN_PUSH_ERRORS.notARunBranch,
    ],
    [
      "the default branch, even named as the run's",
      { branch: "main", runBranch: "main" },
      RUN_PUSH_ERRORS.notARunBranch,
    ],
    [
      "a default branch that is itself under ouro/run-*",
      { defaultBranch: BRANCH },
      RUN_PUSH_ERRORS.defaultBranch,
    ],
    [
      "a change-set older than the run's latest",
      { changeSetSeq: 2 },
      RUN_PUSH_ERRORS.changesNotEvaluated,
    ],
    [
      "a run that never reported a change-set",
      { changeSetSeq: 0, runChangeSetSeq: 0 },
      RUN_PUSH_ERRORS.changesNotEvaluated,
    ],
    [
      "a check never evaluated",
      { guardrails: EVALUATED.slice(1) },
      RUN_PUSH_ERRORS.changesNotEvaluated,
    ],
    [
      "a check still pending",
      {
        guardrails: withCheck({
          check: "secrets",
          verdict: "pending",
          mode: "warn",
          changeSetSeq: 3,
        }),
      },
      RUN_PUSH_ERRORS.changesNotEvaluated,
    ],
    [
      "a diff check that judged an earlier change-set",
      {
        guardrails: withCheck({
          check: "allowed_paths",
          verdict: "pass",
          mode: "block",
          changeSetSeq: 2,
        }),
      },
      RUN_PUSH_ERRORS.changesNotEvaluated,
    ],
    [
      "a block-mode fail",
      {
        guardrails: withCheck({
          check: "ci_config",
          verdict: "fail",
          mode: "block",
          changeSetSeq: 3,
        }),
      },
      RUN_PUSH_ERRORS.guardrailBlocking,
    ],
    [
      "a workspace with no GitHub token",
      { githubConfigured: false },
      RUN_PUSH_ERRORS.githubNotConfigured,
    ],
  ])("refuses %s", (_name, overrides, code) => {
    expect(codeOf(facts(overrides))).toBe(code);
  });

  it("shows a warn-mode fail and does not refuse for it (#315)", () => {
    const warned = withCheck({ check: "secrets", verdict: "fail", mode: "warn", changeSetSeq: 3 });

    expect(pushRefusal(facts({ guardrails: warned }))).toBeUndefined();
  });

  it("refuses in the documented order: force before everything else", () => {
    expect(
      codeOf(facts({ force: true, branch: "main", runBranch: null, githubConfigured: false })),
    ).toBe(RUN_PUSH_ERRORS.forcePushRefused);
    expect(codeOf(facts({ changeSetSeq: 1, githubConfigured: false }))).toBe(
      RUN_PUSH_ERRORS.changesNotEvaluated,
    );
  });

  it("names every blocking check, in the card's order", () => {
    const refusal = pushRefusal(
      facts({
        guardrails: [
          { check: "allowed_paths", verdict: "fail", mode: "block", changeSetSeq: 3 },
          { check: "ci_config", verdict: "pass", mode: "block", changeSetSeq: 3 },
          { check: "secrets", verdict: "fail", mode: "block", changeSetSeq: 3 },
          { check: "review_required", verdict: "pass", mode: "block", changeSetSeq: null },
        ],
      }),
    );

    expect(refusal?.message).toContain("allowed_paths, secrets guardrail checks block it");
  });

  it("names the branch in every refusal's sentence", () => {
    expect(pushRefusal(facts({ force: true }))?.message).toContain(BRANCH);
    expect(pushRefusal(facts({ githubConfigured: false }))?.message).toContain(BRANCH);
  });
});

describe("what a run branch is", () => {
  it.each([BRANCH, "ouro/run-1-482", "ouro/run-abc_DEF-1"])("accepts %s", (branch) => {
    expect(RUN_BRANCH_PATTERN.test(branch)).toBe(true);
  });

  it.each([
    "main",
    "ouro/run-",
    "ouro/run-x/y",
    "refs/heads/ouro/run-1",
    "ouro/runner-1",
    "+ouro/run-1",
  ])("refuses %s", (branch) => {
    expect(RUN_BRANCH_PATTERN.test(branch)).toBe(false);
  });
});

describe("the published contract", () => {
  it("names every push refusal in the internal document's push route", () => {
    const document = readFileSync(resolve(__dirname, "../../../openapi.internal.yaml"), "utf8");
    const push = document.slice(
      document.indexOf("  /internal/runs/{id}/push:"),
      document.indexOf("  /internal/runs/{id}/push/result:"),
    );

    for (const code of Object.values(RUN_PUSH_ERRORS)) {
      expect(push).toContain(code);
    }
  });
});
