/**
 * The flake state reads — AT.3 ([#331](https://github.com/NobuData/ouroboros/issues/331)): one
 * case's flake and quarantine state, and the workspace summary that feeds the strip's `watching`
 * count (#335) and its link onward to insights.
 */

import { Inject, Injectable } from "@nestjs/common";

import { NotFoundError } from "../errors/error.envelope";
import { CANDIDATE_LIMIT } from "./flake-scorer.service";
import { FlakesRepository, type FlakesStore } from "./flakes.repository";
import {
  caseFlakeResource,
  summaryResource,
  type CaseFlakeResource,
  type FlakeSummaryResource,
} from "./flakes.resources";

/** The code a read of a case the workspace never observed answers with. */
export const FLAKE_CASE_NOT_FOUND = "flake_case_not_found";

/** See this file's header. */
@Injectable()
export class FlakeStateService {
  /**
   * @param store - The statements.
   */
  constructor(@Inject(FlakesRepository) private readonly store: FlakesStore) {}

  /**
   * One case's flake and quarantine state.
   *
   * @param organizationId - The workspace.
   * @param caseKey - The durable key.
   * @returns The state; `healthy` with a null score for an observed case never scored.
   * @throws {NotFoundError} `flake_case_not_found` when the workspace has never observed the case —
   *   another workspace's case included.
   */
  async caseState(organizationId: string, caseKey: string): Promise<CaseFlakeResource> {
    const row = await this.store.caseState(organizationId, caseKey);

    if (row === undefined) {
      throw new NotFoundError(
        FLAKE_CASE_NOT_FOUND,
        "This workspace has never observed that case.",
        {
          caseKey,
        },
      );
    }

    return caseFlakeResource(row);
  }

  /**
   * The workspace summary: counts, candidates and the last nightly pass.
   *
   * @param organizationId - The workspace.
   * @returns The summary.
   */
  async summary(organizationId: string): Promise<FlakeSummaryResource> {
    const [formulaVersion, counts, candidates, lastRun] = await Promise.all([
      this.store.currentFormula(),
      this.store.stateCounts(organizationId),
      this.store.candidates(organizationId, CANDIDATE_LIMIT),
      this.store.lastRun(organizationId),
    ]);

    return summaryResource(formulaVersion, counts, candidates, lastRun);
  }
}
