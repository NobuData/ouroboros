/**
 * Every statement the agent gateway issues, in one class.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)). `farm.repository.ts` is
 * AH.2's; this one is the gateway's, and the split follows the writers rather than the tables:
 * enrollment creates runners, and the gateway is what keeps them *live* — V040's header calls
 * `runners` the one table in this schema that holds live state, and every write that makes it so
 * is below.
 *
 * ---------------------------------------------------------------------------
 * **Every statement carries `organization_id` and the runner's own id**, both taken from the
 * identity the connection proved rather than from anything in a frame — which is what the issue's
 * *a session cannot affect another organization's runners* comes to. A `job.finish` naming a job
 * of another workspace, or another runner's job in this one, matches no row in
 * {@link AgentGatewayRepository.recordTerminal}'s update, because the update is scoped by both.
 *
 * Two reads are **deliberately unscoped**, and each says so: the presence sweep, which is the
 * fleet's own housekeeping and changes nothing but observations, and the bearer-fallback
 * candidates, which exist because a bearer secret names no workspace until it has matched one.
 *
 * ---------------------------------------------------------------------------
 * **Status is computed in the statement, never read and written back.** A heartbeat decides the
 * runner's pill from what the agent reported *and* what an operator intended, and an operator's
 * drain can land between a read and a write. V040's `runners_draining_is_intended` would refuse
 * the write that got the order wrong; a `case` over the row's own `desired_state` cannot get it
 * wrong, because it reads the value it is writing beside.
 *
 * **The times are the gateway's clock, bounded by the row's own.** `last_seen_at` may not precede
 * `enrolled_at` (`runners_seen_after_enrolled`), and a job cannot start before it was offered or
 * finish before it started. An agent's timestamps are the customer's clock and are only ever
 * used inside those bounds; `greatest`/`least` below is where that is enforced, so a skewed
 * clock costs a few seconds of precision and never a refused write — a refused `job.finish`
 * write would be a lost result.
 */

import { Injectable } from "@nestjs/common";
import { sql, type RawBuilder } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type { AckPool, AgentState, Arch } from "../protocol/protocol.messages";
import type { BuildJobStatus, Runner, RunnerStatus } from "../../db/schema";
import { UNIQUE_VIOLATION, isDatabaseFailure } from "../../tenancy/constraints";
import type { RunnerCapabilities } from "./capabilities";
import type { TelemetrySnapshot } from "./telemetry";
import type { TerminalState } from "./terminal";

/** The statuses a runner that is connected — or was, until it stopped beating — can hold. */
const LIVE_STATUSES = ["online", "building", "draining"] as const;

/** The statuses a job can be finished or started from. */
const UNFINISHED: readonly BuildJobStatus[] = ["queued", "offered", "running"];

/** What a `hello` writes to the runner row. */
export interface HelloRecord {
  readonly hostname: string;
  readonly arch: Arch;
  readonly agentVersion: string;
  readonly capabilities: RunnerCapabilities;
}

/** What a heartbeat writes to the runner row. */
export interface HeartbeatRecord {
  /** What the agent said it is doing. */
  readonly reported: AgentState;
  /** Whether it is running a job. */
  readonly building: boolean;
  readonly telemetry: TelemetrySnapshot;
  readonly uptimeSeconds: number;
}

/** One terminal frame, to record and apply in one transaction. */
export interface TerminalWrite {
  readonly organizationId: string;
  readonly runnerId: string;
  /** The envelope id — the idempotency key. */
  readonly frameId: string;
  /** The job it named, when its id spells one of this database's UUIDs at all. */
  readonly jobId: string | undefined;
  readonly state: TerminalState;
  /** When the agent says the job started — bounded before it is written. */
  readonly agentStartedAt: Date;
}

/** What recording a terminal frame did. */
export interface TerminalRecord {
  /** True when this frame's id was already in the ledger: answer `duplicate`, change nothing. */
  readonly duplicate: boolean;
  /** True when recording it finished a job. */
  readonly applied: boolean;
}

/** A runner the presence sweep flipped. */
export interface SweptRunner {
  readonly id: string;
  readonly organization_id: string;
  readonly last_seen_at: Date | null;
}

/** A pool as an `ack` states it: the name of record, and its execution policy. */
export interface PoolOfRecord {
  readonly name: string;
  readonly policy: AckPool;
}

/**
 * A pool's `env_allowlist` column as the `ack.pool.env_allowlist` it becomes.
 *
 * The column is jsonb, so its type here is `unknown`, and V040's `runner_pools_env_allowlist_shape`
 * is what really holds it to a set of non-empty strings. It is still read defensively: a value that
 * is not one is sent as the entries that are — never as something the contract would make the
 * agent refuse the whole ack over.
 *
 * @param column - The `env_allowlist` value, as the driver returned it.
 * @returns The allow-list: non-empty strings, at most 64 of them.
 */
export function allowlistOf(column: unknown): string[] {
  if (!Array.isArray(column)) return [];
  return column
    .filter((name): name is string => typeof name === "string" && name.length > 0)
    .slice(0, 64);
}

@Injectable()
export class AgentGatewayRepository {
  /**
   * @param database - The typed connection. Injected, never constructed.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The pool of record, as an `ack` states it: its name for `ack.runner.pool`, and its execution
   * policy for `ack.pool` (#246) — how many jobs one runner may hold, and which variables a job
   * may carry into its build.
   *
   * Read at every hello rather than cached, so a pool an operator edited while the agent was away
   * is the pool the agent comes back to.
   *
   * @param organizationId - The workspace.
   * @param poolId - The pool.
   * @returns The pool, or `undefined`.
   */
  async poolOfRecord(organizationId: string, poolId: string): Promise<PoolOfRecord | undefined> {
    const row = await this.database.db
      .selectFrom("runner_pools")
      .select(["name", "max_concurrency", "env_allowlist"])
      .where("organization_id", "=", organizationId)
      .where("id", "=", poolId)
      .executeTakeFirst();

    if (!row) return undefined;
    return {
      name: row.name,
      policy: {
        max_concurrency: row.max_concurrency,
        env_allowlist: allowlistOf(row.env_allowlist),
      },
    };
  }

  /**
   * Every runner a bearer secret could belong to, across every workspace.
   *
   * **Unscoped, and it has to be**: the secret is a random string that names no workspace, so
   * the workspace is what matching it establishes — the same position `farm.repository.ts`'s
   * `tokenById` takes. It is bounded by what makes a runner eligible at all: enrolled with the
   * fallback, not removed, and in a workspace that still permits it — so switching the setting
   * off cuts every fallback runner in that workspace off at its next connection.
   *
   * @returns The candidates, each with its sealed secret.
   */
  async bearerCandidates(): Promise<Runner[]> {
    return this.database.db
      .selectFrom("runners")
      .innerJoin(
        "workspace_settings_effective",
        "workspace_settings_effective.organization_id",
        "runners.organization_id",
      )
      .selectAll("runners")
      .where("runners.security_mode", "=", "bearer_fallback")
      .where("runners.desired_state", "<>", "removed")
      .where("workspace_settings_effective.runner_bearer_fallback", "=", true)
      .execute();
  }

  /**
   * Record a `hello`: what the machine is, and that it is here.
   *
   * The runner **recovers** here — a runner the sweep had flipped `offline` is `online` again
   * the moment it says hello, rather than lingering until something else refreshes it. A hello
   * is a genuine arrival, so it moves `last_seen_at` as a heartbeat does; without that, the
   * sweep could flip a runner back before its first beat.
   *
   * @param organizationId - The workspace, from the connection's identity.
   * @param runnerId - The runner, from the same.
   * @param hello - What it reported.
   * @param at - When the gateway received it.
   * @returns The row as it now stands, or `undefined` when the runner has been removed since the
   *   connection authenticated.
   */
  async recordHello(
    organizationId: string,
    runnerId: string,
    hello: HelloRecord,
    at: Date,
  ): Promise<Runner | undefined> {
    return this.database.db
      .updateTable("runners")
      .set({
        hostname: hello.hostname,
        arch: hello.arch,
        agent_version: hello.agentVersion,
        capabilities: hello.capabilities,
        status: "online",
        last_seen_at: sql<Date>`greatest(${at}::timestamptz, enrolled_at)`,
      })
      .where("organization_id", "=", organizationId)
      .where("id", "=", runnerId)
      .where("desired_state", "<>", "removed")
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Record a heartbeat: the telemetry snapshot, the uptime, the pill, and `last_seen_at` ←
   * **this** beat.
   *
   * The pill is `draining` only when the agent says it is draining *and* an operator asked for
   * it — the intent is `desired_state`, the observation is the heartbeat, and V040 refuses a
   * pill nobody chose. Otherwise `building` when it reports a job, `online` when it does not.
   *
   * @param organizationId - The workspace.
   * @param runnerId - The runner.
   * @param beat - What it reported.
   * @param at - When the gateway received it.
   * @returns The row as it now stands — its `desired_state` is what the caller reconciles the
   *   agent's drain against — or `undefined` when the runner has been removed.
   */
  async recordHeartbeat(
    organizationId: string,
    runnerId: string,
    beat: HeartbeatRecord,
    at: Date,
  ): Promise<Runner | undefined> {
    return this.database.db
      .updateTable("runners")
      .set({
        telemetry: beat.telemetry,
        uptime_seconds: String(beat.uptimeSeconds),
        last_seen_at: sql<Date>`greatest(${at}::timestamptz, enrolled_at)`,
        status: sql<RunnerStatus>`case
          when desired_state = 'draining' and ${beat.reported}::text = 'draining' then 'draining'
          when ${beat.building}::boolean then 'building'
          else 'online'
        end`,
      })
      .where("organization_id", "=", organizationId)
      .where("id", "=", runnerId)
      .where("desired_state", "<>", "removed")
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Record an agent's `bye`: offline now, deliberately, rather than after a heartbeat timeout.
   *
   * `last_seen_at` is left at the last beat, and the snapshot is cleared for the sweep's reason:
   * a stale snapshot renders exactly like a fresh one.
   *
   * @param organizationId - The workspace.
   * @param runnerId - The runner.
   * @returns When the row is written.
   */
  async recordBye(organizationId: string, runnerId: string): Promise<void> {
    await this.database.db
      .updateTable("runners")
      .set({ status: "offline", telemetry: {}, uptime_seconds: null })
      .where("organization_id", "=", organizationId)
      .where("id", "=", runnerId)
      .where("status", "in", LIVE_STATUSES)
      .execute();
  }

  /**
   * The presence sweep: every live runner whose last genuine heartbeat is older than the cutoff
   * becomes `offline`.
   *
   * **`last_seen_at` is not in the `set`**, and that is the issue's third criterion: it stays at
   * the last beat that arrived, not the moment this noticed. Unscoped, because this is the
   * fleet's housekeeping rather than anybody's request, and it changes only observations —
   * `runners_presence_idx` is the partial index it was drawn for.
   *
   * @param cutoff - Runners last seen before this are gone.
   * @returns The runners flipped.
   */
  async sweepOffline(cutoff: Date): Promise<SweptRunner[]> {
    return this.database.db
      .updateTable("runners")
      .set({ status: "offline", telemetry: {}, uptime_seconds: null })
      .where("status", "in", LIVE_STATUSES)
      .where("last_seen_at", "<", cutoff)
      .returning(["id", "organization_id", "last_seen_at"])
      .execute();
  }

  /**
   * Record an operator's drain or undrain.
   *
   * Undraining a runner whose pill is `draining` moves the pill to `online` in the same
   * statement, because `runners_draining_is_intended` refuses a `draining` pill nobody intends;
   * the next heartbeat corrects it to `building` if it is.
   *
   * @param organizationId - The workspace.
   * @param runnerId - The runner.
   * @param desired - `draining` or `active`.
   * @returns The row, or `undefined` when the workspace has no such runner or it was removed.
   */
  async setDesiredState(
    organizationId: string,
    runnerId: string,
    desired: "active" | "draining",
  ): Promise<Runner | undefined> {
    return this.database.db
      .updateTable("runners")
      .set({
        desired_state: desired,
        status: sql<RunnerStatus>`case
          when ${desired}::text = 'active' and status = 'draining' then 'online'
          else status
        end`,
      })
      .where("organization_id", "=", organizationId)
      .where("id", "=", runnerId)
      .where("desired_state", "<>", "removed")
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Record a `job.start`: the job is running, on this runner.
   *
   * @param organizationId - The workspace.
   * @param runnerId - The runner that says it started it.
   * @param jobId - The job.
   * @param agentStartedAt - When the agent says it started, bounded before it is written.
   * @param at - When the gateway received the frame.
   * @returns Whether a job moved — false for another runner's job, another workspace's, or one
   *   already finished.
   */
  async startJob(
    organizationId: string,
    runnerId: string,
    jobId: string,
    agentStartedAt: Date,
    at: Date,
  ): Promise<boolean> {
    const result = await this.database.db
      .updateTable("build_jobs")
      .set({ status: "running", started_at: startedAt(agentStartedAt, at) })
      .where("organization_id", "=", organizationId)
      .where("id", "=", jobId)
      .where("runner_id", "=", runnerId)
      .where("status", "in", ["queued", "offered"])
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }

  /**
   * Record a terminal frame and apply it — once.
   *
   * **Record, then answer**: this resolves only after the ledger row and the job's terminal
   * state have committed together, and the caller writes the `receipt` after that. The ledger's
   * primary key is the exactly-once rule; the pre-check is only the common case taking the short
   * way. Two copies racing past the pre-check both reach the insert, one of them loses on
   * `runner_terminal_frames_pkey`, its whole transaction — including a job update it may have
   * made — rolls back, and it is answered as the duplicate it was.
   *
   * @param write - The frame and what it says.
   * @param at - When the gateway received it.
   * @returns Whether it was a duplicate, and whether it finished a job.
   */
  async recordTerminal(write: TerminalWrite, at: Date): Promise<TerminalRecord> {
    try {
      return await this.database.db.transaction().execute(async (trx) => {
        const seen = await trx
          .selectFrom("runner_terminal_frames")
          .select("frame_id")
          .where("organization_id", "=", write.organizationId)
          .where("runner_id", "=", write.runnerId)
          .where("frame_id", "=", write.frameId)
          .executeTakeFirst();

        if (seen) return { duplicate: true, applied: false };

        // The job, if it is this runner's in this workspace — locked, so a concurrent copy of
        // the same frame waits here for this one's outcome rather than reading around it.
        const job = write.jobId
          ? await trx
              .selectFrom("build_jobs")
              .select(["id", "status"])
              .where("organization_id", "=", write.organizationId)
              .where("id", "=", write.jobId)
              .where("runner_id", "=", write.runnerId)
              .forUpdate()
              .executeTakeFirst()
          : undefined;

        let applied = false;

        if (job && UNFINISHED.includes(job.status)) {
          const started = startedAt(write.agentStartedAt, at);
          const updated = await trx
            .updateTable("build_jobs")
            .set({
              status: write.state.status,
              exit_code: write.state.exitCode,
              ccache_stats: write.state.ccacheStats,
              started_at: sql<Date>`coalesce(started_at, ${started})`,
              finished_at: sql<Date>`greatest(${at}::timestamptz, coalesce(started_at, ${started}))`,
            })
            .where("organization_id", "=", write.organizationId)
            .where("id", "=", job.id)
            .where("runner_id", "=", write.runnerId)
            .where("status", "in", UNFINISHED)
            .executeTakeFirst();

          applied = updated.numUpdatedRows > 0n;
        }

        await trx
          .insertInto("runner_terminal_frames")
          .values({
            organization_id: write.organizationId,
            runner_id: write.runnerId,
            frame_id: write.frameId,
            frame_type: "job.finish",
            job_id: job?.id ?? null,
            applied,
            received_at: at,
          })
          .execute();

        return { duplicate: false, applied };
      });
    } catch (cause) {
      if (
        isDatabaseFailure(cause) &&
        cause.code === UNIQUE_VIOLATION &&
        cause.constraint === "runner_terminal_frames_pkey"
      ) {
        return { duplicate: true, applied: false };
      }

      throw cause;
    }
  }
}

/**
 * The expression a job's start time is written as: the agent's, bounded by when the job was
 * offered (or queued) below and by when the gateway heard about it above.
 *
 * @param agentStartedAt - The agent's claim.
 * @param at - The gateway's receipt time.
 * @returns The SQL.
 */
function startedAt(agentStartedAt: Date, at: Date): RawBuilder<Date> {
  return sql<Date>`greatest(coalesce(offered_at, queued_at), least(${agentStartedAt}::timestamptz, ${at}::timestamptz))`;
}
