/**
 * The engine claims the head of a workspace's queue — #91 (J.3, narrowed by its DG.1 amendment).
 *
 * ```
 * POST /internal/queue/claim {workspace, worker, idempotencyKey}
 *   admission ── deployment switch off → 409 deployment_disabled          (DG.2, #1300)
 *            └─ workspace not active   → 409 workspace_paused | …         (#489)
 *   replay   ── this key already leases an item, still held → that item   (a lost response
 *                                                                          never takes two)
 *   head     ── lowest position nobody holds, `for update skip locked`  → lease it → 200
 *            └─ nothing claimable                                        → 204
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
 * **Admission is decided here and nowhere else.** DG.2's switch and #489's pause hold today;
 * DI.4 ([#1312](https://github.com/NobuData/ouroboros/issues/1312)) adds the dry-run policy,
 * the confirmation and the concurrency ceiling in this same place — the one decision a queued
 * item passes before it becomes work a model is paid to do.
 */

import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import type { QueueItem } from "../db/schema";
import { workspaceNotAdmitting } from "../lifecycle/lifecycle.errors";
import { WorkspaceStateReader } from "../lifecycle/lifecycle.state";
import { admitsNewWork } from "../lifecycle/lifecycle.states";
import type { ClaimQueueItemDto } from "./ingest.dto";
import { claimWorkspaceNotFound, deploymentDisabled } from "./ingest.errors";
import { IngestRepository, type Writer } from "./ingest.repository";
import type { QueueItemClaimedResource } from "./ingest.resources";

@Injectable()
export class QueueClaimService {
  /**
   * @param queue - The statements — the queue's, beside the ingest contract's own.
   * @param config - The live-execution switch and the lease length.
   * @param states - Whether a workspace is taking new work (#489).
   */
  constructor(
    private readonly queue: IngestRepository,
    private readonly config: AppConfigService,
    private readonly states: WorkspaceStateReader,
  ) {}

  /**
   * Lease the head of a workspace's queue to a worker.
   *
   * @param request - The workspace, the worker and the claim's idempotency key.
   * @param now - The instant the lease is measured from; injectable for tests.
   * @returns The item and its lease, or `undefined` when nothing is claimable.
   * @throws {ConflictError} `409 deployment_disabled`, `409 workspace_paused` or
   *   `409 workspace_pending_delete` — admission refused; nothing was claimed.
   * @throws {NotFoundError} `404 workspace_not_found`.
   */
  async claim(
    request: ClaimQueueItemDto,
    now: Date = new Date(),
  ): Promise<QueueItemClaimedResource | undefined> {
    if (!this.config.liveExecutionEnabled) {
      throw deploymentDisabled();
    }

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

      const replayed = await this.queue.leasedBy(trx, organizationId, request.idempotencyKey);

      if (replayed !== undefined) {
        if (replayed.claim_expires_at !== null && replayed.claim_expires_at > now) {
          return await this.claimed(trx, replayed);
        }
        // The key's lease ran out before it was replayed: let it go, and lease the head anew.
        await this.queue.releaseLease(trx, replayed.id);
      }

      const head = await this.queue.claimableHead(trx, organizationId, now);

      if (head === undefined) {
        return undefined;
      }

      const leased = await this.queue.lease(trx, head.id, {
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
   * A leased item as the claim answers it, with the ticket to open its run for.
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
    };
  }
}
