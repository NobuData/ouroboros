import type { AnalysisRepository, AnalysisRunRow } from "../analysis.repository";
import { annotatedRun, HELIOS, RUN_ID } from "../duration/duration.fixture";
import { confidenceBasis, MINIMUM_DAYS_WITH_BUILDS } from "./corpus.manifest";
import type { CorpusCounts, CorpusRepository } from "./corpus.repository";
import { analyzedCorpusResource } from "./corpus.resources";
import { CorpusStateService } from "./corpus.service";

/**
 * The corpus-state read (BW.6, #521) over stand-ins: the current window is counted, never
 * assembled; the floor is the service's one constant; `analyzed` is the newest judged run's own
 * manifest; and a repository the workspace has none of reads as empty. The statements themselves
 * are the integration suite's.
 */

/** The instant the read is made at: mockup 18's Aug 8, so the window is May 10 … Aug 7. */
const NOW = Date.parse("2026-08-08T15:12:00Z");

/** The window a run started at {@link NOW} would read. */
const WINDOW = { from: "2026-05-10", to: "2026-08-07", days: 90 };

/**
 * A window's counts.
 *
 * @param builds - Builds inside it.
 * @param daysWithBuilds - Days of it with a build.
 * @returns The counts, the rest zero.
 */
function counts(builds: number, daysWithBuilds: number): CorpusCounts {
  return { builds, daysWithBuilds, hilSessions: 0, logLines: 0, loops: 0 };
}

/**
 * A run that ended having judged a corpus of this size.
 *
 * @param builds - Builds its window held.
 * @param daysWithBuilds - Days of it with a build.
 * @param overrides - Columns to replace.
 * @returns The row.
 */
function judgedRun(
  builds: number,
  daysWithBuilds: number,
  overrides: Partial<AnalysisRunRow> = {},
): AnalysisRunRow {
  const run = annotatedRun();

  return {
    ...run,
    corpus_manifest: {
      ...(run.corpus_manifest as object),
      confidence: confidenceBasis({ window: WINDOW, builds, daysWithBuilds }),
    },
    ...overrides,
  };
}

/** How the stand-ins answer. */
interface World {
  repoId?: string;
  counts?: CorpusCounts;
  judged?: AnalysisRunRow;
}

/**
 * The service over stand-ins.
 *
 * @param world - What they answer.
 * @returns The service and the stand-ins, to assert what was asked of them.
 */
function build(world: World = {}) {
  const corpus = {
    repository: jest.fn(() => Promise.resolve(world.repoId)),
    counts: jest.fn(() => Promise.resolve(world.counts ?? counts(0, 0))),
  };
  const runs = { latestJudged: jest.fn(() => Promise.resolve(world.judged)) };

  return {
    service: new CorpusStateService(
      corpus as unknown as CorpusRepository,
      runs as unknown as AnalysisRepository,
      () => NOW,
    ),
    corpus,
    runs,
  };
}

describe("the corpus-state read", () => {
  it("counts the window a run started now would read — today excluded — for this repository", async () => {
    const { service, corpus } = build({ repoId: "repo-1", counts: counts(1284, 89) });

    const state = await service.state("org", HELIOS);

    expect(state.window).toEqual(WINDOW);
    expect(corpus.repository).toHaveBeenCalledWith("org", HELIOS);
    expect(corpus.counts).toHaveBeenCalledWith(
      { organizationId: "org", repoRef: HELIOS, repoId: "repo-1" },
      WINDOW,
    );
    expect(state).toMatchObject({ repo: HELIOS, builds: 1284, daysWithBuilds: 89 });
  });

  it("states the floor, and judges the corpus against it — on the floor is enough", async () => {
    const judge = async (days: number) =>
      (await build({ repoId: "r", counts: counts(days * 3, days) }).service.state("org", HELIOS))
        .sufficient;

    expect(await judge(MINIMUM_DAYS_WITH_BUILDS)).toBe(true);
    expect(await judge(MINIMUM_DAYS_WITH_BUILDS - 1)).toBe(false);
    expect(await judge(0)).toBe(false);
    expect((await build({ repoId: "r" }).service.state("org", HELIOS)).minimumDaysWithBuilds).toBe(
      MINIMUM_DAYS_WITH_BUILDS,
    );
  });

  it("judges by days with builds, never by the build count — forty builds on one day is one day", async () => {
    const { service } = build({ repoId: "r", counts: counts(40, 1) });

    expect(await service.state("org", HELIOS)).toMatchObject({
      builds: 40,
      daysWithBuilds: 1,
      sufficient: false,
    });
  });

  it("answers no analysed corpus before a run has ended having judged one", async () => {
    const { service, runs } = build({ repoId: "r", counts: counts(1284, 89) });

    expect((await service.state("org", HELIOS)).analyzed).toBeNull();
    expect(runs.latestJudged).toHaveBeenCalledWith("org", HELIOS);
  });

  it("answers the newest judged run's own corpus — its manifest's numbers, not today's", async () => {
    const { service } = build({
      repoId: "r",
      counts: counts(1310, 90),
      judged: judgedRun(1284, 89),
    });

    expect(await service.state("org", HELIOS)).toMatchObject({
      builds: 1310,
      daysWithBuilds: 90,
      analyzed: {
        runId: RUN_ID,
        analyzedAt: "2026-08-08T10:41:00.000Z",
        builds: 1284,
        daysWithBuilds: 89,
        sufficient: true,
      },
    });
  });

  it("judges the analysed corpus by the same floor — a run that read three days is thin, whatever today holds", async () => {
    const { service } = build({ repoId: "r", counts: counts(60, 12), judged: judgedRun(3, 3) });

    const state = await service.state("org", HELIOS);

    expect(state.sufficient).toBe(true);
    expect(state.analyzed).toMatchObject({ builds: 3, daysWithBuilds: 3, sufficient: false });
  });

  it("reads a repository the workspace has none of as an empty corpus nothing analysed — and counts nothing", async () => {
    const { service, corpus, runs } = build({ judged: judgedRun(1284, 89) });

    expect(await service.state("org", "acme-robotics/elsewhere")).toEqual({
      repo: "acme-robotics/elsewhere",
      window: WINDOW,
      builds: 0,
      daysWithBuilds: 0,
      sufficient: false,
      minimumDaysWithBuilds: MINIMUM_DAYS_WITH_BUILDS,
      analyzed: null,
    });
    expect(corpus.counts).not.toHaveBeenCalled();
    expect(runs.latestJudged).not.toHaveBeenCalled();
  });
});

describe("an analysed corpus, from a run row", () => {
  it("is nothing for a run that stored no confidence basis, or has not ended", () => {
    expect(analyzedCorpusResource(undefined)).toBeNull();
    expect(analyzedCorpusResource(annotatedRun())).toBeNull();
    expect(analyzedCorpusResource(judgedRun(1284, 89, { finished_at: null }))).toBeNull();
    expect(analyzedCorpusResource(judgedRun(1284, 89, { corpus_manifest: null }))).toBeNull();
  });
});
