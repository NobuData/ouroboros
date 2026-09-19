/**
 * Log ingest — `log.chunk` frames from the agent gateway, stored in `seq` order, capped, guarded,
 * and with every hole marked once.
 *
 * AH.5 ([#253](https://github.com/NobuData/ouroboros/issues/253)) on AH.3's
 * ([#251](https://github.com/NobuData/ouroboros/issues/251)) gateway path: it hears frames through
 * `AgentSessions.listen`, the seam the gateway built for exactly this, and the gateway never
 * imports it.
 *
 * ```
 * log.chunk ──▶ this runner's job, in this workspace? ──no──▶ ignored
 *     │ yes
 *     ▼
 * reassembly (seq order; a gap held ≤ 10 s / 64 chunks, then given up as missing chunks)
 *     │ each ready chunk
 *     ▼
 * rate guard (per workspace) ──refused──▶ not stored; its bytes carried to the next stored chunk
 *     │ admitted
 *     ▼
 * insert (cap trigger: byte_start · clamp + marker · past the cap, counted on the job)
 *
 * job.finish ──▶ (before it is recorded) flush gaps ──▶ the tail: agent's tail drops + carried
 *                refusals + missing frames ──▶ then the ledger marks the job finished
 * ```
 *
 * ---------------------------------------------------------------------------
 * **One honest marker.** Elision is data, never text in the stream — the protocol already says so
 * (`log.chunk.dropped_bytes`, `job.finish.log.dropped_bytes`, and the console renders the marker).
 * Every hole is kept by *position*: before a chunk (`elided_bytes`, `missing_chunks`) or after the
 * last stored byte (the job's `log_dropped_bytes` and `log_missing_chunks`). The agent's own
 * per-job cap and this service's both describe the end of the same log, so both land in the tail
 * figure and the console draws one marker there, not two.
 *
 * **Per job, one thing at a time.** Frames of one job arrive on one connection and are handed to
 * listeners in order, but the housekeeping tick can release a stalled gap at any moment; each job's
 * state carries a promise chain, so a store never races another store of the same job.
 *
 * **A finished job's log is final.** Chunks are written only while the job is offered, accepted
 * or running; the finish is accounted before the job is marked finished; a chunk that arrives
 * after — a cancelled build's last output, a presumed-lost runner's — is not written. So `live:
 * false` on the read side means the log will not change again.
 *
 * **In memory, per process.** A reorder buffer is a few seconds of state. After a restart, or a
 * reconnect to another replica, a gap in flight is recorded as missing chunks rather than waited
 * for — honest, and less precise.
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
import { AgentSessions, type FrameContext } from "../gateway/agent.sessions";
import { GATEWAY_CLOCK, type GatewayClock } from "../gateway/gateway.clock";
import type { Envelope } from "../protocol/protocol";
import { uuidOf } from "../protocol/ulid";
import {
  LOG_GAP_WAIT_MS,
  LOG_HOUSEKEEPING_INTERVAL_MS,
  LOG_IDLE_FORGET_MS,
  LOG_PENDING_MAX,
} from "./log.policy";
import { LogRepository, type WritableJob } from "./log.repository";
import { FARM_LOG_RETENTION, retainUntil, type LogRetentionPolicy } from "./log.retention";
import { Reassembly, type ReadyChunk } from "./reassembly";
import { FARM_LOG_RATE_GUARD, RateGuard } from "./rate.guard";

/** How the housekeeping timer names itself in `SchedulerRegistry`. */
export const LOG_HOUSEKEEPING = "farm-log-housekeeping";

/** One job's ingest, while its chunks are arriving. */
interface JobState {
  readonly job: WritableJob;
  /** The runner writing it — a job re-dispatched to another runner starts a new state. */
  readonly runnerId: string;
  readonly reassembly: Reassembly;
  /** Bytes the rate guard refused since the last stored chunk. */
  refusedBytes: number;
  /** Chunks given up as lost since the last stored chunk, while it was being refused. */
  refusedMissing: number;
  /** When a chunk last arrived, in epoch milliseconds. */
  lastSeen: number;
  /** Everything done to this job, in order. */
  work: Promise<void>;
}

@Injectable()
export class LogIngest implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(LogIngest.name);
  /** Each job being ingested, by workspace and job. */
  private readonly jobs = new Map<string, JobState>();
  private unsubscribe: (() => void)[] = [];
  private stopped = false;

  /**
   * @param repository - Every statement ingest issues.
   * @param sessions - Where the frames come from.
   * @param rateGuard - The per-workspace guard.
   * @param policy - The retention policy, for each chunk's `retain_until`.
   * @param scheduler - Nest's registry, so the timer has a name.
   * @param now - The gateway's clock.
   */
  constructor(
    private readonly repository: LogRepository,
    private readonly sessions: AgentSessions,
    @Inject(FARM_LOG_RATE_GUARD) private readonly rateGuard: RateGuard,
    @Inject(FARM_LOG_RETENTION) private readonly policy: LogRetentionPolicy,
    private readonly scheduler: SchedulerRegistry,
    @Inject(GATEWAY_CLOCK) private readonly now: GatewayClock,
  ) {}

  /** Listen for chunks and finishes, and start the housekeeping loop. */
  onApplicationBootstrap(): void {
    this.unsubscribe = [
      this.sessions.listen("log.chunk", (context, envelope) => this.chunk(context, envelope)),
      // Before the finish is recorded, not after: the job must not read as finished while its
      // log's tail is still being written, or the card stops polling without it.
      this.sessions.onTerminal((context, envelope) => this.finish(context, envelope)),
    ];
    this.schedule();
  }

  /** Stop listening, and stop the loop. */
  onApplicationShutdown(): void {
    this.stopped = true;
    for (const stop of this.unsubscribe.splice(0)) stop();

    if (this.scheduler.doesExist("timeout", LOG_HOUSEKEEPING)) {
      this.scheduler.deleteTimeout(LOG_HOUSEKEEPING);
    }
  }

  /**
   * A chunk arrived.
   *
   * @param context - Where it came from — the runner's proven identity.
   * @param envelope - The `log.chunk`, already judged by the codec (base64, and at most 32 KiB
   *   decoded).
   * @returns When it has been reassembled and whatever became ready has been stored.
   */
  async chunk(context: FrameContext, envelope: Envelope<"log.chunk">): Promise<void> {
    const jobId = uuidOf("job", envelope.payload.job);
    if (!jobId) return;

    const state = await this.stateFor(context, jobId);
    if (!state) return;

    const at = this.now().getTime();
    state.lastSeen = at;

    await this.enqueue(state, async () => {
      const { ready } = state.reassembly.accept(
        {
          seq: envelope.payload.seq,
          bytes: Buffer.from(envelope.payload.data, "base64"),
          droppedBytes: envelope.payload.dropped_bytes,
        },
        at,
      );
      await this.place(state, ready);
    });
  }

  /**
   * A job is about to be finished: release whatever is held, and record the tail — before the
   * ledger marks it finished, so its log is final by the time anybody sees it end.
   *
   * A re-sent finish changes nothing: the job is already finished by then, so it is not open.
   *
   * @param context - Where it came from.
   * @param envelope - The `job.finish`.
   * @returns When the tail is recorded.
   */
  async finish(context: FrameContext, envelope: Envelope<"job.finish">): Promise<void> {
    const jobId = uuidOf("job", envelope.payload.job);
    if (!jobId) return;

    const state = await this.stateFor(context, jobId);
    if (!state) return;

    await this.enqueue(state, async () => {
      await this.place(state, state.reassembly.flush());

      await this.repository.finish(state.job, {
        agentDropped: envelope.payload.log.dropped_bytes,
        missingChunks:
          Math.max(0, envelope.payload.log.chunks - state.reassembly.nextSeq) +
          state.refusedMissing,
        refusedBytes: state.refusedBytes,
      });
    });

    this.jobs.delete(key(state.job));
  }

  /**
   * Release stalled gaps and forget idle jobs — what the housekeeping loop does, and what a suite
   * drives.
   *
   * @returns When every job has been looked at.
   */
  async housekeep(): Promise<void> {
    const at = this.now().getTime();

    for (const state of [...this.jobs.values()]) {
      const idle = at - state.lastSeen >= LOG_IDLE_FORGET_MS;

      await this.enqueue(state, () =>
        this.place(state, idle ? state.reassembly.flush() : state.reassembly.expire(at)),
      );

      if (idle) this.jobs.delete(key(state.job));
    }

    this.rateGuard.prune(at);
  }

  /**
   * How many jobs are being ingested here — for a suite.
   *
   * @returns The count.
   */
  get active(): number {
    return this.jobs.size;
  }

  /**
   * Store chunks released in order: through the rate guard, into the table.
   *
   * @param state - The job.
   * @param ready - The chunks, in `seq` order.
   * @returns When every one has been stored or refused.
   */
  private async place(state: JobState, ready: readonly ReadyChunk[]): Promise<void> {
    for (const chunk of ready) {
      const at = this.now();

      if (!this.rateGuard.admit(state.job.organization_id, chunk.bytes.length, at.getTime())) {
        state.refusedBytes += chunk.droppedBytes + chunk.bytes.length;
        state.refusedMissing += chunk.missingBefore;
        await this.repository.countAgentDrops(state.job, chunk.droppedBytes);
        continue;
      }

      const outcome = await this.repository.store(state.job, {
        seq: chunk.seq,
        content: chunk.bytes,
        elidedBytes: state.refusedBytes + chunk.droppedBytes,
        missingChunks: state.refusedMissing + chunk.missingBefore,
        agentDropped: chunk.droppedBytes,
        retainUntil: retainUntil(this.policy, at),
      });

      // The job finished while this was on its way: its log is final, and so is this state.
      if (outcome === "closed") {
        this.jobs.delete(key(state.job));
        return;
      }

      // A duplicate is a chunk stored before this state existed — a restart, a replica — so
      // what was carried still belongs to the next chunk that is new.
      if (outcome !== "duplicate") {
        state.refusedBytes = 0;
        state.refusedMissing = 0;
      }
    }
  }

  /**
   * A job's ingest state, created on its first chunk — or `undefined` when the runner may not
   * write this job's log: another runner's job, another workspace's, or one that does not exist.
   *
   * @param context - The runner and workspace, from the connection's identity.
   * @param jobId - The job the frame named.
   * @returns The state.
   */
  private async stateFor(context: FrameContext, jobId: string): Promise<JobState | undefined> {
    // Ownership is checked when a state is made, and a state belongs to one runner: a job
    // re-dispatched to another runner mid-stream is checked afresh on that runner's first chunk.
    const existing = this.jobs.get(JSON.stringify([context.organizationId, jobId]));
    if (existing?.runnerId === context.runnerId) return existing;

    const job = await this.repository.writableJob(context.organizationId, context.runnerId, jobId);
    if (!job) return undefined;

    const state: JobState = {
      job,
      runnerId: context.runnerId,
      reassembly: new Reassembly(await this.repository.nextSeq(job.id), {
        pendingMax: LOG_PENDING_MAX,
        gapWaitMs: LOG_GAP_WAIT_MS,
      }),
      refusedBytes: 0,
      refusedMissing: 0,
      lastSeen: this.now().getTime(),
      work: Promise.resolve(),
    };
    this.jobs.set(key(job), state);

    return state;
  }

  /**
   * Run a step of a job's ingest after every step before it.
   *
   * @param state - The job.
   * @param step - The step.
   * @returns When it has run. Its failure is logged and does not poison later steps.
   */
  private enqueue(state: JobState, step: () => Promise<void>): Promise<void> {
    const run = state.work.then(step).catch((error: unknown) => {
      this.logger.error(
        `Log ingest for build job ${state.job.id} failed; the chunk is not stored.`,
        describeForLog(error),
      );
    });
    state.work = run;

    return run;
  }

  /** Book the next housekeeping pass, unless the application is going away. */
  private schedule(): void {
    if (this.stopped) return;

    const timer = setTimeout(() => {
      if (this.scheduler.doesExist("timeout", LOG_HOUSEKEEPING)) {
        this.scheduler.deleteTimeout(LOG_HOUSEKEEPING);
      }
      void this.housekeep().finally(() => this.schedule());
    }, LOG_HOUSEKEEPING_INTERVAL_MS);

    // The loop must not be the reason a process stays alive.
    timer.unref();

    this.scheduler.addTimeout(LOG_HOUSEKEEPING, timer);
  }
}

/**
 * A job's key in {@link LogIngest}'s map.
 *
 * @param job - The job.
 * @returns A key no two jobs share: JSON, so no separator can be forged by an id.
 */
function key(job: WritableJob): string {
  return JSON.stringify([job.organization_id, job.id]);
}
