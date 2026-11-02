/**
 * Opening a live run's draft pull request — the control plane's half of DI.3
 * ([#1311](https://github.com/NobuData/ouroboros/issues/1311)).
 *
 * ```
 * POST /internal/runs/:id/pull-request   {epoch, idempotency_key}
 *   → {pull_request_id, number, url, draft: true, created}
 *   404 run_not_found · 404 repository_not_found · 409 fenced · 409 run_not_executable
 *   409 idempotency_key_reused · 409 not_pushed · 409 pr_source_unavailable · 409 draft_refused
 *   502 pr_create_failed
 * ```
 *
 * The engine calls it at the `open_pr_automerge` terminal, after its last publish (DI.2) and
 * before it finishes the run `review`:
 *
 * ```
 * open(run)
 *   ├─ tx 1, the run locked ─ fenced · run_not_executable
 *   │                       ─ a PR already linked to the run?  → it, created: false   (idempotent)
 *   │                       ─ not_pushed · pr_source_unavailable
 *   │                       ─ the body's facts: stages, plan claims, latest farm job, spend
 *   ├─ PrSyncService.create(source, {head: run branch, base: default branch, title, body,
 *   │                                draft: true})                    (the host, outside any tx)
 *   │                       ─ draft_refused (validation, or an answer with draft: false)
 *   │                       ─ pr_create_failed (anything else)
 *   ├─ PrSyncService.sync(source, #n)                                  (the mirror row)
 *   ├─ tx 2, the run locked ─ link: pull_requests.run_id/ticket_id/draft, runs.pr_number
 *   │                       ─ audit run.pull_request_opened · the receipt
 *   └─ CriteriaService.importPlan(pr)                                   (the plan's claims)
 * ```
 *
 * **Always a draft.** The request carries no draft flag, and this service passes the literal
 * {@link LOOP_PULL_REQUEST_DRAFT} to the PR plane's only opener, whose `draftFor` can only turn a
 * requested draft *on* — so a workspace whose dry-run policy was switched off mid-run still gets
 * a draft. A host that answers a ready PR anyway (the branch already had one open) is refused
 * `draft_refused`, and that PR is **not** linked to the run.
 *
 * **Idempotent by the run, not only by the key.** A resumed terminal asks again under a new
 * epoch and a new key; the PR linked to the run answers it (`created: false`) and nothing is
 * written. Between the host's answer and the link, a crash leaves an unlinked PR on the host; the
 * next request's `createPR` finds that open PR for the branch (the SPI is idempotent by branch and
 * base) and links it.
 *
 * **The actor is the person who started the run** (`runs.started_by`, V151), as for DI.2's push;
 * the imported criteria name them as their author too (null when nobody started the run).
 */

import { Injectable, Logger } from "@nestjs/common";

import { RUN_PULL_REQUEST_OPENED_EVENT } from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import { AppConfigService } from "../config/config.service";
import type { Run } from "../db/schema";
import { DomainError } from "../errors/error.envelope";
import { describeForLog } from "../errors/failure";
import { CRITERIA_ERRORS } from "../pull-requests/criteria/criteria.errors";
import { CriteriaService } from "../pull-requests/criteria/criteria.service";
import { PR_SYNC_ERRORS } from "../pull-requests/pr-sync.errors";
import { PrSyncService } from "../pull-requests/pr-sync.service";
import { readSpendTotals } from "../runs/run.spend";
import { TicketSourceError } from "../ticket-sources/ticket-source.errors";
import type { PrRef } from "../ticket-sources/ticket-source.pr";
import { supportsPullRequests } from "../ticket-sources/ticket-source.provider";
import { TicketSourceRegistry } from "../ticket-sources/ticket-source.registry";
import { repositoryNotFound, runNotExecutable, runNotFound } from "./ingest.errors";
import { assertEpoch } from "./ingest.fence";
import { requestDigest } from "./ingest.idempotency";
import { commitReceipt, replayedReceipt, type ReceiptScope } from "./ingest.receipts";
import { IngestRepository, type Writer } from "./ingest.repository";
import { EXECUTABLE_RUN_STATUSES, RunExecutionRepository } from "./run-execution.repository";
import { composePullRequestBody } from "./run-pull-request.body";
import type { OpenPullRequestDto } from "./run-pull-request.dto";
import {
  draftRefused,
  notPushed,
  prCreateFailed,
  prSourceUnavailable,
} from "./run-pull-request.errors";
import {
  RunPullRequestRepository,
  type LinkedPullRequest,
  type RunTicketSource,
} from "./run-pull-request.repository";
import type { PullRequestOpenedResource } from "./run-pull-request.resources";

/**
 * What a loop asks the host for — **always** a draft. A constant, not a parameter: no code path
 * passes anything else, and `run-pull-request.service.spec.ts` asserts the host received it with
 * the workspace's dry-run policy switched off.
 */
export const LOOP_PULL_REQUEST_DRAFT = true;

/** The ledger operation the receipt is written under (V152). */
export const PULL_REQUEST_OPERATION = "run.pull_request";

/** What the first transaction decided. */
type Prepared =
  /** The run already has its PR, or this key already answered: hand it back. */
  | { readonly kind: "answered"; readonly answer: PullRequestOpenedResource }
  /** Open one. */
  | {
      readonly kind: "open";
      readonly run: Run;
      readonly ticket: RunTicketSource;
      readonly head: string;
      readonly base: string;
      readonly body: string;
    };

@Injectable()
export class RunPullRequestService {
  /** Where a plan import that failed after the link is logged. */
  private readonly logger = new Logger(RunPullRequestService.name);

  /**
   * @param runs - The run's lock, the transaction and the receipts.
   * @param execution - The run's repository and its default branch.
   * @param store - The linked PR, the push record, the ticket's source, the body's rows, the link.
   * @param registry - The providers by kind — whether the source's opens pull requests.
   * @param prs - The PR plane's opener and sync — the only way to the SPI's `createPR`.
   * @param criteria - The plan's claims, before the PR and imported into it after.
   * @param audit - The trail.
   * @param config - `OURO_UI_URL`, for the run console's link.
   */
  constructor(
    private readonly runs: IngestRepository,
    private readonly execution: RunExecutionRepository,
    private readonly store: RunPullRequestRepository,
    private readonly registry: TicketSourceRegistry,
    private readonly prs: PrSyncService,
    private readonly criteria: CriteriaService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Open the run's draft pull request and link it to the run — or answer the one it has.
   *
   * @param runId - The run.
   * @param request - The epoch and the key.
   * @returns The PR, a draft, and whether this request opened it.
   * @throws {NotFoundError} `404 run_not_found`, `404 repository_not_found`.
   * @throws {ConflictError} `409 fenced`, `409 run_not_executable`, `409 idempotency_key_reused`,
   *   `409 not_pushed`, `409 pr_source_unavailable`, `409 draft_refused`.
   * @throws {UpstreamError} `502 pr_create_failed`.
   */
  async open(runId: string, request: OpenPullRequestDto): Promise<PullRequestOpenedResource> {
    // The run is part of the digest: one key reused for another run is refused, not replayed.
    const digest = requestDigest({ run_id: runId, ...request });
    const prepared = await this.runs.transaction((trx) =>
      this.prepare(trx, runId, request, digest),
    );

    if (prepared.kind === "answered") {
      return prepared.answer;
    }

    const { run, ticket } = prepared;
    const ref = await this.create(run, ticket, prepared);
    const prId = await this.mirror(run, ticket, ref);

    const linked = await this.runs.transaction(async (trx) => {
      const locked = await this.locked(trx, runId);

      assertEpoch(locked, request.epoch);

      const answered = await this.answered(trx, locked, this.scope(locked, request, digest));

      if (answered !== undefined) {
        return { answer: answered, fresh: false };
      }

      await this.store.link(trx, {
        run: locked,
        prId,
        number: ref.number,
        ticketId: ticket.ticketId,
      });

      await this.audit.record({
        organizationId: locked.organization_id,
        actorId: locked.started_by,
        action: RUN_PULL_REQUEST_OPENED_EVENT,
        subjectType: "run",
        subjectId: locked.id,
        at: new Date(),
        detail: { number: ref.number, url: ref.url, draft: true },
      });

      const answer = await commitReceipt<PullRequestOpenedResource>(
        this.runs,
        trx,
        this.scope(locked, request, digest),
        locked.id,
        {
          pull_request_id: prId,
          number: ref.number,
          url: ref.url,
          draft: true,
          created: true,
        },
      );

      return { answer, fresh: true };
    });

    if (linked.fresh) {
      // After the link has committed: the import locks the PR row the link just wrote.
      await this.importCriteria(run, prId);
    }

    return linked.answer;
  }

  /**
   * The first transaction: the fence, the idempotent answer, the refusals that need only the
   * database, and the facts the body is composed from.
   *
   * @param trx - The transaction.
   * @param runId - The run.
   * @param request - The epoch and the key.
   * @param digest - The request's digest.
   * @returns The answer to hand back, or what to open.
   */
  private async prepare(
    trx: Writer,
    runId: string,
    request: OpenPullRequestDto,
    digest: string,
  ): Promise<Prepared> {
    const run = await this.locked(trx, runId);

    assertEpoch(run, request.epoch);
    assertExecutable(run);

    const answered = await this.answered(trx, run, this.scope(run, request, digest));

    if (answered !== undefined) {
      return { kind: "answered", answer: answered };
    }

    if (run.branch_name === null || !(await this.store.pushed(trx, run))) {
      throw notPushed(run.branch_name);
    }

    const ticket = await this.store.ticketSource(trx, run);

    if (ticket === undefined) {
      throw prSourceUnavailable("no_source", null);
    }

    const provider = this.registry.find(ticket.kind);

    if (
      provider === undefined ||
      !supportsPullRequests(provider) ||
      !provider.capabilities().pr.create
    ) {
      throw prSourceUnavailable("no_pull_requests", ticket.sourceId);
    }

    const repository = await this.execution.repositoryOf(trx, run);

    if (repository === undefined) {
      throw repositoryNotFound(run.github_repo_id);
    }

    if (repository.defaultBranch === null) {
      throw prSourceUnavailable("no_base_branch", ticket.sourceId);
    }

    const [stages, build, spend, claims] = await Promise.all([
      this.store.stages(trx, run.id),
      this.store.latestBuild(trx, run),
      readSpendTotals(trx, run.id),
      this.criteria.planClaims(run.organization_id, ticket.ticketId),
    ]);

    const body = composePullRequestBody({
      uiUrl: this.config.uiUrl,
      run: {
        id: run.id,
        loopSeq: run.loop_seq,
        workflowTag: run.workflow_tag,
        workflowVersion: run.workflow_version_pin,
        model: run.model,
      },
      issue: { number: run.issue_number, title: run.issue_title },
      stages,
      claims,
      build,
      spend: {
        costCents: spend.costCents,
        unpricedEvents: spend.unpricedEvents,
        tokens: spend.tokensIn + spend.tokensOut,
      },
    });

    return {
      kind: "open",
      run,
      ticket,
      head: run.branch_name,
      base: repository.defaultBranch,
      body,
    };
  }

  /**
   * The PR the run already has, or the answer this key already got.
   *
   * @param trx - The transaction.
   * @param run - The run, locked.
   * @param scope - The receipt's scope.
   * @returns The answer, or `undefined` when there is none yet.
   * @throws {ConflictError} `409 idempotency_key_reused`.
   */
  private async answered(
    trx: Writer,
    run: Run,
    scope: ReceiptScope,
  ): Promise<PullRequestOpenedResource | undefined> {
    const linked = await this.store.linked(trx, run);

    if (linked !== undefined) {
      return existing(linked);
    }

    const replay = await replayedReceipt<PullRequestOpenedResource>(this.runs, trx, scope);

    return replay.replayed ? replay.response : undefined;
  }

  /**
   * Ask the host to open the PR — **as a draft**, whatever the policy says now.
   *
   * @param run - The run.
   * @param ticket - The ticket and its source.
   * @param pr - The branches and the body.
   * @returns The host's PR, which is a draft.
   * @throws {ConflictError} `409 pr_source_unavailable`, `409 draft_refused`.
   * @throws {UpstreamError} `502 pr_create_failed`.
   */
  private async create(
    run: Run,
    ticket: RunTicketSource,
    pr: { readonly head: string; readonly base: string; readonly body: string },
  ): Promise<PrRef> {
    let ref: PrRef | null;

    try {
      ref = await this.prs.create(
        run.organization_id,
        ticket.sourceId,
        {
          branch: pr.head,
          base: pr.base,
          title: run.issue_title,
          body: pr.body,
          draft: LOOP_PULL_REQUEST_DRAFT,
        },
        run.github_repo_id,
      );
    } catch (error) {
      throw hostRefusal(error, ticket.sourceId, true);
    }

    if (ref === null) {
      throw prSourceUnavailable("no_pull_requests", ticket.sourceId);
    }

    if (!ref.draft) {
      throw draftRefused({ url: ref.url, number: ref.number });
    }

    return ref;
  }

  /**
   * Mirror the PR the host opened, so it has a row to link.
   *
   * @param run - The run.
   * @param ticket - The ticket and its source.
   * @param ref - The host's PR.
   * @returns The mirror row's id.
   * @throws {UpstreamError} `502 pr_create_failed` — the host could not be read back; the next
   *   request finds the same open PR and tries again.
   */
  private async mirror(run: Run, ticket: RunTicketSource, ref: PrRef): Promise<string> {
    try {
      return (await this.prs.sync(run.organization_id, ticket.sourceId, ref.number)).prId;
    } catch (error) {
      throw hostRefusal(error, ticket.sourceId, false);
    }
  }

  /**
   * Import the ticket's plan criteria into the PR (decision 2). Best effort once linked: a plan
   * with no criteria is the body's *No acceptance criteria were imported.*, and any other failure
   * is logged — the PR stays linked, and the import can be repeated from the PR page.
   *
   * @param run - The run.
   * @param prId - The PR.
   */
  private async importCriteria(run: Run, prId: string): Promise<void> {
    try {
      await this.criteria.importPlan(run.organization_id, prId, { id: run.started_by });
    } catch (error) {
      if (
        error instanceof DomainError &&
        (error.code === CRITERIA_ERRORS.planContextMissing ||
          error.code === CRITERIA_ERRORS.planCriteriaMissing)
      ) {
        return;
      }

      this.logger.error(
        `Importing the plan criteria into run ${run.id}'s draft PR ${prId} failed; import them from the PR page.`,
        describeForLog(error),
      );
    }
  }

  /**
   * The receipt's scope for this request.
   *
   * @param run - The run.
   * @param request - The key.
   * @param digest - The request's digest.
   * @returns The scope.
   */
  private scope(run: Run, request: OpenPullRequestDto, digest: string): ReceiptScope {
    return {
      organizationId: run.organization_id,
      operation: PULL_REQUEST_OPERATION,
      idempotencyKey: request.idempotency_key,
      digest,
    };
  }

  /**
   * The run, locked for the rest of the transaction.
   *
   * @param writer - The transaction.
   * @param run - The run's id.
   * @returns The row.
   * @throws {NotFoundError} `404 run_not_found`.
   */
  private async locked(writer: Writer, run: string): Promise<Run> {
    const row = await this.runs.lockRun(writer, run);

    if (row === undefined) {
      throw runNotFound(run);
    }

    return row;
  }
}

/**
 * The answer for a run that already has its PR.
 *
 * @param linked - The PR.
 * @returns It, `created: false`.
 */
function existing(linked: LinkedPullRequest): PullRequestOpenedResource {
  return {
    pull_request_id: linked.id,
    number: linked.number,
    url: linked.url,
    draft: true,
    created: false,
  };
}

/**
 * A refusal from the PR plane or the host, as this route's codes.
 *
 * @param error - What was thrown.
 * @param sourceId - The source asked.
 * @param creating - Whether this was the create (a validation refusal is then `draft_refused`).
 * @returns The error to throw — the original when it is none of these.
 */
function hostRefusal(error: unknown, sourceId: string, creating: boolean): unknown {
  if (
    error instanceof DomainError &&
    (error.code === PR_SYNC_ERRORS.sourceNotFound || error.code === PR_SYNC_ERRORS.noPullRequests)
  ) {
    return prSourceUnavailable("no_pull_requests", sourceId);
  }

  if (TicketSourceError.is(error)) {
    return creating && error.errorClass === "validation"
      ? draftRefused({ message: error.detail })
      : prCreateFailed(error.errorClass, error.detail);
  }

  return error;
}

/**
 * Refuse to open a PR for a run that is not `coding` or `building` — nothing executes it.
 *
 * @param run - The run, locked.
 * @throws {ConflictError} `409 run_not_executable`.
 */
function assertExecutable(run: Pick<Run, "id" | "status">): void {
  if (!(EXECUTABLE_RUN_STATUSES as readonly string[]).includes(run.status)) {
    throw runNotExecutable(run.id, run.status);
  }
}
