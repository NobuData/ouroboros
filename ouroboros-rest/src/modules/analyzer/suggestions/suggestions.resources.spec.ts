import { NO_REASON } from "../actions/actions.service";
import { resolvedEvidence } from "../duration/duration.fixture";
import {
  calibrationRow,
  composedRun,
  findingRow,
  FORGE_02_ID,
  HELIOS,
  measurementRow,
  POOL_A_ID,
  QUEUE_FINDING_ID,
  RUN_ID,
  RUNNER_MOVE_ID,
  suggestionRow,
} from "./suggestions.fixture";
import {
  answeredRefs,
  confidenceResource,
  emptySuggestions,
  EVIDENCE_LIMIT,
  findingResource,
  impactResource,
  suggestionResource,
  suggestionsResource,
} from "./suggestions.resources";

/**
 * What the suggestion cards publish of a stored suggestion (BW.3, #518): its text and numbers as
 * composed, each number with what produced it, nothing an older row did not record, and its
 * resolution and measurement as they stand.
 */

/** What the seeded finding's references name. */
const RESOLVED = resolvedEvidence({
  runnerPools: [{ id: POOL_A_ID, name: "pool-a" }],
  runners: [{ id: FORGE_02_ID, name: "forge-02" }],
});

describe("a suggestion, as a card's row reads it", () => {
  const resource = suggestionResource(suggestionRow(), [findingRow()], undefined, RESOLVED);

  it("publishes the title, evidence line and confidence as composed", () => {
    expect(resource).toMatchObject({
      id: RUNNER_MOVE_ID,
      kind: "build_process",
      title: "Move forge-02 to pool-a during 14:00–16:00 UTC",
      evidenceLine:
        "pool-a queue exceeds 5 min in that window on 11 of last 14 weekdays; pool-b sits idle 82% of it",
      confidence: 84,
      needsSpike: false,
      plane: "farm_config",
      status: "open",
    });
  });

  it("publishes the confidence's formula with every input the composer read", () => {
    expect(resource.confidenceBasis).toEqual({
      formula: "composer v1: round(100 * (1 - e^(-n/scale)) * stability * min(1, |effect|/target))",
      inputs: {
        template: "runner_move",
        n: 14,
        scale: 5,
        support: 0.9392,
        stability: 0.895,
        effectSize: 0.786,
        effectTarget: 0.75,
        effect: 1,
      },
    });
  });

  it("publishes the impact with its formula, inputs, window, calibration and raw estimate", () => {
    expect(resource.impact).toEqual({
      estimate: -240,
      unit: "seconds",
      appliesTo: "queue p95",
      share: null,
      basis: {
        method: "extrapolated",
        description: "pool-a's window waits with forge-02 taking the backlog",
        sampleSize: null,
        formula: "runner_move v1: -wait_reduction_seconds",
        inputs: { wait_reduction_seconds: 240 },
        window: { from: "2026-05-10", to: "2026-08-07", days: 90 },
        calibration: { analyzer: "queue_correlation", impactClass: "queue_wait", factor: 1 },
        raw: -240,
      },
    });
  });

  it("is open: no resolution, no measurement, and no workflow for a farm change", () => {
    expect(resource).toMatchObject({ resolution: null, measurement: null, workflow: null });
  });
});

describe("a confidence basis", () => {
  it("is null on a suggestion composed before V087 stored one — never an invented formula", () => {
    expect(confidenceResource(null)).toBeNull();
    expect(
      suggestionResource(suggestionRow({ confidence_basis: null }), [], undefined, RESOLVED)
        .confidenceBasis,
    ).toBeNull();
  });

  it("reads an absence claim's missing effect size as null", () => {
    const basis = confidenceResource({
      formula: "composer v1",
      inputs: {
        template: "dead_options_ticket",
        n: 1284,
        scale: 480,
        effect_size: null,
        effect: 1,
      },
    });

    expect(basis?.inputs).toMatchObject({
      n: 1284,
      effectSize: null,
      effectTarget: null,
      effect: 1,
      support: null,
    });
  });
});

describe("an impact", () => {
  it("of an older row keeps its method and description, and reads what it never stored as null", () => {
    expect(
      impactResource({
        estimate: -110,
        unit: "seconds",
        applies_to: "first build after a runner start",
        basis: {
          method: "measured",
          sample_size: 9,
          description: "9 runner starts, cold against warm",
        },
      }),
    ).toEqual({
      estimate: -110,
      unit: "seconds",
      appliesTo: "first build after a runner start",
      share: null,
      basis: {
        method: "measured",
        description: "9 runner starts, cold against warm",
        sampleSize: 9,
        formula: null,
        inputs: null,
        window: null,
        calibration: null,
        raw: null,
      },
    });
  });

  it("that could not be quantified carries no estimate — the basis says why", () => {
    const impact = impactResource({
      estimate: null,
      unit: "seconds",
      applies_to: "per build",
      basis: {
        method: "unquantified",
        description: "the finding does not carry step_seconds_delta",
      },
    });

    expect(impact).toMatchObject({ estimate: null, basis: { method: "unquantified", raw: null } });
  });

  it("carries the share of builds it applies to when it is not all of them", () => {
    expect(
      impactResource({
        estimate: -110,
        unit: "seconds",
        applies_to: "builds after a deps-refresh merge",
        share: 0.2,
        basis: { method: "measured", sample_size: 14, description: "d" },
      })?.share,
    ).toBe(0.2);
  });

  it("is null for a suggestion that stores none", () => {
    expect(impactResource(null)).toBeNull();
  });

  it("states no calibration or window from a half-written one", () => {
    const impact = impactResource({
      estimate: -1,
      unit: "count",
      applies_to: "per week",
      basis: {
        method: "extrapolated",
        description: "d",
        window: { from: "2026-05-10" },
        calibration: { analyzer: "workflow_outcome" },
      },
    });

    expect(impact?.basis).toMatchObject({ window: null, calibration: null });
  });
});

describe("a workflow suggestion", () => {
  const row = suggestionRow({
    kind: "workflow",
    action_binding: {
      plane: "workflow",
      change: { workflow: "standard-fix", move: "self-review", before: "build" },
    },
    workflow_slug: "standard-fix",
    workflow_version: 14,
  });

  it("names the version a draft becomes when a person publishes it, and where the studio opens it", () => {
    expect(suggestionResource(row, [], undefined, RESOLVED).workflow).toEqual({
      slug: "standard-fix",
      nextVersion: 15,
      studioPath: "/workflows/standard-fix",
    });
  });

  it("would be the first version of a workflow nothing was ever published of", () => {
    const unpublished = suggestionResource(
      { ...row, workflow_version: null },
      [],
      undefined,
      RESOLVED,
    );

    expect(unpublished.workflow?.nextVersion).toBe(1);
  });

  it("names no workflow when the workspace no longer has the one the binding names", () => {
    const gone = suggestionResource({ ...row, workflow_slug: null }, [], undefined, RESOLVED);

    expect(gone).toMatchObject({ plane: "workflow", workflow: null });
  });
});

describe("a resolved suggestion", () => {
  it("applied: who, when, and the measurement its apply opened — day N of the window", () => {
    const applied = suggestionResource(
      suggestionRow({
        status: "applied",
        resolved_at: new Date("2026-08-08T12:00:00Z"),
        resolved_by_name: "Ken Suenobu",
      }),
      [],
      measurementRow(),
      RESOLVED,
    );

    expect(applied.resolution).toEqual({
      at: "2026-08-08T12:00:00.000Z",
      by: "Ken Suenobu",
      reason: null,
      draftBatchId: null,
    });
    expect(applied.measurement).toEqual({
      id: "5eed0069-0000-4000-8000-000000000013",
      appliedOn: "2026-08-08",
      day: 3,
      windowDays: 14,
      windowEndsOn: "2026-08-22",
      verdict: "pending",
    });
  });

  it("dismissed: the reason as written", () => {
    const dismissed = suggestionResource(
      suggestionRow({
        status: "dismissed",
        resolved_at: new Date("2026-08-08T12:00:00Z"),
        resolved_by_name: "Mira Okafor",
        resolution_reason: "pool-b is reserved for HIL sweeps",
      }),
      [],
      undefined,
      RESOLVED,
    );

    expect(dismissed).toMatchObject({
      status: "dismissed",
      resolution: { by: "Mira Okafor", reason: "pool-b is reserved for HIL sweeps" },
    });
  });

  it("dismissed without a reason: no reason, rather than the placeholder the row must store", () => {
    const dismissed = suggestionResource(
      suggestionRow({
        status: "dismissed",
        resolved_at: new Date("2026-08-08T12:00:00Z"),
        resolution_reason: NO_REASON,
      }),
      [],
      undefined,
      RESOLVED,
    );

    expect(dismissed.resolution).toMatchObject({ reason: null, by: null });
  });

  it("drafted: the planning batch the spike went into", () => {
    const drafted = suggestionResource(
      suggestionRow({
        needs_spike: true,
        status: "drafted",
        resolved_at: new Date("2026-08-08T12:00:00Z"),
        draft_batch_id: "5eed006a-0000-4000-8000-000000000002",
      }),
      [],
      undefined,
      RESOLVED,
    );

    expect(drafted).toMatchObject({
      needsSpike: true,
      status: "drafted",
      resolution: { draftBatchId: "5eed006a-0000-4000-8000-000000000002" },
    });
  });
});

describe("a cited finding", () => {
  it("is published as its analyzer wrote it, with its own confidence basis", () => {
    expect(findingResource(findingRow(), RESOLVED)).toMatchObject({
      id: QUEUE_FINDING_ID,
      analyzer: "queue_correlation",
      analyzerVersion: 1,
      findingType: "queue_correlation",
      subjectKey: "pool-a@14:00-16:00",
      data: { days_exceeded: 11, days_observed: 14, idle_share: 0.82 },
      confidence: 84,
      confidenceBasis: { sampleSize: 14, effectSize: 0.786, stability: 0.895 },
    });
  });

  it("resolves its references to the surfaces they open on, in their stored order", () => {
    const { evidence, evidenceTotal } = findingResource(findingRow(), RESOLVED);

    expect(evidence.map((entry) => [entry.kind, entry.label, entry.surface])).toEqual([
      ["runner_pool", "pool-a", "farm"],
      ["runner", "forge-02", "farm"],
    ]);
    expect(evidenceTotal).toBe(2);
  });

  it("answers with its first references only, and says how many it cites", () => {
    const refs = Array.from({ length: EVIDENCE_LIMIT + 93 }, (_, index) => ({
      kind: "build",
      id: `build-${String(index)}`,
    }));
    const finding = findingRow({ evidence_refs: refs });

    expect(answeredRefs(finding)).toEqual(refs.slice(0, EVIDENCE_LIMIT));
    expect(findingResource(finding, RESOLVED)).toMatchObject({
      evidenceTotal: EVIDENCE_LIMIT + 93,
      evidence: { length: EVIDENCE_LIMIT },
    });
  });

  it("reads a basis or data that is not an object as empty — never a guess", () => {
    const bare = findingResource(
      findingRow({ data: null, confidence_basis: "n/a", evidence_refs: null }),
      RESOLVED,
    );

    expect(bare).toMatchObject({
      data: {},
      confidenceBasis: { method: null, sampleSize: null, effectSize: null, stability: null },
      evidence: [],
      evidenceTotal: 0,
    });
  });
});

describe("the read", () => {
  it("is one analysis's: its id, when it ended, its suggestions each with their own findings", () => {
    const other = suggestionRow({ id: "5eed0067-0000-4000-8000-000000000012", confidence: 88 });
    const read = suggestionsResource(
      HELIOS,
      composedRun(),
      [other, suggestionRow()],
      [findingRow()],
      [measurementRow({ suggestion_id: other.id })],
      [calibrationRow()],
      RESOLVED,
    );

    expect(read).toMatchObject({
      repo: HELIOS,
      runId: RUN_ID,
      analyzedAt: "2026-08-08T10:41:00.000Z",
    });
    expect(read.suggestions.map((entry) => [entry.id, entry.findings.length])).toEqual([
      [other.id, 0],
      [RUNNER_MOVE_ID, 1],
    ]);
    // A measurement belongs to the suggestion it measures, and to no other.
    expect(read.suggestions.map((entry) => entry.measurement?.day ?? null)).toEqual([3, null]);
  });

  it("carries the repository's calibration cells with their history", () => {
    const read = suggestionsResource(
      HELIOS,
      composedRun(),
      [],
      [],
      [],
      [calibrationRow()],
      RESOLVED,
    );

    expect(read.calibration).toEqual([
      {
        analyzer: "cache_window",
        impactClass: "duration_delta",
        factor: 0.6545,
        sampleCount: 1,
        updatedAt: "2026-07-24T03:00:00.000Z",
        history: [
          expect.objectContaining({ fromFactor: 1, toFactor: 0.6545, measuredSum: -72 }) as unknown,
        ],
      },
    ]);
  });

  it("is empty — no run, no rows — before any analysis has composed a suggestion", () => {
    expect(emptySuggestions("acme-robotics/atlas-scheduler")).toEqual({
      repo: "acme-robotics/atlas-scheduler",
      runId: null,
      analyzedAt: null,
      suggestions: [],
      calibration: [],
    });
  });
});
