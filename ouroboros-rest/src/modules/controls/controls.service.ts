/**
 * The control queue — Pause, Resume, Abort and Steer delivered over a durable queue with
 * acknowledgments, TTLs, role policy and an audit trail. AP.4
 * ([#306](https://github.com/NobuData/ouroboros/issues/306)), decision **R6**.
 *
 * ```
 * POST /api/v1/runs/:id/controls                       a person asks          → pending | rejected
 * GET  /api/v1/runs/:id/controls                       the console's ack chips
 * POST /internal/runs/:id/controls/fetch               the executor claims    → delivered
 * POST /internal/runs/:id/controls/:controlId/ack      the executor answers   → acked
 *      (the sweep)                                     nobody answered        → expired
 * ```
 *
 * ---------------------------------------------------------------------------
 * **What each kind means to an executor.** This is the contract the fetch hands over, and the
 * simulated driver (AP.5, #307) and real execution (AR.1, #315) both honour it:
 *
 *   * **`pause`** takes effect at the next safe boundary (between tool calls, or between
 *     stages), never mid-write. The ack is sent once the loop has actually stopped.
 *   * **`resume`** continues a paused loop from where it stopped.
 *   * **`abort`** terminates the run and **preserves its branch**. Nothing is reverted or
 *     deleted. When it is acked, this service closes the run as `canceled` (V050).
 *   * **`steer`** appends the text to the *current attempt's* context and **does not pause**.
 *     The ack names the attempt it landed on (*"steering applied to attempt 2"*), so the person
 *     who typed it knows it reached the attempt they were watching.
 *
 * **Where the audit comes from.** Every insert and every state change here lands in
 * `audit_events` through V048's `run_controls_audit()` trigger: actor, run, kind, state and
 * `has_payload`, never the steer text. There is no audit call in this file, because a trigger
 * cannot be forgotten.
 */

import { Inject, Injectable, Optional } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import type { OrganizationRole, RunControl, RunControlKind } from "../db/schema";
import {
  FACT_SOURCE_OBSERVER,
  type FactSourceObserver,
} from "../fact-proposers/proposers.observer";
import { runNotFound } from "../runs/runs.errors";
import { forbidden } from "../tenancy/tenancy.errors";
import type { AckControlDto, SubmitControlDto } from "./controls.dto";
import {
  abortConfirmationInvalid,
  controlKeyReused,
  controlNotDelivered,
  controlNotFound,
  controlPayloadInvalid,
} from "./controls.errors";
import {
  CONTROL_ROLES,
  confirmationMatches,
  defaultAckDetail,
  finishedRunRejection,
  isDeduplicated,
  mayRequest,
  ttlSeconds,
} from "./controls.policy";
import { ControlsRepository, type ControlSubmission } from "./controls.repository";
import {
  pendingControlResource,
  runControlResource,
  type ControlsFetchedResource,
  type RunControlResource,
  type RunControlsListResource,
} from "./controls.resources";

/** How many controls the listing returns — enough for every chip a run page draws. */
export const MAX_LISTED_CONTROLS = 50;

/** Who is asking, as the public surface establishes it. */
export interface Requester {
  /** `"user".id`. */
  readonly id: string;
  /** Their display name, which the transcript's `user` entry carries. */
  readonly name: string;
  /** The roles their membership in this workspace carries. */
  readonly roles: readonly OrganizationRole[];
}

/**
 * Why the system queued a control (DI.4, #1312; the two budget reasons are AR.1's, #315, filed
 * by the harness facade when it refuses a call). Stable: the console keys copy on it.
 */
export type SystemControlReason =
  | "wall_clock_limit"
  | "no_progress_limit"
  | "workspace_paused"
  | "workspace_resumed"
  | "cost_cap_exceeded"
  | "token_budget_exceeded";

/** The transcript sentence each reason writes. */
export const SYSTEM_CONTROL_SENTENCES: Readonly<Record<SystemControlReason, string>> = {
  wall_clock_limit:
    "Aborted: the run passed the deployment's wall-clock limit for a live run. Its branch is kept.",
  no_progress_limit:
    "Aborted: the run reported no progress within the deployment's no-progress limit. Its branch is kept.",
  workspace_paused: "Pausing at the next safe boundary: the workspace was paused.",
  workspace_resumed: "Resuming: the workspace was resumed.",
  cost_cap_exceeded:
    "Aborted: the run reached its per-run cost cap, so its next model call was refused. Its branch is kept.",
  token_budget_exceeded:
    "Aborted: the stage attempt reached its token budget, so its next model call was refused. Its branch is kept.",
};

@Injectable()
export class ControlsService {
  /**
   * @param controls - Every statement the queue issues.
   * @param config - The two TTLs.
   */
  constructor(
    private readonly controls: ControlsRepository,
    private readonly config: AppConfigService,
    @Optional() @Inject(FACT_SOURCE_OBSERVER) private readonly factSources?: FactSourceObserver,
  ) {}

  // --- POST /api/v1/runs/:id/controls ----------------------------------------------------

  /**
   * Ask for a control.
   *
   * The checks run in an order that matters. The role comes first, before the run is even
   * read, so a member's abort is refused whatever it carries, a forged confirmation included,
   * and writes nothing. Then the payload's shape, then the confirmation against the locked
   * run, and only then anything that writes.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param runId - The run.
   * @param requester - Who is asking, and with what roles.
   * @param request - The kind, and whatever that kind carries.
   * @returns The control. `pending` when queued, `rejected` with a reason when the run has
   *   already finished, and the earlier control when this is a repeat that collapses into it.
   * @throws {ForbiddenError} `403 forbidden` — their role may not request this kind.
   * @throws {InvalidRequestError} `422 control_payload_invalid`, `422 abort_confirmation_invalid`.
   * @throws {NotFoundError} `404 run_not_found` — absent, or another workspace's.
   * @throws {ConflictError} `409 control_key_reused`.
   *
   * A steer flagged *remember this* is reported to BF.3's steer proposer (#412) once written —
   * best-effort: the observer never throws, and a replay proposes nothing twice.
   */
  async submit(
    organizationId: string,
    runId: string,
    requester: Requester,
    request: SubmitControlDto,
  ): Promise<RunControlResource> {
    const control = await this.queue(organizationId, runId, requester, request, false);

    if (control.kind === "steer" && control.remember) {
      await this.factSources?.sourceWritten(organizationId, { kind: "steer", id: control.id });
    }

    return control;
  }

  // --- controls nobody asked for (DI.4, #1312) -----------------------------------------------

  /**
   * Queue a control in the system's name — a live-run limit's abort, a workspace pause reaching
   * its running runs (DI.4, [#1312](https://github.com/NobuData/ouroboros/issues/1312)), or the
   * harness facade's abort when a run reaches its cost cap or token budget (AR.1, #315).
   *
   * No role and no typed confirmation: no person is asking, and the limit or the lifecycle move
   * that caused it is its own authority. Everything else is {@link submit}'s: the run is locked,
   * an elapsed control is expired first, a pause or abort already outstanding is answered rather
   * than duplicated, and the audit trigger records the request — with no actor. A transcript
   * entry in the system's name says why, so the console never shows a control from nowhere.
   *
   * An abort keeps the run's branch, as every abort does.
   *
   * @param organizationId - The run's workspace.
   * @param runId - The run.
   * @param kind - `pause`, `resume` or `abort`.
   * @param reason - Why.
   * @returns The control and whether this call queued it (`false` when one of the same kind was
   *   already outstanding), or `undefined` when the run is gone or has already finished.
   */
  async submitSystem(
    organizationId: string,
    runId: string,
    kind: Exclude<RunControlKind, "steer">,
    reason: SystemControlReason,
  ): Promise<{ readonly control: RunControlResource; readonly queued: boolean } | undefined> {
    return this.controls.transaction(async (trx) => {
      const run = await this.controls.lockRun(trx, runId, organizationId);

      if (run === undefined || run.finished_at !== null) {
        return undefined;
      }

      await this.controls.sweep(trx, runId);

      if (isDeduplicated(kind)) {
        const outstanding = await this.controls.findOutstanding(trx, runId, kind);

        if (outstanding !== undefined) {
          return { control: runControlResource(outstanding), queued: false };
        }
      }

      const queued = await this.controls.insertPending(trx, {
        runId,
        kind,
        payload: null,
        remember: false,
        retryStage: false,
        requestedBy: null,
        ttlSeconds: ttlSeconds(kind, {
          control: this.config.runControlTtlSeconds,
          steer: this.config.runSteerTtlSeconds,
        }),
      });

      await this.controls.appendSystemEntry(trx, runId, SYSTEM_CONTROL_SENTENCES[reason], {
        controlId: queued.id,
        kind,
        reason,
      });

      return { control: runControlResource(queued), queued: true };
    });
  }

  /**
   * Abort every live run past a limit — the limits sweeper's cycle (DI.4, #1312). A run that
   * has run longer than `OURO_LIVE_RUN_WALL_CLOCK_MINUTES`, or reported nothing for
   * `OURO_LIVE_RUN_NO_PROGRESS_MINUTES`, is aborted through the queue like any other abort —
   * the engine cleans up and the branch is kept. The cost cap is the chain executor's (#235).
   *
   * @param now - The instant the limits are measured against.
   * @returns How many aborts were queued (an abort already outstanding is not counted again).
   */
  async enforceLiveLimits(now: Date = new Date()): Promise<number> {
    const minute = 60_000;
    const overdue = await this.controls.overdueLiveRuns(
      new Date(now.getTime() - this.config.liveRunWallClockMinutes * minute),
      new Date(now.getTime() - this.config.liveRunNoProgressMinutes * minute),
    );

    let queued = 0;

    for (const run of overdue) {
      const reason = run.limit === "wall_clock" ? "wall_clock_limit" : "no_progress_limit";
      const submitted = await this.submitSystem(run.organizationId, run.id, "abort", reason);

      if (submitted?.queued === true) {
        queued += 1;
      }
    }

    return queued;
  }

  /**
   * A workspace pause, reaching its running live runs: each is asked to pause at its next safe
   * boundary (DI.4, #1312). New claims stop at once by admission; this is the half that reaches
   * what already started.
   *
   * @param organizationId - The workspace just paused.
   * @returns How many runs were asked.
   */
  async pauseLiveRuns(organizationId: string): Promise<number> {
    const runs = await this.controls.liveActiveRuns(organizationId);

    for (const runId of runs) {
      await this.submitSystem(organizationId, runId, "pause", "workspace_paused");
    }

    return runs.length;
  }

  /**
   * A workspace resume: resume the live runs its pause paused. A run a person paused stays
   * paused — only a pause nobody asked for is undone.
   *
   * @param organizationId - The workspace just resumed.
   * @returns How many runs were asked.
   */
  async resumeLiveRuns(organizationId: string): Promise<number> {
    const runs = await this.controls.systemPausedRuns(organizationId);

    for (const runId of runs) {
      await this.submitSystem(organizationId, runId, "resume", "workspace_resumed");
    }

    return runs.length;
  }

  // --- the correction round (#332) --------------------------------------------------------

  /**
   * Queue a **correction round**: a steer carrying the note into the planning context, which
   * also asks the executor to start the current stage's next attempt (V061, decision **T6**).
   *
   * This is the Mark & Route card's *Queue correction round → attempt N+1*, composed over the
   * queue rather than beside it: the same role policy (a steer is a `member`'s), the same
   * transcript entry, the same TTL, the same audit trigger. Only `retry_stage` differs.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param runId - The run whose stage is retried.
   * @param requester - Who classified the failure.
   * @param note - The correction note — the steer's text.
   * @param idempotencyKey - Optional: the classification's own key, so a replay is one control.
   * @returns The control, as {@link submit} answers it: `pending`, or `rejected` when the run
   *   has already finished.
   * @throws As {@link submit}.
   */
  correctionRound(
    organizationId: string,
    runId: string,
    requester: Requester,
    note: string,
    idempotencyKey?: string,
  ): Promise<RunControlResource> {
    return this.queue(
      organizationId,
      runId,
      requester,
      { kind: "steer", payload: note, ...(idempotencyKey === undefined ? {} : { idempotencyKey }) },
      true,
    );
  }

  /**
   * The one path {@link submit} and {@link correctionRound} share.
   *
   * @param organizationId - The workspace.
   * @param runId - The run.
   * @param requester - Who is asking.
   * @param request - The kind, and whatever that kind carries.
   * @param retryStage - Whether a steer is a correction round.
   * @returns The control.
   */
  private async queue(
    organizationId: string,
    runId: string,
    requester: Requester,
    request: SubmitControlDto,
    retryStage: boolean,
  ): Promise<RunControlResource> {
    if (!mayRequest(request.kind, requester.roles)) {
      throw forbidden(requester.roles.join(","), CONTROL_ROLES[request.kind]);
    }

    const submission = this.submission(runId, requester, request, retryStage);

    return this.controls.transaction(async (trx) => {
      const run = await this.controls.lockRun(trx, runId, organizationId);

      if (run === undefined) {
        throw runNotFound(runId);
      }

      if (request.kind === "abort" && !confirmationMatches(run.loop_seq, request.confirmation)) {
        throw abortConfirmationInvalid();
      }

      if (submission.idempotencyKey !== undefined) {
        const earlier = await this.controls.findByKey(trx, runId, submission.idempotencyKey);

        if (earlier !== undefined) {
          if (!sameSubmission(earlier, submission)) {
            throw controlKeyReused(submission.idempotencyKey);
          }

          return runControlResource(earlier);
        }
      }

      // Anything elapsed is expired before it can be mistaken for an outstanding control.
      await this.controls.sweep(trx, runId);

      if (run.finished_at !== null) {
        const rejected = await this.controls.insertRejected(
          trx,
          submission,
          finishedRunRejection(run.status),
        );

        return runControlResource(rejected);
      }

      if (isDeduplicated(request.kind)) {
        const outstanding = await this.controls.findOutstanding(trx, runId, request.kind);

        if (outstanding !== undefined) {
          return runControlResource(outstanding);
        }
      }

      const queued = await this.controls.insertPending(trx, submission);

      if (queued.kind === "steer" && queued.payload !== null) {
        const stage = await this.controls.activeStage(trx, runId);

        await this.controls.appendUserEntry(trx, runId, {
          body: queued.payload,
          stageKey: stage?.stage_key ?? null,
          attempt: stage?.attempt ?? null,
          payload: {
            controlId: queued.id,
            requestedBy: { id: requester.id, name: requester.name },
            ...(queued.retry_stage ? { correctionRound: true } : {}),
          },
        });
      }

      return runControlResource(queued);
    });
  }

  // --- GET /api/v1/runs/:id/controls -----------------------------------------------------

  /**
   * The run's recent controls, for the console's ack chips.
   *
   * Sweeps the run first, so an elapsed control reads as `expired` now rather than whenever
   * the periodic sweep next runs.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param runId - The run.
   * @returns At most {@link MAX_LISTED_CONTROLS}, newest first.
   * @throws {NotFoundError} `404 run_not_found`.
   */
  async list(organizationId: string, runId: string): Promise<RunControlsListResource> {
    return this.controls.transaction(async (trx) => {
      if (!(await this.controls.runExists(trx, runId, organizationId))) {
        throw runNotFound(runId);
      }

      await this.controls.sweep(trx, runId);

      const rows = await this.controls.list(trx, runId, MAX_LISTED_CONTROLS);

      return { controls: rows.map(runControlResource) };
    });
  }

  // --- POST /internal/runs/:id/controls/fetch ---------------------------------------------

  /**
   * Hand the executor everything pending for its run, and mark it delivered.
   *
   * @param runId - The run.
   * @returns The claimed controls, oldest first, carrying the steer text.
   * @throws {NotFoundError} `404 run_not_found`.
   */
  async fetch(runId: string): Promise<ControlsFetchedResource> {
    return this.controls.transaction(async (trx) => {
      if ((await this.controls.lockRun(trx, runId)) === undefined) {
        throw runNotFound(runId);
      }

      await this.controls.sweep(trx, runId);

      const claimed = await this.controls.claimPending(trx, runId);

      return { controls: claimed.map(pendingControlResource) };
    });
  }

  // --- POST /internal/runs/:id/controls/:controlId/ack ------------------------------------

  /**
   * Record what the executor did with a control.
   *
   * An acked abort closes the run as `canceled`. Nothing else here moves `runs.status`: a
   * pause is a state of the executor, not of the run's lifecycle.
   *
   * @param runId - The run.
   * @param controlId - The control.
   * @param request - The effect, and for a steer the attempt it landed on.
   * @returns The control, acked.
   * @throws {NotFoundError} `404 run_not_found`, `404 control_not_found`.
   * @throws {ConflictError} `409 control_not_delivered`: already acked (a lost response),
   *   expired (answered too late), or never fetched.
   */
  async ack(runId: string, controlId: string, request: AckControlDto): Promise<RunControlResource> {
    return this.controls.transaction(async (trx) => {
      const run = await this.controls.lockRun(trx, runId);

      if (run === undefined) {
        throw runNotFound(runId);
      }

      await this.controls.sweep(trx, runId);

      const control = await this.controls.findForUpdate(trx, runId, controlId);

      if (control === undefined) {
        throw controlNotFound(runId, controlId);
      }

      if (control.state !== "delivered") {
        throw controlNotDelivered(controlId, control.state);
      }

      const detail = request.effect ?? defaultAckDetail(control.kind, request.attempt);
      const acked = await this.controls.ack(trx, controlId, detail);

      if (acked.kind === "abort") {
        await this.controls.cancelRun(trx, runId);
      }

      return runControlResource(acked);
    });
  }

  // --- the periodic sweep -----------------------------------------------------------------

  /**
   * Expire every elapsed control in every run.
   *
   * @returns How many expired.
   */
  async sweep(): Promise<number> {
    return this.controls.sweep(this.controls.db);
  }

  /**
   * Check what the kind carries, and shape the row to insert.
   *
   * @param runId - The run.
   * @param requester - Who is asking.
   * @param request - The request.
   * @param retryStage - Whether a steer is a correction round.
   * @returns The submission.
   * @throws {InvalidRequestError} `422 control_payload_invalid` for a steer with no text, text on
   *   any other kind, or `remember` on anything but a steer.
   */
  private submission(
    runId: string,
    requester: Requester,
    request: SubmitControlDto,
    retryStage: boolean,
  ): ControlSubmission {
    const { kind } = request;

    if (kind === "steer") {
      if (request.payload === undefined || request.payload.trim() === "") {
        throw controlPayloadInvalid(kind, "payload", "Say how to steer the loop.");
      }
    } else {
      if (request.payload !== undefined) {
        throw controlPayloadInvalid(
          kind,
          "payload",
          `A ${kind} carries no text; only a steer does.`,
        );
      }

      if (request.remember === true) {
        throw controlPayloadInvalid(kind, "remember", "Only a steer can be remembered.");
      }
    }

    return {
      runId,
      kind,
      payload: kind === "steer" ? (request.payload ?? null) : null,
      remember: request.remember ?? false,
      retryStage: kind === "steer" && retryStage,
      requestedBy: requester.id,
      ttlSeconds: ttlSeconds(kind, {
        control: this.config.runControlTtlSeconds,
        steer: this.config.runSteerTtlSeconds,
      }),
      ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
    };
  }
}

/**
 * Is an earlier control under the same key the same request as this one?
 *
 * The requester is not compared. A key names a submission, and a retry comes from the same
 * client.
 *
 * @param earlier - The control the key already names.
 * @param submission - This request.
 * @returns Whether a replay is honest.
 */
function sameSubmission(earlier: RunControl, submission: ControlSubmission): boolean {
  return (
    earlier.kind === submission.kind &&
    earlier.payload === submission.payload &&
    earlier.remember === submission.remember &&
    earlier.retry_stage === submission.retryStage
  );
}
