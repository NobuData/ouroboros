/**
 * `GuardrailService` — the four checks, run for real against every reported change-set.
 *
 * AP.3 ([#305](https://github.com/NobuData/ouroboros/issues/305)), decision **R5**. Bound to
 * AP.1's `GUARDRAIL_SCHEDULER` token by `GuardrailsModule`, so the ingestion service calls it
 * from inside the change-set report's transaction, exactly where the `pending` scheduler it
 * replaces used to run.
 *
 * ```
 * change-set report (AP.1) ──▶ read: run → pin → stage permissions · plan files · vote rules
 *                           ──▶ judge: allowed_paths · ci_config · secrets · review_required
 *                           ──▶ append four rows to guardrail_evaluations (never update)
 *                           ──▶ answer: {checks: 4, failures: [...]}  → needsHuman on the report
 * ```
 *
 * **Evaluation, not enforcement.** A `fail` is recorded with its evidence and returned to the
 * executor as `needsHuman`; nothing here pauses a stage or moves `runs.status`. Blocking needs an
 * executor to block and lands with AR.1 ([#315](https://github.com/NobuData/ouroboros/issues/315)).
 * The card says what is true today and does not imply a gate that is not there.
 *
 * **Re-evaluation supersedes.** Every report appends four new rows; `v_run_guardrails_latest`
 * is what the card reads, so a fixed change-set flips the latest verdict to `pass` while the
 * failing evaluation stays in the table as history.
 *
 * **Nothing it logs can carry a secret.** The one log line is the verdict summary — check names,
 * verdicts, counts and the elapsed time — built from the rows *after* `safeEvidence`, and it
 * never includes evidence at all.
 *
 * **Timing.** Each evaluation's pure part — the four checks over the change-set, the secrets scan
 * included — is timed and logged at debug, which is the ≤ 50 ms criterion measured where it runs
 * rather than only in a benchmark. The spec asserts the same budget on a typical change-set.
 */

import { Injectable, Logger } from "@nestjs/common";
import { performance } from "node:perf_hooks";

import type {
  GuardrailOutcome,
  GuardrailRequest,
  GuardrailScheduler,
  GuardrailWriter,
} from "../ingest/ingest.guardrails";
import { evaluateGuardrails, type GuardrailVerdictRow } from "./guardrails.checks";
import {
  asQueueEffort,
  countVoteRules,
  readPinnedPolicy,
  resolvePermissions,
  reviewPolicy,
  type PinnedPolicy,
} from "./guardrails.policy";
import { GuardrailsRepository } from "./guardrails.repository";
import { SECRETS_RULESET_DISCLOSURE } from "./guardrails.ruleset";

@Injectable()
export class GuardrailService implements GuardrailScheduler {
  private readonly logger = new Logger(GuardrailService.name);

  /**
   * @param repository - Every statement the evaluation issues.
   */
  constructor(private readonly repository: GuardrailsRepository) {}

  /**
   * What a `secrets` verdict can and cannot claim — for the Guardrails card's tooltip (#313).
   *
   * @returns The ruleset's version, rule count, recall class and limitation sentence.
   */
  disclosure(): typeof SECRETS_RULESET_DISCLOSURE {
    return SECRETS_RULESET_DISCLOSURE;
  }

  /**
   * Judge one change-set report and append the verdicts.
   *
   * @param writer - The report's own transaction. Every read and the write go through it.
   * @param request - The run, the report's number, and the change-set with its hunks.
   * @returns How many checks were written and which failed. A run the ingestion service has
   *   already resolved always exists; if it somehow does not, nothing is written and `0` checks
   *   are reported rather than inventing verdicts about nothing.
   */
  async evaluate(writer: GuardrailWriter, request: GuardrailRequest): Promise<GuardrailOutcome> {
    const run = await this.repository.runPolicy(writer, request.runId);

    if (run === undefined) {
      return { checks: 0, failures: [] };
    }

    const pinned =
      run.workflowVersionPin === null
        ? undefined
        : await this.repository.pinnedDefinition(
            writer,
            run.organizationId,
            run.workflowTag,
            run.workflowVersionPin,
          );
    const policy: PinnedPolicy | undefined =
      pinned === undefined ? undefined : readPinnedPolicy(pinned.definition);

    // Sequential rather than `Promise.all`: they share the report's one connection, which would
    // queue them anyway, and a fixed order keeps the statements a test records deterministic.
    const stages = await this.repository.reportedStages(writer, request.runId);
    const ticket = await this.repository.ticketFacts(writer, run);
    const rules = await this.repository.enabledRules(writer, run.organizationId);

    const started = performance.now();
    const effort = asQueueEffort(ticket.effort);
    const permissions = policy === undefined ? undefined : resolvePermissions(policy, stages);
    const review = reviewPolicy(
      policy,
      countVoteRules(rules, { labels: ticket.labels, ...(effort === undefined ? {} : { effort }) }),
    );
    const verdicts = evaluateGuardrails({
      changeSetSeq: request.changeSetSeq,
      files: request.changeSet,
      ...(ticket.planFiles === undefined ? {} : { planFiles: ticket.planFiles }),
      ...(permissions === undefined ? {} : { permissions }),
      ...(review === undefined ? {} : { review }),
    });
    const elapsed = performance.now() - started;

    await this.repository.appendVerdicts(writer, request.runId, run.workflowVersionPin, verdicts);

    const failures = verdicts.filter((row) => row.verdict === "fail").map((row) => row.check);
    this.logger.debug(summary(request, verdicts, elapsed));

    return { checks: verdicts.length, failures };
  }
}

/**
 * The one log line an evaluation writes.
 *
 * @param request - The report.
 * @param verdicts - What it decided.
 * @param elapsed - How long the checks took, in milliseconds.
 * @returns `run … change-set 3: allowed_paths=pass ci_config=pass secrets=fail … in 1.2 ms` —
 *   check names and verdicts only. Evidence is deliberately absent: even screened, a path is
 *   repository content, and a log line is the wrong place to keep it.
 */
function summary(
  request: GuardrailRequest,
  verdicts: readonly GuardrailVerdictRow[],
  elapsed: number,
): string {
  const judged = verdicts.map((row) => `${row.check}=${row.verdict}`).join(" ");

  return `run ${request.runId} change-set ${String(request.changeSetSeq)}: ${judged} in ${elapsed.toFixed(1)} ms`;
}
