/**
 * The rule matrix — every check × `pass` / `fail` / `not_applicable`, as inputs and the verdict
 * each must produce.
 *
 * AP.3's first acceptance criterion ([#305](https://github.com/NobuData/ouroboros/issues/305)).
 * A table rather than a test per case, so a missing cell is visible as a missing row, and
 * `guardrails.checks.spec.ts` asserts the table covers all twelve.
 *
 * The baseline is mockup 10's run: `standard-fix`'s `implement` stage (`touch_ci: false`), a plan
 * that declared two files under `drivers/can/`, a change-set of three files with clean hunks, and
 * a terminal that auto-merges with no vote rule — which is three passes and the `○`.
 *
 * Nothing here ships: `tsconfig.build.json` excludes `*.fixture.ts`.
 */

import type { GuardrailCheck, GuardrailEvidence, GuardrailVerdict } from "../db/schema";
import type { GuardrailInput } from "./guardrails.checks";
import { AWS_ACCESS_KEY_ID } from "./guardrails.fixture";

/** The mockup's change-set: two drivers files and a test, with ordinary added lines. */
export const MOCKUP_INPUT: GuardrailInput = {
  changeSetSeq: 3,
  files: [
    {
      path: "drivers/can/telemetry_buf.c",
      hunks: [
        {
          newStart: 40,
          lines: [
            { kind: "del", text: "static struct k_fifo tel_fifo;" },
            { kind: "add", text: "K_MSGQ_DEFINE(tel_msgq, sizeof(struct tel_frame), 32, 4);" },
          ],
        },
      ],
    },
    {
      path: "drivers/can/isr_fastpath.c",
      hunks: [{ newStart: 7, lines: [{ kind: "add", text: "frame.seq = atomic_inc(&tel_seq);" }] }],
    },
    {
      path: "drivers/can/tests/test_frame_order.c",
      hunks: [{ newStart: 1, lines: [{ kind: "add", text: "ZTEST(telemetry, test_order) {}" }] }],
    },
  ],
  planFiles: ["drivers/can/telemetry_buf.c", "drivers/can/isr_fastpath.c"],
  permissions: { stageKey: "implement", touchCi: false },
  review: { autoMerges: true, voteRules: 0 },
};

/** One cell of the matrix. */
export interface MatrixCell {
  /** Which check. */
  readonly check: GuardrailCheck;
  /** What it must decide. */
  readonly verdict: Exclude<GuardrailVerdict, "pending">;
  /** Why, in a phrase — the test's name. */
  readonly because: string;
  /** The input. */
  readonly input: GuardrailInput;
  /** The evidence it must carry, or `null` for none. Omitted where any evidence is acceptable. */
  readonly evidence?: GuardrailEvidence | null;
}

/** A path added to the mockup's change-set. */
function withFile(path: string, text = "x"): GuardrailInput {
  return {
    ...MOCKUP_INPUT,
    files: [
      ...MOCKUP_INPUT.files,
      { path, hunks: [{ newStart: 1, lines: [{ kind: "add", text }] }] },
    ],
  };
}

/** The whole matrix. */
export const RULE_MATRIX: readonly MatrixCell[] = [
  // --- allowed_paths -------------------------------------------------------------------------
  {
    check: "allowed_paths",
    verdict: "pass",
    because: "every path sits under a widened plan file",
    input: MOCKUP_INPUT,
    evidence: null,
  },
  {
    check: "allowed_paths",
    verdict: "fail",
    because: "a path outside the pinned stage's scope names the glob it violated",
    input: withFile("drivers/spi/bus.c"),
    evidence: {
      path: "drivers/spi/bus.c",
      glob: "drivers/can/**",
      detail: "1 path outside the declared scope.",
    },
  },
  {
    check: "allowed_paths",
    verdict: "not_applicable",
    because: "no plan declares a scope",
    input: { ...MOCKUP_INPUT, planFiles: [] },
  },

  // --- ci_config -----------------------------------------------------------------------------
  {
    check: "ci_config",
    verdict: "pass",
    because: "no CI configuration is touched",
    input: MOCKUP_INPUT,
    evidence: null,
  },
  {
    check: "ci_config",
    verdict: "fail",
    because: ".github/workflows/ci.yml is touched while touch_ci is false",
    input: withFile(".github/workflows/ci.yml"),
    evidence: {
      path: ".github/workflows/ci.yml",
      glob: ".github/workflows/**",
      detail: "1 CI file touched while touch_ci is false on stage implement.",
    },
  },
  {
    check: "ci_config",
    verdict: "pass",
    because: ".github/workflows/ci.yml is touched and touch_ci is true",
    input: {
      ...withFile(".github/workflows/ci.yml"),
      permissions: { stageKey: "implement", touchCi: true },
    },
  },
  {
    check: "ci_config",
    verdict: "not_applicable",
    because: "no model stage's permissions can be resolved",
    input: (({ permissions: _permissions, ...rest }) => rest)(withFile(".github/workflows/ci.yml")),
  },

  // --- secrets -------------------------------------------------------------------------------
  {
    check: "secrets",
    verdict: "pass",
    because: "no added line matches the ruleset",
    input: MOCKUP_INPUT,
    evidence: null,
  },
  {
    check: "secrets",
    verdict: "fail",
    because: "a planted AWS access key is found with its rule id and line",
    input: withFile("drivers/can/keys.h", `#define KEY "${AWS_ACCESS_KEY_ID}"`),
    evidence: {
      path: "drivers/can/keys.h",
      line: 1,
      rule_id: "aws-access-key-id",
      detail: "1 finding in 1 file.",
    },
  },
  {
    check: "secrets",
    verdict: "not_applicable",
    because: "the report carried no hunks, so nothing was scanned",
    input: { ...MOCKUP_INPUT, files: MOCKUP_INPUT.files.map(({ path }) => ({ path })) },
  },

  // --- review_required -----------------------------------------------------------------------
  {
    check: "review_required",
    verdict: "not_applicable",
    because: "standard-fix auto-merges and no vote rule applies — auto-merge eligible",
    input: MOCKUP_INPUT,
    evidence: null,
  },
  {
    check: "review_required",
    verdict: "pass",
    because: "the terminal policy routes the run to a person",
    input: { ...MOCKUP_INPUT, review: { autoMerges: false, voteRules: 1 } },
  },
  {
    check: "review_required",
    verdict: "fail",
    because: "a vote rule requires review but the terminal policy auto-merges",
    input: { ...MOCKUP_INPUT, review: { autoMerges: true, voteRules: 1 } },
  },
  {
    check: "review_required",
    verdict: "fail",
    because: "the pinned policy could not be read, so auto-merge cannot be assumed",
    input: (({ review: _review, ...rest }) => rest)(MOCKUP_INPUT),
  },
];
