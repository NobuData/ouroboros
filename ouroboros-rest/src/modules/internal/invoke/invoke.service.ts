/**
 * `POST /internal/llm/invoke`'s service — AF.2 ([#235](https://github.com/NobuData/ouroboros/issues/235)).
 *
 * ```
 * prepare(body)  ─▶ subject (which workspace) ─▶ target ─▶ plan          refusals are HTTP errors
 *                     alias + routed stage  ─▶ resolution ─▶ chainPlan        here, before any stream
 *                     otherwise              ─▶ alias binding / connection ─▶ singleHopPlan
 * stream(prepared) ─▶ invoke.executor.ts over this service's ports           NDJSON events from here on
 * ```
 *
 * The ports are where the executor meets the rest of the service: `ConnectionOpener` (the
 * credential, one hop at a time), `PricingService` (prices are never the executor's own, R4),
 * `InvokeRepository` (usage rows, spend so far) and the clock. The plaintext credential lives
 * in the context `ConnectionOpener.open` returns, inside one hop's attempt, and is passed to
 * the adapter and nowhere else (R10).
 */

import { setTimeout as delay } from "node:timers/promises";

import { Injectable, Logger, Optional } from "@nestjs/common";

import type { NewTokenUsage } from "../../db/schema";
import { DomainError } from "../../errors/error.envelope";
import { effectivePerRunCap } from "../../policies/policy-resolution";
import { PolicyResolutionService } from "../../policies/policy-resolution.service";
import { PricingService } from "../../pricing/pricing.service";
import { ConnectionOpener } from "../../provider-connections/connection.opener";
import { monthWindow } from "../../provider-connections/spend";
import type { Resolution } from "../../routing/resolution";
import { ResolutionService } from "../../routing/resolution.service";
import { ROUTING_ERRORS } from "../../routing/routing.errors";
import { snapshotOf } from "../../routing/snapshot";
import {
  aliasNotFound,
  aliasUnavailable,
  invokeConnectionNotFound,
  invokeModelRequired,
  invokeRunNotFound,
  invokeTargetInvalid,
} from "../internal.errors";
import type { RunContext } from "../invoke.contract";
import { TtlCache } from "./invoke.cache";
import type { InvokeRequestDto } from "./invoke.dto";
import {
  execute,
  type Emit,
  type ExecutorPorts,
  type HopUsage,
  type TokenRates,
} from "./invoke.executor";
import {
  chainPlan,
  effectiveCap,
  isRefusal,
  singleHopPlan,
  type InvokePlan,
  type PlanRefusal,
  type RunCap,
  type SingleHopTarget,
} from "./invoke.plan";
import { InvokeRepository, type InvokeSubject } from "./invoke.repository";

/** An invocation that passed every check that can be an HTTP status. */
export interface PreparedInvocation {
  readonly subject: InvokeSubject;
  readonly plan: InvokePlan | PlanRefusal;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly runCtx: RunContext;
  /** The routed task kind, when the call walks a resolution — `token_usage.task_kind`. */
  readonly taskKind: string | null;
  /**
   * The resolution snapshot this call executes, for a run's routed call (G1).
   *
   * A promise: the insert runs beside the walk rather than before its first token, and a usage
   * row waits for it. A failed insert resolves to null — the snapshot is attribution, and a
   * call must not fail for want of it.
   */
  readonly snapshotId: Promise<string | null>;
}

/** How long routing's resolution is reused for one (workspace, task kind), milliseconds. */
export const RESOLUTION_TTL_MS = 1_000;

/** How long a run id's owner is remembered, milliseconds. Ownership never changes. */
export const SUBJECT_TTL_MS = 10 * 60_000;

/** The bound on either memo's entries. */
export const CACHE_MAX_ENTRIES = 5_000;

/** Resolved, and never awaited by anything that could fail on it. */
const NO_SNAPSHOT: Promise<string | null> = Promise.resolve(null);

@Injectable()
export class InvokeService {
  private readonly logger = new Logger(InvokeService.name);
  /** See `invoke.cache.ts` for why these two reads, and only these, are memoised. */
  private readonly resolutionMemo = new TtlCache<Resolution | null>(
    RESOLUTION_TTL_MS,
    CACHE_MAX_ENTRIES,
  );
  private readonly subjectMemo = new TtlCache<InvokeSubject>(SUBJECT_TTL_MS, CACHE_MAX_ENTRIES);

  constructor(
    private readonly repository: InvokeRepository,
    private readonly resolutions: ResolutionService,
    private readonly connections: ConnectionOpener,
    private readonly pricing: PricingService,
    @Optional() private readonly policies?: PolicyResolutionService,
  ) {}

  /**
   * Check a request and decide what it will walk.
   *
   * @param request - The validated body.
   * @returns The prepared invocation. A `fail_run` resolution or a vote is a plan refusal,
   *   which the stream reports as its one `error` event, not an HTTP status.
   * @throws {InvalidRequestError} `invoke_target_invalid`, `invoke_model_required`,
   *   `alias_unavailable`.
   * @throws {NotFoundError} `run_not_found`, `alias_not_found`, `connection_not_found`.
   */
  async prepare(request: InvokeRequestDto): Promise<PreparedInvocation> {
    if ((request.connection === undefined) === (request.alias === undefined)) {
      throw invokeTargetInvalid();
    }

    const subject = await this.subjectOf(request.runCtx.run);

    if (subject === undefined) {
      throw invokeRunNotFound(request.runCtx.run);
    }

    const base = { subject, payload: request.payload, runCtx: request.runCtx };

    if (request.connection !== undefined) {
      const target = await this.connectionTarget(subject, request.connection, request.payload);

      return {
        ...base,
        plan: singleHopPlan(target, await this.unroutedCap(subject, request.runCtx)),
        taskKind: null,
        snapshotId: NO_SNAPSHOT,
      };
    }

    const alias = request.alias ?? "";
    const resolution = await this.routed(subject.organizationId, request.runCtx.stage);
    const walked = resolution === null ? null : chainPlan(resolution, alias, request.runCtx);

    if (resolution !== null && walked !== null) {
      return {
        ...base,
        plan: walked,
        taskKind: resolution.taskKind,
        snapshotId: isRefusal(walked) ? NO_SNAPSHOT : this.snapshot(subject, resolution),
      };
    }

    const target = await this.aliasTarget(subject, alias);

    return {
      ...base,
      plan: singleHopPlan(target, await this.unroutedCap(subject, request.runCtx)),
      taskKind: null,
      snapshotId: NO_SNAPSHOT,
    };
  }

  /**
   * Which workspace owns a run id, remembered — ownership never changes.
   *
   * @param id - `runCtx.run`.
   * @returns The subject, or undefined. An unknown id is not remembered: the run may be
   *   created a moment later.
   */
  private async subjectOf(id: string): Promise<InvokeSubject | undefined> {
    try {
      return await this.subjectMemo.get(id, async () => {
        const found = await this.repository.subjectOf(id);

        if (found === undefined) {
          throw new SubjectUnknown();
        }

        return found;
      });
    } catch (error) {
      if (error instanceof SubjectUnknown) {
        return undefined;
      }

      throw error;
    }
  }

  /**
   * Run a prepared invocation.
   *
   * @param prepared - From {@link prepare}.
   * @param signal - Aborts when the caller disconnects.
   * @param emit - Receives the contract's events, in order.
   * @returns When the invocation has ended.
   */
  async stream(prepared: PreparedInvocation, signal: AbortSignal, emit: Emit): Promise<void> {
    if (isRefusal(prepared.plan)) {
      const refusal = prepared.plan;

      emit({
        kind: "error",
        code: refusal.code,
        message: refusal.message,
        ...(refusal.reason === undefined ? {} : { reason: refusal.reason }),
      });
      return;
    }

    await execute(prepared.plan, prepared.payload, this.ports(prepared), signal, emit);
  }

  /**
   * The executor's ports, bound to one invocation.
   *
   * @param prepared - The invocation.
   * @returns The ports.
   */
  private ports(prepared: PreparedInvocation): ExecutorPorts {
    const { subject } = prepared;
    const organizationId = subject.organizationId;

    return {
      open: (hop) => this.connections.open(organizationId, hop.connectionId),
      rates: async (hop) =>
        ratesOf(await this.pricing.resolve(hop.kind, hop.modelId, organizationId)),
      spent: () => this.repository.subjectSpent(subject),
      providerMonthSpent: (hop) =>
        this.repository.providerMonthSpent(organizationId, hop.kind, monthWindow(new Date()).since),
      record: async (usage) =>
        this.repository.insertUsage(usageRow(prepared, usage, await prepared.snapshotId)),
      touch: (hop) => this.connections.touch(organizationId, hop.connectionId, new Date()),
      now: () => performance.now(),
      clock: () => new Date(),
      sleep: async (ms, signal) => {
        await delay(ms, undefined, { signal });
      },
    };
  }

  /**
   * The resolution for the stage's task kind, when the stage names a routed one.
   *
   * @param organizationId - The workspace.
   * @param stage - `runCtx.stage`, or undefined.
   * @returns The resolution, or null when there is no stage or no route for it.
   */
  private async routed(
    organizationId: string,
    stage: string | undefined,
  ): Promise<Resolution | null> {
    if (stage === undefined) {
      return null;
    }

    return this.resolutionMemo.get(`${organizationId}\u0000${stage}`, async () => {
      try {
        return await this.resolutions.resolve(organizationId, stage);
      } catch (error) {
        if (
          error instanceof DomainError &&
          error.envelope().code === ROUTING_ERRORS.routeNotFound
        ) {
          return null;
        }

        throw error;
      }
    });
  }

  /**
   * Record the resolution a run's call executes, and return its id (G1).
   *
   * @param subject - The subject; only a run has a snapshot.
   * @param resolution - The resolution.
   * @returns The snapshot id, or null for a subject that is not a run or a failed insert.
   */
  private snapshot(subject: InvokeSubject, resolution: Resolution): Promise<string | null> {
    if (subject.kind !== "run") {
      return NO_SNAPSHOT;
    }

    return this.repository
      .insertSnapshot(
        subject.organizationId,
        subject.id,
        snapshotOf(resolution, { durationMs: null }),
      )
      .catch((error: unknown) => {
        this.logger.warn(`resolution snapshot not written: ${String(error)}`);

        return null;
      });
  }

  /**
   * The per-run cap for a call that walks no route: the spend guard's, lowered by the worker's.
   *
   * @param subject - The subject.
   * @param runCtx - The run context.
   * @returns The cap, or null.
   */
  private async unroutedCap(subject: InvokeSubject, runCtx: RunContext): Promise<RunCap | null> {
    const guarded =
      this.policies === undefined
        ? null
        : effectivePerRunCap(
            null,
            await this.policies.resolve(subject.organizationId, "spend_guard"),
          ).capCents;

    return effectiveCap(
      guarded,
      guarded === null
        ? undefined
        : { limit: "spend_guard", ruleId: "spend_guard", policyVersion: null },
      runCtx.costCapCents,
    );
  }

  /**
   * A single-hop target from an alias's binding.
   *
   * @throws {NotFoundError} `alias_not_found`.
   * @throws {InvalidRequestError} `alias_unavailable` for a disabled or unbound alias.
   */
  private async aliasTarget(subject: InvokeSubject, alias: string): Promise<SingleHopTarget> {
    const binding = await this.repository.aliasBinding(subject.organizationId, alias);

    if (binding === undefined) {
      throw aliasNotFound(alias);
    }

    if (!binding.enabled || binding.connectionId === null || binding.kind === null) {
      throw aliasUnavailable(alias);
    }

    return {
      alias: binding.alias,
      modelId: binding.modelId,
      params: binding.params,
      connectionId: binding.connectionId,
      kind: binding.kind,
    };
  }

  /**
   * A single-hop target from a named connection; the model comes from `payload.model`.
   *
   * @throws {NotFoundError} `connection_not_found`.
   * @throws {InvalidRequestError} `invoke_model_required`.
   */
  private async connectionTarget(
    subject: InvokeSubject,
    connection: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<SingleHopTarget> {
    const summary = await this.connections.describe(subject.organizationId, connection);

    if (summary === undefined) {
      throw invokeConnectionNotFound(connection);
    }

    if (typeof payload.model !== "string" || payload.model.length === 0) {
      throw invokeModelRequired();
    }

    return {
      alias: null,
      modelId: payload.model,
      params: {},
      connectionId: summary.id,
      kind: summary.kind,
    };
  }
}

/** A memo load's way of saying *no such id*, so that the answer is not remembered. */
class SubjectUnknown extends Error {}

/**
 * A resolved price as per-token rates.
 *
 * @param price - `PricingService.resolve`'s answer.
 * @returns Rates for a token or free price; null for seat, usage, or no price — *unpriced*,
 *   which stores a null cost and is never counted toward a cap (G6).
 */
export function ratesOf(price: Awaited<ReturnType<PricingService["resolve"]>>): TokenRates | null {
  if (price === undefined) {
    return null;
  }

  if (price.billingMode === "token") {
    return {
      inputCentsPer1m: Number(price.inputCentsPer1m),
      outputCentsPer1m: Number(price.outputCentsPer1m),
    };
  }

  if (price.billingMode === "free") {
    return {
      inputCentsPer1m: Number(price.inputCentsPer1m ?? 0),
      outputCentsPer1m: Number(price.outputCentsPer1m ?? 0),
    };
  }

  return null;
}

/**
 * One hop's `token_usage` row, attributed to the hop that served it (R4, G2).
 *
 * @param prepared - The invocation.
 * @param settled - The hop's usage.
 * @param snapshotId - The resolution snapshot, once written, or null.
 * @returns The row.
 */
export function usageRow(
  prepared: PreparedInvocation,
  settled: HopUsage,
  snapshotId: string | null,
): NewTokenUsage {
  const { subject, runCtx } = prepared;

  return {
    organization_id: subject.organizationId,
    run_id: subject.kind === "run" ? subject.id : null,
    provider: settled.hop.kind,
    model: settled.hop.modelId,
    tokens_in: settled.usage.inputTokens,
    tokens_out: settled.usage.outputTokens,
    cost_cents: settled.costCents === null ? null : settled.costCents.toFixed(4),
    task_kind: prepared.taskKind,
    latency_ms: settled.latencyMs,
    connection_id: settled.hop.connectionId,
    alias: settled.hop.alias,
    hop: settled.hop.index,
    stage: runCtx.stage ?? null,
    attempt: null,
    is_vote: runCtx.vote === true,
    cache_read_tokens: settled.usage.cacheReadTokens,
    cache_write_tokens: settled.usage.cacheWriteTokens,
    subject_kind: subject.kind,
    subject_id: subject.id,
    resolution_snapshot_id: snapshotId,
  };
}
