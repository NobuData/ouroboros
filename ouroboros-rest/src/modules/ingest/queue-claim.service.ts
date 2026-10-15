/**
 * The engine claims the head of a workspace's queue — #91 (J.3, narrowed by its DG.1 amendment).
 *
 * ```
 * POST /internal/queue/claim {workspace, worker, idempotencyKey, executors?}
 *   admission ── deployment switch off → 409 deployment_disabled          (DG.2, #1300)
 *            └─ workspace not active   → 409 workspace_paused | …         (#489)
 *            └─ no stage executor      → 409 no_executor                  (DI.4, #1312)
 *   replay   ── this key already leases an item, still held → that item   (a lost response
 *                                                                          never takes two)
 *   ceiling  ── per-workspace advisory lock; live runs + live leases ≥ ceiling
 *                                       → 409 concurrency_ceiling        (DI.4)
 *   next     ── in position order, `for update skip locked`, the first item admission
 *               admits (repository enabled · dry-run · published pin · route invocable ·
 *               confirmed) → lease it → 200; the rest keep their place and their reason
 *            └─ nothing admissible                                       → 204
 *
 * POST /internal/runs {…, queueItem: {id, claimToken}}   (ingest.service.ts)
 *   the lease is still the caller's and the item is this run → open the run, remove the item
 * ```
 *
 * **A lease, then the open.** The claim never removes an item: a worker that dies between the
 * claim and the open loses nothing, because the lease runs out
 * (`OURO_QUEUE_CLAIM_LEASE_SECONDS`) and the item is the head again. Removal is the open's, in
 * the transaction that inserts the run.
 *
 * **Admission is decided here and nowhere else.** The decision itself is
 * `admission/admission.ts` (DI.4, [#1312](https://github.com/NobuData/ouroboros/issues/1312)) —
 * the same evaluator the queue, the dashboard and the backlog explain a waiting item with — and
 * this is the one place it is enforced, before a queued item becomes work a model is paid to do.
 */

import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { AdmissionService } from "../admission/admission.service";
import type { WorkspaceAdmissionReason } from "../admission/admission";
import { AppConfigService } from "../config/config.service";
import type { QueueItem } from "../db/schema";
import type { ConflictError } from "../errors/error.envelope";
import { workspaceNotAdmitting } from "../lifecycle/lifecycle.errors";
import { WorkspaceStateReader } from "../lifecycle/lifecycle.state";
import { admitsNewWork } from "../lifecycle/lifecycle.states";
import type { ClaimQueueItemDto } from "./ingest.dto";
import {
  claimWorkspaceNotFound,
  concurrencyCeiling,
  deploymentDisabled,
  noExecutor,
} from "./ingest.errors";
import { IngestRepository, type Writer } from "./ingest.repository";
import type { QueueItemClaimedResource } from "./ingest.resources";

@Injectable()
export class QueueClaimService {
  /**
   * @param queue - The statements — the queue's, beside the ingest contract's own.
   * @param config - The live-execution switch and the lease length.
   * @param states - Whether a workspace is taking new work (#489).
   * @param admission - The live-run admission decision (DI.4, #1312), and the model a claimed
   *   item's run will record (#160).
   */
  constructor(
    private readonly queue: IngestRepository,
    private readonly config: AppConfigService,
    private readonly states: WorkspaceStateReader,
    @Inject(AdmissionService)
    private readonly admission: Pick<AdmissionService, "executorCount" | "admitNext" | "modelFor">,
  ) {}

  /**
   * Lease a workspace's next admissible queue item to a worker — the first, in queue order, that
   * live-run admission takes (#1312).
   *
   * @param request - The workspace, the worker and the claim's idempotency key.
   * @param now - The instant the lease is measured from; injectable for tests.
   * @returns The item and its lease, or `undefined` when nothing is admissible.
   * @throws {ConflictError} `409 deployment_disabled`, `409 workspace_paused`,
   *   `409 workspace_pending_delete`, `409 no_executor` or `409 concurrency_ceiling` — admission
   *   refused the workspace; nothing was claimed.
   * @throws {NotFoundError} `404 workspace_not_found`.
   */
  async claim(
    request: ClaimQueueItemDto,
    now: Date = new Date(),
  ): Promise<QueueItemClaimedResource | undefined> {
    if (!this.config.liveExecutionEnabled) {
      throw deploymentDisabled();
    }

    // Before the transaction: the engine's status is a network call, never made under a lock.
    const executors = await this.admission.executorCount(request.executors);

    return this.queue.transaction(async (trx) => {
      const organizationId = await this.queue.workspaceId(trx, request.workspace);

      if (organizationId === undefined) {
        throw claimWorkspaceNotFound(request.workspace);
      }

      // Read per claim rather than cached, so a pause holds the very next claim.
      const state = await this.states.stateOf(organizationId);
      if (!admitsNewWork(state)) {
        throw workspaceNotAdmitting(state);
      }

      if (executors === 0) {
        throw noExecutor();
      }

      const replayed = await this.queue.leasedBy(trx, organizationId, request.idempotencyKey);

      if (replayed !== undefined) {
        if (replayed.claim_expires_at !== null && replayed.claim_expires_at > now) {
          return await this.claimed(trx, replayed);
        }
        // The key's lease ran out before it was replayed: let it go, and lease the head anew.
        await this.queue.releaseLease(trx, replayed.id);
      }

      const admitted = await this.admission.admitNext(trx, organizationId, now, executors);

      if (admitted.refused !== null) {
        throw refusal(admitted.refused, admitted.taken, admitted.ceiling);
      }

      if (admitted.item === undefined) {
        return undefined;
      }

      const leased = await this.queue.lease(trx, admitted.item.id, {
        claimed_at: now,
        claim_expires_at: new Date(now.getTime() + this.config.queueClaimLeaseSeconds * 1000),
        claimed_by: request.worker,
        claim_token: randomUUID(),
        claim_key: request.idempotencyKey,
      });

      return this.claimed(trx, leased);
    });
  }

  /**
   * A leased item as the claim answers it, with the ticket to open its run for and the model the
   * run will record (`AdmissionService.modelFor` is the rule).
   *
   * @param writer - The claim's transaction.
   * @param item - The item, leased.
   * @returns The resource.
   */
  private async claimed(writer: Writer, item: QueueItem): Promise<QueueItemClaimedResource> {
    const ticket = await this.queue.ticketOfQueuedIssue(
      writer,
      item.organization_id,
      item.github_repo_id,
      item.issue_number,
    );
    const pinned =
      item.workflow_version === null
        ? undefined
        : await this.queue.pinnedDefinition(
            writer,
            item.organization_id,
            item.workflow_tag,
            item.workflow_version,
          );
    const model = await this.admission.modelFor(item.organization_id, pinned?.definition);

    return {
      id: item.id,
      // Both are set on every leased row (`queue_items_claim_whole`); asserted for the types.
      claimToken: item.claim_token ?? "",
      expiresAt: (item.claim_expires_at ?? new Date(0)).toISOString(),
      organizationId: item.organization_id,
      repository: item.github_repo_id,
      issueNumber: item.issue_number,
      issueTitle: item.issue_title,
      workflow: { tag: item.workflow_tag, version: item.workflow_version },
      playbookId: item.playbook_id,
      ticket: ticket ?? null,
      model,
    };
  }
}

/**
 * The error a workspace-wide refusal answers with.
 *
 * @param reason - Why admission refused the workspace.
 * @param taken - The slots taken, for `concurrency_ceiling`.
 * @param ceiling - The ceiling, for `concurrency_ceiling`.
 * @returns The `409`.
 */
function refusal(reason: WorkspaceAdmissionReason, taken: number, ceiling: number): ConflictError {
  switch (reason) {
    case "deployment_disabled":
      return deploymentDisabled();
    case "workspace_paused":
      return workspaceNotAdmitting("paused");
    case "workspace_pending_delete":
      return workspaceNotAdmitting("pending_delete");
    case "no_executor":
      return noExecutor();
    case "concurrency_ceiling":
      return concurrencyCeiling(taken, ceiling);
  }
}
