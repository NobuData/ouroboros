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
 *                                     · protected paths (#380) · live allow-once grants (#459)
 *                           ──▶ judge: allowed_paths · ci_config · secrets · review_required
 *                           ──▶ append four rows to guardrail_evaluations (never update)
 *                           ──▶ consume the grants a passing allowed_paths relied on
 *                           ──▶ answer: {checks: 4, failures: [...]}  → needsHuman on the report
 * ```
 *
 * **Evaluation, not enforcement.** A `fail` is recorded with its evidence and returned to the
 * executor as `needsHuman`; nothing here pauses a stage or moves `runs.status`. Blocking needs an
 * executor to block and lands with AR.1 ([#315](https://github.com/NobuData/ouroboros/issues/315)).
 * The card says what is true today and does not imply a gate that is not there.
 *
 * **Allow once means once** (#459, decision **X3**). A protected path a live grant covers does not
 * fail `allowed_paths`; when the verdict passes with a grant's help, the grant is consumed against
 * that verdict's row in the same transaction, so the run's next report is refused again. The
 * grants are read `for update`, and a grant that can no longer be consumed fails the report
 * rather than leaving a pass that nothing paid for.
 *
 * **Re-evaluation supersedes.** Every report appends four new rows; `v_run_guardrails_latest`
 * is what the card reads, so a fixed change-set flips the latest verdict to `pass` while the
 * failing evaluation stays in the table as history.
 *
 * **Re-judging the paths without a report** ({@link GuardrailService.reevaluatePaths}, BN.2
 * [#462](https://github.com/NobuData/ouroboros/issues/462), the third #305 amendment). When a person
 * grants an allow-once from the inbox, the inbox decides nothing about writability: it asks this
 * service to judge `allowed_paths` again over the change-set the run already reported
 * (`run_files`, at its `change_set_seq`). Only that one check is re-judged — the hunks the secrets
 * scan needs were never stored, and re-writing `secrets` as `not_applicable` would hide a real
 * failure behind a later row. The grant is consumed by the passing verdict exactly as a report's
 * would.
 *
 * **Nothing it logs can carry a secret.** The one log line is the verdict summary — check names,
 * verdicts, counts and the elapsed time — built from the rows *after* `safeEvidence`, and it
 * never includes evidence at all.
 *
 * **Timing.** Each evaluation's pure part — the four checks over the change-set, the secrets scan
 * included — is timed and logged at debug, which is the ≤ 50 ms criterion measured where it runs
 * rather than only in a benchmark. The spec asserts the same budget on a typical change-set.
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { performance } from "node:perf_hooks";

import type {
  GuardrailOutcome,
  GuardrailRequest,
  GuardrailScheduler,
  GuardrailWriter,
} from "../ingest/ingest.guardrails";
import {
  checkAllowedPaths,
  evaluateGuardrails,
  exceptionsSpent,
  type GuardrailInput,
  type GuardrailVerdictRow,
} from "./guardrails.checks";
import {
  asQueueEffort,
  countVoteRules,
  readPinnedPolicy,
  resolvePermissions,
  reviewPolicy,
  type PinnedPolicy,
} from "./guardrails.policy";
import { PolicyResolutionService } from "../policies/policy-resolution.service";
import { GuardrailsRepository, type RunPolicyRow } from "./guardrails.repository";
import { SECRETS_RULESET_DISCLOSURE } from "./guardrails.ruleset";

/** What re-judging a run's paths decided ({@link GuardrailService.reevaluatePaths}). */
export interface PathReevaluation {
  /** The new `allowed_paths` row of `guardrail_evaluations`. */
  readonly evaluationId: string;
  /** Its verdict — `pass` when every reported path is now allowed. */
  readonly verdict: GuardrailVerdictRow["verdict"];
  /** The reported change-set it judged (`runs.change_set_seq`). */
  readonly changeSetSeq: number;
  /** The allow-once grants the verdict consumed, by id. */
  readonly grantsSpent: readonly string[];
}

@Injectable()
export class GuardrailService implements GuardrailScheduler {
  private readonly logger = new Logger(GuardrailService.name);

  /**
   * @param repository - Every statement the evaluation issues.
   * @param policies - The org policy document (BQ.2, #481) — its `protected_paths` globs join each
   *   repository's own. Absent in the suites that predate it, which then read the rows alone.
   */
  constructor(
    private readonly repository: GuardrailsRepository,
    @Optional() private readonly policies?: PolicyResolutionService,
  ) {}

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

    const input = await this.readInput(
      writer,
      run,
      request.runId,
      request.changeSetSeq,
      request.changeSet,
    );

    // Timed from here: the pure part, the ≤ 50 ms budget, as before the reads were shared.
    const started = performance.now();
    const verdicts = evaluateGuardrails(input);
    const elapsed = performance.now() - started;

    const written = await this.repository.appendVerdicts(
      writer,
      request.runId,
      run.workflowVersionPin,
      verdicts,
    );
    await this.consumeGrants(writer, input, verdicts, written);

    const failures = verdicts.filter((row) => row.verdict === "fail").map((row) => row.check);
    this.logger.debug(summary(request, verdicts, elapsed));

    return { checks: verdicts.length, failures };
  }

  /**
   * Re-judge `allowed_paths` over the change-set a run already reported, and consume the grants a
   * passing verdict relied on — what **Allow once** asks of this plane (BN.2, #462).
   *
   * @param writer - The caller's transaction; the grant it wrote is visible through it.
   * @param runId - The run.
   * @returns The new verdict and the grants it spent, or `undefined` when the run does not exist
   *   or has reported no change-set yet — nothing to re-judge.
   * @throws {Error} When a grant read as live cannot be consumed (see {@link consumeGrants}).
   */
  async reevaluatePaths(
    writer: GuardrailWriter,
    runId: string,
  ): Promise<PathReevaluation | undefined> {
    const run = await this.repository.runPolicy(writer, runId);
    const recorded =
      run === undefined ? undefined : await this.repository.recordedChangeSet(writer, runId);

    if (run === undefined || recorded === undefined) {
      return undefined;
    }

    const input = await this.readInput(
      writer,
      run,
      runId,
      recorded.changeSetSeq,
      recorded.paths.map((path) => ({ path })),
    );
    const verdict = checkAllowedPaths(input);
    const written = await this.repository.appendVerdicts(writer, runId, run.workflowVersionPin, [
      verdict,
    ]);
    const evaluationId = written.get("allowed_paths");

    if (evaluationId === undefined) {
      throw new Error(`the allowed_paths re-evaluation of run ${runId} wrote no row`);
    }

    const grantsSpent = await this.consumeGrants(writer, input, [verdict], written);

    return {
      evaluationId,
      verdict: verdict.verdict,
      changeSetSeq: recorded.changeSetSeq,
      grantsSpent,
    };
  }

  /**
   * Everything the checks judge a change-set against, read through the caller's writer.
   *
   * @param writer - The transaction.
   * @param run - The run's policy row.
   * @param runId - The run.
   * @param changeSetSeq - The report being judged.
   * @param files - Its paths, with hunks where the report carried them.
   * @returns The checks' input, live allow-once grants included (read `for update`).
   */
  private async readInput(
    writer: GuardrailWriter,
    run: RunPolicyRow,
    runId: string,
    changeSetSeq: number,
    files: GuardrailInput["files"],
  ): Promise<GuardrailInput> {
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
    const stages = await this.repository.reportedStages(writer, runId);
    const ticket = await this.repository.ticketFacts(writer, run);
    const rules = await this.repository.enabledRules(writer, run.organizationId);
    // The union (BQ.2, #481): the repository's own rows and the org policy's globs, so publishing
    // a glob protects it on the next run without a write to the rows, and absorbing the rows into
    // the document never un-protects a path.
    const repositoryGlobs = await this.repository.protectedPaths(writer, run);
    const orgGlobs =
      this.policies === undefined
        ? undefined
        : await this.policies.resolve(run.organizationId, "protected_paths");
    const policyGlobs = orgGlobs?.value.globs ?? [];
    const protectedPaths = [...new Set([...repositoryGlobs, ...policyGlobs])].sort();
    const exceptions = await this.repository.liveExceptions(writer, run, runId);

    const effort = asQueueEffort(ticket.effort);
    const permissions = policy === undefined ? undefined : resolvePermissions(policy, stages);
    const review = reviewPolicy(
      policy,
      countVoteRules(rules, { labels: ticket.labels, ...(effort === undefined ? {} : { effort }) }),
    );

    return {
      changeSetSeq,
      files,
      ...(ticket.planFiles === undefined ? {} : { planFiles: ticket.planFiles }),
      ...(permissions === undefined ? {} : { permissions }),
      protectedPaths,
      ...(orgGlobs === undefined || policyGlobs.length === 0
        ? {}
        : { policyGlobs: { globs: policyGlobs, version: orgGlobs.version } }),
      exceptions,
      ...(review === undefined ? {} : { review }),
    };
  }

  /**
   * Spend the allow-once grants a passing `allowed_paths` verdict relied on.
   *
   * @param writer - The report's transaction.
   * @param input - What the checks judged, grants included.
   * @param verdicts - What they decided.
   * @param written - The written rows' ids by check.
   * @returns The grants spent, by id.
   * @throws {Error} When a grant read as live could not be consumed — which the `for update` read
   *   rules out, so it fails the report rather than keep a pass nothing paid for.
   */
  private async consumeGrants(
    writer: GuardrailWriter,
    input: GuardrailInput,
    verdicts: readonly GuardrailVerdictRow[],
    written: ReadonlyMap<string, string>,
  ): Promise<string[]> {
    const allowed = verdicts.find((row) => row.check === "allowed_paths");
    const evaluation = written.get("allowed_paths");

    if (allowed === undefined || evaluation === undefined) {
      return [];
    }

    const spent = exceptionsSpent(input, allowed);

    for (const grant of spent) {
      if (!(await this.repository.consumeException(writer, grant, evaluation))) {
        throw new Error(
          `allow-once grant ${grant} could not be consumed by evaluation ${evaluation}`,
        );
      }
    }

    return spent;
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
