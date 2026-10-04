/**
 * The `merge_approval` emitter — the gate engine's plane files *"Approve merge for a refactor PR?"*.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)), AX.5
 * ([#361](https://github.com/NobuData/ouroboros/issues/361)) and the **#358 amendment**. The gate
 * engine applies the published org policy's `human_review` rule on every evaluation and tells its
 * listeners what it decided; this listener turns a match into a card:
 *
 * ```
 * gate evaluation ─▶ humanReview {required, label: "refactor"} ─▶ PR open, not yet approved?
 *   ─▶ facts: checks passed/total (required gates but the human one), matrix state (criteria),
 *             +added −removed across files (the host's diff stat)
 *   ─▶ registry.emit(merge_approval, key: pr.gates / pr:<id>)     ← one card per PR, refreshed
 * ```
 *
 * A request for review (AX.5) re-evaluates the PR, so it reaches this listener the same way. The
 * card names its policy, so it is filed only for a match that **names a label**: a review the
 * policy requires by effort alone, or one a person asked for by hand, is still required by the gate
 * but files no card whose *why* would claim a label policy that did not fire (a follow-up kind
 * version can word those).
 *
 * **Out-of-band settlement**: the PR merging or closing on its host closes the card as
 * `policy(source_resolved)` — {@link prSettledDetector}.
 */

import {
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { DatabaseService } from "../../db/db.service";
import type { PrGateVerdict, PullRequestState } from "../../db/schema";
import { DecisionKindRegistry } from "../../decisions/decision-kind.registry";
import type { DecisionEmission, DecisionRef } from "../../decisions/decision.types";
import { DecisionSourceWatcher, prSettledDetector } from "../../decisions/decision.watchers";
import { describeForLog } from "../../errors/failure";
import { GateListeners, type GateEvaluated, type GateEvaluationListener } from "./gate.listeners";

/** The kind. */
export const MERGE_APPROVAL_KIND = "merge_approval";

/** The plane's name in the idempotency key. */
export const MERGE_APPROVAL_PLANE = "pr.gates";

/** The verdicts that count a check as passed — the merge precondition's (V056). */
const PASSING: ReadonlySet<PrGateVerdict> = new Set(["green", "waived", "not_required"]);

/** The card's `pr_kind` must be a slug (merge_approval v1's pattern). */
const PR_KIND = /^[a-z][a-z0-9-]*$/;

/** Everything the card is composed from. */
export interface MergeApprovalFacts {
  readonly organizationId: string;
  readonly prId: string;
  readonly prNumber: number;
  readonly prState: PullRequestState;
  readonly runId: string | null;
  readonly loopSeq: number | null;
  readonly ticketId: string | null;
  readonly ticketKey: string | null;
  /** The label the policy matched. */
  readonly policyLabel: string;
  /** The latest revision's required gates other than `human_approval`, with their verdicts. */
  readonly checks: readonly { readonly verdict: PrGateVerdict | null }[];
  /** The acceptance criteria's statuses. */
  readonly criteria: readonly string[];
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  /** Whether the latest approval slot is approved. */
  readonly approved: boolean;
}

/**
 * The verification matrix's state, as the card prints it.
 *
 * @param criteria - The criteria's statuses.
 * @returns `all ✓` when there is at least one criterion and every one is verified or waived;
 *   `incomplete` otherwise. (`failing` is the kind's word for a refuted criterion, which no status
 *   records yet.)
 */
export function matrixStateOf(criteria: readonly string[]): "all ✓" | "incomplete" {
  return criteria.length > 0 &&
    criteria.every((status) => status === "verified" || status === "waived")
    ? "all ✓"
    : "incomplete";
}

/**
 * The emission for one PR, or null when no card should be asked.
 *
 * @param facts - The PR's facts.
 * @returns The emission; null for a PR that merged, closed, has no run (the kind requires a run
 *   ref), is already approved, or matched a label that is not a slug.
 */
export function mergeApprovalEmission(facts: MergeApprovalFacts): DecisionEmission | null {
  if (
    facts.prState === "merged" ||
    facts.prState === "closed" ||
    facts.runId === null ||
    facts.approved ||
    !PR_KIND.test(facts.policyLabel) ||
    facts.policyLabel.length > 40
  ) {
    return null;
  }

  const refs: DecisionRef[] = [
    {
      type: "run",
      id: facts.runId,
      label: facts.loopSeq === null ? "loop" : `loop #${String(facts.loopSeq)}`,
    },
    { type: "pr", id: facts.prId, label: `PR #${String(facts.prNumber)}` },
  ];

  if (facts.ticketId !== null && facts.ticketKey !== null) {
    refs.push({ type: "ticket", id: facts.ticketId, label: `issue ${facts.ticketKey}` });
  }

  return {
    organizationId: facts.organizationId,
    kindId: MERGE_APPROVAL_KIND,
    payload: {
      pr_kind: facts.policyLabel,
      policy_label: facts.policyLabel,
      checks_passed: facts.checks.filter(
        (check) => check.verdict !== null && PASSING.has(check.verdict),
      ).length,
      checks_total: facts.checks.length,
      matrix_state: matrixStateOf(facts.criteria),
      added: facts.additions,
      removed: facts.deletions,
      files: facts.changedFiles,
    },
    refs,
    key: { plane: MERGE_APPROVAL_PLANE, sourceRef: `pr:${facts.prId}` },
  };
}

/** Reads a PR's facts for the card. */
@Injectable()
export class MergeApprovalFactsReader {
  /**
   * @param database - The pool.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * One PR's facts, as of its latest revision.
   *
   * @param prId - The PR.
   * @param revisionId - The revision the engine just judged.
   * @param policyLabel - The label the policy matched.
   * @returns The facts, or undefined when the PR is gone.
   */
  async read(
    prId: string,
    revisionId: string,
    policyLabel: string,
  ): Promise<MergeApprovalFacts | undefined> {
    const db = this.database.db;
    const pr = await db
      .selectFrom("pull_requests")
      .leftJoin("runs", "runs.id", "pull_requests.run_id")
      .leftJoin("tickets", "tickets.id", "pull_requests.ticket_id")
      .select([
        "pull_requests.id",
        "pull_requests.organization_id",
        "pull_requests.external_number",
        "pull_requests.state",
        "pull_requests.run_id",
        "pull_requests.ticket_id",
        "pull_requests.additions",
        "pull_requests.deletions",
        "pull_requests.changed_files",
        "runs.loop_seq",
        "tickets.external_key",
      ])
      .where("pull_requests.id", "=", prId)
      .executeTakeFirst();

    if (pr === undefined) {
      return undefined;
    }

    const gates = await db
      .selectFrom("pr_gate_results_latest")
      .select(["gate_key", "required", "verdict"])
      .where("revision_id", "=", revisionId)
      .execute();
    const criteria = await db
      .selectFrom("pr_criteria")
      .select("status")
      .where("pr_id", "=", prId)
      .execute();
    const approval = await db
      .selectFrom("pr_approvals")
      .select(["state", "decided_revision_id"])
      .where("pr_id", "=", prId)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();

    return {
      organizationId: pr.organization_id,
      prId: pr.id,
      prNumber: pr.external_number,
      prState: pr.state,
      runId: pr.run_id,
      loopSeq: pr.loop_seq ?? null,
      ticketId: pr.ticket_id,
      ticketKey: pr.external_key ?? null,
      policyLabel,
      checks: gates
        .filter((gate) => gate.required && gate.gate_key !== "human_approval")
        .map((gate) => ({ verdict: gate.verdict })),
      criteria: criteria.map((row) => row.status),
      additions: pr.additions ?? 0,
      deletions: pr.deletions ?? 0,
      changedFiles: pr.changed_files ?? 0,
      approved: approval?.state === "approved" && approval.decided_revision_id === revisionId,
    };
  }
}

/** The listener — see this file's header. */
@Injectable()
export class MergeApprovalEmitter implements GateEvaluationListener, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MergeApprovalEmitter.name);

  private readonly unsubscribe: (() => void)[] = [];

  /** Per PR, the filing in flight — so evaluations of one PR file in order. */
  private readonly queued = new Map<string, Promise<void>>();

  /**
   * @param listeners - The gate engine's listener registry.
   * @param reader - The PR's facts.
   * @param registry - Where the card is filed.
   * @param watcher - Where the PR-settled detector registers. Optional so a suite can omit it.
   */
  constructor(
    private readonly listeners: GateListeners,
    private readonly reader: MergeApprovalFactsReader,
    private readonly registry: DecisionKindRegistry,
    @Optional() private readonly watcher?: DecisionSourceWatcher,
  ) {}

  /** Listen to the gate engine, and register how a merge approval settles out of band. */
  onModuleInit(): void {
    this.unsubscribe.push(this.listeners.add(this));

    if (this.watcher !== undefined) {
      this.unsubscribe.push(this.watcher.register(prSettledDetector([MERGE_APPROVAL_KIND])));
    }
  }

  /** Stop listening. */
  onModuleDestroy(): void {
    for (const stop of this.unsubscribe.splice(0)) {
      stop();
    }
  }

  /** @inheritdoc */
  gateEvaluated(evaluated: GateEvaluated): void {
    const previous = this.queued.get(evaluated.prId) ?? Promise.resolve();
    const next = previous.then(() => this.file(evaluated));

    this.queued.set(evaluated.prId, next);
    void next.finally(() => {
      if (this.queued.get(evaluated.prId) === next) {
        this.queued.delete(evaluated.prId);
      }
    });
  }

  /**
   * File (or refresh) the card for one evaluation. Never throws: the evaluation has committed, and
   * the next one files what this one could not.
   *
   * @param evaluated - What the gate engine decided.
   * @returns When the card is filed, or nothing was to be filed.
   */
  async file(evaluated: GateEvaluated): Promise<void> {
    const label = evaluated.humanReview?.required === true ? evaluated.humanReview.label : null;

    if (label === null || evaluated.revisionId === null) {
      return;
    }

    try {
      const facts = await this.reader.read(evaluated.prId, evaluated.revisionId, label);
      const emission = facts === undefined ? null : mergeApprovalEmission(facts);

      if (emission !== null) {
        await this.registry.emit(emission);
      }
    } catch (error) {
      this.logger.error(
        `Could not file the merge approval for pr ${evaluated.prId}; the next evaluation will.`,
        describeForLog(error),
      );
    }
  }
}
