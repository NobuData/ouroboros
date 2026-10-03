/**
 * The suggestion cards' read (BW.3, [#518](https://github.com/NobuData/ouroboros/issues/518)) —
 * one analysis's build-process and workflow suggestions, each with what its row, its popovers and
 * its Details sheet need, answered together so no card can show a suggestion beside another
 * analysis's findings.
 *
 * **The cards hold what is still current** (`suggestions.repository.ts` says which that is), in
 * every status: an open suggestion to act on, an applied one with the measurement its apply
 * opened, a dismissed one staying dismissed. A suggestion a later analysis looked for and did not
 * find leaves the cards; a dismissed one it finds again is still there, still dismissed — which is
 * how *won't be suggested again* is seen to hold.
 */

import { Injectable } from "@nestjs/common";

import { EvidenceRepository } from "../evidence/evidence.repository";
import { groupRefs } from "../evidence/evidence.resources";
import { MeasurementRepository } from "../measurement/measurement.repository";
import { SuggestionsRepository } from "./suggestions.repository";
import {
  answeredRefs,
  emptySuggestions,
  suggestionsResource,
  type SuggestionsResource,
} from "./suggestions.resources";

@Injectable()
export class SuggestionsService {
  /**
   * @param reads - The analysis, its suggestions and their findings.
   * @param measurements - BU.3's measurements and calibration cells.
   * @param evidence - What the findings' references name.
   */
  constructor(
    private readonly reads: SuggestionsRepository,
    private readonly measurements: MeasurementRepository,
    private readonly evidence: EvidenceRepository,
  ) {}

  /**
   * A repository's suggestion cards.
   *
   * @param organizationId - The workspace.
   * @param repoRef - The repository.
   * @param at - The instant each measurement's day N is counted to.
   * @returns The suggestions still current, and the newest analysis that composed any; none
   *   before one, or for a repository the workspace has none of.
   */
  async list(organizationId: string, repoRef: string, at: Date): Promise<SuggestionsResource> {
    const run = await this.reads.composedRun(organizationId, repoRef);
    if (run === undefined) {
      return emptySuggestions(repoRef);
    }

    const rows = await this.reads.suggestions(organizationId, repoRef);
    const [findings, measurements, calibration] = await Promise.all([
      this.reads.findings(
        organizationId,
        rows.map((row) => row.id),
      ),
      this.measurements.measurements(organizationId, repoRef, at),
      this.measurements.calibration(organizationId, repoRef),
    ]);
    // Only the references the read answers are resolved — a finding's first few, not its hundreds.
    const resolved = await this.evidence.resolve(
      organizationId,
      groupRefs(findings.flatMap(answeredRefs)),
    );

    return suggestionsResource(repoRef, run, rows, findings, measurements, calibration, resolved);
  }
}
