/**
 * Publishing a live run's branch — the control plane's half of DI.2
 * ([#1310](https://github.com/NobuData/ouroboros/issues/1310)).
 *
 * ```
 * POST /internal/runs/:id/push         {epoch, idempotency_key, branch, head_sha, change_set_seq, force?}
 *   → {refspec, remote, username, password}
 *   404 run_not_found · 409 fenced · 409 run_not_executable · 409 force_push_refused
 *   409 branch_mismatch · 409 not_a_run_branch · 409 default_branch · 409 changes_not_evaluated
 *   409 guardrail_blocking · 409 github_not_configured · 409 protected_branch
 *   502 branch_check_failed
 * POST /internal/runs/:id/push/result  {epoch, idempotency_key, branch, outcome, pushed_sha?, reason?}
 *   → {recorded: true}
 *   404 run_not_found · 409 fenced · 409 idempotency_key_reused
 * ```
 *
 * **The engine names a branch; the control plane builds the refspec.** The grant answers exactly
 * one refspec, `refs/heads/<run branch>:refs/heads/<run branch>`, without `+`, from the run's own
 * row — never from anything the stage produced. The engine checks it again before its git client
 * touches the network.
 *
 * **Every refusal comes before the credential.** The rules that need only the database are
 * `run-push.policy.ts`'s, decided under the run's lock; the one that needs GitHub — is this branch
 * protected? — runs after them, through the workspace's GitHub client; and only when all have
 * passed is the token opened, for this one answer, the way #617 opens it for an engine fetch. It
 * is never stored: the grant writes no receipt (a receipt stores its answer), and the audit row
 * names the branch and the commit, nothing of the credential.
 *
 * **The actor is the person who started the run** (`runs.started_by`, V151), on both audit rows
 * — the grant (`run.push_granted`) and the engine's report of how it ended (`run.branch_pushed`).
 */

import { Injectable } from "@nestjs/common";

import { AuditService } from "../audit/audit.service";
import { RUN_BRANCH_PUSHED_EVENT, RUN_PUSH_GRANTED_EVENT } from "../audit/audit.events";
import type { Run } from "../db/schema";
import { GithubClientFactory } from "../github/github.client.factory";
import { GithubCredentialsService } from "../github/github.credentials.service";
import { GITHUB_FAILURES, GithubApiError } from "../github/github.errors";
import { CodeWorkspace } from "../research/code/code.workspace";
import { repositoryNotFound, runNotExecutable, runNotFound } from "./ingest.errors";
import { assertEpoch } from "./ingest.fence";
import { requestDigest } from "./ingest.idempotency";
import { commitReceipt, replayedReceipt, type ReceiptScope } from "./ingest.receipts";
import { IngestRepository, type Writer } from "./ingest.repository";
import {
  EXECUTABLE_RUN_STATUSES,
  RunExecutionRepository,
  type RunRepositoryFacts,
} from "./run-execution.repository";
import type { ReportPushResultDto, RequestPushDto } from "./run-push.dto";
import { branchCheckFailed, githubNotConfigured, protectedBranch } from "./run-push.errors";
import { pushRefusal } from "./run-push.policy";
import { RunPushRepository } from "./run-push.repository";
import type { PushGrantResource, PushRecordedResource } from "./run-push.resources";

/** GitHub's basic-auth user for a token — what the engine's git client presents. */
export const PUSH_USERNAME = "x-access-token";

/** The one route the grant asks GitHub: a branch, and whether it is protected. */
export const BRANCH_ROUTE = "GET /repos/{owner}/{repo}/branches/{branch}";

/** What the grant read under the run's lock. */
interface GrantContext {
  readonly run: Run;
  readonly repository: RunRepositoryFacts;
}

@Injectable()
export class RunPushService {
  /**
   * @param runs - The run's lock, the transaction and the receipts.
   * @param execution - The run's repository.
   * @param pushes - The latest guardrail verdicts.
   * @param credentials - Whether the workspace holds a GitHub token — asked, not opened.
   * @param github - The workspace's GitHub client, for the protected-branch read.
   * @param code - The repository's clone URL and the token, opened per call (#617).
   * @param audit - The trail.
   */
  constructor(
    private readonly runs: IngestRepository,
    private readonly execution: RunExecutionRepository,
    private readonly pushes: RunPushRepository,
    private readonly credentials: GithubCredentialsService,
    private readonly github: GithubClientFactory,
    private readonly code: CodeWorkspace,
    private readonly audit: AuditService,
  ) {}

  /**
   * Grant one push of a run's branch, or refuse it.
   *
   * @param runId - The run.
   * @param request - The branch, the commit, the change-set, and whether force was asked for.
   * @returns The refspec, the remote and the credential for this one push.
   * @throws {NotFoundError} `404 run_not_found`, `404 repository_not_found`.
   * @throws {ConflictError} `409 fenced`, `409 run_not_executable`, or one of the push refusals
   *   (`run-push.errors.ts`).
   * @throws {UpstreamError} `502 branch_check_failed`.
   */
  async grant(runId: string, request: RequestPushDto): Promise<PushGrantResource> {
    const context = await this.runs.transaction(async (trx) => {
      const run = await this.locked(trx, runId);

      assertEpoch(run, request.epoch);
      assertExecutable(run);

      const repository = await this.execution.repositoryOf(trx, run);

      if (repository === undefined) {
        throw repositoryNotFound(run.github_repo_id);
      }

      const refusal = pushRefusal({
        branch: request.branch,
        force: request.force === true,
        changeSetSeq: request.change_set_seq,
        runBranch: run.branch_name,
        runChangeSetSeq: run.change_set_seq,
        defaultBranch: repository.defaultBranch,
        guardrails: await this.pushes.latestGuardrails(trx, runId),
        githubConfigured: await this.credentials.isConfigured(run.organization_id),
      });

      if (refusal !== undefined) {
        throw refusal;
      }

      return { run, repository } satisfies GrantContext;
    });

    const { run, repository } = context;

    // After every database refusal: the one that needs the network.
    await this.refuseProtected(run.organization_id, repository.slug, request.branch);

    const ref = await this.code.repositoryRef(run.organization_id, {
      id: repository.id,
      slug: repository.slug,
      name: repository.name,
      defaultBranch: repository.defaultBranch ?? "",
    });

    if (ref.token === null) {
      // The token went away between the question and the opening — the same refusal.
      throw githubNotConfigured(request.branch);
    }

    // Before the credential leaves: a grant nobody can account for is the one this row prevents.
    await this.audit.record({
      organizationId: run.organization_id,
      actorId: run.started_by,
      action: RUN_PUSH_GRANTED_EVENT,
      subjectType: "run",
      subjectId: run.id,
      at: new Date(),
      detail: { branch: request.branch, head_sha: request.head_sha },
    });

    return {
      refspec: `refs/heads/${request.branch}:refs/heads/${request.branch}`,
      remote: ref.remote,
      username: PUSH_USERNAME,
      password: ref.token,
    };
  }

  /**
   * Record how a granted push ended — the audit row naming the run and who started it.
   *
   * @param runId - The run.
   * @param request - The branch, the outcome, and the commit or the host's reason.
   * @returns `{recorded: true}`; a replay of the same key answers the same without a second row.
   * @throws {NotFoundError} `404 run_not_found`.
   * @throws {ConflictError} `409 fenced`, `409 idempotency_key_reused`.
   */
  async recordResult(runId: string, request: ReportPushResultDto): Promise<PushRecordedResource> {
    const digest = requestDigest(request);

    return this.runs.transaction(async (trx) => {
      const run = await this.locked(trx, runId);

      assertEpoch(run, request.epoch);

      const scope: ReceiptScope = {
        organizationId: run.organization_id,
        operation: "run.push_result",
        idempotencyKey: request.idempotency_key,
        digest,
      };
      const replay = await replayedReceipt<PushRecordedResource>(this.runs, trx, scope);

      if (replay.replayed) {
        return replay.response;
      }

      await this.audit.record({
        organizationId: run.organization_id,
        actorId: run.started_by,
        action: RUN_BRANCH_PUSHED_EVENT,
        subjectType: "run",
        subjectId: run.id,
        at: new Date(),
        detail: {
          branch: request.branch,
          outcome: request.outcome,
          ...(request.pushed_sha === undefined ? {} : { pushed_sha: request.pushed_sha }),
          ...(request.reason === undefined ? {} : { reason: request.reason }),
        },
      });

      return commitReceipt<PushRecordedResource>(this.runs, trx, scope, runId, {
        recorded: true,
      });
    });
  }

  /**
   * Refuse a branch GitHub reports as protected. A branch GitHub does not know yet — the first
   * push of a run — is a `404`, and not protected.
   *
   * @param organizationId - The workspace whose client asks.
   * @param slug - `owner/name`.
   * @param branch - The branch.
   * @throws {ConflictError} `409 protected_branch`.
   * @throws {UpstreamError} `502 branch_check_failed` — GitHub could not be asked.
   */
  private async refuseProtected(
    organizationId: string,
    slug: string,
    branch: string,
  ): Promise<void> {
    const [owner, repo] = slug.split("/") as [string, string];

    try {
      const client = await this.github.forOrganization(organizationId);
      const answer = await client.request<{ protected?: boolean }>(BRANCH_ROUTE, {
        owner,
        repo,
        branch,
      });

      if (answer.data?.protected === true) {
        throw protectedBranch(branch);
      }
    } catch (error) {
      if (!(error instanceof GithubApiError)) {
        throw error;
      }

      if (error.failure === GITHUB_FAILURES.notFound) {
        return;
      }

      if (error.failure === GITHUB_FAILURES.notConfigured) {
        throw githubNotConfigured(branch);
      }

      throw branchCheckFailed(branch, error.failure);
    }
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
 * Refuse to push for a run that is not `coding` or `building` — nothing executes it any more.
 *
 * @param run - The run, locked.
 * @throws {ConflictError} `409 run_not_executable`.
 */
export function assertExecutable(run: Pick<Run, "id" | "status">): void {
  if (!(EXECUTABLE_RUN_STATUSES as readonly string[]).includes(run.status)) {
    throw runNotExecutable(run.id, run.status);
  }
}
