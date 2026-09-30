import { importedProvenance } from "../knowledge-import/rule-import.resources";
import {
  CORRECTION_NOTE_PROPOSER,
  IMPORT_PROPOSER,
  PROPOSER_DEFINITIONS,
  PROPOSER_REGISTRY,
  STEER_PROPOSER,
  WAIVER_PROPOSER,
  waiverCategory,
} from "./proposers.registry";
import {
  CLASSIFICATION_ID,
  GATE_ID,
  KEN,
  K_MSGQ_NOTE,
  PR_ID,
  REMEMBERED_STEER_ID,
  RUN_ID,
  SOURCE_RUN,
  STAGE_ID,
  WAIVER_ID,
} from "./proposers.store.fixture";
import type { FactCandidate, Proposal } from "./proposers.types";

/**
 * @param proposal - A rule's answer.
 * @returns Its candidate, failing the test on a skip.
 */
function candidateOf(proposal: Proposal): FactCandidate {
  if (proposal.kind !== "candidate")
    throw new Error(`expected a candidate, got ${proposal.reason}`);
  return proposal.candidate;
}

describe("the proposer registry", () => {
  it("has one versioned entry per deterministic source kind", () => {
    expect(Object.keys(PROPOSER_REGISTRY)).toEqual([
      "correction_note",
      "waiver",
      "steer",
      "import",
    ]);
    for (const definition of PROPOSER_DEFINITIONS) {
      expect(definition.version).toBeGreaterThanOrEqual(1);
      expect(definition.trigger).not.toBe("");
      expect(definition.provenanceShape.length).toBeGreaterThan(0);
    }
  });

  it("gives no entry a way to name a status", () => {
    // K3, declared: every candidate every entry can produce has exactly the candidate's keys.
    for (const definition of PROPOSER_DEFINITIONS) {
      expect(Object.keys(definition)).not.toContain("status");
    }
  });
});

describe("the correction-note proposer", () => {
  const source = {
    classificationId: CLASSIFICATION_ID,
    note: K_MSGQ_NOTE,
    actor: "human",
    run: SOURCE_RUN,
  };

  it("promotes the seeded note to the mockup's k_msgq candidate, honestly attributed", () => {
    expect(candidateOf(CORRECTION_NOTE_PROPOSER.propose(source))).toEqual({
      text: "Team prefers `k_msgq` over `k_fifo` in ISR paths",
      repoRef: "acme-robotics/helios-firmware",
      proposer: "correction_note",
      proposerVersion: 1,
      category: "convention",
      confidence: null,
      provenance: {
        line: "from correction note (run #1847)",
        refs: [
          { kind: "run", id: RUN_ID },
          { kind: "pull_request", id: PR_ID },
          { kind: "classification", id: CLASSIFICATION_ID },
        ],
      },
      source: { kind: "classification", id: CLASSIFICATION_ID },
    });
  });

  it("never claims the review-cycle phrasing — that is #423's richer extraction", () => {
    expect(candidateOf(CORRECTION_NOTE_PROPOSER.propose(source)).provenance.line).not.toMatch(
      /review cycle/,
    );
  });

  it("omits the PR ref for a run that opened none", () => {
    const candidate = candidateOf(
      CORRECTION_NOTE_PROPOSER.propose({ ...source, run: { ...SOURCE_RUN, pullRequest: null } }),
    );

    expect(candidate.provenance.refs.map((ref) => ref.kind)).toEqual(["run", "classification"]);
  });

  it.each([
    [{ actor: "heuristic" }, "not_human"],
    [{ actor: "model" }, "not_human"],
    [{ note: null }, "no_note"],
    [{ note: "Fix." }, "too_short"],
  ])("skips %j as %s", (overrides, reason) => {
    expect(CORRECTION_NOTE_PROPOSER.propose({ ...source, ...overrides })).toEqual({
      kind: "skip",
      reason,
    });
  });
});

describe("the waiver proposer", () => {
  const reason =
    "Rig 2's thermal chamber is out for calibration; thermal cases stay red until it returns.";
  const source = { waiverId: WAIVER_ID, reason, gateIds: [GATE_ID], run: SOURCE_RUN };

  it("produces an environment-class candidate citing the PR, the gate and the waiver", () => {
    const candidate = candidateOf(WAIVER_PROPOSER.propose(source));

    expect(candidate).toMatchObject({
      text: "Rig 2's thermal chamber is out for calibration",
      proposer: "waiver",
      category: "environment",
      provenance: {
        line: "from waiver on PR #514 · environment",
        refs: [
          { kind: "run", id: RUN_ID },
          { kind: "pull_request", id: PR_ID },
          { kind: "gate", id: GATE_ID },
          { kind: "waiver", id: WAIVER_ID },
        ],
      },
    });
  });

  it("calls a reason that names no environment a known limitation", () => {
    const candidate = candidateOf(
      WAIVER_PROPOSER.propose({
        ...source,
        reason: "Overshoot above 2% is accepted until the new PID tuning lands",
        gateIds: [],
      }),
    );

    expect(candidate.category).toBe("limitation");
    expect(candidate.provenance.refs.map((ref) => ref.kind)).toEqual([
      "run",
      "pull_request",
      "waiver",
    ]);
  });

  it("names the run when there is no PR", () => {
    const candidate = candidateOf(
      WAIVER_PROPOSER.propose({ ...source, run: { ...SOURCE_RUN, pullRequest: null } }),
    );

    expect(candidate.provenance.line).toBe("from waiver on run #1847 · environment");
  });

  it.each([
    ["The CI runner image lacks the ARM toolchain", "environment"],
    ["Known limitation of the parser", "limitation"],
    ["Circuit breaker behaviour is expected", "limitation"],
  ])("reads %j as %s — whole words only", (text, category) => {
    expect(waiverCategory(text)).toBe(category);
  });
});

describe("the steer proposer", () => {
  const source = {
    controlId: REMEMBERED_STEER_ID,
    payload: "Always run `west update` before the first build of the day.",
    remember: true,
    stage: { id: STAGE_ID, label: "Implement" },
    actorId: KEN,
    run: SOURCE_RUN,
  };

  it("proposes nothing from a steer without remember this", () => {
    expect(STEER_PROPOSER.propose({ ...source, remember: false })).toEqual({
      kind: "skip",
      reason: "not_remembered",
    });
  });

  it("promotes a remembered steer with its run, stage, person and steer", () => {
    expect(candidateOf(STEER_PROPOSER.propose(source))).toMatchObject({
      text: "Always run `west update` before the first build of the day",
      proposer: "steer",
      category: "instruction",
      provenance: {
        line: "from remembered steer (run #1847 · Implement)",
        refs: [
          { kind: "run", id: RUN_ID },
          { kind: "run_stage", id: STAGE_ID },
          { kind: "person", id: KEN },
          { kind: "steer", id: REMEMBERED_STEER_ID },
        ],
      },
    });
  });

  it("leaves out a stage it does not know and a person who left", () => {
    const candidate = candidateOf(
      STEER_PROPOSER.propose({ ...source, stage: null, actorId: null }),
    );

    expect(candidate.provenance.line).toBe("from remembered steer (run #1847)");
    expect(candidate.provenance.refs.map((ref) => ref.kind)).toEqual(["run", "steer"]);
  });
});

describe("the import proposer", () => {
  it("is the rule-file import's bullets, with the import's own provenance", () => {
    const candidate = candidateOf(
      IMPORT_PROPOSER.propose({
        file: "CLAUDE.md",
        section: "Kconfig",
        bullet: " Zephyr 4.0 needs `CONFIG_LEGACY_TIMER` ",
        repoRef: "acme-robotics/helios-firmware",
      }),
    );

    expect(candidate).toMatchObject({
      text: "Zephyr 4.0 needs `CONFIG_LEGACY_TIMER`",
      proposer: "import",
      provenance: importedProvenance({ file: "CLAUDE.md", section: "Kconfig" }),
      source: { kind: "import", id: "CLAUDE.md#Kconfig" },
    });
  });
});
