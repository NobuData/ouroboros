/**
 * The dispatcher — which runner is offered which job, what happens to the answer, and what
 * happens when a runner is never heard from again.
 *
 * AH.4 ([#252](https://github.com/NobuData/ouroboros/issues/252)). The interesting cases are all
 * failure cases, and each has a line below:
 *
 * ```
 * submit · hello · decline · finish · tick ──▶ kick ──▶ drain the queue, oldest first
 *     for each waiting job: gate(workspace) ─▶ candidates (pool · executor · cap · drain) ─▶ connected here?
 *        └─▶ place (runner locked, cap re-counted) ─▶ job.offer ─▶ no session? release, next runner
 *
 * job.accept  ──▶ offered → accepted (q:N +1)          stale? job.cancel{reassigned}
 * job.decline ──▶ offered → waiting, that runner cooled off for this job, kick
 * job.start   ──▶ (gateway: running)                   not this runner's any more? job.cancel
 * job.finish  ──▶ (gateway: ledger + retry policy)     applied? completion, kick
 * heartbeat   ──▶ the job it says it runs is not its own? job.cancel
 *
 * tick ──▶ unanswered offers back to the queue
 *      ──▶ lost runners' jobs: offered/accepted → waiting; running → retried once, then failed
 * ```
 *
 * ---------------------------------------------------------------------------
 * **One drain at a time in this process, and correct across processes.** A burst of submissions
 * kicks the dispatcher once per submission; the kicks coalesce into one running drain plus, at
 * most, one more after it. What keeps two *replicas* from over-filling one runner is not this
 * but `DispatchRepository.place`, which decides capacity under the runner's row lock.
 *
 * **Connected means connected here.** Sessions live in the process that holds the socket
 * (`agent.sessions.ts`), so a replica only offers to runners whose socket it holds — every
 * replica drains the same queue, and the job goes to whichever holds a runner that can take it.
 * A runner whose socket dropped is not offered anything until it is back, even inside its resume
 * window: an offer to a detached session is one nobody is there to answer.
 *
 * **A runner told to stop a job is told once per session.** The reconciliation on accept, start
 * and heartbeat would otherwise repeat a `job.cancel` every ten seconds for a job an agent takes
 * a while to stop; a new session — a reconnect — is told again, because its agent may be a new
 * process that never heard.
 */

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { describeForLog } from "../../errors/failure";
import { jittered } from "../../scheduling/cadence";
import type { AgentSession, FrameContext } from "../gateway/agent.sessions";
import { AgentSessions } from "../gateway/agent.sessions";
import { GATEWAY_CLOCK, type GatewayClock } from "../gateway/gateway.clock";
import { OFFER_ACK_MS } from "../gateway/gateway.policy";
import type { Envelope } from "../protocol/protocol";
import type { CancelReason } from "../protocol/protocol.messages";
import { uuidOf, wireId } from "../protocol/ulid";
import { FARM_OFFER_UPLOADS, type OfferUploads } from "../artifacts/upload.service";
import { FARM_DISPATCH_GATE, type DispatchGate } from "./dispatch.gate";
import {
  DECLINE_COOLDOWN_MS,
  DISPATCH_BATCH,
  DISPATCH_INTERVAL_MS,
  LOST_RUNNER_AFTER_MS,
  OFFER_RECLAIM_MS,
  OPERATOR_CANCEL_DETAIL,
  REASSIGNED_CANCEL_DETAIL,
} from "./dispatch.policy";
import { DispatchRepository, type PlacedJob, type WaitingJob } from "./dispatch.repository";
import { JobCompletions } from "./job.completions";
import { offerPayload, undispatchable } from "./offer";

/** How the timer names itself in `SchedulerRegistry`. */
export const DISPATCH_TICK = "farm-dispatch";

/** What one tick did. */
export interface DispatchReport {
  /** Offers nobody answered, taken back into the queue. */
  readonly reclaimed: number;
  /** Jobs taken back from lost runners — waiting again, retried or failed. */
  readonly requeued: number;
}

/**
 * Which runners declined which jobs, and until when they are passed over for them.
 *
 * In memory, because it is advice rather than state: a decline is also a fact the runner will
 * repeat if asked again, so forgetting one on a restart costs one more decline and nothing else.
 */
export class DeclineMemory {
  /** job → runner → epoch milliseconds the cooldown ends. */
  private readonly until = new Map<string, Map<string, number>>();

  /**
   * @param cooldownMs - How long a decliner is passed over for the job it declined.
   */
  constructor(private readonly cooldownMs: number = DECLINE_COOLDOWN_MS) {}

  /**
   * A runner declined a job.
   *
   * @param jobId - The job.
   * @param runnerId - The runner.
   * @param at - When, in epoch milliseconds.
   */
  note(jobId: string, runnerId: string, at: number): void {
    const runners = this.until.get(jobId) ?? new Map<string, number>();
    runners.set(runnerId, at + this.cooldownMs);
    this.until.set(jobId, runners);
  }

  /**
   * Whether a runner is still being passed over for a job.
   *
   * @param jobId - The job.
   * @param runnerId - The runner.
   * @param at - Now, in epoch milliseconds.
   * @returns True inside the cooldown.
   */
  cooling(jobId: string, runnerId: string, at: number): boolean {
    return (this.until.get(jobId)?.get(runnerId) ?? 0) > at;
  }

  /**
   * Forget every cooldown that has ended.
   *
   * @param at - Now, in epoch milliseconds.
   */
  prune(at: number): void {
    for (const [jobId, runners] of this.until) {
      for (const [runnerId, until] of runners) if (until <= at) runners.delete(runnerId);
      if (runners.size === 0) this.until.delete(jobId);
    }
  }
}

@Injectable()
export class DispatchService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DispatchService.name);
  private readonly declines = new DeclineMemory();
  /** The jobs each session has been told to stop, so it is told once. */
  private readonly told = new WeakMap<AgentSession, Set<string>>();
  /** Jobs already reported as impossible to offer, so the log says it once. */
  private readonly reported = new Set<string>();
  private unsubscribe: (() => void)[] = [];
  private draining: Promise<void> | undefined;
  private again = false;
  private stopped = false;

  /**
   * @param repository - Every statement dispatch issues.
   * @param sessions - This process's sessions: who is connected, and the reach to each.
   * @param completions - Where a job reaching a terminal status is announced (#510's seam).
   * @param gate - Whether a workspace may be dispatched to at all (#489's seam).
   * @param scheduler - Nest's registry, so the timer has a name.
   * @param now - The gateway's clock — the one `last_seen_at` is written with.
   * @param uploads - Where an offer's single-use artifact upload token is minted (#330).
   */
  constructor(
    private readonly repository: DispatchRepository,
    private readonly sessions: AgentSessions,
    private readonly completions: JobCompletions,
    @Inject(FARM_DISPATCH_GATE) private readonly gate: DispatchGate,
    private readonly scheduler: SchedulerRegistry,
    @Inject(GATEWAY_CLOCK) private readonly now: GatewayClock,
    @Inject(FARM_OFFER_UPLOADS) private readonly uploads: OfferUploads,
  ) {}

  /** Listen to the agents' answers, and start the loop. */
  onApplicationBootstrap(): void {
    this.unsubscribe = [
      this.sessions.listen("hello", () => {
        void this.kick();
      }),
      this.sessions.listen("job.accept", (context, envelope) => this.accepted(context, envelope)),
      this.sessions.listen("job.decline", (context, envelope) => this.declined(context, envelope)),
      this.sessions.listen("job.start", (context, envelope) =>
        this.reconcile(context, envelope.payload.job),
      ),
      this.sessions.listen("job.finish", (context) => {
        this.finished(context);
      }),
      this.sessions.listen("heartbeat", (context, envelope) =>
        envelope.payload.job ? this.reconcile(context, envelope.payload.job.id) : undefined,
      ),
    ];
    this.schedule();
  }

  /** Stop listening, and stop the loop. */
  onApplicationShutdown(): void {
    this.stopped = true;
    for (const stop of this.unsubscribe.splice(0)) stop();

    if (this.scheduler.doesExist("timeout", DISPATCH_TICK)) {
      this.scheduler.deleteTimeout(DISPATCH_TICK);
    }
  }

  /**
   * Drain the queue: offer every waiting job that some connected runner can take.
   *
   * Kicks coalesce — a kick during a drain runs the drain once more after it, not once per kick.
   *
   * @returns When the drain this kick joined, and any it scheduled, have finished.
   */
  kick(): Promise<void> {
    if (this.draining) {
      this.again = true;
      return this.draining;
    }

    this.draining = (async () => {
      try {
        do {
          this.again = false;
          await this.drain();
        } while (this.again && !this.stopped);
      } catch (error) {
        // A failed drain is retried by the next kick or tick; the queue is in the database.
        this.logger.error(
          "A dispatch pass failed; the next one will retry.",
          describeForLog(error),
        );
      } finally {
        this.draining = undefined;
      }
    })();

    return this.draining;
  }

  /**
   * One tick without the scheduling — what a suite drives: take back unanswered offers and lost
   * runners' jobs, then drain.
   *
   * @returns What it took back.
   */
  async tick(): Promise<DispatchReport> {
    const at = this.now().getTime();

    const reclaimed = await this.repository.reclaimOffers(new Date(at - OFFER_RECLAIM_MS));
    for (const job of reclaimed) {
      if (job.runner_id) {
        this.sessions.withdraw(job.organization_id, job.runner_id, wireId("job", job.id));
      }
    }

    const cutoff = new Date(at - LOST_RUNNER_AFTER_MS);
    let requeued = 0;
    for (const lost of await this.repository.lostJobs(cutoff, DISPATCH_BATCH)) {
      const outcome = await this.repository.requeueLost(
        lost.organization_id,
        lost.id,
        cutoff,
        new Date(at),
      );
      if (!outcome) continue;

      requeued += 1;
      this.logger.warn(
        `Build job ${outcome.jobId} was taken back from lost runner ${outcome.runnerId}: ` +
          `${outcome.from} → ${outcome.to}.`,
      );
      if (outcome.to !== "waiting") {
        this.completions.emit({
          organizationId: outcome.organizationId,
          jobId: outcome.jobId,
          status: outcome.to,
        });
      }
    }

    this.declines.prune(at);
    await this.kick();

    return { reclaimed: reclaimed.length, requeued };
  }

  /**
   * Tell the runner holding a cancelled job to stop it — the cancellation API's propagation.
   *
   * @param organizationId - The workspace.
   * @param runnerId - The runner that held it.
   * @param jobId - The job.
   */
  propagateCancel(organizationId: string, runnerId: string, jobId: string): void {
    const wire = wireId("job", jobId);

    this.sessions.withdraw(organizationId, runnerId, wire);
    this.tell(organizationId, runnerId, wire, "operator");
  }

  /** Run one tick and book the next, whatever this one did. */
  private async scheduledTick(): Promise<void> {
    if (this.scheduler.doesExist("timeout", DISPATCH_TICK)) {
      this.scheduler.deleteTimeout(DISPATCH_TICK);
    }

    try {
      const report = await this.tick();

      if (report.reclaimed > 0 || report.requeued > 0) {
        this.logger.log(
          `Dispatch: ${String(report.reclaimed)} unanswered offer(s) and ` +
            `${String(report.requeued)} lost runner job(s) taken back.`,
        );
      }
    } catch (error) {
      // A tick is lost, not the loop: a process that stopped ticking would never notice a dead
      // runner again, and its jobs would be held for ever.
      this.logger.error("A dispatch tick failed; retrying next tick.", describeForLog(error));
    }

    this.schedule();
  }

  /** Book the next tick, unless the application is going away. */
  private schedule(): void {
    if (this.stopped) return;

    const timer = setTimeout(() => {
      void this.scheduledTick();
    }, jittered(DISPATCH_INTERVAL_MS));

    // The loop must not be the reason a process stays alive.
    timer.unref();

    this.scheduler.addTimeout(DISPATCH_TICK, timer);
  }

  /** One pass over the queue, oldest job first. */
  private async drain(): Promise<void> {
    const admitted = new Map<string, boolean>();

    for (const job of await this.repository.waiting(DISPATCH_BATCH)) {
      if (this.stopped) return;

      let admits = admitted.get(job.organization_id);
      if (admits === undefined) {
        admits = await this.gate.admits(job.organization_id);
        admitted.set(job.organization_id, admits);
      }

      if (admits) await this.placeOne(job);
    }
  }

  /**
   * Offer one waiting job to the first connected runner that can take it.
   *
   * @param job - The job.
   */
  private async placeOne(job: WaitingJob): Promise<void> {
    const impossible = undispatchable(job);
    if (impossible) {
      if (!this.reported.has(job.id)) {
        this.reported.add(job.id);
        this.logger.error(`Build job ${job.id} is left queued: ${impossible}.`);
      }
      return;
    }

    const at = this.now();
    const candidates = (await this.repository.candidates(job, at)).filter(
      (runner) =>
        this.sessions.isConnected(job.organization_id, runner.id) &&
        !this.declines.cooling(job.id, runner.id, at.getTime()),
    );

    for (const runner of candidates) {
      const placement = await this.repository.place(job, runner.id, at);

      if (placement.kind === "job_unavailable") return;
      if (placement.kind === "placed" && (await this.send(placement.placed, at))) return;
    }
  }

  /**
   * Send an offer for a job just placed, or put the job back if it cannot be sent.
   *
   * The offer carries the job's artifact upload (#330) — a single-use token minted here, so a job
   * offered again gets a fresh one and the runner that did not take it holds a dead token. A token
   * that cannot be minted is an offer that cannot be sent: results with nowhere to go would be
   * dropped silently, so the job waits for the next pass instead.
   *
   * @param placed - The job, offered in the database.
   * @param at - When it was placed.
   * @returns Whether the offer is in the runner's session.
   */
  private async send(placed: PlacedJob, at: Date): Promise<boolean> {
    const { job } = placed;
    const runnerId = job.runner_id as string;
    let sent: string | undefined;

    try {
      const payload = offerPayload(placed, new Date(at.getTime() + OFFER_ACK_MS));
      const upload = await this.uploads.forOffer(job, at, OFFER_ACK_MS + payload.timeout_s * 1000);

      sent = this.sessions.offer(
        job.organization_id,
        runnerId,
        upload ? { ...payload, upload } : payload,
      );
    } catch (error) {
      // An offer this gateway would refuse to send is a record it cannot dispatch; the log is
      // where it surfaces, and the job goes back to wait for somebody to look.
      this.logger.error(`Build job ${job.id} could not be offered.`, describeForLog(error));
    }

    if (sent) return true;

    await this.repository.release(job.organization_id, runnerId, job.id);
    return false;
  }

  /**
   * An agent accepted an offer: the job is its own now, waiting behind whatever it runs.
   *
   * @param context - Where the frame came from.
   * @param envelope - The `job.accept`.
   * @returns When it has been recorded.
   */
  private async accepted(context: FrameContext, envelope: Envelope<"job.accept">): Promise<void> {
    const jobId = uuidOf("job", envelope.payload.job);
    if (!jobId) return;

    if (await this.repository.accept(context.organizationId, context.runnerId, jobId)) return;

    // An accept that moved nothing: a re-send, or an offer that lapsed and went elsewhere —
    // in which case the agent has started a job that is no longer its own.
    await this.reconcile(context, envelope.payload.job);
  }

  /**
   * An agent declined an offer: the job goes back to the queue, and to another runner.
   *
   * @param context - Where the frame came from.
   * @param envelope - The `job.decline`.
   * @returns When it has been recorded.
   */
  private async declined(context: FrameContext, envelope: Envelope<"job.decline">): Promise<void> {
    const jobId = uuidOf("job", envelope.payload.job);
    if (!jobId) return;

    if (await this.repository.release(context.organizationId, context.runnerId, jobId)) {
      this.declines.note(jobId, context.runnerId, this.now().getTime());
      void this.kick();
    }
  }

  /**
   * A `job.finish` was recorded. If it finished a build — rather than being a re-send — that is
   * a completion, and a runner has room again.
   *
   * @param context - Where it came from, with the ledger's verdict.
   */
  private finished(context: FrameContext): void {
    const record = context.terminal;
    if (!record?.applied || !record.jobId || !record.status) return;

    this.completions.emit({
      organizationId: context.organizationId,
      jobId: record.jobId,
      status: record.status,
    });
    void this.kick();
  }

  /**
   * A runner reported a job — by accepting, starting or running it. If the job is not its own
   * any more, tell it to stop.
   *
   * @param context - Where the report came from.
   * @param wire - The job's wire id.
   * @returns When it has been checked.
   */
  private async reconcile(context: FrameContext, wire: string): Promise<void> {
    const jobId = uuidOf("job", wire);
    if (!jobId) return;

    const liveness = await this.repository.liveness(
      context.organizationId,
      context.runnerId,
      jobId,
    );

    if (liveness === "canceled" || liveness === "elsewhere") {
      this.tell(
        context.organizationId,
        context.runnerId,
        wire,
        liveness === "canceled" ? "operator" : "reassigned",
      );
    }
  }

  /**
   * Send a `job.cancel` into a runner's session — once per session per job.
   *
   * @param organizationId - The workspace.
   * @param runnerId - The runner.
   * @param wire - The job's wire id.
   * @param reason - Why.
   */
  private tell(organizationId: string, runnerId: string, wire: string, reason: CancelReason): void {
    const session = this.sessions.find(organizationId, runnerId);
    if (!session) return;

    const told = this.told.get(session) ?? new Set<string>();
    if (told.has(wire)) return;

    told.add(wire);
    this.told.set(session, told);
    this.sessions.cancel(organizationId, runnerId, {
      job: wire,
      reason,
      detail: reason === "operator" ? OPERATOR_CANCEL_DETAIL : REASSIGNED_CANCEL_DETAIL,
    });
  }
}
