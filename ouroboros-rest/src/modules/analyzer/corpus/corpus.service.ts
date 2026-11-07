/**
 * The corpus-state read (BW.6, [#521](https://github.com/NobuData/ouroboros/issues/521)) — how
 * much history a repository holds right now, and how much the last ended analysis read.
 *
 * **Counted, never assembled.** The current window's numbers are {@link CorpusRepository.counts} —
 * the same statement a run's manifest is filled from, over the window a run started now would
 * read — so the page's *N builds on M days* is what the next analysis will find, and no build row
 * is read to say it.
 *
 * **Nothing is refused here.** An analysis may still be started on a thin corpus; this read is what
 * lets the page say that its results would not be worth showing yet.
 */

import { Inject, Injectable, Optional } from "@nestjs/common";

import type { DataOrigin } from "../../db/schema";
import { ANALYSIS_CLOCK } from "../analysis.orchestrator";
import { analysisOrigin } from "../analysis.origin";
import { AnalysisRepository } from "../analysis.repository";
import { corpusWindow } from "./corpus.manifest";
import { CorpusRepository } from "./corpus.repository";
import { corpusStateResource, type CorpusStateResource } from "./corpus.resources";

@Injectable()
export class CorpusStateService {
  /**
   * @param corpus - The window's counts.
   * @param runs - The run records.
   * @param clock - The current instant; `Date.now` unless a suite binds one.
   */
  constructor(
    private readonly corpus: CorpusRepository,
    private readonly runs: AnalysisRepository,
    @Optional() @Inject(ANALYSIS_CLOCK) private readonly clock: () => number = Date.now,
  ) {}

  /**
   * A repository's corpus state.
   *
   * @param organizationId - The workspace.
   * @param repoRef - The repository.
   * @param requested - The one data origin to count; `live` when omitted (#2022).
   * @returns The current window's history of that origin against the floor, and the newest judged
   *   run of it. A repository the workspace has none of reads as an empty corpus that nothing
   *   analysed.
   */
  async state(
    organizationId: string,
    repoRef: string,
    requested?: DataOrigin,
  ): Promise<CorpusStateResource> {
    const origin = analysisOrigin(requested);
    const window = corpusWindow(new Date(this.clock()));
    const repoId = await this.corpus.repository(organizationId, repoRef);
    if (repoId === undefined) {
      return corpusStateResource(
        repoRef,
        origin,
        window,
        { builds: 0, daysWithBuilds: 0 },
        undefined,
      );
    }

    const [counts, run] = await Promise.all([
      this.corpus.counts({ organizationId, repoRef, repoId, origin }, window),
      this.runs.latestJudged(organizationId, repoRef, origin),
    ]);

    return corpusStateResource(repoRef, origin, window, counts, run);
  }
}
