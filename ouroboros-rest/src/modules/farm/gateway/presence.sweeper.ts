/**
 * The presence sweep — what turns a runner that has stopped heartbeating into `offline`.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)). Presence is *inferred*: a
 * machine that loses power announces nothing, so the only evidence it is gone is the heartbeats
 * that stop arriving. Every tick:
 *
 * ```
 * 1. runners live but last seen before now − 32s ─▶ offline, snapshot cleared
 *                                                   (last_seen_at UNTOUCHED — the last real beat)
 * 2. sockets here whose agent has not beaten since then ─▶ closed; the session waits for resume
 * 3. sessions past their resume window, offers past their expiry ─▶ forgotten
 * ```
 *
 * **The threshold is `gateway.policy.ts`'s, and it is the documented one:** three missed
 * heartbeats plus the jitter half-width, 32 seconds, applied every 5 seconds — so the farm table
 * is at most 37 seconds behind a machine that died. `last_seen_at` stays at the last heartbeat
 * that genuinely arrived, which is the issue's own criterion: mockup 08's `last seen 2h ago` must
 * not be an approximation of an approximation.
 *
 * **Recovery is not the sweep's.** A runner flipped `offline` comes back `online` the moment its
 * agent says hello again (`gateway.repository.ts`'s `recordHello`), on whichever replica it
 * reaches.
 *
 * **Every replica sweeps, and that is harmless.** Step 1 is one conditional `update` on the
 * database's own rows; two replicas running it in the same second flip each runner once. Steps 2
 * and 3 are about this process's own sockets and sessions. The loop is the same self-rescheduling,
 * jittered, non-overlapping, unreferenced timeout as `estimation.sweeper.ts` and its siblings,
 * for the reasons written in `backlog-sync.scheduler.ts`.
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
import { AgentSessions } from "./agent.sessions";
import { GATEWAY_CLOCK, type GatewayClock } from "./gateway.clock";
import { GatewayMetrics } from "./gateway.metrics";
import { PRESENCE_SWEEP_INTERVAL_MS, PRESENCE_THRESHOLD_MS } from "./gateway.policy";
import { AgentGatewayRepository } from "./gateway.repository";

/** How the timer names itself in `SchedulerRegistry`. */
export const PRESENCE_SWEEP = "farm-presence-sweep";

/** What one sweep did. */
export interface PresenceReport {
  /** Runners flipped `offline`. */
  readonly offline: number;
  /** Sockets here closed for carrying no heartbeats. */
  readonly staleClosed: number;
  /** Sessions forgotten after their resume window. */
  readonly expired: number;
}

@Injectable()
export class PresenceSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PresenceSweeper.name);
  /** Set once the application is shutting down — `estimation.sweeper.ts` on why. */
  private stopped = false;

  /**
   * @param repository - The sweep's one statement.
   * @param sessions - This process's sockets and sessions.
   * @param metrics - The counters.
   * @param scheduler - Nest's registry, so the timer has a name.
   * @param now - The clock.
   */
  constructor(
    private readonly repository: AgentGatewayRepository,
    private readonly sessions: AgentSessions,
    private readonly metrics: GatewayMetrics,
    private readonly scheduler: SchedulerRegistry,
    @Inject(GATEWAY_CLOCK) private readonly now: GatewayClock,
  ) {}

  /** Start the loop. The first sweep is a full jittered interval away. */
  onApplicationBootstrap(): void {
    this.schedule();
  }

  /** Stop the loop, and clear a pending timer. */
  onApplicationShutdown(): void {
    this.stopped = true;

    if (this.scheduler.doesExist("timeout", PRESENCE_SWEEP)) {
      this.scheduler.deleteTimeout(PRESENCE_SWEEP);
    }
  }

  /**
   * Run one sweep and schedule the next, whatever this one did.
   *
   * @returns When the next is booked.
   */
  async tick(): Promise<void> {
    if (this.scheduler.doesExist("timeout", PRESENCE_SWEEP)) {
      this.scheduler.deleteTimeout(PRESENCE_SWEEP);
    }

    try {
      const report = await this.sweep();

      if (report.offline > 0 || report.staleClosed > 0) {
        this.logger.log(
          `Presence sweep: ${String(report.offline)} runner(s) offline after ` +
            `${String(PRESENCE_THRESHOLD_MS / 1000)}s without a heartbeat, ` +
            `${String(report.staleClosed)} silent socket(s) closed.`,
        );
      }
    } catch (error) {
      // A sweep is lost, not the loop: a process that silently stopped sweeping would show every
      // runner that dies from now on as online for ever.
      this.logger.error("Presence sweep failed; retrying next tick.", describeForLog(error));
    }

    this.schedule();
  }

  /**
   * One sweep, without the scheduling — what a suite drives.
   *
   * @returns What it did.
   */
  async sweep(): Promise<PresenceReport> {
    const at = this.now().getTime();
    const cutoff = at - PRESENCE_THRESHOLD_MS;

    const swept = await this.repository.sweepOffline(new Date(cutoff));
    this.metrics.swept(swept.length);

    // A socket still open but carrying no heartbeats is an agent that has wedged, or a
    // connection that died without either end noticing. Closing it detaches the session for
    // resume rather than ending it; the agent's reconnect is what brings it back.
    const stale = this.sessions.stale(cutoff);
    for (const session of stale) {
      session.socket?.terminate();
      this.metrics.staleClosedOne();
    }

    return { offline: swept.length, staleClosed: stale.length, expired: this.sessions.expire() };
  }

  /** Book the next tick, unless the application is going away. */
  private schedule(): void {
    if (this.stopped) return;

    const timer = setTimeout(() => {
      void this.tick();
    }, jittered(PRESENCE_SWEEP_INTERVAL_MS));

    // The loop must not be the reason a process stays alive.
    timer.unref();

    this.scheduler.addTimeout(PRESENCE_SWEEP, timer);
  }
}
