/**
 * `POST /internal/queue/claim` — the engine claims the head of a workspace's queue (#91).
 *
 * Behind the internal key, like the rest of the ingest contract: its caller is a worker inside
 * the network, never a browser. What the claim decides is `queue-claim.service.ts`'s; this file
 * turns *nothing to claim* into a `204` rather than a `200` with an empty body, so a worker
 * polling an empty queue reads the status line and nothing else.
 */

import { Body, Controller, HttpStatus, Post, Res, VERSION_NEUTRAL } from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import { InternalOnly } from "../internal/internal.decorators";
import { QUEUE_CLAIM_ROUTE, QUEUE_PATH } from "../internal/internal.paths";
import { ClaimQueueItemDto } from "./ingest.dto";
import type { QueueItemClaimedResource } from "./ingest.resources";
import { QueueClaimService } from "./queue-claim.service";

/** The one method of the response this controller uses. */
interface StatusResponse {
  status(code: number): unknown;
}

@InternalOnly()
@AllowAnonymous()
@Controller({ path: QUEUE_PATH, version: VERSION_NEUTRAL })
export class QueueClaimController {
  /**
   * @param claims - Where the claim is decided.
   */
  constructor(private readonly claims: QueueClaimService) {}

  /**
   * Lease the head of a workspace's queue to the calling worker.
   *
   * @param request - The workspace, the worker and the claim's idempotency key.
   * @param response - Where `204` is set when nothing is claimable.
   * @returns The item and its lease — `200` — or nothing, `204`.
   */
  @Post(QUEUE_CLAIM_ROUTE)
  async claim(
    @Body() request: ClaimQueueItemDto,
    @Res({ passthrough: true }) response: StatusResponse,
  ): Promise<QueueItemClaimedResource | undefined> {
    const claimed = await this.claims.claim(request);

    response.status(claimed === undefined ? HttpStatus.NO_CONTENT : HttpStatus.OK);
    return claimed;
  }
}
