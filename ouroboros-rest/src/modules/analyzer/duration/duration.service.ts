/**
 * The duration chart's read (BW.2, [#517](https://github.com/NobuData/ouroboros/issues/517)) — the
 * series a run analyzed and the change-points it detected on it, read together so the picture and
 * the data cannot drift apart.
 *
 * **The chart is one run's.** The window is that run's corpus window, the series is the job label
 * its corpus timed, and the change-points are its findings. Reading the series over some other
 * window, or annotating it with another run's findings, would put a chip where nothing was
 * detected.
 */

import { Injectable } from "@nestjs/common";

import type { DataOrigin } from "../../db/schema";
import { analysisOrigin } from "../analysis.origin";
import { DURATION_METRIC } from "../corpus/corpus.assembler";
import type { CorpusManifest } from "../corpus/corpus.manifest";
import { CorpusRepository } from "../corpus/corpus.repository";
import { EvidenceRepository } from "../evidence/evidence.repository";
import { evidenceIds } from "../evidence/evidence.resources";
import { DurationRepository } from "./duration.repository";
import {
  durationChartResource,
  emptyDurationChart,
  type DurationChartResource,
} from "./duration.resources";

@Injectable()
export class DurationChartService {
  /**
   * @param reads - The run and its findings.
   * @param corpus - BI's rolled-up series.
   * @param evidence - What the findings' references name.
   */
  constructor(
    private readonly reads: DurationRepository,
    private readonly corpus: CorpusRepository,
    private readonly evidence: EvidenceRepository,
  ) {}

  /**
   * A repository's duration chart.
   *
   * @param organizationId - The workspace.
   * @param repoRef - The repository.
   * @param origin - The data origin the run read; `live` when omitted (#2022). The series is read
   *   for the run's own origin, so the curve is the one its change-points were found in.
   * @returns The newest annotated run's series and change-points; an empty chart before one, or
   *   for a repository the workspace has none of.
   */
  async chart(
    organizationId: string,
    repoRef: string,
    origin?: DataOrigin,
  ): Promise<DurationChartResource> {
    const run = await this.reads.annotatedRun(organizationId, repoRef, analysisOrigin(origin));
    if (run === undefined) {
      return emptyDurationChart(repoRef);
    }

    const manifest = run.corpus_manifest as CorpusManifest;
    const label = manifest.duration_label ?? null;

    const [points, findings] = await Promise.all([
      // No label means nothing succeeded in the window: there is no series to read.
      label === null
        ? Promise.resolve([])
        : this.corpus.series(
            { organizationId, repoRef, origin: run.origin },
            manifest.window,
            DURATION_METRIC,
          ),
      this.reads.changePoints(organizationId, run.id),
    ]);
    const resolved = await this.evidence.resolve(organizationId, evidenceIds(findings));

    return durationChartResource(
      run,
      points.filter((point) => point.dimension === label),
      findings,
      resolved,
    );
  }
}
