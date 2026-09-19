/**
 * The agent gateway — the server half of the runner protocol, as a module.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)) under epic
 * [#240](https://github.com/NobuData/ouroboros/issues/240). The layers, with the files that
 * carry the issue's criteria named beside them:
 *
 * ```
 * the socket     agent.gateway.ts     upgrade · authenticate · refuse in the error envelope
 *                transport.ts         certificate (AH.2's check) or the bearer fallback
 * the session    agent.connection.ts  hello → ack · heartbeat · job.finish → receipt · bye
 *                hello.ts             version floors · security mode vs transport
 *                agent.sessions.ts    connection ↔ runner · ordered outbox · resume · offers
 * the row        gateway.repository.ts  every statement; the terminal ledger's transaction
 *                telemetry.ts · terminal.ts · capabilities.ts   the three translations
 * the fleet      presence.sweeper.ts  missed × 3 → offline, last_seen_at untouched
 *                runner.control.ts    drain / undrain — intent written, then pushed
 *                gateway.metrics.ts   what AJ.4 (#266) will retain
 * ../protocol/   the codec, held to schemas/runner-protocol/fixtures with the Go agent
 * ```
 *
 * ---------------------------------------------------------------------------
 * **A module of its own rather than more of `FarmModule`**, because it is a different kind of
 * thing: `FarmModule` is request/response routes and the CA, and this is a long-lived socket
 * server with a sweep loop. It imports `FarmModule` for one service — `RunnerIdentityService`,
 * which AH.2 exported for exactly this — and reads no farm table that module owns except through
 * it.
 *
 * **It exports three things, each for a named ticket:** `AgentSessions` for dispatch (AH.4,
 * [#252](https://github.com/NobuData/ouroboros/issues/252)) to offer jobs and hear their answers,
 * and log ingest (AH.5, [#253](https://github.com/NobuData/ouroboros/issues/253)) to hear
 * `log.chunk`; `RunnerControl` for the lifecycle actions (AH.6,
 * [#254](https://github.com/NobuData/ouroboros/issues/254)); and `GatewayMetrics` for the health
 * history (AJ.4, [#266](https://github.com/NobuData/ouroboros/issues/266)).
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";

import { AppConfigService } from "../../config/config.service";
import { DbModule } from "../../db/db.module";
import { VaultModule } from "../../vault/vault.module";
import { FarmModule } from "../farm.module";
import { AgentGateway, VERSION_POLICY } from "./agent.gateway";
import { AgentSessions } from "./agent.sessions";
import { GATEWAY_CLOCK } from "./gateway.clock";
import { GatewayMetrics } from "./gateway.metrics";
import { AgentGatewayRepository } from "./gateway.repository";
import { DEFAULT_VERSION_POLICY, type VersionPolicy } from "./hello";
import { PresenceSweeper } from "./presence.sweeper";
import { RunnerControl } from "./runner.control";
import { TransportAuthenticator } from "./transport";

@Module({
  imports: [FarmModule, DbModule, VaultModule, ScheduleModule.forRoot()],
  providers: [
    AgentGateway,
    AgentSessions,
    AgentGatewayRepository,
    TransportAuthenticator,
    PresenceSweeper,
    RunnerControl,
    GatewayMetrics,
    {
      // The clock, as a provider — `gateway.clock.ts` on why.
      provide: GATEWAY_CLOCK,
      useValue: () => new Date(),
    },
    {
      // The build's protocol lines, and the operator's agent-version floor if one is set.
      provide: VERSION_POLICY,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): VersionPolicy => ({
        ...DEFAULT_VERSION_POLICY,
        minimumAgentVersion: config.farmMinAgentVersion,
      }),
    },
  ],
  exports: [AgentSessions, RunnerControl, GatewayMetrics],
})
export class FarmGatewayModule {}
