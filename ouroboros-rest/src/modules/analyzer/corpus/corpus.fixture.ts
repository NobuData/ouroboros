/**
 * An in-memory stand-in for {@link CorpusRepository}, for the assembler's and the orchestrator's
 * suites (#510).
 *
 * It honours the repository's contract rather than its SQL: builds come back in `md5(id)` order a
 * page at a time from a keyset cursor, a log comes back newest chunk first, and **a log's bytes are
 * generated when a page of them is asked for** — never held — so a suite can stand up millions of
 * lines and prove the assembler reads only what it needs.
 *
 * Not shipped: `*.fixture.ts` is excluded from the build.
 */

import { createHash } from "node:crypto";

import type {
  EngineCandidateEvent,
  EngineFlakeScore,
  EngineLoop,
  EngineSeriesPoint,
  EngineTestCase,
  EngineWaiver,
} from "../../engine/engine.analysis";
import type { CorpusWindow } from "./corpus.manifest";
import type {
  BuildCursor,
  BuildRow,
  CorpusCounts,
  CorpusRepository,
  CorpusScope,
} from "./corpus.repository";
import type { LogChunk } from "./log.tail";

/** The workspace every fixture lives in. */
export const ORG = "5eed0001-0000-4000-8000-000000000001";

/** The repository, as the strip names it. */
export const REPO = "acme-robotics/helios-firmware";

/** Its `github_repos.id`. */
export const REPO_ID = "7f000003-0000-4000-8000-000000000001";

/** The scope every fixture assembles. */
export const SCOPE: CorpusScope = { organizationId: ORG, repoRef: REPO, repoId: REPO_ID };

/** The mockup's window: Aug 8's run, May 10 … Aug 7. */
export const WINDOW: CorpusWindow = { from: "2026-05-10", to: "2026-08-07", days: 90 };

/** Lines in one generated log chunk. */
export const LINES_PER_CHUNK = 100;

/** One fake build. */
export interface FakeBuild {
  id: string;
  label: string;
  status: BuildRow["status"];
  day: string;
  durationSeconds: number | null;
  logLines: number;
  hil: boolean;
  ccacheStats: unknown;
}

/** A deterministic uuid for build `n`. */
export function buildId(n: number): string {
  return `b0000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

/** A deterministic uuid for loop `n`. */
export function loopId(n: number): string {
  return `10000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

/**
 * The day `n` days into the window.
 *
 * @param n - 0 … 89.
 * @returns `YYYY-MM-DD`.
 */
export function windowDay(n: number): string {
  const day = new Date(Date.UTC(2026, 4, 10 + (n % 90)));
  return day.toISOString().slice(0, 10);
}

/** What the fake holds. */
export interface FakeCorpusData {
  builds: FakeBuild[];
  loops?: EngineLoop[];
  tests?: EngineTestCase[];
  events?: EngineCandidateEvent[];
  flakes?: EngineFlakeScore[];
  waivers?: EngineWaiver[];
  series?: EngineSeriesPoint[];
}

/** md5 of a string, hex — PostgreSQL's `md5()`. */
const md5 = (value: string): string => createHash("md5").update(value).digest("hex");

/**
 * The fake. Its counters record what was asked of it.
 */
export class FakeCorpusRepository implements Pick<
  CorpusRepository,
  | "repository"
  | "counts"
  | "durationLabel"
  | "buildPage"
  | "logChunks"
  | "events"
  | "testCasePage"
  | "flakes"
  | "loopPage"
  | "waivers"
  | "series"
> {
  /** Log bytes generated and handed out. */
  logBytesServed = 0;
  /** Build pages served. */
  buildPages = 0;

  private readonly sorted: (FakeBuild & { hash: string })[];

  /** @param data - What the corpus holds. */
  constructor(private readonly data: FakeCorpusData) {
    this.sorted = data.builds
      .map((build) => ({ ...build, hash: md5(build.id) }))
      .sort((a, b) =>
        a.hash === b.hash ? a.id.localeCompare(b.id) : a.hash.localeCompare(b.hash),
      );
  }

  repository(organizationId: string, repoRef: string): Promise<string | undefined> {
    return Promise.resolve(organizationId === ORG && repoRef === REPO ? REPO_ID : undefined);
  }

  counts(): Promise<CorpusCounts> {
    const builds = this.data.builds;

    return Promise.resolve({
      builds: builds.length,
      hilSessions: builds.filter((build) => build.hil).length,
      logLines: builds.reduce((sum, build) => sum + build.logLines, 0),
      loops: this.data.loops?.length ?? 0,
      daysWithBuilds: new Set(builds.map((build) => build.day)).size,
    });
  }

  durationLabel(): Promise<string | null> {
    const counts = new Map<string, number>();
    for (const build of this.data.builds) {
      if (build.status === "succeeded") {
        counts.set(build.label, (counts.get(build.label) ?? 0) + 1);
      }
    }
    const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    return Promise.resolve(ranked[0]?.[0] ?? null);
  }

  buildPage(
    _scope: CorpusScope,
    _window: CorpusWindow,
    after: BuildCursor | null,
    limit = 500,
  ): Promise<BuildRow[]> {
    this.buildPages += 1;
    const start =
      after === null
        ? 0
        : this.sorted.findIndex(
            (build) =>
              build.hash > after.hash || (build.hash === after.hash && build.id > after.id),
          );

    return Promise.resolve(
      (start === -1 ? [] : this.sorted.slice(start, start + limit)).map((build) => ({ ...build })),
    );
  }

  /**
   * A build's log is `logLines` lines of about eighty bytes, in chunks of {@link LINES_PER_CHUNK},
   * generated on request.
   */
  logChunks(jobId: string, beforeSeq: number | null, limit = 4): Promise<LogChunk[]> {
    const build = this.data.builds.find((candidate) => candidate.id === jobId);
    if (build === undefined || build.logLines === 0) {
      return Promise.resolve([]);
    }

    const chunkCount = Math.ceil(build.logLines / LINES_PER_CHUNK);
    const newest = (beforeSeq ?? chunkCount) - 1;
    const chunks: LogChunk[] = [];

    for (let seq = newest; seq >= 0 && chunks.length < limit; seq -= 1) {
      const first = seq * LINES_PER_CHUNK;
      const count = Math.min(LINES_PER_CHUNK, build.logLines - first);
      const text = Array.from(
        { length: count },
        (_, line) =>
          `[${String(first + line).padStart(7, "0")}] ${jobId} compiling drivers/can/can_mcux_flexcan.c`,
      ).join("\n");
      const content = Buffer.from(text + "\n", "utf8");
      this.logBytesServed += content.length;
      chunks.push({ seq, content });
    }

    return Promise.resolve(chunks);
  }

  events(): Promise<EngineCandidateEvent[]> {
    return Promise.resolve(this.data.events ?? []);
  }

  testCasePage(
    _scope: CorpusScope,
    _window: CorpusWindow,
    afterRunId: string | null,
  ): Promise<{ cases: EngineTestCase[]; last: string | null }> {
    // One page holds everything; the second is empty.
    return Promise.resolve(
      afterRunId === null && (this.data.tests?.length ?? 0) > 0
        ? { cases: this.data.tests ?? [], last: "ffffffff-ffff-4fff-8fff-ffffffffffff" }
        : { cases: [], last: null },
    );
  }

  flakes(): Promise<EngineFlakeScore[]> {
    return Promise.resolve(this.data.flakes ?? []);
  }

  loopPage(
    _scope: CorpusScope,
    _window: CorpusWindow,
    afterId: string | null,
  ): Promise<EngineLoop[]> {
    const loops = [...(this.data.loops ?? [])].sort((a, b) => a.run_id.localeCompare(b.run_id));
    const start = afterId === null ? 0 : loops.findIndex((loop) => loop.run_id > afterId);

    return Promise.resolve(start === -1 ? [] : loops.slice(start, start + 500));
  }

  waivers(): Promise<EngineWaiver[]> {
    return Promise.resolve(this.data.waivers ?? []);
  }

  series(): Promise<EngineSeriesPoint[]> {
    return Promise.resolve(this.data.series ?? []);
  }
}

/**
 * Mockup 18's corpus, shaped like the seed: 1,284 builds over ninety days (62 HIL sweeps on a
 * `hil` pool), 312 loops and 4,100,000 log lines — spread so every build has a log.
 *
 * @returns The data.
 */
export function mockupCorpus(): FakeCorpusData {
  const total = 1284;
  const lines = 4_100_000;
  const builds: FakeBuild[] = Array.from({ length: total }, (_, n) => {
    const hil = n < 62;
    return {
      id: buildId(n + 1),
      label: hil ? "HIL test rig" : n % 3 === 0 ? "native_sim" : "zephyr build",
      status: n % 20 === 0 ? "failed" : "succeeded",
      day: windowDay(n),
      durationSeconds: hil ? 900 : 240 + (n % 30),
      // Every build carries an even share, the first `lines mod total` one line more.
      logLines: Math.floor(lines / total) + (n < lines % total ? 1 : 0),
      hil,
      ccacheStats: hil ? null : { hits: 380, misses: 140, version: "4.9" },
    };
  });

  const loops: EngineLoop[] = Array.from({ length: 312 }, (_, n) => ({
    run_id: loopId(n + 1),
    day: windowDay(n),
    status: n % 8 === 0 ? "failed" : "merged",
    stages: [{ key: "build", attempts: 1, seconds: 120 }],
    events: 40,
    event_bytes: 9000,
  }));

  return { builds, loops };
}
