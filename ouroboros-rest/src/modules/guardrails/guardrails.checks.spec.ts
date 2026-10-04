import { GUARDRAIL_CHECKS, type GuardrailCheck } from "../db/schema";
import {
  checkAllowedPaths,
  checkCiConfig,
  checkReviewRequired,
  checkSecrets,
  evaluateGuardrails,
  exceptionsSpent,
  type GuardrailInput,
  type GuardrailVerdictRow,
} from "./guardrails.checks";
import { CI_REGISTRY_VERSION } from "./guardrails.ci";
import { AWS_ACCESS_KEY_ID } from "./guardrails.fixture";
import { MOCKUP_INPUT, RULE_MATRIX } from "./guardrails.matrix.fixture";
import { SECRETS_RULESET_VERSION } from "./guardrails.ruleset";

/**
 * The four checks, driven by the rule matrix — every check × `pass` / `fail` / `not_applicable`.
 */

const CHECKS: Record<GuardrailCheck, (input: GuardrailInput) => GuardrailVerdictRow> = {
  allowed_paths: checkAllowedPaths,
  ci_config: checkCiConfig,
  secrets: checkSecrets,
  review_required: checkReviewRequired,
};

describe("the rule matrix", () => {
  it("covers every check with a pass, a fail and a not-applicable", () => {
    for (const check of GUARDRAIL_CHECKS) {
      const verdicts = new Set(
        RULE_MATRIX.filter((cell) => cell.check === check).map((cell) => cell.verdict),
      );

      expect([...verdicts].sort()).toEqual(["fail", "not_applicable", "pass"]);
    }
  });

  it.each(RULE_MATRIX.map((cell) => [cell.check, cell.verdict, cell.because, cell] as const))(
    "%s is %s when %s",
    (check, verdict, _because, cell) => {
      const row = CHECKS[check](cell.input);

      expect(row.check).toBe(check);
      expect(row.verdict).toBe(verdict);

      if (cell.evidence !== undefined) {
        expect(row.evidence).toEqual(cell.evidence);
      }
    },
  );
});

describe("allow-once grants (#459)", () => {
  const PROTECTED: GuardrailInput = {
    changeSetSeq: 4,
    files: [{ path: "boot/rollback_flag.c" }],
    planFiles: ["boot/rollback_flag.c"],
    protectedPaths: ["boot/**"],
  };

  it("spends the grant a passing allowed_paths relied on, once even when it covers two paths", () => {
    const input: GuardrailInput = {
      ...PROTECTED,
      files: [{ path: "boot/rollback_flag.c" }, { path: "boot/rollback_flag.h" }],
      planFiles: ["boot/rollback_flag.c", "boot/rollback_flag.h"],
      exceptions: [{ id: "grant-a", pathGlob: "boot/rollback_flag.*" }],
    };
    const row = checkAllowedPaths(input);

    expect(row.verdict).toBe("pass");
    expect(row.evidence?.detail).toBe("2 protected paths allowed once by exception.");
    expect(exceptionsSpent(input, row)).toEqual(["grant-a"]);
  });

  it("uses the oldest grant whose glob matches, and leaves the others unspent", () => {
    const input: GuardrailInput = {
      ...PROTECTED,
      exceptions: [
        { id: "grant-other", pathGlob: "boot/mcuboot.conf" },
        { id: "grant-old", pathGlob: "boot/rollback_flag.c" },
        { id: "grant-new", pathGlob: "boot/rollback_flag.c" },
      ],
    };

    expect(exceptionsSpent(input, checkAllowedPaths(input))).toEqual(["grant-old"]);
  });

  it("spends nothing when the verdict fails for another reason — the grant is kept for the retry", () => {
    const input: GuardrailInput = {
      ...PROTECTED,
      files: [{ path: "boot/rollback_flag.c" }, { path: "drivers/spi/bus.c" }],
      exceptions: [{ id: "grant-a", pathGlob: "boot/rollback_flag.c" }],
    };
    const row = checkAllowedPaths(input);

    expect(row.verdict).toBe("fail");
    expect(row.evidence?.path).toBe("drivers/spi/bus.c");
    expect(exceptionsSpent(input, row)).toEqual([]);
  });

  it("spends nothing for a pass no grant was needed for, or for another check's row", () => {
    const clean: GuardrailInput = {
      ...PROTECTED,
      files: [{ path: "drivers/can/a.c" }],
      planFiles: ["drivers/can/a.c"],
      exceptions: [{ id: "grant-a", pathGlob: "boot/rollback_flag.c" }],
    };
    const covered: GuardrailInput = {
      ...clean,
      files: PROTECTED.files,
      planFiles: PROTECTED.planFiles,
    };

    expect(exceptionsSpent(clean, checkAllowedPaths(clean))).toEqual([]);
    expect(checkAllowedPaths(clean).evidence).toBeNull();
    expect(exceptionsSpent(covered, checkCiConfig(covered))).toEqual([]);
  });

  it("refuses the protected path once no live grant is offered — the second attempt is blocked", () => {
    const row = checkAllowedPaths({ ...PROTECTED, exceptions: [] });

    expect(row.verdict).toBe("fail");
    expect(row.evidence?.detail).toBe("1 path inside a protected path.");
  });
});

describe("what a verdict records", () => {
  it("numbers change-set checks by the report, and leaves review_required unnumbered", () => {
    const rows = evaluateGuardrails(MOCKUP_INPUT);

    expect(rows.map((row) => [row.check, row.changeSetSeq])).toEqual([
      ["allowed_paths", 3],
      ["ci_config", 3],
      ["secrets", 3],
      ["review_required", null],
    ]);
  });

  it("is the mockup's card for mockup 10's run: three passes and the ○", () => {
    expect(evaluateGuardrails(MOCKUP_INPUT).map((row) => row.verdict)).toEqual([
      "pass",
      "pass",
      "pass",
      "not_applicable",
    ]);
  });

  it("records the ruleset version for the secrets scan and the CI registry", () => {
    const [paths, ci, secrets, review] = evaluateGuardrails(MOCKUP_INPUT);

    expect(paths.rulesetVersion).toBeNull();
    expect(ci.rulesetVersion).toBe(CI_REGISTRY_VERSION);
    expect(secrets.rulesetVersion).toBe(SECRETS_RULESET_VERSION);
    expect(review.rulesetVersion).toBeNull();
  });

  it("never carries the matched secret, anywhere in any verdict", () => {
    const rows = evaluateGuardrails({
      ...MOCKUP_INPUT,
      files: [
        {
          path: "drivers/can/keys.h",
          hunks: [{ newStart: 9, lines: [{ kind: "add", text: `k = "${AWS_ACCESS_KEY_ID}"` }] }],
        },
      ],
    });

    expect(JSON.stringify(rows)).not.toContain(AWS_ACCESS_KEY_ID);
    expect(JSON.stringify(rows)).not.toContain(AWS_ACCESS_KEY_ID.slice(4));
  });

  it("names the first offending path in code-unit order and counts the rest", () => {
    const row = checkAllowedPaths({
      ...MOCKUP_INPUT,
      files: [{ path: "z/out.c" }, { path: "b/out.c" }, { path: "drivers/can/ok.c" }],
    });

    expect(row.evidence).toEqual({
      path: "b/out.c",
      glob: "drivers/can/**",
      detail: "2 paths outside the declared scope.",
    });
  });

  it("admits CI files to the path scope when the stage may touch CI, judging them once", () => {
    const input: GuardrailInput = {
      ...MOCKUP_INPUT,
      files: [...MOCKUP_INPUT.files, { path: ".github/workflows/ci.yml" }],
      permissions: { stageKey: "implement", touchCi: true },
    };

    expect(checkAllowedPaths(input).verdict).toBe("pass");
    expect(
      checkAllowedPaths({ ...input, permissions: { stageKey: "implement", touchCi: false } })
        .verdict,
    ).toBe("fail");
  });

  it("withholds an offending path whose name would break the evidence rules", () => {
    const row = checkAllowedPaths({
      ...MOCKUP_INPUT,
      files: [{ path: `leak/${AWS_ACCESS_KEY_ID}.txt` }],
    });

    expect(row.verdict).toBe("fail");
    expect(JSON.stringify(row)).not.toContain(AWS_ACCESS_KEY_ID);
  });
});
