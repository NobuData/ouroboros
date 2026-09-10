/**
 * `POST /api/v1/backlog/queue` — mockup 03's three queue affordances, as one write
 * (M.3, [#112](https://github.com/NobuData/ouroboros/issues/112)).
 *
 * **Queue 3 selected ⟳** in the page head, **Queue → standard-fix** on the selection action bar
 * and **Queue for loop** in the detail panel all call this: a set of issues and, optionally, the
 * workflow to run them under. This is the write side the dashboard roadmap deliberately left
 * out — decision **K9** — and the reason `queue/queue.controller.ts` says in as many words that
 * *"reorder, remove and enqueue are deliberately not here: the queue's writes belong to the
 * issues screen"*. They are here, under `/backlog`, because that is the screen doing the
 * queueing; `GET /api/v1/queue` is where the result is read back.
 *
 * **A fourth controller under this prefix**, named for its route as the other three are.
 * `BacklogController` holds `sync-status` and `sync`, `BacklogListingController` the listing,
 * `BacklogDetailController` the panel, and this one the queue write.
 *
 * **It cannot be shadowed by the bare parameter beside it.** `GET /backlog/{id}` is a different
 * method, and `POST /backlog/{id}/estimate` is three path segments to this one's two — so
 * `queue` is reachable however `backlog.module.ts` sorts its controllers. The registration-order
 * rule that file records is about `GET`, and this route is deliberately not part of it.
 *
 * **The workspace is the session's, never the request's** — the same sentence the listing, the
 * panel, the sync trigger, the queue listing and the dashboard all open with. No `{orgId}` in
 * the path, the tenant guard resolves and membership-checks the active organization, and this
 * handler queues into what it established. The ticket's *cross-org ids → 404* criterion is met
 * two levels below, in the statements: see `queue.repository.ts`.
 *
 * **`member+`, which is the BA-C.3 policy the ticket names.** Queueing is work — it commits the
 * workspace's loop, and eventually its money, to a list of issues — so a `viewer` may read the
 * backlog and may not fill the queue. It is deliberately *not* `admin+` like
 * `POST /backlog/estimate-all`: that one fans out over the whole backlog in a single press,
 * while this one queues exactly the rows a person selected.
 */

import { Body, Controller, Post } from "@nestjs/common";

import type { Organization } from "../db/schema";
import { CONTRIBUTORS, Roles } from "../tenancy/roles.guard";
import { CurrentTenant } from "../tenancy/tenant.decorators";
import { QueueSelectionBody } from "./queue.dto";
import type { QueuedSelection } from "./queue.resources";
import { BacklogQueueService } from "./queue.service";

@Controller("backlog")
export class BacklogQueueController {
  /** @param queue - The checks, and the one transaction that writes. */
  constructor(private readonly queue: BacklogQueueService) {}

  /**
   * Queue a selection of issues.
   *
   * Answers `201`, Nest's default for a `POST`, and it is the honest status: rows were created,
   * and the body is those rows. Unlike the two estimation triggers beside it there is nothing to
   * accept for later — a queue write is a transaction, not an engine call, so a `202` would be
   * promising work that has in fact already happened.
   *
   * @param tenant - The workspace, established by the tenant guard.
   * @param body - The issue ids in the order to append them, and the workflow they all run
   *   under when one is named.
   * @returns The created queue items and their combined estimate.
   * @throws {NotFoundError} `queue_issues_not_found` — an id names no issue in this workspace.
   * @throws {InvalidRequestError} `queue_issues_not_queueable` — an issue is not `sized`.
   * @throws {ConflictError} `queue_issues_conflict` — an issue is already queued.
   */
  @Post("queue")
  @Roles(...CONTRIBUTORS)
  queueSelection(
    @CurrentTenant() tenant: Organization,
    @Body() body: QueueSelectionBody,
  ): Promise<QueuedSelection> {
    return this.queue.queueSelection(tenant.id, body);
  }
}
