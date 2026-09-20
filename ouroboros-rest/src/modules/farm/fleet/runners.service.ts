/**
 * The `⋯` menu — drain, undrain, and the guarded remove.
 *
 * AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)). Three operator decisions
 * about a machine, and the order each one has to happen in.
 *
 * ```
 * drain    ─▶ RunnerControl (AH.3)  desired_state ← draining · push the frame
 *                                   the PILL follows from the agent's own heartbeat
 * undrain  ─▶ RunnerControl         desired_state ← active
 * remove   ─▶ guard: offline or drained only
 *             status + desired_state ← removed   (one write; the CHECK wants both)
 *             revoke its certificate             (so it cannot come back)
 *             two audit rows                     (retired ≠ suspected)
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Draining is not this file's to implement**, and calling `RunnerControl` rather than
 * writing `desired_state` here is the whole point. AH.3 built that seam for this ticket: it
 * writes the intent *first* and pushes the frame as an optimisation, so a runner connected to
 * another replica is told at its next heartbeat and a drain cannot be lost to the machine
 * being elsewhere. A second implementation would be a drain that reached the database and not
 * the agent.
 *
 * ---------------------------------------------------------------------------
 * **Removal revokes, and the guard is in the statement.**
 *
 * A retired machine must not be able to reconnect, so its certificate is revoked with the
 * reason V041 names — `runner_removed`, which is the reason the seed's own retired runner
 * carries. That goes through `RegistrationService`, which owns revocation and its audit row,
 * rather than through a second `update` here: a revocation honoured on one path and not the
 * other is the failure `FarmModule` exports things to prevent.
 *
 * The guard — *offline or drained only* — is checked for a readable error **and applied again
 * in the `update`'s `where`**. Between the check and the write a machine can heartbeat its way
 * back to `online`, and a removal that raced it would strand whatever it had just been given.
 */

import { Injectable, Inject } from "@nestjs/common";

import type { Organization, RunnerStatus } from "../../db/schema";
import { DomainError } from "../../errors/error.envelope";
import { FarmAudit } from "../farm.audit";
import { FARM_ERRORS, runnerNotFound, runnerNotRemovable, runnerRemoved } from "../farm.errors";
import { RegistrationService } from "../registration.service";
import { GATEWAY_CLOCK, type GatewayClock } from "../gateway/gateway.clock";
import { RunnerControl } from "../gateway/runner.control";
import { FleetRepository } from "./fleet.repository";
import { runnerResource, type RunnerResource } from "./fleet.resources";

/**
 * The states a runner may be removed from.
 *
 * `offline` — the fleet cannot reach it, so nothing is running on it that this service knows
 * about. `draining` — an operator has already decided, and has watched it finish. Nothing
 * else: removing a machine that is `online` or `building` strands whatever it holds, and the
 * row would say `removed` while the agent went on compiling something nobody was waiting for.
 */
export const REMOVABLE_STATUSES: readonly RunnerStatus[] = ["offline", "draining"];

/**
 * Why a drain was asked for, as the agent is told it.
 *
 * `operator`, because that is the only reason this route can carry: a person chose it from
 * mockup 08's `⋯` menu. The protocol's other reasons belong to the gateway — a shutdown, a
 * version floor — and are pushed from there.
 */
const DRAIN_REASON = "operator";

/**
 * How long a drained runner is given to finish, in milliseconds.
 *
 * Zero, which in the protocol means *no deadline*: finish what you are running, however long
 * it takes, and decline everything new. That is what drain means on mockup 08 — `bigiron`
 * shows `#472 HIL test rig · finishing`, a sweep that started this morning — and a deadline
 * would turn an operator's *stop taking work* into *kill that build in N minutes*, which is
 * what cancelling is for.
 */
const DRAIN_DEADLINE_MS = 0;

/** What an operator's lifecycle action did. */
export interface LifecycleResult {
  /** The runner, as the table will draw it next. */
  readonly runner: RunnerResource;
  /**
   * Whether the frame reached a session in this process.
   *
   * **`false` is not a failure.** The intent is in the database, and a runner connected to
   * another replica — or not connected at all — is told at its next heartbeat or hello. It is
   * returned so AI.5 ([#260](https://github.com/NobuData/ouroboros/issues/260)) can say
   * *asked* rather than *done* while a machine has not yet answered.
   */
  readonly pushed: boolean;
}

@Injectable()
export class RunnersService {
  /**
   * @param fleet - The rows.
   * @param control - AH.3's drain channel — the intent and the push, together.
   * @param registration - Revocation, for a removal. Exported by `FarmModule` for this.
   * @param audit - AD.4's trail.
   * @param now - The gateway's clock, shared for `fleet.service.ts`'s reason.
   */
  constructor(
    private readonly fleet: FleetRepository,
    private readonly control: RunnerControl,
    private readonly registration: RegistrationService,
    private readonly audit: FarmAudit,
    @Inject(GATEWAY_CLOCK) private readonly now: GatewayClock,
  ) {}

  /**
   * Withdraw a runner from dispatch: it declines new offers and finishes what it is running.
   *
   * @param tenant - The workspace.
   * @param actorId - Who decided, from the session. The answer to *who drained bigiron?*
   * @param runnerId - The runner.
   * @returns The runner and whether the frame was pushed.
   * @throws {NotFoundError} `farm_runner_not_found` when this workspace has no such runner.
   * @throws {ConflictError} `farm_runner_removed` when it has been retired.
   */
  drain(tenant: Organization, actorId: string, runnerId: string): Promise<LifecycleResult> {
    return this.setDrain(tenant, actorId, runnerId, true);
  }

  /**
   * Return a drained runner to dispatch.
   *
   * @param tenant - The workspace.
   * @param actorId - Who decided.
   * @param runnerId - The runner.
   * @returns The runner and whether the frame was pushed.
   * @throws {NotFoundError} `farm_runner_not_found`.
   * @throws {ConflictError} `farm_runner_removed`.
   */
  undrain(tenant: Organization, actorId: string, runnerId: string): Promise<LifecycleResult> {
    return this.setDrain(tenant, actorId, runnerId, false);
  }

  /**
   * Both halves of the drain switch, which differ only in the frame and the event name.
   *
   * `RunnerControl` answers `undefined` for a runner this workspace does not have **and** for
   * one that has been retired — two facts it has no reason to tell apart. They are told apart
   * here, by reading the row: *no such runner* and *that machine is gone* send an operator to
   * different places.
   *
   * @param tenant - The workspace.
   * @param actorId - Who decided.
   * @param runnerId - The runner.
   * @param draining - Which way.
   * @returns The runner and whether the frame was pushed.
   * @throws {NotFoundError} `farm_runner_not_found`.
   * @throws {ConflictError} `farm_runner_removed`.
   */
  private async setDrain(
    tenant: Organization,
    actorId: string,
    runnerId: string,
    draining: boolean,
  ): Promise<LifecycleResult> {
    const result = draining
      ? await this.control.drain(tenant.id, runnerId, {
          reason: DRAIN_REASON,
          deadline_ms: DRAIN_DEADLINE_MS,
          detail: "An operator drained this runner.",
        })
      : await this.control.undrain(tenant.id, runnerId);

    if (!result) throw await this.whyNot(tenant.id, runnerId);

    await this.audit.drainChanged(
      { organizationId: tenant.id, actorId, at: this.now() },
      { runnerId, name: result.runner.name, draining, pushed: result.pushed },
    );

    return { runner: await this.view(tenant.id, result.runner.id), pushed: result.pushed };
  }

  /**
   * Retire a runner from the fleet.
   *
   * @param tenant - The workspace.
   * @param actorId - Who decided.
   * @param runnerId - The runner.
   * @returns The runner, `removed` — returned rather than a bare `204`, so a client can see
   *   the state it is now in without asking again.
   * @throws {NotFoundError} `farm_runner_not_found`.
   * @throws {ConflictError} `farm_runner_removed` when it has already gone, and
   *   `farm_runner_not_removable` when it is still connected — the guard.
   */
  async remove(tenant: Organization, actorId: string, runnerId: string): Promise<RunnerResource> {
    const runner = await this.fleet.runnerById(tenant.id, runnerId);
    if (!runner) throw runnerNotFound();
    if (runner.status === "removed") throw runnerRemoved();
    if (!REMOVABLE_STATUSES.includes(runner.status)) throw runnerNotRemovable(runner.status);

    // The guard again, inside the statement — see this file's header. A runner that
    // heartbeated its way back to `online` in between matches nothing and is refused with the
    // state it is *now* in, which is the one the operator needs to see.
    const removed = await this.fleet.remove(tenant.id, runnerId, REMOVABLE_STATUSES);
    if (!removed) {
      const current = await this.fleet.runnerById(tenant.id, runnerId);

      throw current ? runnerNotRemovable(current.status) : runnerNotFound();
    }

    await this.audit.runnerRemoved(
      { organizationId: tenant.id, actorId, at: this.now() },
      { runnerId, name: removed.name, status: runner.status },
    );

    // After the row, and deliberately. The removal is the operation; the revocation is what
    // makes it stick. A runner on the bearer fallback holds no certificate at all — decision
    // B3 — and `farm_no_live_certificate` there is the expected answer rather than a failure
    // to report, so it is the one refusal this swallows.
    await this.revoke(tenant.id, actorId, runnerId);

    return this.view(tenant.id, runnerId);
  }

  /**
   * Revoke a retired runner's certificate, if it has one.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who decided.
   * @param runnerId - The runner.
   * @returns When it is revoked, or at once for a runner that holds no certificate.
   */
  private async revoke(organizationId: string, actorId: string, runnerId: string): Promise<void> {
    try {
      await this.registration.revokeCertificate(
        organizationId,
        actorId,
        runnerId,
        "runner_removed",
      );
    } catch (error) {
      // Only this one. A bearer-fallback runner has no certificate by construction, and a
      // machine whose certificate was already revoked is in the state this was aiming for.
      // Anything else is a revocation that did not happen, and the caller must hear about it.
      if (!isNoLiveCertificate(error)) throw error;
    }
  }

  /**
   * Why a control action found nothing.
   *
   * @param organizationId - The workspace.
   * @param runnerId - The runner.
   * @returns The error to throw: `farm_runner_removed` for a retired machine, and
   *   `farm_runner_not_found` for one this workspace does not have.
   */
  private async whyNot(organizationId: string, runnerId: string): Promise<Error> {
    const runner = await this.fleet.runnerById(organizationId, runnerId);

    return runner?.status === "removed" ? runnerRemoved() : runnerNotFound();
  }

  /**
   * A runner as the table draws it, read back after a write.
   *
   * Read back rather than mapped from what the write returned, because the row is only half
   * of what the cell shows: the pool's name, the queue behind it and the build it is holding
   * are three other tables, and a client that has just drained a machine should see the same
   * row the next page load will.
   *
   * @param organizationId - The workspace.
   * @param runnerId - The runner.
   * @returns The resource.
   * @throws {NotFoundError} `farm_runner_not_found` if it has gone in between.
   */
  private async view(organizationId: string, runnerId: string): Promise<RunnerResource> {
    const [rows, depths, current] = await Promise.all([
      this.fleet.runners(organizationId),
      this.fleet.queueDepths(organizationId),
      this.fleet.currentJobs(organizationId),
    ]);

    const row = rows.find((candidate) => candidate.runner.id === runnerId);
    if (row) {
      return runnerResource({
        runner: row.runner,
        poolName: row.poolName,
        queueDepth: depths.get(runnerId) ?? 0,
        currentJob: current.get(runnerId),
      });
    }

    // A removal takes the runner out of `runners()`, which excludes retired machines — so the
    // row it just wrote is read directly. The retired resource is what the caller is owed:
    // `status: removed`, no telemetry, no queue.
    const removed = await this.fleet.runnerById(organizationId, runnerId);
    if (!removed) throw runnerNotFound();

    const pool = await this.fleet.poolById(organizationId, removed.pool_id);

    return runnerResource({
      runner: removed,
      poolName: pool?.name ?? "",
      queueDepth: 0,
      currentJob: undefined,
    });
  }
}

/**
 * Is this the *no live certificate* refusal?
 *
 * Matched on the envelope's code rather than on the class, because the code is the contract —
 * `farm.errors.ts` holds every one of them to `openapi.yaml`, and a rename that changed the
 * class would have to change the code too.
 *
 * @param error - What was thrown.
 * @returns Whether it is `farm_no_live_certificate`.
 */
function isNoLiveCertificate(error: unknown): boolean {
  return error instanceof DomainError && error.code === (FARM_ERRORS.noLiveCertificate as string);
}
