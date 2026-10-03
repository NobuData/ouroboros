import { resolvedEvidence } from "../duration/duration.fixture";
import type { EvidenceRepository } from "../evidence/evidence.repository";
import type {
  CalibrationRow,
  MeasurementRepository,
  MeasurementRow,
} from "../measurement/measurement.repository";
import {
  calibrationRow,
  composedRun,
  findingRow,
  FORGE_02_ID,
  HELIOS,
  measurementRow,
  POOL_A_ID,
  RUN_ID,
  RUNNER_MOVE_ID,
  suggestionRow,
} from "./suggestions.fixture";
import type {
  ComposedRun,
  SuggestionFindingRow,
  SuggestionListRow,
  SuggestionsRepository,
} from "./suggestions.repository";
import { EVIDENCE_LIMIT } from "./suggestions.resources";
import { SuggestionsService } from "./suggestions.service";

/**
 * The suggestion cards' read (BW.3, #518) over stand-ins: nothing is read for a repository no
 * analysis has composed for, the workspace scopes every read, and only the evidence the read
 * answers is resolved. Which suggestions are current is the statements', and the integration
 * suite's to prove.
 */

/** The instant day N is counted to. */
const AT = new Date("2026-08-11T09:00:00Z");

/** How the stand-ins answer. */
interface World {
  run?: ComposedRun;
  rows?: SuggestionListRow[];
  findings?: SuggestionFindingRow[];
  measurements?: MeasurementRow[];
  calibration?: CalibrationRow[];
}

/**
 * The service over stand-ins.
 *
 * @param world - What they answer.
 * @returns The service and the stand-ins, to assert what was asked of them.
 */
function build(world: World = {}) {
  const reads = {
    composedRun: jest.fn(() => Promise.resolve(world.run)),
    suggestions: jest.fn(() => Promise.resolve(world.rows ?? [])),
    findings: jest.fn(() => Promise.resolve(world.findings ?? [])),
  };
  const measurements = {
    measurements: jest.fn(() => Promise.resolve(world.measurements ?? [])),
    calibration: jest.fn(() => Promise.resolve(world.calibration ?? [])),
  };
  const evidence = {
    resolve: jest.fn(() =>
      Promise.resolve(
        resolvedEvidence({
          runnerPools: [{ id: POOL_A_ID, name: "pool-a" }],
          runners: [{ id: FORGE_02_ID, name: "forge-02" }],
        }),
      ),
    ),
  };

  return {
    service: new SuggestionsService(
      reads as unknown as SuggestionsRepository,
      measurements as unknown as MeasurementRepository,
      evidence as unknown as EvidenceRepository,
    ),
    reads,
    measurements,
    evidence,
  };
}

describe("the suggestion cards' read", () => {
  it("answers no suggestions, reading nothing else, before any analysis has composed one", async () => {
    const { service, reads, measurements, evidence } = build();

    await expect(service.list("org", HELIOS, AT)).resolves.toEqual({
      repo: HELIOS,
      runId: null,
      analyzedAt: null,
      suggestions: [],
      calibration: [],
    });
    expect(reads.composedRun).toHaveBeenCalledWith("org", HELIOS);
    expect(reads.suggestions).not.toHaveBeenCalled();
    expect(reads.findings).not.toHaveBeenCalled();
    expect(measurements.measurements).not.toHaveBeenCalled();
    expect(evidence.resolve).not.toHaveBeenCalled();
  });

  it("reads the current suggestions in the workspace, naming the newest composing analysis", async () => {
    const { service, reads } = build({ run: composedRun(), rows: [suggestionRow()] });

    const read = await service.list("org", HELIOS, AT);

    expect(reads.suggestions).toHaveBeenCalledWith("org", HELIOS);
    expect(reads.findings).toHaveBeenCalledWith("org", [RUNNER_MOVE_ID]);
    expect(read).toMatchObject({ runId: RUN_ID, analyzedAt: "2026-08-08T10:41:00.000Z" });
    expect(read.suggestions.map((entry) => entry.title)).toEqual([
      "Move forge-02 to pool-a during 14:00–16:00 UTC",
    ]);
  });

  it("resolves the findings' evidence in the workspace, and attaches each to its suggestion", async () => {
    const { service, evidence } = build({
      run: composedRun(),
      rows: [suggestionRow()],
      findings: [findingRow()],
    });

    const read = await service.list("org", HELIOS, AT);

    expect(evidence.resolve).toHaveBeenCalledWith(
      "org",
      expect.objectContaining({ runnerPools: [POOL_A_ID], runners: [FORGE_02_ID] }),
    );
    expect(read.suggestions[0].findings[0].evidence.map((entry) => entry.label)).toEqual([
      "pool-a",
      "forge-02",
    ]);
  });

  it("resolves only the references it answers — a finding's first few, not its hundreds", async () => {
    const refs = Array.from({ length: 300 }, (_, index) => ({
      kind: "build",
      id: `build-${String(index)}`,
    }));
    const { service, evidence } = build({
      run: composedRun(),
      rows: [suggestionRow()],
      findings: [findingRow({ evidence_refs: refs })],
    });

    await service.list("org", HELIOS, AT);

    expect(evidence.resolve).toHaveBeenCalledWith(
      "org",
      expect.objectContaining({
        builds: refs.slice(0, EVIDENCE_LIMIT).map((ref) => ref.id),
      }),
    );
  });

  it("counts each measurement's day to the instant it was asked at, and carries the calibration", async () => {
    const { service, measurements } = build({
      run: composedRun(),
      rows: [suggestionRow({ status: "applied", resolved_at: new Date("2026-08-08T12:00:00Z") })],
      measurements: [measurementRow()],
      calibration: [calibrationRow()],
    });

    const read = await service.list("org", HELIOS, AT);

    expect(measurements.measurements).toHaveBeenCalledWith("org", HELIOS, AT);
    expect(measurements.calibration).toHaveBeenCalledWith("org", HELIOS);
    expect(read.suggestions[0].measurement).toMatchObject({ day: 3, windowDays: 14 });
    expect(read.calibration).toHaveLength(1);
  });
});
