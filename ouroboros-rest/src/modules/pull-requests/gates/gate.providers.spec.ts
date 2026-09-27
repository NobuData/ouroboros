import { PR_GATE_VERDICTS } from "../../db/schema";
import { evaluateGate } from "./gate.engine";
import {
  ATTEMPT,
  BUILD,
  HIL,
  MATRIX_GATES,
  PROVIDER_MATRIX,
  REVISION_2,
  factsWith,
  type MatrixCell,
} from "./gate.matrix.fixture";
import {
  GATE_PROVIDERS,
  MAX_EVIDENCE,
  MODEL_REVIEW_UNAVAILABLE,
  boundEvidence,
  listWithin,
  measurementLine,
  sameCommit,
} from "./gate.providers";
import type { GateDefinitionSpec, StoredGateDefinition } from "./gate.types";

/**
 * The seven providers (AX.2, [#358](https://github.com/NobuData/ouroboros/issues/358)) — the
 * provider matrix, the mockup's evidence lines, and idempotency.
 */

/**
 * Run one matrix cell through the engine.
 *
 * @param cell - The cell.
 * @returns The row the engine decided.
 */
function run(cell: MatrixCell) {
  const definition: StoredGateDefinition = {
    id: `def-${cell.gate}`,
    gateKey: cell.gate,
    required: true,
    source: "standard-fix@v14 pin",
  };
  const spec: GateDefinitionSpec = {
    gateKey: cell.gate,
    label: cell.gate,
    sortOrder: 1,
    required: true,
    source: "standard-fix@v14 pin",
    disabled: false,
    ...cell.spec,
  };

  return evaluateGate(
    definition,
    spec,
    cell.facts,
    cell.providers ?? GATE_PROVIDERS,
    cell.waivers ?? [],
  );
}

describe("the provider matrix", () => {
  it("covers every gate × every verdict", () => {
    const covered = new Set(PROVIDER_MATRIX.map((cell) => `${cell.gate}:${cell.verdict}`));

    for (const gate of MATRIX_GATES) {
      for (const verdict of PR_GATE_VERDICTS) {
        expect(covered).toContain(`${gate}:${verdict}`);
      }
    }
  });

  it.each(
    PROVIDER_MATRIX.map((cell) => [`${cell.gate} → ${cell.verdict}: ${cell.how}`, cell] as const),
  )("%s", (_name, cell) => {
    const row = run(cell);

    expect(row.verdict).toBe(cell.verdict);
    if (cell.evidence !== undefined) {
      expect(row.evidence).toBe(cell.evidence);
    }
    expect(row.evidence.length).toBeGreaterThan(0);
    expect(row.evidence.length).toBeLessThanOrEqual(MAX_EVIDENCE);
  });

  it.each(PROVIDER_MATRIX.map((cell) => [`${cell.gate} → ${cell.verdict}`, cell] as const))(
    "is idempotent: %s twice from identical inputs is the identical row",
    (_name, cell) => {
      expect(run(cell)).toEqual(run(cell));
    },
  );
});

describe("mockup 12's Revision 2", () => {
  it("reads the card's seven lines from the seeded evidence", () => {
    const lines = Object.fromEntries(
      [...GATE_PROVIDERS].map(([key, provider]) => [key, provider.evaluate(REVISION_2)]),
    );

    expect(lines.build).toEqual({
      verdict: "green",
      evidence: "forge-01 · zephyr.elf · FLASH 43.5%",
      evidenceRef: { kind: "build_job", id: BUILD.jobId },
    });
    expect(lines.test_suite).toEqual({
      verdict: "green",
      evidence: "63/63 after attempt 4",
      evidenceRef: { kind: "test_run", id: ATTEMPT.id },
    });
    expect(lines.physical_hil).toEqual({
      verdict: "green",
      evidence: "overshoot 1.7% ≤ 2.0% · rig helios-rig-02",
      evidenceRef: { kind: "hil_measurement", id: HIL[0].id },
    });
    expect(lines.diff_vs_plan.evidence).toBe(
      "all hunks map to planned files · 0 out-of-scope edits",
    );
    expect(lines.secrets_license.verdict).toBe("green");
    expect(lines.model_review.verdict).toBe("unavailable");
    expect(lines.human_approval).toEqual({
      verdict: "not_required",
      evidence: "not required by policy",
      evidenceRef: null,
    });
  });
});

describe("model_review", () => {
  it("reports unavailable, never pending, while no provider exists — whatever the evidence", () => {
    const provider = GATE_PROVIDERS.get("model_review");
    const variants = [
      REVISION_2,
      factsWith({ build: null, attempt: null, hil: [] }),
      factsWith({ secrets: null, policy: undefined, review: undefined }),
      factsWith({ voteRules: 3 }),
    ];

    for (const facts of variants) {
      const outcome = provider?.evaluate(facts);

      expect(outcome?.verdict).not.toBe("pending");
      expect(outcome).toEqual({
        verdict: "unavailable",
        evidence: MODEL_REVIEW_UNAVAILABLE,
        evidenceRef: null,
      });
    }
  });
});

describe("build", () => {
  const build = GATE_PROVIDERS.get("build");

  it("leaves out what the log does not say, rather than inventing it", () => {
    expect(build?.evaluate(factsWith({ build: { ...BUILD, logTail: "" } })).evidence).toBe(
      "forge-01",
    );
  });

  it("reads Zephyr's own link line and a whole-number FLASH figure", () => {
    const logTail = "FLASH: 1 B 2 MB 44.00%\n[9/9] Linking C executable zephyr/zephyr.elf\n";

    expect(build?.evaluate(factsWith({ build: { ...BUILD, logTail } })).evidence).toBe(
      "forge-01 · zephyr.elf · FLASH 44%",
    );
  });

  it("is pending while the job is queued or running, and red when canceled", () => {
    expect(build?.evaluate(factsWith({ build: { ...BUILD, status: "running" } }))).toMatchObject({
      verdict: "pending",
      evidence: "forge-01 · running",
    });
    expect(
      build?.evaluate(factsWith({ build: { ...BUILD, status: "queued", runnerName: null } })),
    ).toMatchObject({
      verdict: "pending",
      evidence: "unassigned · queued",
    });
    expect(build?.evaluate(factsWith({ build: { ...BUILD, status: "canceled" } }))).toMatchObject({
      verdict: "red",
      evidence: "forge-01 · canceled",
    });
  });
});

describe("test_suite", () => {
  const tests = GATE_PROVIDERS.get("test_suite");

  it("is red when a finished attempt reported no cases — nothing was proven", () => {
    expect(
      tests?.evaluate(factsWith({ attempt: { ...ATTEMPT, total: 0, passed: 0 } })),
    ).toMatchObject({ verdict: "red", evidence: "attempt 4 reported no test cases" });
  });

  it("is red when only some failing cases are waived", () => {
    const attempt = { ...ATTEMPT, failed: 2, passed: 61, failingCaseKeys: ["a", "b"] };

    expect(tests?.evaluate(factsWith({ attempt, waivedCaseKeys: new Set(["a"]) })).verdict).toBe(
      "red",
    );
  });

  it("is red when the attempt errored", () => {
    expect(tests?.evaluate(factsWith({ attempt: { ...ATTEMPT, status: "error" } })).verdict).toBe(
      "red",
    );
  });
});

describe("physical_hil", () => {
  it("reports the closest measurement to its limit, and ranks a zero limit last", () => {
    // reordered_frames 0 ≤ 0 has no relative headroom; the overshoot's 15% is the line.
    expect(GATE_PROVIDERS.get("physical_hil")?.evaluate(REVISION_2).evidence).toBe(
      "overshoot 1.7% ≤ 2.0% · rig helios-rig-02",
    );
  });

  it("writes the value and the limit at one scale, without rounding either", () => {
    expect(measurementLine({ ...HIL[0], value: "2.4", limitValue: "2", verdict: "fail" })).toBe(
      "overshoot 2.4% > 2.0% · rig helios-rig-02",
    );
    expect(measurementLine({ ...HIL[0], value: "1", limitValue: "2.25" })).toBe(
      "overshoot 1.00% ≤ 2.25% · rig helios-rig-02",
    );
  });

  it("writes a floor with ≥ and <, and a unit that is not a percentage apart", () => {
    const floor = {
      ...HIL[0],
      metric: "voltage",
      unit: "V",
      limitKind: "min" as const,
      value: "3.1",
      limitValue: "3.0",
    };

    expect(measurementLine(floor)).toBe("voltage 3.1 V ≥ 3.0 V · rig helios-rig-02");
    expect(measurementLine({ ...floor, value: "2.9", verdict: "fail", platform: "qemu" })).toBe(
      "voltage 2.9 V < 3.0 V · qemu",
    );
  });
});

describe("diff_vs_plan", () => {
  it("names every out-of-scope path on failure", () => {
    const files = [
      ...REVISION_2.revision.files,
      { path: "west.yml", additions: 1, deletions: 0 },
      { path: ".github/workflows/ci.yml", additions: 3, deletions: 0 },
    ];
    const outcome = GATE_PROVIDERS.get("diff_vs_plan")?.evaluate(
      factsWith({ revision: { ...REVISION_2.revision, files } }),
    );

    expect(outcome).toEqual({
      verdict: "red",
      evidence: "2 out-of-scope edits: .github/workflows/ci.yml, west.yml",
      evidenceRef: null,
    });
  });

  it("treats an empty plan list as no scope", () => {
    expect(GATE_PROVIDERS.get("diff_vs_plan")?.evaluate(factsWith({ planFiles: [] })).verdict).toBe(
      "not_required",
    );
  });
});

describe("secrets_license", () => {
  const gate = GATE_PROVIDERS.get("secrets_license");

  it("states its scope when there was no diff to read", () => {
    expect(gate?.evaluate(REVISION_2).evidence).toBe(
      "clean (secrets only — no diff to check headers or manifest delta)",
    );
  });

  it("says when there was no run secrets scan to compose", () => {
    const excerpt = "--- drivers/can/telemetry_buf.c\n@@ -1,1 +1,1 @@\n-a\n+b\n";

    expect(
      gate?.evaluate(
        factsWith({ secrets: null, revision: { ...REVISION_2.revision, diffExcerpt: excerpt } }),
      ),
    ).toEqual({
      verdict: "green",
      evidence: "clean (headers + manifest delta) · no run secrets scan",
      evidenceRef: null,
    });
  });

  it("goes red on a GPL dependency in the manifest delta, naming it", () => {
    const excerpt = [
      "--- package-lock.json",
      "@@ -10,3 +10,8 @@",
      "     },",
      '+    "node_modules/readline-gpl": {',
      '+      "version": "1.0.0",',
      '+      "license": "GPL-3.0-only"',
      "+    },",
    ].join("\n");
    const files = [{ path: "package-lock.json", additions: 4, deletions: 0 }];

    expect(
      gate?.evaluate(
        factsWith({ revision: { ...REVISION_2.revision, files, diffExcerpt: excerpt } }),
      ),
    ).toEqual({
      verdict: "red",
      evidence: "license: GPL-3.0-only via readline-gpl (package-lock.json)",
      evidenceRef: { kind: "guardrail_evaluation", id: REVISION_2.secrets?.id },
    });
  });

  it("puts a secrets failure ahead of the license layer", () => {
    expect(
      gate?.evaluate(
        factsWith({ secrets: { id: "5eed0030-0000-4000-8000-000000000003", verdict: "fail" } }),
      ).evidence,
    ).toBe("secrets: a known credential format in the added lines");
  });
});

describe("the line helpers", () => {
  it("bounds a line at 512 characters with an ellipsis", () => {
    expect(boundEvidence("x".repeat(600))).toHaveLength(MAX_EVIDENCE);
    expect(boundEvidence("x".repeat(600)).endsWith("…")).toBe(true);
    expect(boundEvidence("  short  ")).toBe("short");
  });

  it("lists what fits and counts the rest", () => {
    const paths = Array.from(
      { length: 100 },
      (_, index) => `src/module_${String(index).padStart(3, "0")}/file.c`,
    );
    const line = listWithin("100 out-of-scope edits: ", paths);

    expect(line.length).toBeLessThanOrEqual(MAX_EVIDENCE);
    expect(line).toMatch(/ \+\d+ more$/);
    expect(line.startsWith("100 out-of-scope edits: src/module_000/file.c, ")).toBe(true);
  });

  it("matches a commit by abbreviation either way, and never on fewer than seven characters", () => {
    expect(sameCommit("b7e41d0", "b7e41d0aa11ff00")).toBe(true);
    expect(sameCommit("B7E41D0AA", "b7e41d0")).toBe(true);
    expect(sameCommit("b7e41d0", "3f9c2ae")).toBe(false);
    expect(sameCommit("b7e4", "b7e41d0")).toBe(false);
  });
});
