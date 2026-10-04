/**
 * The `fact_review` emitter — BF.2's fact feed files *"Should the loops trust this fact?"*, at
 * `info` severity, so knowledge housekeeping never outranks a blocked loop.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)), BF.2
 * ([#411](https://github.com/NobuData/ouroboros/issues/411)). The facts plane already answers
 * *which facts wait on a person* (`GET /facts/needs-you`); this files the same two waits into the
 * inbox, each under its own key:
 *
 * ```
 * a fact is proposed        ─▶ facts / fact:<id>:proposed            reason "awaiting review"
 * the sweep flags it stale  ─▶ facts / fact:<id>:stale:<transition>  reason "flagged stale"
 * ```
 *
 * A stale episode is keyed by the transition that began it, so a fact re-confirmed and later
 * flagged stale again asks again rather than finding its old answered card.
 *
 * **Out-of-band settlement**: confirming, rejecting, re-confirming or expiring the fact on the
 * knowledge page closes its card as `policy(source_resolved)` — at once (the facts service asks for
 * a sweep after each decision), and on the minute's sweep otherwise.
 */

import {
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { FactStatus } from "../db/schema";
import { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import { clipFact } from "../decisions/decision.refs";
import type { DecisionEmission } from "../decisions/decision.types";
import {
  DecisionSourceWatcher,
  settledOf,
  type AskingDecision,
  type DecisionSourceDetector,
} from "../decisions/decision.watchers";
import { describeForLog } from "../errors/failure";

/** The kind. */
export const FACT_REVIEW_KIND = "fact_review";

/** The plane's name in the idempotency key. */
export const FACT_REVIEW_PLANE = "facts";

/** A fact's source ref: `fact:<id>:proposed` or `fact:<id>:stale:<transition id>`. */
const FACT_SOURCE_REF = /^fact:([0-9a-f-]{36}):(proposed|stale:([0-9a-f-]{36}))$/;

/**
 * The display line of a stored provenance (`{"line": …, "refs": […]}`, V071).
 *
 * @param provenance - The stored document.
 * @returns Its line, or a neutral one for a document without (which V071's CHECK rules out).
 */
function provenanceLineOf(provenance: unknown): string {
  const line = (provenance as { line?: unknown } | null)?.line;

  return typeof line === "string" && line.trim() !== "" ? line : "provenance unrecorded";
}

/** What a card is composed from. */
export interface FactReviewFacts {
  readonly organizationId: string;
  readonly factId: string;
  readonly status: FactStatus;
  readonly text: string;
  /** `from PR #514 review cycle`. */
  readonly provenanceLine: string;
  /** For a stale fact, the transition that flagged it; null otherwise. */
  readonly staleTransitionId: string | null;
}

/**
 * The emission for one fact waiting on a person, or null when it waits on nobody.
 *
 * @param facts - The fact.
 * @returns The emission; null unless the fact is `proposed`, or `stale` with a known transition.
 */
export function factReviewEmission(facts: FactReviewFacts): DecisionEmission | null {
  const proposed = facts.status === "proposed";

  if (!proposed && (facts.status !== "stale" || facts.staleTransitionId === null)) {
    return null;
  }

  return {
    organizationId: facts.organizationId,
    kindId: FACT_REVIEW_KIND,
    payload: {
      reason: proposed ? "awaiting review" : "flagged stale",
      text: clipFact(facts.text, 600),
      provenance_line: clipFact(facts.provenanceLine, 200),
    },
    refs: [],
    key: {
      plane: FACT_REVIEW_PLANE,
      sourceRef: proposed
        ? `fact:${facts.factId}:proposed`
        : `fact:${facts.factId}:stale:${String(facts.staleTransitionId)}`,
    },
  };
}

/**
 * The detector: a fact's card is settled once the fact has left the wait it was filed for.
 *
 * @returns The detector.
 */
export function factResolvedDetector(): DecisionSourceDetector {
  return {
    name: "fact-resolved",
    kinds: [FACT_REVIEW_KIND],
    async settled(items, db) {
      const parsed = items
        .map((item) => ({ item, match: FACT_SOURCE_REF.exec(item.sourceRef) }))
        .filter(
          (entry): entry is { item: AskingDecision; match: RegExpExecArray } =>
            entry.match !== null,
        );

      if (parsed.length === 0) {
        return [];
      }

      const facts = await db
        .selectFrom("facts")
        .select(["id", "organization_id", "status"])
        .where("id", "in", [...new Set(parsed.map((entry) => entry.match[1]))])
        .execute();
      const status = new Map(
        facts.map((fact) => [`${fact.organization_id}:${fact.id}`, fact.status]),
      );

      return parsed
        .filter(({ item, match }) => {
          const now = status.get(`${item.organizationId}:${match[1]}`);
          const waitingFor: FactStatus = match[2] === "proposed" ? "proposed" : "stale";

          // A fact that is gone, or no longer in the status its card asks about, is settled. A stale
          // card whose episode was superseded is settled by the next episode's card being asked.
          return now !== waitingFor;
        })
        .map(({ item }) => settledOf(item, "fact_resolved", "web"));
    },
  };
}

@Injectable()
export class FactReviewEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FactReviewEmitter.name);

  private readonly unsubscribe: (() => void)[] = [];

  /**
   * @param database - The pool, for the fact.
   * @param registry - Where the card is filed.
   * @param watcher - Where the detector registers, and what a decision asks to sweep. Optional so a
   *   suite can omit it.
   */
  constructor(
    private readonly database: DatabaseService,
    private readonly registry: DecisionKindRegistry,
    @Optional() private readonly watcher?: DecisionSourceWatcher,
  ) {}

  /** Register how a fact review settles out of band. */
  onModuleInit(): void {
    if (this.watcher !== undefined) {
      this.unsubscribe.push(this.watcher.register(factResolvedDetector()));
    }
  }

  /** Unregister. */
  onModuleDestroy(): void {
    for (const stop of this.unsubscribe.splice(0)) {
      stop();
    }
  }

  /**
   * File (or refresh) the card for each fact that now waits on a person. Never throws: the fact's
   * own write has committed, and the needs-you feed still lists it.
   *
   * @param organizationId - The workspace.
   * @param factIds - The facts just proposed or flagged stale.
   * @returns When every card is filed.
   */
  async review(organizationId: string, factIds: readonly string[]): Promise<void> {
    for (const factId of factIds) {
      try {
        const facts = await this.read(organizationId, factId);
        const emission = facts === undefined ? null : factReviewEmission(facts);

        if (emission !== null) {
          await this.registry.emit(emission);
        }
      } catch (error) {
        this.logger.error(`Could not file the review of fact ${factId}.`, describeForLog(error));
      }
    }
  }

  /**
   * A fact was decided on the knowledge page: close the card it settled now, rather than on the
   * minute's sweep. Never throws.
   *
   * @param organizationId - The workspace.
   * @returns When the sweep is done.
   */
  async settled(organizationId: string): Promise<void> {
    await this.watcher?.sweep(organizationId);
  }

  /**
   * A fact's card facts.
   *
   * @param organizationId - The workspace.
   * @param factId - The fact.
   * @returns The facts, or undefined when it is not this workspace's.
   */
  private async read(organizationId: string, factId: string): Promise<FactReviewFacts | undefined> {
    const db = this.database.db;
    const fact = await db
      .selectFrom("facts")
      .select(["id", "status", "text", "provenance"])
      .where("id", "=", factId)
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();

    if (fact === undefined) {
      return undefined;
    }

    const stale =
      fact.status === "stale"
        ? await db
            .selectFrom("fact_transitions")
            .select("id")
            .where("fact_id", "=", factId)
            .where("to_status", "=", "stale")
            .orderBy("at", "desc")
            .orderBy("id", "desc")
            .limit(1)
            .executeTakeFirst()
        : undefined;

    return {
      organizationId,
      factId: fact.id,
      status: fact.status,
      text: fact.text,
      provenanceLine: provenanceLineOf(fact.provenance),
      staleTransitionId: stale?.id ?? null,
    };
  }
}
