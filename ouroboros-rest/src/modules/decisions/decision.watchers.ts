/**
 * Out-of-band resolution — an item whose source settled elsewhere closes itself.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)), decision **X4**. A PR merged
 * directly on GitHub, a run cancelled from the console, a fact reviewed on the knowledge page — each
 * leaves a card asking permission for something already settled. Every kind declares how its
 * settlement is detected by registering a {@link DecisionSourceDetector}; the watcher asks each
 * detector about the items of its kinds that are still asking, and closes what it finds as
 * `policy(source_resolved)`, so the resolved list still accounts for them.
 *
 * ```
 * sweep(workspace?) ─ per detector: asking items of its kinds ─▶ detector.settled(items)
 *                   ─▶ registry.resolveFromSource(each)   ← no-op for an item no longer asking
 * ```
 *
 * The watcher knows no kind. The detectors that judge by a ref — a PR that merged or closed, a run
 * that ended — are built here once ({@link prSettledDetector}, {@link runTerminatedDetector}) so
 * each plane composes rather than re-writes them; the rest live with their plane.
 *
 * Swept every minute by {@link DecisionSourceSweeper}, and on demand by a plane that just saw its
 * source settle (the PR sync after a merge), so the card closes at the moment, not a minute later.
 */

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import type { Kysely } from "kysely";

import type { Database, DecisionChannel, RunStatus } from "../db/schema";
import { describeForLog } from "../errors/failure";
import { jittered } from "../scheduling/cadence";
import { DecisionKindRegistry } from "./decision-kind.registry";
import { DecisionRepository } from "./decision.repository";
import type { DecisionRef, DecisionSourceSettlement, SettledDecision } from "./decision.types";

/** One item still asking, as a detector sees it. */
export interface AskingDecision {
  readonly id: string;
  readonly organizationId: string;
  readonly kindId: string;
  readonly refs: readonly DecisionRef[];
  /** The plane's own reference — what a detector without a ref parses. */
  readonly sourceRef: string;
}

/** How one or more kinds detect that their source settled elsewhere. */
export interface DecisionSourceDetector {
  /** A name for the log — `pr-settled`. */
  readonly name: string;
  /** The kinds whose asking items it judges. */
  readonly kinds: readonly string[];
  /**
   * Which of these items' sources have settled.
   *
   * @param items - Asking items of {@link kinds}, of one workspace or of every workspace.
   * @param db - The query builder, to read the plane's own tables.
   * @returns The settled ones, each with its settlement and channel.
   */
  settled(items: readonly AskingDecision[], db: Kysely<Database>): Promise<SettledDecision[]>;
}

/**
 * The ids of one ref type an item carries.
 *
 * @param item - The item.
 * @param type - The ref type.
 * @returns The ids, in tag order.
 */
export function refIds(item: AskingDecision, type: DecisionRef["type"]): string[] {
  return item.refs.filter((ref) => ref.type === type).map((ref) => ref.id);
}

/**
 * One settled answer per item.
 *
 * @param item - The item.
 * @param settlement - Why.
 * @param channel - Through where.
 * @returns The settled record.
 */
export function settledOf(
  item: AskingDecision,
  settlement: DecisionSourceSettlement,
  channel: DecisionChannel,
): SettledDecision {
  return { itemId: item.id, organizationId: item.organizationId, settlement, channel };
}

/**
 * A detector that closes items whose PR ref merged or closed on its host.
 *
 * @param kinds - The kinds it watches — every kind whose question a PR's end settles.
 * @returns The detector.
 */
export function prSettledDetector(kinds: readonly string[]): DecisionSourceDetector {
  return {
    name: "pr-settled",
    kinds,
    async settled(items, db) {
      const prIds = [...new Set(items.flatMap((item) => refIds(item, "pr")))];

      if (prIds.length === 0) {
        return [];
      }

      const rows = await db
        .selectFrom("pull_requests")
        .select(["id", "organization_id", "state"])
        .where("id", "in", prIds)
        .where("state", "in", ["merged", "closed"])
        .execute();
      const ended = new Map(rows.map((row) => [`${row.organization_id}:${row.id}`, row.state]));

      return items.flatMap((item) => {
        const state = refIds(item, "pr")
          .map((id) => ended.get(`${item.organizationId}:${id}`))
          .find((found) => found !== undefined);

        return state === undefined
          ? []
          : [settledOf(item, state === "merged" ? "pr_merged" : "pr_closed", "github")];
      });
    },
  };
}

/**
 * A detector that closes items whose run ref has moved past a set of statuses.
 *
 * @param kinds - The kinds it watches.
 * @param settledStatuses - The run statuses that settle the question — the terminal ones for a
 *   question asked mid-run, anything but `needs_human` for a needs-human hand-off.
 * @param settlement - What the receipt says.
 * @returns The detector.
 */
export function runTerminatedDetector(
  kinds: readonly string[],
  settledStatuses: readonly RunStatus[],
  settlement: DecisionSourceSettlement = "run_terminated",
): DecisionSourceDetector {
  return {
    name: `run-${settlement}`,
    kinds,
    async settled(items, db) {
      const runIds = [...new Set(items.flatMap((item) => refIds(item, "run")))];

      if (runIds.length === 0 || settledStatuses.length === 0) {
        return [];
      }

      const rows = await db
        .selectFrom("runs")
        .select(["id", "organization_id"])
        .where("id", "in", runIds)
        .where("status", "in", [...settledStatuses])
        .execute();
      const ended = new Set(rows.map((row) => `${row.organization_id}:${row.id}`));

      return items
        .filter((item) =>
          refIds(item, "run").some((id) => ended.has(`${item.organizationId}:${id}`)),
        )
        .map((item) => settledOf(item, settlement, "api"));
    },
  };
}

/** The registry of detectors, and the sweep that asks them. */
@Injectable()
export class DecisionSourceWatcher {
  private readonly logger = new Logger(DecisionSourceWatcher.name);

  private readonly detectors = new Set<DecisionSourceDetector>();

  /**
   * @param repository - Reads the asking items.
   * @param registry - Closes what a detector found.
   */
  constructor(
    private readonly repository: DecisionRepository,
    private readonly registry: DecisionKindRegistry,
  ) {}

  /**
   * Register a detector — what a plane's emitter does once, at module init.
   *
   * @param detector - How its kinds detect settlement.
   * @returns A function that unregisters it.
   */
  register(detector: DecisionSourceDetector): () => void {
    this.detectors.add(detector);

    return () => {
      this.detectors.delete(detector);
    };
  }

  /**
   * Close every asking item whose source settled. A detector that fails is logged and costs only
   * its own kinds this pass.
   *
   * @param organizationId - One workspace, or null (the default) for every workspace.
   * @returns How many items this pass closed.
   */
  async sweep(organizationId: string | null = null): Promise<number> {
    let closed = 0;

    for (const detector of this.detectors) {
      try {
        const rows = await this.repository.asking(detector.kinds, organizationId);
        const items: AskingDecision[] = rows.map((row) => ({
          id: row.id,
          organizationId: row.organization_id,
          kindId: row.kind_id,
          refs: Array.isArray(row.refs) ? (row.refs as DecisionRef[]) : [],
          sourceRef: row.source_ref,
        }));

        if (items.length === 0) {
          continue;
        }

        for (const settled of await detector.settled(items, this.repository.db)) {
          if (await this.registry.resolveFromSource(settled)) {
            closed += 1;
          }
        }
      } catch (error) {
        this.logger.error(
          `Decision source detector ${detector.name} failed.`,
          describeForLog(error),
        );
      }
    }

    return closed;
  }
}

/** How the sweep's timer names itself in `SchedulerRegistry`. */
export const DECISION_SOURCE_SWEEP_TIMEOUT = "decision-source-sweep";

/** Seconds between sweeps, before jitter — a closure lags its source by about a minute at most. */
export const DECISION_SOURCE_SWEEP_SECONDS = 60;

/**
 * What makes the watcher periodic — `controls/controls.sweeper.ts`'s shape: a jittered
 * self-rescheduling timeout, a cycle that never overlaps itself, a failed cycle that costs a cycle,
 * and an unreferenced timer so a suite that built an application without listening still exits.
 * It logs only when it closed something.
 */
@Injectable()
export class DecisionSourceSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DecisionSourceSweeper.name);

  private stopped = false;

  /**
   * @param watcher - The sweep. This class owns *when* and nothing else.
   * @param scheduler - Nest's registry.
   */
  constructor(
    private readonly watcher: DecisionSourceWatcher,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /** Start the loop once the application is up. The first delay is a full jittered interval. */
  onApplicationBootstrap(): void {
    this.schedule(jittered(DECISION_SOURCE_SWEEP_SECONDS * 1000));
  }

  /** Stop the loop, and clear a pending timer. */
  onApplicationShutdown(): void {
    this.stopped = true;

    if (this.scheduler.doesExist("timeout", DECISION_SOURCE_SWEEP_TIMEOUT)) {
      this.scheduler.deleteTimeout(DECISION_SOURCE_SWEEP_TIMEOUT);
    }
  }

  /**
   * Run one sweep and book the next, whatever the first did. Public so a test can drive it.
   *
   * @returns When the sweep has settled and the next tick is booked.
   */
  async tick(): Promise<void> {
    if (this.scheduler.doesExist("timeout", DECISION_SOURCE_SWEEP_TIMEOUT)) {
      this.scheduler.deleteTimeout(DECISION_SOURCE_SWEEP_TIMEOUT);
    }

    try {
      const closed = await this.watcher.sweep();

      if (closed > 0) {
        this.logger.log(`Decision sweep: ${String(closed)} item(s) closed — their source settled.`);
      }
    } catch (error) {
      this.logger.error("Decision source sweep failed; retrying next tick.", describeForLog(error));
    }

    this.schedule(jittered(DECISION_SOURCE_SWEEP_SECONDS * 1000));
  }

  /**
   * Book the next tick, unless the application is going away.
   *
   * @param delayMs - How long to wait.
   */
  private schedule(delayMs: number): void {
    if (this.stopped) {
      return;
    }

    const timer = setTimeout(() => {
      void this.tick();
    }, delayMs);

    timer.unref();

    this.scheduler.addTimeout(DECISION_SOURCE_SWEEP_TIMEOUT, timer);
  }
}
