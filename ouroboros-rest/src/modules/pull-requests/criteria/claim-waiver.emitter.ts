/**
 * The `claim_waiver` emitter — AX.3's unverifiable-claim flow files *"Waive a claim the bench can't
 * verify?"*.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)), AX.3
 * ([#359](https://github.com/NobuData/ouroboros/issues/359)). The criteria plane knows a criterion's
 * claim; the bench knows what it lacks. {@link ClaimWaiverEmitter.unverifiable} is the plane's hook:
 * given a criterion and the capability the rig is missing, it files one card per criterion
 * (`pr.criteria` / `pr:<pr>:criterion:<criterion>`), refreshed if asked again.
 *
 * **What calls it.** No detector decides "unverifiable" yet — criterion statuses are `unverified`,
 * `verified` and `waived`, and nothing records a bench's missing capability — so this hook is driven
 * by the harness today and by the bench-capability check when it lands. It is wired and tested,
 * not faked into a live path that has no facts to give it.
 *
 * **Out-of-band settlement**: the criterion waived or verified on the PR page, or the PR merging or
 * closing on its host, closes the card as `policy(source_resolved)`.
 */

import { Injectable, Optional, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { DatabaseService } from "../../db/db.service";
import { DecisionKindRegistry } from "../../decisions/decision-kind.registry";
import type {
  DecisionEmission,
  DecisionEmitOutcome,
  DecisionRef,
} from "../../decisions/decision.types";
import {
  DecisionSourceWatcher,
  prSettledDetector,
  settledOf,
  type DecisionSourceDetector,
} from "../../decisions/decision.watchers";

/** The kind. */
export const CLAIM_WAIVER_KIND = "claim_waiver";

/** The plane's name in the idempotency key. */
export const CLAIM_WAIVER_PLANE = "pr.criteria";

/** What the card is composed from. */
export interface ClaimWaiverFacts {
  readonly organizationId: string;
  readonly prId: string;
  readonly prNumber: number;
  readonly criterionId: string;
  /** The acceptance criterion's text, as the PR states it. */
  readonly claim: string;
  /** The bench capability the claim needs and the rig lacks — `thermal chamber`. */
  readonly missingCapability: string;
  readonly runId: string | null;
  readonly loopSeq: number | null;
}

/**
 * The key a criterion's card is filed under.
 *
 * @param prId - The PR.
 * @param criterionId - The criterion.
 * @returns `pr:<pr>:criterion:<criterion>`.
 */
export function claimWaiverSourceRef(prId: string, criterionId: string): string {
  return `pr:${prId}:criterion:${criterionId}`;
}

/**
 * The emission for one unverifiable criterion.
 *
 * @param facts - The criterion, its PR and the missing capability.
 * @returns The emission.
 */
export function claimWaiverEmission(facts: ClaimWaiverFacts): DecisionEmission {
  const refs: DecisionRef[] = [
    { type: "pr", id: facts.prId, label: `PR #${String(facts.prNumber)}` },
  ];

  if (facts.runId !== null) {
    refs.push({
      type: "run",
      id: facts.runId,
      label: facts.loopSeq === null ? "loop" : `loop #${String(facts.loopSeq)}`,
    });
  }

  return {
    organizationId: facts.organizationId,
    kindId: CLAIM_WAIVER_KIND,
    payload: { claim: facts.claim, missing_capability: facts.missingCapability },
    refs,
    key: {
      plane: CLAIM_WAIVER_PLANE,
      sourceRef: claimWaiverSourceRef(facts.prId, facts.criterionId),
    },
  };
}

/**
 * The detector for a criterion settled on the PR page — waived or verified there.
 *
 * @returns The detector.
 */
export function criterionSettledDetector(): DecisionSourceDetector {
  return {
    name: "criterion-settled",
    kinds: [CLAIM_WAIVER_KIND],
    async settled(items, db) {
      const keyed = items
        .map((item) => ({
          item,
          match: /^pr:[0-9a-f-]{36}:criterion:([0-9a-f-]{36})$/.exec(item.sourceRef),
        }))
        .filter(
          (entry): entry is { item: (typeof items)[number]; match: RegExpExecArray } =>
            entry.match !== null,
        );

      if (keyed.length === 0) {
        return [];
      }

      const rows = await db
        .selectFrom("pr_criteria")
        .select("id")
        .where(
          "id",
          "in",
          keyed.map((entry) => entry.match[1]),
        )
        .where("status", "in", ["verified", "waived"])
        .execute();
      const settled = new Set(rows.map((row) => row.id));

      return keyed
        .filter((entry) => settled.has(entry.match[1]))
        .map((entry) => settledOf(entry.item, "criterion_settled", "web"));
    },
  };
}

@Injectable()
export class ClaimWaiverEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly unsubscribe: (() => void)[] = [];

  /**
   * @param database - The pool, for the criterion's facts.
   * @param registry - Where the card is filed.
   * @param watcher - Where the settlement detectors register. Optional so a suite can omit it.
   */
  constructor(
    private readonly database: DatabaseService,
    private readonly registry: DecisionKindRegistry,
    @Optional() private readonly watcher?: DecisionSourceWatcher,
  ) {}

  /** Register how a claim waiver settles out of band. */
  onModuleInit(): void {
    if (this.watcher !== undefined) {
      this.unsubscribe.push(
        this.watcher.register(prSettledDetector([CLAIM_WAIVER_KIND])),
        this.watcher.register(criterionSettledDetector()),
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
   * A criterion the bench cannot verify: file (or refresh) its waiver card.
   *
   * @param organizationId - The workspace.
   * @param criterionId - `pr_criteria.id`.
   * @param missingCapability - What the rig lacks — `thermal chamber`.
   * @returns What the emission did, or null when the criterion is not this workspace's or is no
   *   longer unverified (waived or verified already — nothing to ask).
   */
  async unverifiable(
    organizationId: string,
    criterionId: string,
    missingCapability: string,
  ): Promise<DecisionEmitOutcome | null> {
    const row = await this.database.db
      .selectFrom("pr_criteria")
      .innerJoin("pull_requests", "pull_requests.id", "pr_criteria.pr_id")
      .leftJoin("runs", "runs.id", "pull_requests.run_id")
      .select([
        "pr_criteria.id",
        "pr_criteria.claim",
        "pr_criteria.status",
        "pull_requests.id as pr_id",
        "pull_requests.external_number",
        "pull_requests.run_id",
        "runs.loop_seq",
      ])
      .where("pr_criteria.id", "=", criterionId)
      .where("pull_requests.organization_id", "=", organizationId)
      .executeTakeFirst();

    if (row === undefined || row.status !== "unverified") {
      return null;
    }

    return this.registry.emit(
      claimWaiverEmission({
        organizationId,
        prId: row.pr_id,
        prNumber: row.external_number,
        criterionId: row.id,
        claim: row.claim,
        missingCapability,
        runId: row.run_id,
        loopSeq: row.loop_seq ?? null,
      }),
    );
  }
}
