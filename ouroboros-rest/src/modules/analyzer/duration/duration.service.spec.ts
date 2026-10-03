import type { EngineSeriesPoint } from "../../engine/engine.analysis";
import type { AnalysisRunRow } from "../analysis.repository";
import type { CorpusRepository } from "../corpus/corpus.repository";
import { annotatedRun, changePoint, HELIOS, resolvedEvidence, RUN_ID } from "./duration.fixture";
import type { DurationRepository, FindingRow } from "./duration.repository";
import { DurationChartService } from "./duration.service";

/**
 * The duration chart's read (BW.2, #517) over stand-ins: the chart is one run's — its window, the
 * job label its corpus timed, its findings — and nothing is read for a repository with no such
 * run. The statements themselves are the integration suite's.
 */

/** One rolled-up day of a job label. */
function day(date: string, dimension: string, ms: number): EngineSeriesPoint {
  return { day: date, dimension, value: ms, samples: [ms] };
}

/** How the stand-ins answer. */
interface World {
  run?: AnalysisRunRow;
  findings?: FindingRow[];
  series?: EngineSeriesPoint[];
}

/**
 * The service over stand-ins.
 *
 * @param world - What they answer.
 * @returns The service and the stand-ins, to assert what was asked of them.
 */
function build(world: World = {}) {
  const reads = {
    annotatedRun: jest.fn(() => Promise.resolve(world.run)),
    changePoints: jest.fn(() => Promise.resolve(world.findings ?? [])),
    evidence: jest.fn(() => Promise.resolve(resolvedEvidence())),
  };
  const corpus = { series: jest.fn(() => Promise.resolve(world.series ?? [])) };

  return {
    service: new DurationChartService(
      reads as unknown as DurationRepository,
      corpus as unknown as CorpusRepository,
    ),
    reads,
    corpus,
  };
}

describe("the duration chart's read", () => {
  it("answers an empty chart, reading nothing else, before a run has detected change-points", async () => {
    const { service, reads, corpus } = build();

    await expect(service.chart("org", HELIOS)).resolves.toEqual({
      repo: HELIOS,
      runId: null,
      analyzedAt: null,
      durationLabel: null,
      window: null,
      series: [],
      changePoints: [],
    });
    expect(reads.annotatedRun).toHaveBeenCalledWith("org", HELIOS);
    expect(corpus.series).not.toHaveBeenCalled();
    expect(reads.changePoints).not.toHaveBeenCalled();
    expect(reads.evidence).not.toHaveBeenCalled();
  });

  it("reads the series over the run's own corpus window, in the workspace", async () => {
    const { service, corpus } = build({ run: annotatedRun() });

    await service.chart("org", HELIOS);

    expect(corpus.series).toHaveBeenCalledWith(
      { organizationId: "org", repoRef: HELIOS },
      { from: "2026-05-10", to: "2026-08-07", days: 90 },
      "build_duration",
    );
  });

  it("draws only the job label the run's corpus timed, never another job's durations", async () => {
    const { service } = build({
      run: annotatedRun(),
      series: [
        day("2026-06-21", "twister sweep", 900_000),
        day("2026-06-21", "zephyr build", 342_000),
        day("2026-06-22", "zephyr build", 212_000),
      ],
    });

    const chart = await service.chart("org", HELIOS);

    expect(chart.durationLabel).toBe("zephyr build");
    expect(chart.series).toEqual([
      { day: "2026-06-21", medianSeconds: 342, builds: 1 },
      { day: "2026-06-22", medianSeconds: 212, builds: 1 },
    ]);
  });

  it("annotates with that run's findings, their evidence resolved in the workspace", async () => {
    const { service, reads } = build({ run: annotatedRun(), findings: [changePoint()] });

    const chart = await service.chart("org", HELIOS);

    expect(reads.changePoints).toHaveBeenCalledWith("org", RUN_ID);
    expect(reads.evidence).toHaveBeenCalledWith(
      "org",
      expect.objectContaining({ merges: ["0c5eed47a1b2"] }),
    );
    expect(chart.changePoints).toHaveLength(1);
    expect(chart.changePoints[0].evidence[0]).toMatchObject({
      kind: "merge",
      surface: "pull_request",
    });
  });

  it("reads no series for a corpus that timed nothing — a run with no successful build", async () => {
    const run = annotatedRun();
    const { service, corpus } = build({
      run: {
        ...run,
        corpus_manifest: { ...(run.corpus_manifest as object), duration_label: null },
      },
      series: [day("2026-06-21", "", 1)],
    });

    const chart = await service.chart("org", HELIOS);

    expect(corpus.series).not.toHaveBeenCalled();
    expect(chart).toMatchObject({ runId: RUN_ID, durationLabel: null, series: [] });
  });
});
