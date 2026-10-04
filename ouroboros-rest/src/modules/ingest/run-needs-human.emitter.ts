/**
 * The `run_needs_human` emitter — a run that handed itself to a person files *"Take over a loop
 * that needs a human?"*.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)), AO / AT.4
 * ([#332](https://github.com/NobuData/ouroboros/issues/332)) terminal needs-human runs.
 * {@link RunNeedsHumanEmitter.handedOver} is the plane's hook: one card per run (`runs` /
 * `run:<id>`), naming the stage it stopped at and why.
 *
 * **What calls it.** Nothing in this service moves a run to `needs_human` yet — the status exists
 * (V079's intervention trigger reads it), and the executor that sets it reports through the
 * internal contract when it does. The hook is wired and tested and driven by the harness until then.
 *
 * **Out-of-band settlement**: the run moving on — retried, merged, failed or cancelled from the
 * console, anything but `needs_human` — closes the card as `policy(source_resolved)`.
 */

import { Injectable, Optional, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { RunStatus } from "../db/schema";
import { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import { clipFact, runCardFacts, type RunCardFacts } from "../decisions/decision.refs";
import type { DecisionEmission, DecisionEmitOutcome } from "../decisions/decision.types";
import { DecisionSourceWatcher, runTerminatedDetector } from "../decisions/decision.watchers";

/** The kind. */
export const RUN_NEEDS_HUMAN_KIND = "run_needs_human";

/** The plane's name in the idempotency key. */
export const RUN_NEEDS_HUMAN_PLANE = "runs";

/** Every status but `needs_human` — a run in any of these is no longer waiting on a person. */
export const RUN_MOVED_ON_STATUSES: readonly RunStatus[] = [
  "coding",
  "building",
  "review",
  "merged",
  "failed",
  "canceled",
];

/**
 * The emission for one run waiting on a person.
 *
 * @param run - The run's subject, stage and refs.
 * @param reason - Why it stopped, as the run plane recorded it.
 * @returns The emission.
 */
export function runNeedsHumanEmission(run: RunCardFacts, reason: string): DecisionEmission {
  return {
    organizationId: run.organizationId,
    kindId: RUN_NEEDS_HUMAN_KIND,
    payload: {
      subject: clipFact(run.subject, 120),
      stage_label: clipFact(run.stageLabel, 80),
      reason: clipFact(reason, 200),
    },
    refs: run.refs,
    key: { plane: RUN_NEEDS_HUMAN_PLANE, sourceRef: `run:${run.runId}` },
  };
}

@Injectable()
export class RunNeedsHumanEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly unsubscribe: (() => void)[] = [];

  /**
   * @param database - The pool, for the run.
   * @param registry - Where the card is filed.
   * @param watcher - Where the run-moved-on detector registers. Optional so a suite can omit it.
   */
  constructor(
    private readonly database: DatabaseService,
    private readonly registry: DecisionKindRegistry,
    @Optional() private readonly watcher?: DecisionSourceWatcher,
  ) {}

  /** Register how a needs-human hand-off settles out of band. */
  onModuleInit(): void {
    if (this.watcher !== undefined) {
      this.unsubscribe.push(
        this.watcher.register(
          runTerminatedDetector([RUN_NEEDS_HUMAN_KIND], RUN_MOVED_ON_STATUSES, "run_moved_on"),
        ),
      );
    }
  }

  /** Unregister. */
  onModuleDestroy(): void {
    for (const stop of this.unsubscribe.splice(0)) {
      stop();
    }
  }

  /**
   * A run handed itself to a person: file (or refresh) its card.
   *
   * @param runId - The run.
   * @param reason - Why it stopped — `attempt limit reached`.
   * @returns What the emission did, or null when the run is unknown or not `needs_human`.
   */
  async handedOver(runId: string, reason: string): Promise<DecisionEmitOutcome | null> {
    const db = this.database.db;
    const status = await db
      .selectFrom("runs")
      .select("status")
      .where("id", "=", runId)
      .executeTakeFirst();

    if (status?.status !== "needs_human") {
      return null;
    }

    const run = await runCardFacts(db, runId);

    return run === undefined ? null : this.registry.emit(runNeedsHumanEmission(run, reason));
  }
}
