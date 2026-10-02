import {
  AssemblyOverrun,
  CorpusAssembler,
  DURATION_METRIC,
  RIG_TELEMETRY_ABSENT,
  type Deadline,
} from "./corpus.assembler";
import {
  buildId,
  FakeCorpusRepository,
  mockupCorpus,
  SCOPE,
  WINDOW,
  windowDay,
  type FakeBuild,
} from "./corpus.fixture";
import type { CorpusRepository } from "./corpus.repository";
import { TAIL_LINES } from "./log.tail";

/** A deadline that never passes. */
const NEVER: Deadline = { expired: () => false };

/** The seed's schedule: 2,000 builds, 1,230,000 log lines, an hour. */
const SEEDED_BUDGET = { maxBuilds: 2000, maxLogLines: 1_230_000, computeCeilingSeconds: 3600 };

/** Room for everything. */
const GENEROUS = { maxBuilds: 100_000, maxLogLines: 1e12, computeCeilingSeconds: 3600 };

function assemblerOver(repository: FakeCorpusRepository): CorpusAssembler {
  return new CorpusAssembler(repository as unknown as CorpusRepository);
}

describe("assembling mockup 18's corpus", () => {
  it("counts exactly the strip's numbers: 1,284 builds · 312 loops · 90 days · 4.1M log lines · 62 HIL", async () => {
    const repository = new FakeCorpusRepository(mockupCorpus());

    const { manifest } = await assemblerOver(repository).assemble(
      SCOPE,
      WINDOW,
      SEEDED_BUDGET,
      NEVER,
    );

    expect(manifest.window).toEqual({ from: "2026-05-10", to: "2026-08-07", days: 90 });
    expect(manifest.counts).toEqual({
      builds: 1284,
      loops: 312,
      log_lines: 4_100_000,
      hil_sessions: 62,
    });
  });

  it("records the log sample the seeded run records — 0.3 under max_log_lines — and every other source in full", async () => {
    const repository = new FakeCorpusRepository(mockupCorpus());

    const { manifest } = await assemblerOver(repository).assemble(
      SCOPE,
      WINDOW,
      SEEDED_BUDGET,
      NEVER,
    );

    expect(manifest.sources).toEqual({
      builds: { sampled: false, rate: 1, cap: null },
      loops: { sampled: false, rate: 1, cap: null },
      log_lines: { sampled: true, rate: 0.3, cap: "max_log_lines" },
      hil_sessions: { sampled: false, rate: 1, cap: null },
    });
    expect(manifest.budget).toEqual({
      max_builds: 2000,
      max_log_lines: 1_230_000,
      compute_ceiling_seconds: 3600,
    });
  });

  it("streams: the full 4.1M-line volume is never generated, let alone held", async () => {
    const repository = new FakeCorpusRepository(mockupCorpus());
    // About 80 bytes a line: the corpus's whole log volume, were anyone to read it.
    const volume = 4_100_000 * 80;
    const heapBefore = process.memoryUsage().heapUsed;

    const assembled = await assemblerOver(repository).assemble(SCOPE, WINDOW, SEEDED_BUDGET, NEVER);

    const heapGrowth = process.memoryUsage().heapUsed - heapBefore;
    // Tails only: a few chunks from the end of each sampled build's log.
    expect(repository.logBytesServed).toBeLessThan(volume / 20);
    expect(assembled.logBytesRead).toBe(repository.logBytesServed);
    // And what the corpus keeps is the tails — far below the volume, whatever the collector did.
    expect(heapGrowth).toBeLessThan(volume / 4);
    for (const tail of assembled.corpus.log_tails ?? []) {
      expect(tail.lines.length).toBeLessThanOrEqual(TAIL_LINES);
    }
  });

  it("reads tails only for the builds whose log volume fits the cap, and names each build's whole line count", async () => {
    const repository = new FakeCorpusRepository(mockupCorpus());

    const { corpus } = await assemblerOver(repository).assemble(
      SCOPE,
      WINDOW,
      SEEDED_BUDGET,
      NEVER,
    );

    const tails = corpus.log_tails ?? [];
    const standsFor = tails.reduce((sum, tail) => sum + tail.line_count, 0);
    expect(standsFor).toBeLessThanOrEqual(1_230_000);
    expect(standsFor / 4_100_000).toBeCloseTo(0.3, 2);
    expect(tails[0].lines).toHaveLength(TAIL_LINES);
  });

  it("records rig telemetry as absent — null in the corpus and named in the manifest, never zeroed", async () => {
    const repository = new FakeCorpusRepository(mockupCorpus());

    const { corpus, manifest } = await assemblerOver(repository).assemble(
      SCOPE,
      WINDOW,
      SEEDED_BUDGET,
      NEVER,
    );

    expect(corpus.rig_telemetry).toBeNull();
    expect(manifest.absent).toEqual([RIG_TELEMETRY_ABSENT]);
    expect(Object.keys(manifest.counts)).not.toContain("rig_telemetry");
  });

  it("carries the window, the repository and every other source", async () => {
    const data = mockupCorpus();
    const series = [
      { day: windowDay(89), dimension: "zephyr build", value: 245000, samples: [245000] },
    ];
    const repository = new FakeCorpusRepository({ ...data, series });

    const { corpus } = await assemblerOver(repository).assemble(SCOPE, WINDOW, GENEROUS, NEVER);

    expect(corpus.repo_ref).toBe("acme-robotics/helios-firmware");
    expect(corpus.window).toEqual({ from: "2026-05-10", to: "2026-08-07" });
    expect(corpus.loops).toHaveLength(312);
    expect(corpus.series).toEqual({ [DURATION_METRIC]: series });
    expect(corpus.events).toEqual([]);
    expect(corpus.waivers).toEqual([]);
    expect(corpus.flakes).toEqual([]);
    expect(corpus.tests).toEqual([]);
  });
});

describe("the duration series", () => {
  it("is the succeeded builds of the commonest successful label, with a positive duration", async () => {
    const builds: FakeBuild[] = [
      fake(1, { label: "zephyr build", status: "succeeded", durationSeconds: 250 }),
      fake(2, { label: "zephyr build", status: "succeeded", durationSeconds: 260 }),
      fake(3, { label: "zephyr build", status: "failed", durationSeconds: 30 }),
      fake(4, { label: "native_sim", status: "succeeded", durationSeconds: 90 }),
      fake(5, { label: "zephyr build", status: "succeeded", durationSeconds: null }),
    ];
    const repository = new FakeCorpusRepository({ builds });

    const { corpus, manifest } = await assemblerOver(repository).assemble(
      SCOPE,
      WINDOW,
      GENEROUS,
      NEVER,
    );

    expect(manifest.duration_label).toBe("zephyr build");
    expect((corpus.builds ?? []).map((sample) => sample.build_id).sort()).toEqual([
      buildId(1),
      buildId(2),
    ]);
  });

  it("is empty, with no label, when nothing succeeded", async () => {
    const repository = new FakeCorpusRepository({
      builds: [fake(1, { status: "failed" })],
    });

    const { corpus, manifest } = await assemblerOver(repository).assemble(
      SCOPE,
      WINDOW,
      GENEROUS,
      NEVER,
    );

    expect(manifest.duration_label).toBeNull();
    expect(corpus.builds).toEqual([]);
  });
});

describe("cache statistics", () => {
  it("are carried for builds with a usable summary, and a null summary is not a zero", async () => {
    const repository = new FakeCorpusRepository({
      builds: [
        fake(1, { ccacheStats: { hits: 10, misses: 5 } }),
        fake(2, { ccacheStats: null }),
        fake(3, { ccacheStats: { hits: "lots" } }),
      ],
    });

    const { corpus } = await assemblerOver(repository).assemble(SCOPE, WINDOW, GENEROUS, NEVER);

    expect(corpus.cache).toEqual([
      { build_id: buildId(1), day: windowDay(0), hits: 10, misses: 5 },
    ]);
  });
});

describe("when a budget binds", () => {
  it("samples builds at max_builds, and what rides on them with them", async () => {
    const builds = Array.from({ length: 100 }, (_, n) =>
      fake(n + 1, { hil: n % 10 === 0, logLines: 100 }),
    );
    const repository = new FakeCorpusRepository({ builds });

    const { manifest, corpus } = await assemblerOver(repository).assemble(
      SCOPE,
      WINDOW,
      { ...GENEROUS, maxBuilds: 40 },
      NEVER,
    );

    expect(manifest.counts.builds).toBe(100);
    expect(manifest.sources.builds).toEqual({ sampled: true, rate: 0.4, cap: "max_builds" });
    expect(manifest.sources.log_lines).toEqual({ sampled: true, rate: 0.4, cap: "max_builds" });
    expect(manifest.sources.hil_sessions.cap).toBe("max_builds");
    expect(corpus.log_tails).toHaveLength(40);
  });

  it("is the same sample every time — md5 order, not time order", async () => {
    const builds = Array.from({ length: 50 }, (_, n) => fake(n + 1));
    const budget = { ...GENEROUS, maxBuilds: 10 };

    const first = await assemblerOver(new FakeCorpusRepository({ builds })).assemble(
      SCOPE,
      WINDOW,
      budget,
      NEVER,
    );
    const second = await assemblerOver(
      new FakeCorpusRepository({ builds: [...builds].reverse() }),
    ).assemble(SCOPE, WINDOW, budget, NEVER);

    expect(second.corpus.builds).toEqual(first.corpus.builds);
    // Not simply the first ten builds of the window.
    expect((first.corpus.builds ?? []).map((sample) => sample.build_id)).not.toEqual(
      builds.slice(0, 10).map((build) => build.id),
    );
  });

  it("stops at the compute ceiling during assembly, and says what it had read under that cap", async () => {
    const repository = new FakeCorpusRepository(mockupCorpus());
    let checks = 0;
    // Passes after the first page of builds.
    const deadline: Deadline = { expired: () => ++checks > 1 };

    const failure = await assemblerOver(repository)
      .assemble(SCOPE, WINDOW, SEEDED_BUDGET, deadline)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AssemblyOverrun);
    const { manifest } = failure as AssemblyOverrun;
    expect(manifest.counts.builds).toBe(1284);
    expect(manifest.sources.builds).toEqual({
      sampled: true,
      rate: 0.39,
      cap: "compute_ceiling_seconds",
    });
    expect(manifest.sources.loops.cap).toBe("compute_ceiling_seconds");
  });
});

/**
 * One fake build.
 *
 * @param n - Its number.
 * @param overrides - What the case varies.
 * @returns The build.
 */
function fake(n: number, overrides: Partial<FakeBuild> = {}): FakeBuild {
  return {
    id: buildId(n),
    label: "zephyr build",
    status: "succeeded",
    day: windowDay(0),
    durationSeconds: 250,
    logLines: 0,
    hil: false,
    ccacheStats: null,
    ...overrides,
  };
}
