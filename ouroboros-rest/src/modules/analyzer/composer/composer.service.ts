/**
 * The suggestion composer — the run's `composing` phase (BV.4,
 * [#513](https://github.com/NobuData/ouroboros/issues/513)).
 *
 * Reads what the run found, composes it through the template registry (`composer.ts`) and records
 * each suggestion with `record_analysis_suggestion()`. **Composition never fails a run**: a
 * template that throws or a suggestion the database refuses is logged and skipped, and the run
 * keeps its findings and every suggestion that did compose.
 *
 * The v2 LLM synthesis pass (BX.1) attaches beside this through the `/v0/synthesize-findings`
 * contract (`synthesis.contract.ts`); the deterministic composition here does not depend on it.
 */

import { Injectable, Logger } from "@nestjs/common";

import { describeForLog } from "../../errors/failure";
import { compose } from "./composer";
import { calibrationKey, ComposerRepository } from "./composer.repository";
import type { ComposeWindow } from "./composer.types";

/** The run a composition is for. */
export interface ComposeRun {
  id: string;
  organization_id: string;
  repo_ref: string;
}

/** What a composition recorded. */
export interface ComposeResult {
  /** The ids of the suggestions recorded (inserted or updated). */
  recorded: string[];
  /** Templates or suggestions that failed, by template id. */
  failed: string[];
}

@Injectable()
export class SuggestionComposer {
  /** Where a failed template or refused suggestion is logged. */
  private readonly logger = new Logger(SuggestionComposer.name);

  /** @param repository - The composer's reads and its write. */
  constructor(private readonly repository: ComposerRepository) {}

  /**
   * Compose and record a run's suggestions.
   *
   * @param run - The run — still `running`, so its findings are complete.
   * @param window - The corpus window it read.
   * @returns What was recorded and what failed.
   */
  async compose(run: ComposeRun, window: ComposeWindow): Promise<ComposeResult> {
    const findings = await this.repository.findingsOf(run.id);
    if (findings.length === 0) {
      return { recorded: [], failed: [] };
    }
    const factors = await this.repository.calibration(run.organization_id, run.repo_ref);
    const names = await this.repository.names(run.organization_id);

    const composition = compose(findings, {
      window,
      factor: (analyzer, impactClass) => factors.get(calibrationKey(analyzer, impactClass)) ?? 1,
      poolName: (id) => names.pools.get(id),
      runnerName: (id) => names.runners.get(id),
    });

    const recorded: string[] = [];
    const failed = composition.failures.map((failure) => {
      this.logger.error(
        `Analysis ${run.id}: template ${failure.template} could not compose.`,
        describeForLog(failure.error),
      );
      return failure.template;
    });

    for (const suggestion of composition.suggestions) {
      try {
        recorded.push(await this.repository.record(run.id, suggestion));
      } catch (error) {
        this.logger.error(
          `Analysis ${run.id}: the ${suggestion.template} suggestion was refused.`,
          describeForLog(error),
        );
        failed.push(suggestion.template);
      }
    }

    return { recorded, failed };
  }
}
