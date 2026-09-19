/**
 * Drain and undrain — an operator's intent, written down and pushed to the agent.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)): *drain and undrain reach a
 * connected agent and are reflected in its status*. The operator-facing routes and their audit
 * rows are AH.6's ([#254](https://github.com/NobuData/ouroboros/issues/254), mockup 08's `⋯`
 * menu); this is the part of them that is the gateway's, exported so that ticket calls it rather
 * than reaching into the session registry.
 *
 * ```
 * drain(runner)
 *   ├─ runners.desired_state ← draining         THE INTENT — the database is the source of truth
 *   └─ drain frame ─▶ the agent's session here  THE PUSH — immediate when it is connected here
 *                                                          │
 *   agent declines offers, heartbeats state: draining  ◀───┘
 *   └─ runners.status ← draining                THE OBSERVATION — the pill, from the heartbeat
 * ```
 *
 * **The intent is written first, and the push is an optimisation of it.** A runner connected to
 * another replica, or not connected at all, is told at its next heartbeat or hello: both
 * reconcile what the agent reports against `desired_state` (`agent.connection.ts`). So a drain
 * cannot be lost to the runner being elsewhere, and the pill is only ever what the runner's own
 * heartbeat said — V040's *observation and intent are two columns*.
 */

import { Injectable } from "@nestjs/common";

import type { Runner } from "../../db/schema";
import { frame } from "../protocol/protocol";
import type { DrainPayload } from "../protocol/protocol.messages";
import { AgentSessions } from "./agent.sessions";
import { AgentGatewayRepository } from "./gateway.repository";

/** What a drain or undrain did. */
export interface ControlResult {
  /** The runner row, with its new `desired_state`. */
  readonly runner: Runner;
  /**
   * Whether the frame went into a session in this process. False is not a failure: the runner
   * is told at its next heartbeat or hello, wherever it connects.
   */
  readonly pushed: boolean;
}

@Injectable()
export class RunnerControl {
  /**
   * @param repository - Where the intent is written.
   * @param sessions - Where the frame is pushed.
   */
  constructor(
    private readonly repository: AgentGatewayRepository,
    private readonly sessions: AgentSessions,
  ) {}

  /**
   * Withdraw a runner from dispatch without stopping it: it declines new offers and finishes what
   * it is running.
   *
   * @param organizationId - The workspace — the caller's, from its own session.
   * @param runnerId - The runner.
   * @param drain - Why, how long running work is given, and one sentence for the agent's log.
   * @returns The result, or `undefined` when the workspace has no such runner or it was removed.
   */
  async drain(
    organizationId: string,
    runnerId: string,
    drain: DrainPayload,
  ): Promise<ControlResult | undefined> {
    const runner = await this.repository.setDesiredState(organizationId, runnerId, "draining");
    if (!runner) return undefined;

    return { runner, pushed: this.sessions.push(organizationId, runnerId, frame("drain", drain)) };
  }

  /**
   * Put a drained runner back in rotation.
   *
   * @param organizationId - The workspace.
   * @param runnerId - The runner.
   * @returns The result, or `undefined` when the workspace has no such runner or it was removed.
   */
  async undrain(organizationId: string, runnerId: string): Promise<ControlResult | undefined> {
    const runner = await this.repository.setDesiredState(organizationId, runnerId, "active");
    if (!runner) return undefined;

    return { runner, pushed: this.sessions.push(organizationId, runnerId, frame("undrain", {})) };
  }
}
