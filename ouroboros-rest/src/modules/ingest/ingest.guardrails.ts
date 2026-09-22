/**
 * Where a reported change-set becomes four scheduled checks — and the seam AP.3 fills.
 *
 * AP.1 ([#303](https://github.com/NobuData/ouroboros/issues/303)) has this acceptance
 * criterion:
 *
 * > A file report triggers guardrail evaluation; a run with no file changes triggers none.
 *
 * and AP.3 ([#305](https://github.com/NobuData/ouroboros/issues/305)) is what *answers* the
 * four checks: allowed paths against the pinned stage's permissions, CI-config detection, the
 * embedded secrets ruleset (option **3-A**), and review-required from workflow policy and
 * routing votes. AP.1 is blocked-by nothing and **blocks** AP.3, so this file ships first and
 * has to be honest about what it can say today.
 *
 * ---------------------------------------------------------------------------
 * **What it does: it schedules, with `pending`.**
 *
 * V048 gave `guardrail_evaluations.verdict` four words, and the fourth is documented as
 * *"pending is a check that has been scheduled and has not answered"*. That is exactly the
 * state a change-set is in between AP.1 and AP.3, and it is a state the schema was built to
 * hold: `guardrail_evaluations_pending_has_no_evidence` refuses evidence on such a row, so a
 * scheduled check cannot carry the previous verdict's offending path under this report's
 * spinner.
 *
 * The alternative was to write nothing and let AP.3 add both the scheduling and the
 * answering. That would have made this ticket's criterion untestable — *"triggers
 * evaluation"* with nothing to observe — and would have left the `change_set_seq` V049
 * allocates with no reader, which is the shape of a column that quietly stops being written.
 *
 * **So the rows are real and the verdicts are honest.** The Guardrails card renders a
 * scheduled check as pending rather than as a pass, because *"this has not been judged"* and
 * *"this was judged and was fine"* are different things to tell somebody — which is the same
 * argument V048 makes for `not_applicable` being a third answer rather than a pass.
 *
 * ---------------------------------------------------------------------------
 * **How AP.3 replaces it.** {@link GuardrailScheduler} is injected into the ingestion service
 * by token, and AP.3 provides an implementation that evaluates rather than schedules. Nothing
 * else in this module changes: the trigger point, the transaction it runs in, the
 * `change_set_seq` it is given and the *"no files, no evaluation"* rule are all AP.1's and
 * stay here.
 *
 * **It runs inside the report's transaction**, and that is deliberate rather than incidental.
 * A change-set and the verdicts about it are one fact: a report that committed without its
 * checks would leave the card showing the *previous* report's verdicts beside the new files,
 * which is precisely the drift `change_set_seq` exists to make visible. When AP.3's evaluation
 * turns out to be slow enough to want moving out of the transaction, that is a decision with
 * a cost — and it belongs in AP.3's ticket, with the cost written down.
 */

import { Inject, Injectable } from "@nestjs/common";
import type { Kysely, Transaction } from "kysely";

import { GUARDRAIL_CHECKS, type Database } from "../db/schema";

/**
 * The connection a scheduler writes through.
 *
 * A `Transaction` in practice and typed as either, so the contract is *"use the handle you
 * are given"* rather than *"take your own connection"* — the one mistake that would put the
 * verdicts outside the report's transaction.
 */
export type GuardrailWriter = Kysely<Database> | Transaction<Database>;

/** What a scheduler is told about the report it is judging. */
export interface GuardrailRequest {
  /** The run whose change-set this is. */
  readonly runId: string;
  /**
   * Which report — `runs.change_set_seq` after the write, from 1.
   *
   * Carried onto every row written, which is what makes re-evaluation history read as a
   * sequence rather than as a pile.
   */
  readonly changeSetSeq: number;
  /** How many files the change-set holds. Never zero: the caller does not schedule for none. */
  readonly files: number;
}

/**
 * What a change-set report triggers.
 *
 * An interface with an injection token rather than a concrete class, because the whole point
 * is that AP.3 substitutes for it — and because a test of *"a report with no files schedules
 * nothing"* should be able to watch a double rather than count rows.
 */
export interface GuardrailScheduler {
  /**
   * Judge — or, today, schedule — the four checks for one report.
   *
   * @param writer - The report's own transaction. Every statement must go through it.
   * @param request - Which run, which report, how large.
   * @returns How many checks were written. The change-set report returns this to the caller as
   *   `guardrailChecks`, so *"evaluation happened"* is observable in the answer.
   */
  evaluate(writer: GuardrailWriter, request: GuardrailRequest): Promise<number>;
}

/**
 * The injection token.
 *
 * A symbol-free string constant, matching how the rest of this service names tokens, and
 * namespaced so it cannot collide with a token a library registers.
 */
export const GUARDRAIL_SCHEDULER = "ouroboros:ingest:guardrail-scheduler";

/**
 * The implementation AP.1 ships: four `pending` rows per report.
 *
 * One statement, four rows, no evidence, no ruleset version — because it has not run a
 * ruleset. `policy_ref` is left null for the same reason: it is *which workflow policy said
 * so*, and nothing here has consulted one.
 */
@Injectable()
export class PendingGuardrailScheduler implements GuardrailScheduler {
  /**
   * Write one `pending` row per check.
   *
   * @param writer - The report's transaction.
   * @param request - The report.
   * @returns `GUARDRAIL_CHECKS.length` — four today, and however many the vocabulary grows to,
   *   because the count is of the set rather than a number written beside it.
   */
  async evaluate(writer: GuardrailWriter, request: GuardrailRequest): Promise<number> {
    await writer
      .insertInto("guardrail_evaluations")
      .values(
        GUARDRAIL_CHECKS.map((check) => ({
          run_id: request.runId,
          check,
          verdict: "pending" as const,
          change_set_seq: request.changeSetSeq,
        })),
      )
      .execute();

    return GUARDRAIL_CHECKS.length;
  }
}

/**
 * Nest's provider for the token above.
 *
 * Exported so `ingest.module.ts` states the binding in one line and AP.3's module can state
 * its own the same way — the substitution is then a one-line diff in a module rather than an
 * edit to the service that calls it.
 */
export const guardrailSchedulerProvider = {
  provide: GUARDRAIL_SCHEDULER,
  useClass: PendingGuardrailScheduler,
};

/** Inject the scheduler. */
export const InjectGuardrailScheduler = (): ParameterDecorator => Inject(GUARDRAIL_SCHEDULER);
