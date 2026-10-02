/**
 * Corpus assembly — bounded, streamed, on-tenant (BV.1,
 * [#510](https://github.com/NobuData/ouroboros/issues/510), decision **A2**).
 *
 * Assembling the corpus is the part of the analyzer most likely to take the product down, so it
 * runs under three budgets and reads every source a page at a time:
 *
 *   * **`max_builds`** — builds are read in sample order (`md5(id)`) and the read stops at the cap.
 *     What a build carries into the corpus — its duration, its cache summary, its log tail —
 *     follows it, so a sampled build set samples those too.
 *   * **`max_log_lines`** — a build's tail is read only while the log volume its build stands for
 *     (`build_jobs.log_lines`) still fits under the cap. The first build that would not fit closes
 *     the log sample. The rate recorded is the share of the window's lines the read tails stand
 *     for, not the share of lines read: a tail is a summary of its whole log.
 *   * **`compute_ceiling_seconds`** — assembly spends the run's ceiling too. The deadline is
 *     checked between pages; when it passes, assembly stops, records what it had read under that
 *     cap, and reports {@link AssemblyOverrun} — the run then ends `budget_exceeded` without
 *     dispatching, rather than running for six hours.
 *
 * **When a budget binds, the corpus samples and the manifest says so**, per source
 * (`corpus.manifest.ts`). **An absent source is recorded as absent** — the rig telemetry AJ.4
 * (#266) has not built yet is `null` in the corpus and named in `manifest.absent`, never an empty
 * list standing in for data nobody read.
 *
 * Nothing here holds a whole plane: the builds a page brings are reduced to what the corpus keeps
 * before the next page is read, and a log is read backwards a few chunks at a time
 * (`log.tail.ts`). What the corpus keeps is bounded by the caps and by {@link TAIL_LINES} per
 * build.
 */

import { Injectable } from "@nestjs/common";

import type {
  EngineBuildSample,
  EngineCacheStat,
  EngineCorpus,
  EngineLogTail,
  EngineLoop,
  EngineTestCase,
} from "../../engine/engine.analysis";
import {
  manifestBudget,
  samplingRecord,
  type AbsentSource,
  type BudgetKey,
  type CorpusBudget,
  type CorpusManifest,
  type CorpusWindow,
} from "./corpus.manifest";
import {
  CorpusRepository,
  type BuildCursor,
  type BuildRow,
  type CorpusCounts,
  type CorpusScope,
} from "./corpus.repository";
import { readTail, TAIL_LINES } from "./log.tail";

/** The rolled-up metric that is the duration series' source (BI, V086). */
export const DURATION_METRIC = "build_duration";

/** Why the rig telemetry source is absent — until AJ.4 (#266) exists to produce it. */
export const RIG_TELEMETRY_ABSENT: AbsentSource = Object.freeze({
  source: "rig_telemetry",
  reason: "Rig/HIL telemetry export (AJ.4, #266) is not available in this deployment.",
});

/** A run's remaining compute, as assembly sees it. */
export interface Deadline {
  /** Whether the run's compute ceiling has been reached. */
  expired(): boolean;
}

/** What assembly produced. */
export interface AssembledCorpus {
  corpus: EngineCorpus;
  manifest: CorpusManifest;
  /** The window's counts — kept for the confidence note. */
  counts: CorpusCounts;
  /** Log bytes fetched to read the tails — what the memory bound is asserted against. */
  logBytesRead: number;
}

/**
 * The compute ceiling passed during assembly. Carries the manifest of what was read by then, so
 * the run can end `budget_exceeded` with an honest receipt.
 */
export class AssemblyOverrun extends Error {
  /**
   * @param manifest - What had been read when the ceiling passed.
   * @param counts - The window's counts.
   */
  constructor(
    readonly manifest: CorpusManifest,
    readonly counts: CorpusCounts,
  ) {
    super("The run's compute ceiling was reached while its corpus was being assembled.");
    this.name = "AssemblyOverrun";
  }
}

/** Running totals while the builds are read. */
interface BuildRead {
  builds: number;
  hil: number;
  logLines: number;
  /** Set once a build's log did not fit; no later tail is read. */
  logsClosed: boolean;
  /** The cap that ended the build read, if one did. */
  buildCap: BudgetKey | null;
  /** The cap that closed the log sample, if one did. */
  logCap: BudgetKey | null;
  samples: EngineBuildSample[];
  cache: EngineCacheStat[];
  tails: EngineLogTail[];
  logBytesRead: number;
}

/**
 * A build's ccache summary, when it has a usable one.
 *
 * @param stats - `build_jobs.ccache_stats`.
 * @returns `{hits, misses}`, or undefined — null is not zero (decision **B5**).
 */
function cacheOf(stats: unknown): { hits: number; misses: number } | undefined {
  if (typeof stats !== "object" || stats === null) {
    return undefined;
  }

  const { hits, misses } = stats as { hits?: unknown; misses?: unknown };

  return Number.isInteger(hits) &&
    Number.isInteger(misses) &&
    Number(hits) >= 0 &&
    Number(misses) >= 0
    ? { hits: Number(hits), misses: Number(misses) }
    : undefined;
}

@Injectable()
export class CorpusAssembler {
  /** @param repository - The bounded reads. */
  constructor(private readonly repository: CorpusRepository) {}

  /**
   * Assemble one repository's corpus over a window, within a budget.
   *
   * @param scope - The repository.
   * @param window - The window.
   * @param budget - The caps.
   * @param deadline - The run's compute ceiling.
   * @returns The corpus, its manifest and what reading it cost.
   * @throws {AssemblyOverrun} When the ceiling passed before assembly finished.
   */
  async assemble(
    scope: CorpusScope,
    window: CorpusWindow,
    budget: CorpusBudget,
    deadline: Deadline,
  ): Promise<AssembledCorpus> {
    const counts = await this.repository.counts(scope, window);
    const durationLabel = await this.repository.durationLabel(scope, window);
    const read = await this.readBuilds(scope, window, budget, deadline, durationLabel);

    const manifestOf = (loops: { read: number; cap: BudgetKey | null }): CorpusManifest => ({
      window,
      counts: {
        builds: counts.builds,
        loops: counts.loops,
        log_lines: counts.logLines,
        hil_sessions: counts.hilSessions,
      },
      sources: {
        builds: samplingRecord(read.builds, counts.builds, read.buildCap),
        loops: samplingRecord(loops.read, counts.loops, loops.cap),
        log_lines: samplingRecord(read.logLines, counts.logLines, read.logCap ?? read.buildCap),
        hil_sessions: samplingRecord(read.hil, counts.hilSessions, read.buildCap),
      },
      budget: manifestBudget(budget),
      duration_label: durationLabel,
      absent: [RIG_TELEMETRY_ABSENT],
    });

    if (read.buildCap === "compute_ceiling_seconds") {
      throw new AssemblyOverrun(manifestOf({ read: 0, cap: "compute_ceiling_seconds" }), counts);
    }

    const loops = await this.readLoops(scope, window, deadline);
    if (loops.overrun) {
      throw new AssemblyOverrun(
        manifestOf({ read: loops.records.length, cap: "compute_ceiling_seconds" }),
        counts,
      );
    }

    const tests = await this.readTests(scope, window, deadline);
    if (tests === undefined) {
      throw new AssemblyOverrun(manifestOf({ read: loops.records.length, cap: null }), counts);
    }

    const [events, flakes, waivers, series] = await Promise.all([
      this.repository.events(scope, window),
      this.repository.flakes(scope),
      this.repository.waivers(scope, window),
      this.repository.series(scope, window, DURATION_METRIC),
    ]);

    const corpus: EngineCorpus = {
      repo_ref: scope.repoRef,
      window: { from: window.from, to: window.to },
      builds: read.samples,
      events,
      log_tails: read.tails,
      tests,
      flakes,
      loops: loops.records,
      cache: read.cache,
      waivers,
      series: { [DURATION_METRIC]: series },
      // Absent, not empty: see RIG_TELEMETRY_ABSENT.
      rig_telemetry: null,
    };

    return {
      corpus,
      manifest: manifestOf({ read: loops.records.length, cap: null }),
      counts,
      logBytesRead: read.logBytesRead,
    };
  }

  /**
   * Read the window's builds in sample order, keeping what the corpus carries of each.
   *
   * @param scope - The repository.
   * @param window - The window.
   * @param budget - The caps.
   * @param deadline - The compute ceiling.
   * @param durationLabel - Whose durations are the duration series.
   * @returns What was read, and which cap stopped it.
   */
  private async readBuilds(
    scope: CorpusScope,
    window: CorpusWindow,
    budget: CorpusBudget,
    deadline: Deadline,
    durationLabel: string | null,
  ): Promise<BuildRead> {
    const read: BuildRead = {
      builds: 0,
      hil: 0,
      logLines: 0,
      logsClosed: false,
      buildCap: null,
      logCap: null,
      samples: [],
      cache: [],
      tails: [],
      logBytesRead: 0,
    };
    let cursor: BuildCursor | null = null;

    for (;;) {
      if (deadline.expired()) {
        read.buildCap = "compute_ceiling_seconds";
        read.logCap = read.logCap ?? "compute_ceiling_seconds";
        return read;
      }

      const page = await this.repository.buildPage(scope, window, cursor);
      if (page.length === 0) {
        return read;
      }

      for (const build of page) {
        if (read.builds >= budget.maxBuilds) {
          read.buildCap = "max_builds";
          return read;
        }

        await this.keep(build, read, budget, durationLabel);
      }

      const last = page[page.length - 1];
      cursor = { hash: last.hash, id: last.id };
    }
  }

  /**
   * Take one build into the corpus.
   *
   * @param build - The build.
   * @param read - The running totals, updated in place.
   * @param budget - The caps.
   * @param durationLabel - Whose durations are the duration series.
   */
  private async keep(
    build: BuildRow,
    read: BuildRead,
    budget: CorpusBudget,
    durationLabel: string | null,
  ): Promise<void> {
    read.builds += 1;
    if (build.hil) {
      read.hil += 1;
    }

    if (
      build.status === "succeeded" &&
      build.label === durationLabel &&
      build.durationSeconds !== null &&
      build.durationSeconds > 0
    ) {
      read.samples.push({
        build_id: build.id,
        day: build.day,
        duration_seconds: build.durationSeconds,
      });
    }

    const cache = cacheOf(build.ccacheStats);
    if (cache !== undefined) {
      read.cache.push({ build_id: build.id, day: build.day, ...cache });
    }

    if (read.logsClosed) {
      return;
    }
    if (read.logLines + build.logLines > budget.maxLogLines) {
      read.logsClosed = true;
      read.logCap = "max_log_lines";
      return;
    }

    read.logLines += build.logLines;
    if (build.logLines === 0) {
      return;
    }

    const tail = await readTail(
      (before) => this.repository.logChunks(build.id, before),
      TAIL_LINES,
    );
    read.logBytesRead += tail.bytesRead;
    read.tails.push({
      build_id: build.id,
      day: build.day,
      label: build.label,
      status: build.status,
      line_count: build.logLines,
      lines: tail.lines,
    });
  }

  /**
   * Read the window's loops, a page at a time.
   *
   * @param scope - The repository.
   * @param window - The window.
   * @param deadline - The compute ceiling.
   * @returns The loops, and whether the ceiling stopped the read.
   */
  private async readLoops(
    scope: CorpusScope,
    window: CorpusWindow,
    deadline: Deadline,
  ): Promise<{ records: EngineLoop[]; overrun: boolean }> {
    const records: EngineLoop[] = [];
    let after: string | null = null;

    for (;;) {
      if (deadline.expired()) {
        return { records, overrun: true };
      }

      const page = await this.repository.loopPage(scope, window, after);
      if (page.length === 0) {
        return { records, overrun: false };
      }

      records.push(...page);
      after = page[page.length - 1].run_id;
    }
  }

  /**
   * Read the window's failed and flaky test cases, a page of test runs at a time.
   *
   * @param scope - The repository.
   * @param window - The window.
   * @param deadline - The compute ceiling.
   * @returns The cases, or undefined when the ceiling stopped the read.
   */
  private async readTests(
    scope: CorpusScope,
    window: CorpusWindow,
    deadline: Deadline,
  ): Promise<EngineTestCase[] | undefined> {
    const cases: EngineTestCase[] = [];
    let after: string | null = null;

    for (;;) {
      if (deadline.expired()) {
        return undefined;
      }

      const page = await this.repository.testCasePage(scope, window, after);
      cases.push(...page.cases);
      if (page.last === null) {
        return cases;
      }
      after = page.last;
    }
  }
}
