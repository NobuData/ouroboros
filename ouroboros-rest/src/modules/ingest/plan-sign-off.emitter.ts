/**
 * The `plan_sign_off` emitter — a workflow's human-gate stage files *"Sign off a plan before the
 * loop builds it?"*.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)), the workflow human-gate stage
 * entries of P.2/R.3 ([#133](https://github.com/NobuData/ouroboros/issues/133),
 * [#145](https://github.com/NobuData/ouroboros/issues/145)). {@link PlanSignOffEmitter.stageEntered}
 * is the plane's hook: a run entering a stage that waits on a person's sign-off files one card per
 * run and stage (`workflows` / `run:<id>:stage:<stage_key>`), with the plan's size as its fact.
 *
 * **What calls it.** The workflow DSL has no human-gate node yet — its `gate` and `decision` forks
 * evaluate predicates (effort, labels, paths, checks) without a person — so no stage transition can
 * honestly be called a sign-off. The hook is wired and tested and driven by the harness; the stage
 * catalog's human gate calls it when it lands. Filing a card for every automatic gate would ask
 * people to approve things nothing waits on.
 *
 * **Out-of-band settlement**: the run ending (merged, failed or cancelled) closes the card as
 * `policy(source_resolved)`.
 */

import { Injectable, Optional, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import { clipFact, runCardFacts, type RunCardFacts } from "../decisions/decision.refs";
import type { DecisionEmission, DecisionEmitOutcome } from "../decisions/decision.types";
import { DecisionSourceWatcher, runTerminatedDetector } from "../decisions/decision.watchers";
import { RUN_ENDED_STATUSES } from "../guardrails/protected-path.emitter";

/** The kind. */
export const PLAN_SIGN_OFF_KIND = "plan_sign_off";

/** The plane's name in the idempotency key. */
export const PLAN_SIGN_OFF_PLANE = "workflows";

/** What the card is composed from. */
export interface PlanSignOffFacts {
  readonly run: RunCardFacts;
  /** The pinned stage's key — the idempotency key's last part. */
  readonly stageKey: string;
  /** The stage's label, as the pinned workflow names it. */
  readonly stageLabel: string;
  /** How many files the run's plan declares. */
  readonly planFiles: number;
}

/**
 * The emission for one run waiting at a sign-off stage.
 *
 * @param facts - The run, the stage and the plan's size.
 * @returns The emission.
 */
export function planSignOffEmission(facts: PlanSignOffFacts): DecisionEmission {
  return {
    organizationId: facts.run.organizationId,
    kindId: PLAN_SIGN_OFF_KIND,
    payload: {
      subject: clipFact(facts.run.subject, 120),
      stage_label: clipFact(facts.stageLabel, 80),
      plan_files: facts.planFiles,
    },
    refs: facts.run.refs,
    key: {
      plane: PLAN_SIGN_OFF_PLANE,
      sourceRef: `run:${facts.run.runId}:stage:${facts.stageKey}`,
    },
  };
}

@Injectable()
export class PlanSignOffEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly unsubscribe: (() => void)[] = [];

  /**
   * @param database - The pool, for the run, its stage and its plan.
   * @param registry - Where the card is filed.
   * @param watcher - Where the run-ended detector registers. Optional so a suite can omit it.
   */
  constructor(
    private readonly database: DatabaseService,
    private readonly registry: DecisionKindRegistry,
    @Optional() private readonly watcher?: DecisionSourceWatcher,
  ) {}

  /** Register how a sign-off settles out of band. */
  onModuleInit(): void {
    if (this.watcher !== undefined) {
      this.unsubscribe.push(
        this.watcher.register(runTerminatedDetector([PLAN_SIGN_OFF_KIND], [...RUN_ENDED_STATUSES])),
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
   * A run entered a stage that waits on a person's sign-off: file (or refresh) its card.
   *
   * @param runId - The run.
   * @param stageKey - The stage's key in the pinned workflow.
   * @returns What the emission did, or null when the run or the stage is unknown.
   */
  async stageEntered(runId: string, stageKey: string): Promise<DecisionEmitOutcome | null> {
    const db = this.database.db;
    const run = await runCardFacts(db, runId);
    const stage = await db
      .selectFrom("run_stages")
      .select("stage_label")
      .where("run_id", "=", runId)
      .where("stage_key", "=", stageKey)
      .orderBy("attempt", "desc")
      .limit(1)
      .executeTakeFirst();

    if (run === undefined || stage === undefined) {
      return null;
    }

    const plan = await db
      .selectFrom("runs")
      .innerJoin("github_issues", (join) =>
        join
          .onRef("github_issues.github_repo_id", "=", "runs.github_repo_id")
          .onRef("github_issues.number", "=", "runs.issue_number")
          .onRef("github_issues.organization_id", "=", "runs.organization_id"),
      )
      .innerJoin("issue_estimates", "issue_estimates.github_issue_id", "github_issues.id")
      .select("issue_estimates.breakdown")
      .where("runs.id", "=", runId)
      .orderBy("issue_estimates.version", "desc")
      .limit(1)
      .executeTakeFirst();

    return this.registry.emit(
      planSignOffEmission({
        run,
        stageKey,
        stageLabel: stage.stage_label,
        planFiles: plan?.breakdown.files.length ?? 0,
      }),
    );
  }
}
