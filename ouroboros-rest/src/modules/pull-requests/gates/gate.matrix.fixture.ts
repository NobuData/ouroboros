/**
 * The provider matrix — every gate × `green` / `red` / `pending` / `waived` / `not_required` /
 * `unavailable` — as inputs and expected rows, and the mockup's Revision 2 facts they vary.
 *
 * AX.2 ([#358](https://github.com/NobuData/ouroboros/issues/358)). A cell is reached the way the
 * product reaches it: most through the provider's own evidence, and the three policy verdicts a
 * provider does not decide itself through the engine's overlays — org config switching a gate off
 * (`not_required`), a gate-level waiver (`waived`), and a registry without the gate's provider
 * (`unavailable`). `gate.providers.spec.ts` runs every cell through `evaluateGate`.
 */

import { BUILT_IN_GATE_KEYS, type BuiltInGateKey, type PrGateVerdict } from "../../db/schema";
import { DEFAULT_LICENSE_ALLOW_LIST } from "./gate.policy";
import { GATE_PROVIDERS } from "./gate.providers";
import type {
  ApprovalFact,
  AttemptFact,
  BuildFact,
  GateDefinitionSpec,
  GateFacts,
  GateProvider,
  GateWaiver,
  HilFact,
} from "./gate.types";

/** PR #514's head at revision 2. */
export const HEAD = "b7e41d0";

/** Build `#485`'s log tail — the memory map the Build gate reads its FLASH figure from. */
export const MEMORY_MAP =
  "Memory region         Used Size  Region Size  %age Used\n" +
  "     FLASH:            912344 B         2 MB     43.50%\n" +
  "       RAM:            181208 B       512 KB     34.56%\n" +
  "[638/638] Linking zephyr.elf\n";

/** Build `#485`, finished on forge-01. */
export const BUILD: BuildFact = {
  jobId: "5eed0028-0000-4000-8000-000000000485",
  status: "succeeded",
  runnerName: "forge-01",
  exitCode: 0,
  logTail: MEMORY_MAP,
};

/** Build 4 — 63/63. */
export const ATTEMPT: AttemptFact = {
  id: "5eed0031-0000-4000-8000-000000004824",
  attemptSeq: 4,
  status: "complete",
  total: 63,
  passed: 63,
  failed: 0,
  failingCaseKeys: [],
};

/** The overshoot case's durable key. */
export const OVERSHOOT_KEY = "a".repeat(64);

/** Build 4's two rig measurements. */
export const HIL: readonly HilFact[] = [
  {
    id: "5eed0034-0000-4000-8000-000048240501",
    metric: "overshoot_pct",
    value: "1.7",
    unit: "%",
    limitValue: "2.0",
    limitKind: "max",
    verdict: "pass",
    platform: "rig:helios-rig-02",
    caseKey: OVERSHOOT_KEY,
  },
  {
    id: "5eed0034-0000-4000-8000-000048240502",
    metric: "reordered_frames",
    value: "0",
    unit: "count",
    limitValue: "0",
    limitKind: "max",
    verdict: "pass",
    platform: "rig:helios-rig-02",
    caseKey: "b".repeat(64),
  },
];

/** Revision 2's three files, which the plan's list covers. */
export const FILES = [
  { path: "drivers/can/telemetry_buf.c", additions: 38, deletions: 12 },
  { path: "drivers/can/isr_fastpath.c", additions: 9, deletions: 3 },
  { path: "tests/telemetry/test_frame_order.c", additions: 21, deletions: 0 },
];

/** Mockup 12's Revision 2 — every gate's evidence in, the policy standard-fix@v14's. */
export const REVISION_2: GateFacts = {
  pr: { id: "pr-514", organizationId: "org-358", state: "verifying", runId: "run-482" },
  revision: { id: "rev-2", seq: 2, headSha: HEAD, files: FILES, diffExcerpt: null },
  policy: { touchCi: new Map([["implement", false]]), autoMerges: true, holdsOnChecks: true },
  review: { autoMerges: true, voteRules: 1 },
  voteRules: 1,
  build: BUILD,
  attempt: ATTEMPT,
  hil: HIL,
  waivedCaseKeys: new Set(),
  planFiles: ["drivers/can/telemetry_buf.c", "drivers/can/isr_fastpath.c", "tests/telemetry/"],
  secrets: { id: "5eed0030-0000-4000-8000-000000000003", verdict: "pass" },
  license: { allow: DEFAULT_LICENSE_ALLOW_LIST, deny: [] },
  approval: null,
};

/** An approval slot (V065, #361) — Ken asked, and nobody has answered yet. */
export const REQUESTED_APPROVAL: ApprovalFact = {
  id: "5eed0042-0000-4000-8000-000000000514",
  state: "requested",
  requestedBy: "Ken S",
  decidedBy: null,
  decidedRevisionId: null,
  note: null,
};

/**
 * Revision 2's facts with some replaced.
 *
 * @param changes - The facts to replace.
 * @returns A new facts object.
 */
export function factsWith(changes: Partial<GateFacts>): GateFacts {
  return { ...REVISION_2, ...changes };
}

/** One cell of the matrix. */
export interface MatrixCell {
  readonly gate: BuiltInGateKey;
  readonly verdict: PrGateVerdict;
  /** What the cell exercises, for the test's name. */
  readonly how: string;
  readonly facts: GateFacts;
  /** The definition's spec, when the cell switches the gate off. */
  readonly spec?: Partial<GateDefinitionSpec>;
  readonly waivers?: readonly GateWaiver[];
  /** A registry other than the built-in one. */
  readonly providers?: ReadonlyMap<string, GateProvider>;
  /** The evidence line expected, when the cell pins it. */
  readonly evidence?: string;
}

/**
 * The three engine overlays, for one gate.
 *
 * @param gate - The gate.
 * @param red - Facts that turn the gate red, for the waiver cell.
 * @returns The `not_required`, `waived` and `unavailable` cells.
 */
function overlays(gate: BuiltInGateKey, red: GateFacts): MatrixCell[] {
  return [
    {
      gate,
      verdict: "not_required",
      how: "org config switched it off",
      facts: REVISION_2,
      spec: { disabled: true },
      evidence: "not required by org config",
    },
    {
      gate,
      verdict: "waived",
      how: "a gate-level waiver over a red verdict",
      facts: red,
      waivers: [{ gateKey: gate, reason: "accepted by Ken" }],
    },
    {
      gate,
      verdict: "unavailable",
      how: "no provider registered",
      facts: REVISION_2,
      providers: new Map([...GATE_PROVIDERS].filter(([key]) => key !== gate)),
      evidence: `no provider for ${gate}`,
    },
  ];
}

/** A test failure, not waived. */
const FAILING_ATTEMPT: AttemptFact = {
  ...ATTEMPT,
  passed: 61,
  failed: 2,
  failingCaseKeys: [OVERSHOOT_KEY, "c".repeat(64)],
};

/** Build 3's overshoot — 2.4% over a 2.0% ceiling. */
const OVERSHOOT_FAIL: HilFact = { ...HIL[0], value: "2.4", verdict: "fail" };

/** A new source file with no SPDX header. */
export const HEADERLESS =
  "--- drivers/can/isr_fastpath.c\n@@ -0,0 +1,2 @@\n+#include <zephyr/kernel.h>\n+void isr(void) {}\n";

/** Every cell, gate by gate. */
export const PROVIDER_MATRIX: readonly MatrixCell[] = [
  // build
  {
    gate: "build",
    verdict: "green",
    how: "the head's build succeeded",
    facts: REVISION_2,
    evidence: "forge-01 · zephyr.elf · FLASH 43.5%",
  },
  {
    gate: "build",
    verdict: "red",
    how: "the head's build failed",
    facts: factsWith({ build: { ...BUILD, status: "failed", exitCode: 2 } }),
    evidence: "forge-01 · exit 2",
  },
  {
    gate: "build",
    verdict: "pending",
    how: "no build of the head yet",
    facts: factsWith({ build: null }),
    evidence: "no build of b7e41d0 yet",
  },
  ...overlays("build", factsWith({ build: { ...BUILD, status: "failed", exitCode: 2 } })),

  // test_suite
  {
    gate: "test_suite",
    verdict: "green",
    how: "the attempt at the head passed",
    facts: REVISION_2,
    evidence: "63/63 after attempt 4",
  },
  {
    gate: "test_suite",
    verdict: "red",
    how: "two cases failed",
    facts: factsWith({ attempt: FAILING_ATTEMPT }),
    evidence: "61/63 · 2 failing after attempt 4",
  },
  {
    gate: "test_suite",
    verdict: "pending",
    how: "the attempt is still running",
    facts: factsWith({ attempt: { ...ATTEMPT, status: "running" } }),
    evidence: "attempt 4 running",
  },
  {
    gate: "test_suite",
    verdict: "waived",
    how: "every failing case is waived by an AS.4 waiver",
    facts: factsWith({
      attempt: FAILING_ATTEMPT,
      waivedCaseKeys: new Set(FAILING_ATTEMPT.failingCaseKeys),
    }),
    evidence: "2 failing cases waived · 61/63 after attempt 4",
  },
  ...overlays("test_suite", factsWith({ attempt: FAILING_ATTEMPT })),

  // physical_hil
  {
    gate: "physical_hil",
    verdict: "green",
    how: "every measurement inside its limit",
    facts: REVISION_2,
    evidence: "overshoot 1.7% ≤ 2.0% · rig helios-rig-02",
  },
  {
    gate: "physical_hil",
    verdict: "red",
    how: "the overshoot over its ceiling",
    facts: factsWith({ hil: [OVERSHOOT_FAIL, HIL[1]] }),
    evidence: "overshoot 2.4% > 2.0% · rig helios-rig-02",
  },
  {
    gate: "physical_hil",
    verdict: "pending",
    how: "no attempt at the head yet",
    facts: factsWith({ attempt: null, hil: [] }),
    evidence: "no test attempt at b7e41d0 yet",
  },
  {
    gate: "physical_hil",
    verdict: "not_required",
    how: "the attempt ran no physical suite",
    facts: factsWith({ hil: [] }),
    evidence: "no physical suite in attempt 4",
  },
  {
    gate: "physical_hil",
    verdict: "waived",
    how: "the failing case is waived",
    facts: factsWith({ hil: [OVERSHOOT_FAIL, HIL[1]], waivedCaseKeys: new Set([OVERSHOOT_KEY]) }),
    evidence: "overshoot 2.4% > 2.0% · rig helios-rig-02 · waived",
  },
  ...overlays("physical_hil", factsWith({ hil: [OVERSHOOT_FAIL] })),

  // diff_vs_plan
  {
    gate: "diff_vs_plan",
    verdict: "green",
    how: "every file inside the plan's scope",
    facts: REVISION_2,
    evidence: "all hunks map to planned files · 0 out-of-scope edits",
  },
  {
    gate: "diff_vs_plan",
    verdict: "red",
    how: "two files outside the plan",
    facts: factsWith({
      revision: {
        ...REVISION_2.revision,
        files: [
          ...FILES,
          { path: "west.yml", additions: 1, deletions: 1 },
          { path: "boards/x.dts", additions: 2, deletions: 0 },
        ],
      },
    }),
    evidence: "2 out-of-scope edits: boards/x.dts, west.yml",
  },
  {
    gate: "diff_vs_plan",
    verdict: "not_required",
    how: "no plan declares a scope",
    facts: factsWith({ planFiles: undefined }),
    evidence: "no plan file list declares a scope",
  },
  ...overlays("diff_vs_plan", factsWith({ planFiles: ["docs/"] })).filter(
    (cell) => cell.verdict !== "not_required",
  ),
  {
    gate: "diff_vs_plan",
    verdict: "pending",
    how: "unreachable — the plan and the files are both synchronous facts",
    facts: REVISION_2,
    providers: new Map([
      ...GATE_PROVIDERS,
      [
        "diff_vs_plan",
        {
          key: "diff_vs_plan",
          version: "test",
          evaluate: () => ({ verdict: "pending", evidence: "judging", evidenceRef: null }),
        },
      ],
    ]),
  },

  // secrets_license
  {
    gate: "secrets_license",
    verdict: "green",
    how: "secrets pass and the license layer is clean",
    facts: factsWith({
      revision: {
        ...REVISION_2.revision,
        diffExcerpt: "--- drivers/can/telemetry_buf.c\n@@ -41,2 +41,2 @@\n-a\n+b\n",
      },
    }),
    evidence: "clean (headers + manifest delta)",
  },
  {
    gate: "secrets_license",
    verdict: "red",
    how: "a new source file without an SPDX header",
    facts: factsWith({ revision: { ...REVISION_2.revision, diffExcerpt: HEADERLESS } }),
    evidence: "license: missing SPDX header in drivers/can/isr_fastpath.c",
  },
  {
    gate: "secrets_license",
    verdict: "pending",
    how: "the secrets scan has not answered",
    facts: factsWith({
      secrets: { id: "5eed0030-0000-4000-8000-000000000003", verdict: "pending" },
    }),
    evidence: "secrets scan pending",
  },
  ...overlays(
    "secrets_license",
    factsWith({ secrets: { id: "5eed0030-0000-4000-8000-000000000003", verdict: "fail" } }),
  ),

  // human_approval
  {
    gate: "human_approval",
    verdict: "not_required",
    how: "the pinned terminal auto-merges",
    facts: REVISION_2,
    evidence: "not required by policy",
  },
  {
    gate: "human_approval",
    verdict: "pending",
    how: "the terminal routes to a person",
    facts: factsWith({ review: { autoMerges: false, voteRules: 0 } }),
    evidence: "awaiting human approval — the terminal policy routes this PR to a person",
  },
  {
    gate: "human_approval",
    verdict: "pending",
    how: "a person asked for a review of an auto-merging PR (AX.5)",
    facts: factsWith({ approval: REQUESTED_APPROVAL }),
    evidence: "review requested by Ken S — awaiting approval",
  },
  {
    gate: "human_approval",
    verdict: "green",
    how: "an approval on this revision (AX.5)",
    facts: factsWith({
      approval: {
        ...REQUESTED_APPROVAL,
        state: "approved",
        decidedBy: "Priya N",
        decidedRevisionId: "rev-2",
        note: "bench numbers look right",
      },
    }),
    evidence: "approved by Priya N — bench numbers look right",
  },
  {
    gate: "human_approval",
    verdict: "red",
    how: "a decline on this revision (AX.5)",
    facts: factsWith({
      approval: {
        ...REQUESTED_APPROVAL,
        state: "declined",
        decidedBy: "Priya N",
        decidedRevisionId: "rev-2",
        note: "needs the thermal run",
      },
    }),
    evidence: "declined by Priya N — needs the thermal run",
  },
  ...overlays("human_approval", REVISION_2).filter((cell) => cell.verdict !== "waived"),
  {
    gate: "human_approval",
    verdict: "waived",
    how: "a gate-level waiver over a decline",
    facts: factsWith({
      approval: {
        ...REQUESTED_APPROVAL,
        state: "declined",
        decidedBy: "Priya N",
        decidedRevisionId: "rev-2",
        note: "changes requested",
      },
    }),
    waivers: [{ gateKey: "human_approval", reason: "owner override" }],
    evidence: "waived: owner override · declined by Priya N — changes requested",
  },

  // model_review
  {
    gate: "model_review",
    verdict: "unavailable",
    how: "a vote rule asks for one and no provider exists (AZ.1)",
    facts: REVISION_2,
    evidence: "unavailable — arrives with the provider stack",
  },
  {
    gate: "model_review",
    verdict: "not_required",
    how: "no vote rule asks for one",
    facts: factsWith({ voteRules: 0 }),
    evidence: "no vote rule asks for a second model",
  },
  ...(["green", "red", "pending"] as const).map((verdict): MatrixCell => ({
    gate: "model_review",
    verdict,
    how: `live vote state once #371 lands — ${verdict}`,
    facts: REVISION_2,
    providers: new Map([
      ...GATE_PROVIDERS,
      [
        "model_review",
        {
          key: "model_review",
          version: "test",
          evaluate: () => ({ verdict, evidence: "cursor/composer-2 voting…", evidenceRef: null }),
        },
      ],
    ]),
  })),
  {
    gate: "model_review",
    verdict: "waived",
    how: "a gate-level waiver over a red vote",
    facts: REVISION_2,
    waivers: [{ gateKey: "model_review", reason: "owner override" }],
    providers: new Map([
      ...GATE_PROVIDERS,
      [
        "model_review",
        {
          key: "model_review",
          version: "test",
          evaluate: () => ({ verdict: "red", evidence: "vote failed", evidenceRef: null }),
        },
      ],
    ]),
  },
];

/** The built-in keys, re-exported for the matrix's completeness check. */
export const MATRIX_GATES = BUILT_IN_GATE_KEYS;
