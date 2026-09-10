/**
 * `SyncTriggerService` — *"I have just filed an issue on GitHub; fetch it now"*, and the two
 * guards that keep that from being a way to spend a workspace's GitHub budget.
 *
 * M.4 ([#113](https://github.com/NobuData/ouroboros/issues/113)). Without it, somebody who
 * files an issue waits out an interval they cannot see, wondering whether the integration is
 * broken — which is the state the freshness tag exists to end and cannot end on its own.
 *
 * ---------------------------------------------------------------------------
 * ## Two refusals, and both are properties of this endpoint rather than of the cycle
 *
 *   * **A cycle is already running** → `409 backlog_sync_running`. Not a queued second cycle:
 *     two cycles in flight walk the same repositories twice, spend one token's budget twice
 *     for one answer, and race each other's upserts.
 *   * **A cycle ran within `debounce.ts`'s minimum interval** → `409
 *     backlog_sync_too_soon`, carrying how long to wait. `debounce.ts` argues the number and
 *     why the clock is the last cycle's start rather than a per-caller counter.
 *
 * The order matters: *already running* is checked first, because a cycle that started five
 * seconds ago satisfies both and *"it is happening now"* is the more useful of the two true
 * things to be told.
 *
 * ## The check and the start are one step
 *
 * `BacklogSyncScheduler.runNow()` answers `undefined` when it did not start a cycle, and that
 * answer is what refuses the request — never a second reading of `running()`. It has to be:
 * the snapshot below is read *between* the first guard and the start, and an `await` is a turn
 * another request can take. JavaScript is single-threaded, so a check that hands out the right
 * to start in one synchronous step cannot be raced, which is what makes *"concurrent trigger →
 * 409"* a property of the code instead of a timing that usually holds.
 *
 * ## A cycle is process-wide, and the trigger inherits that
 *
 * K.4's cycle polls **every** configured workspace, and `BacklogSyncScheduler.tick()` is what
 * the roadmap named for a manual re-sync to drive. So one member's click refreshes the whole
 * installation rather than only their workspace. That is why the minimum-interval guard is
 * process-wide too: a per-workspace guard would let ten workspaces start ten whole-installation
 * cycles inside one interval, which is ten times the spend the guard exists to prevent.
 * Narrowing a cycle to one workspace is a change to K.4's service rather than to this
 * endpoint, and it is worth making when a second ticket source lands (Q.3,
 * [#140](https://github.com/NobuData/ouroboros/issues/140)) and the cycle stops being one loop.
 */

import { Injectable, Logger } from "@nestjs/common";

import { BacklogSyncScheduler } from "../backlog-sync/backlog-sync.scheduler";
import { BacklogSyncService } from "../backlog-sync/backlog-sync.service";
import { retryAfterSeconds } from "./debounce";
import { syncAlreadyRunning, syncTooSoon } from "./sync.errors";
import { SyncStatusService } from "./sync-status.service";
import type { SyncStatusResource } from "./sync.resources";

@Injectable()
export class SyncTriggerService {
  /** Where an accepted trigger is recorded — one line, naming the workspace and nobody. */
  private readonly logger = new Logger(SyncTriggerService.name);

  /**
   * @param scheduler - The loop. The trigger drives `runNow()` and never touches the timer.
   * @param sync - The cycle, for when the last one started — the minimum interval's clock.
   * @param status - What the answer is made of; the trigger returns the same shape the status
   *   endpoint does, so a client has the state it needs without a second request.
   */
  constructor(
    private readonly scheduler: BacklogSyncScheduler,
    private readonly sync: BacklogSyncService,
    private readonly status: SyncStatusService,
  ) {}

  /**
   * Start a cycle now, and answer with the status as it stood the moment it started.
   *
   * The answer is deliberately *not* awaited on the cycle. A poll of a large backlog is
   * several seconds of somebody else's network, and a request that held a connection open for
   * it would turn a click into a timeout; the `202` says *accepted*, and `syncedAt` advancing
   * is what a client watches for. It is the same shape `POST …/models/pull` answers with, for
   * the same reason.
   *
   * @param organizationId - The workspace whose member asked, established by the tenant guard.
   * @param now - The clock, injectable for the same reason the status service's is.
   * @returns The status as it stood the moment the cycle started, with `running: true`. Its
   *   freshness is still the **previous** cycle's — the poll this request started has not
   *   written anything yet, and claiming otherwise would be the freshness tag lying by one
   *   cycle.
   * @throws {ConflictError} `backlog_sync_running` or `backlog_sync_too_soon` — see this
   *   file's header.
   */
  async trigger(organizationId: string, now: Date = new Date()): Promise<SyncStatusResource> {
    if (this.scheduler.running()) {
      throw syncAlreadyRunning();
    }

    const wait = retryAfterSeconds(this.sync.lastCycle()?.startedAt, now);

    if (wait !== undefined) {
      throw syncTooSoon(wait);
    }

    // Read **before** the cycle starts, which is what makes the answer a snapshot rather than
    // a race with the writes it is about to cause. Reading afterwards would mean a fast cycle
    // could stamp `synced_at` between the two, and the `202` would then carry freshness the
    // caller had not been told to wait for.
    const accepted = await this.status.status(organizationId, now);

    const cycle = this.scheduler.runNow();

    if (cycle === undefined) {
      // Lost the start to another request that got there first. The refusal is the one above's,
      // because that is what happened: somebody else's trigger is the cycle now running.
      throw syncAlreadyRunning();
    }

    // Not awaited, and not left floating either: the cycle outlives this request by design,
    // and it never rejects — `tick()` logs a failed cycle and books the next one.
    void cycle;

    this.logger.log(`Backlog sync triggered for workspace ${organizationId}.`);

    // `running` is the one field the snapshot cannot have read for itself: it was taken a
    // moment before the cycle this request just started.
    return { ...accepted, running: true };
  }
}
