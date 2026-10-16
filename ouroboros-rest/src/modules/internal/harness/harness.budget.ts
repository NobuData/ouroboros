/**
 * The harness facade's budget enforcement — AR.1
 * ([#315](https://github.com/NobuData/ouroboros/issues/315), decision 2).
 *
 * ```
 * before each model call (never count_tokens, never mid-stream):
 *   cost cap       the run's — the stricter of the route's max_cost_cents_per_run and the
 *                  spend guard's per_run_cap_cents (#235's plan.cap)  vs  sum(cost_cents) of the run
 *   token budget   the pinned node's limits.token_budget              vs  sum(tokens_in + tokens_out)
 *                                                                        of the run · stage · attempt
 * on a breach:
 *   refuse the call   Anthropic-shaped 400: cost_cap_exceeded | token_budget_exceeded
 *   file an abort     ControlsService.submitSystem(…, "abort", reason) — the branch is kept and
 *                     REST sets the run `canceled` when the engine acks it
 *   audit             run.budget_exceeded {limit, spent, cap, stage, attempt}
 * ```
 *
 * **Once per run.** `submitSystem` answers an abort already outstanding instead of queuing a
 * second one (`queued: false`), and the audit row is written only when this call queued the abort
 * — so a harness that retries the refused call, or a second stage call racing it, refuses again
 * without a second abort or a second audit row. Once the engine acks, the run is `canceled` and
 * its credentials answer `run_finished`.
 *
 * **Why the facade, not the engine.** The facade is where every model call of a harness stage
 * passes and where the spend is metered, so it is the one place that can stop the *next* call
 * with the numbers that justify it. The engine sees the refused call fail inside its executor,
 * polls controls before it finishes the stage, and takes the abort path.
 */

import { Inject, Injectable, Optional } from "@nestjs/common";

import { RUN_BUDGET_EXCEEDED_EVENT } from "../../audit/audit.events";
import { AuditService } from "../../audit/audit.service";
import { ControlsService } from "../../controls/controls.service";
import { readPinnedWorkflow } from "../../ingest/ingest.pin";
import type { AttemptBudgetBreach } from "./harness.errors";
import { HarnessRepository, type CredentialBinding } from "./harness.repository";

/** Which limit a breach reached — `run.budget_exceeded`'s `limit`. */
export type BudgetLimit = "cost_cap" | "token_budget";

/** A breach, as the abort and the audit row record it. */
export interface BudgetBreach {
  /** Which limit. */
  readonly limit: BudgetLimit;
  /** What was spent — cents for a cost cap, tokens for a token budget. */
  readonly spent: number;
  /** The limit — cents for a cost cap, tokens for a token budget. */
  readonly cap: number;
}

/** The control queue, as this guard uses it. */
export type BudgetControls = Pick<ControlsService, "submitSystem">;

/** The audit trail, as this guard writes to it. */
export type BudgetAudit = Pick<AuditService, "record">;

/** Injection token for the clock — `Date.now` unless a suite binds one. */
export const HARNESS_BUDGET_CLOCK = "ouroboros:harness:budget-clock";

@Injectable()
export class HarnessBudgetGuard {
  /** The clock. */
  private readonly clock: () => Date;

  /**
   * @param repository - The pinned document and the attempt's token sum.
   * @param controls - The control queue the abort is filed through.
   * @param audit - The trail.
   * @param clock - The clock — `Date.now` unless a suite binds one.
   */
  constructor(
    private readonly repository: HarnessRepository,
    @Inject(ControlsService) private readonly controls: BudgetControls,
    @Inject(AuditService) private readonly audit: BudgetAudit,
    @Optional() @Inject(HARNESS_BUDGET_CLOCK) clock?: () => number,
  ) {
    this.clock = () => new Date((clock ?? Date.now)());
  }

  /**
   * Whether the credential's stage attempt has reached its token budget.
   *
   * @param binding - The credential — its run, stage and attempt.
   * @returns The breach, or `undefined` when the attempt is under budget or its stage has no
   *   `limits.token_budget` in the pinned document (no pin, a non-`llm` node, a stage the pin does
   *   not name) — nothing to enforce.
   */
  async attemptBudgetBreach(binding: CredentialBinding): Promise<AttemptBudgetBreach | undefined> {
    const definition = await this.repository.pinnedDefinition(binding);

    if (definition === undefined) {
      return undefined;
    }

    const budget = readPinnedWorkflow(definition).stages.get(binding.stage)?.tokenBudget;

    if (budget === undefined) {
      return undefined;
    }

    const spent = await this.repository.attemptTokens(binding);

    return spent >= budget
      ? { limitTokens: budget, spentTokens: spent, stage: binding.stage, attempt: binding.attempt }
      : undefined;
  }

  /**
   * File the system abort for a breach, and audit it — once per run.
   *
   * @param binding - The credential whose call was refused.
   * @param breach - Which limit, what was spent and the limit.
   * @returns Whether this call queued the abort (`false` when one was already outstanding, or the
   *   run has already finished).
   */
  async breached(binding: CredentialBinding, breach: BudgetBreach): Promise<boolean> {
    const submitted = await this.controls.submitSystem(
      binding.organizationId,
      binding.runId,
      "abort",
      breach.limit === "cost_cap" ? "cost_cap_exceeded" : "token_budget_exceeded",
    );

    if (submitted?.queued !== true) {
      return false;
    }

    await this.audit.record({
      organizationId: binding.organizationId,
      actorId: null,
      action: RUN_BUDGET_EXCEEDED_EVENT,
      subjectType: "run",
      subjectId: binding.runId,
      at: this.clock(),
      detail: {
        limit: breach.limit,
        spent: breach.spent,
        cap: breach.cap,
        stage: binding.stage,
        attempt: binding.attempt,
      },
    });

    return true;
  }
}
