/**
 * The `resize_review` emitter — the estimator's re-size files *"Accept a re-size of #486 from L to
 * M?"*.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)), INTAKE-K.2
 * ([#100](https://github.com/NobuData/ouroboros/issues/100)) re-size events. Estimates are
 * versioned per ticket; when a new version's effort differs from the one before, the size the
 * queue was planned on moved, and a person may want to keep the old one. One card per re-size
 * (`estimation` / `ticket:<id>:estimate:<version>`).
 *
 * `resize_review` is the one **auto-resolvable** kind: a workspace policy (BP.4,
 * `auto_accept_resize`) may accept it — mockup 16's *"Estimator re-size #486 L→M — auto-accepted
 * by policy"*. That policy is BP.4's to write; this files the question.
 *
 * **Out-of-band settlement**: a newer estimate superseding the one asked about, or the ticket
 * closing, closes the card as `policy(source_resolved)`.
 */

import {
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { EstimateEffort } from "../db/schema";
import { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import type { DecisionEmission } from "../decisions/decision.types";
import {
  DecisionSourceWatcher,
  refIds,
  settledOf,
  type AskingDecision,
  type DecisionSourceDetector,
} from "../decisions/decision.watchers";
import { describeForLog } from "../errors/failure";

/** The kind. */
export const RESIZE_REVIEW_KIND = "resize_review";

/** The plane's name in the idempotency key. */
export const RESIZE_REVIEW_PLANE = "estimation";

/** A re-size's source ref. */
const RESIZE_SOURCE_REF = /^ticket:([0-9a-f-]{36}):estimate:([0-9]+)$/;

/** What the card is composed from. */
export interface ResizeReviewFacts {
  readonly organizationId: string;
  readonly ticketId: string;
  /** `#486`. */
  readonly ticketKey: string;
  /** The version the re-size produced. */
  readonly version: number;
  readonly fromEffort: EstimateEffort;
  readonly toEffort: EstimateEffort;
  /** The new estimate's confidence, in percent. */
  readonly confidence: number;
}

/**
 * The emission for one re-size, or null when the size did not move.
 *
 * @param facts - The ticket and its two estimates.
 * @returns The emission; null when both versions name the same effort.
 */
export function resizeReviewEmission(facts: ResizeReviewFacts): DecisionEmission | null {
  if (facts.fromEffort === facts.toEffort) {
    return null;
  }

  return {
    organizationId: facts.organizationId,
    kindId: RESIZE_REVIEW_KIND,
    payload: {
      ticket_key: facts.ticketKey.slice(0, 64),
      from_effort: facts.fromEffort.toUpperCase(),
      to_effort: facts.toEffort.toUpperCase(),
      confidence: Math.min(100, Math.max(0, Math.round(facts.confidence))),
    },
    refs: [{ type: "ticket", id: facts.ticketId, label: `issue ${facts.ticketKey}` }],
    key: {
      plane: RESIZE_REVIEW_PLANE,
      sourceRef: `ticket:${facts.ticketId}:estimate:${String(facts.version)}`,
    },
  };
}

/**
 * The detector: a re-size is settled once a newer estimate supersedes it or its ticket closes.
 *
 * @returns The detector.
 */
export function resizeSettledDetector(): DecisionSourceDetector {
  return {
    name: "resize-settled",
    kinds: [RESIZE_REVIEW_KIND],
    async settled(items, db) {
      const parsed = items
        .map((item) => ({ item, match: RESIZE_SOURCE_REF.exec(item.sourceRef) }))
        .filter(
          (entry): entry is { item: AskingDecision; match: RegExpExecArray } =>
            entry.match !== null,
        );
      const ticketIds = [...new Set(parsed.flatMap(({ item }) => refIds(item, "ticket")))];

      if (ticketIds.length === 0) {
        return [];
      }

      const tickets = await db
        .selectFrom("tickets")
        .leftJoin("issue_estimates", "issue_estimates.ticket_id", "tickets.id")
        .select((eb) => [
          "tickets.id",
          "tickets.organization_id",
          "tickets.state",
          eb.fn.max<number | null>("issue_estimates.version").as("latest"),
        ])
        .where("tickets.id", "in", ticketIds)
        .groupBy(["tickets.id", "tickets.organization_id", "tickets.state"])
        .execute();
      const byTicket = new Map(tickets.map((row) => [`${row.organization_id}:${row.id}`, row]));

      return parsed.flatMap(({ item, match }) => {
        const ticket = byTicket.get(`${item.organizationId}:${match[1]}`);

        if (ticket === undefined || ticket.state === "closed") {
          return [settledOf(item, "ticket_closed", "web")];
        }

        return ticket.latest !== null && ticket.latest > Number(match[2])
          ? [settledOf(item, "estimate_superseded", "api")]
          : [];
      });
    },
  };
}

@Injectable()
export class ResizeReviewEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResizeReviewEmitter.name);

  private readonly unsubscribe: (() => void)[] = [];

  /**
   * @param database - The pool, for the ticket and its estimates.
   * @param registry - Where the card is filed.
   * @param watcher - Where the resize-settled detector registers. Optional so a suite can omit it.
   */
  constructor(
    private readonly database: DatabaseService,
    private readonly registry: DecisionKindRegistry,
    @Optional() private readonly watcher?: DecisionSourceWatcher,
  ) {}

  /** Register how a re-size settles out of band. */
  onModuleInit(): void {
    if (this.watcher !== undefined) {
      this.unsubscribe.push(this.watcher.register(resizeSettledDetector()));
    }
  }

  /** Unregister. */
  onModuleDestroy(): void {
    for (const stop of this.unsubscribe.splice(0)) {
      stop();
    }
  }

  /**
   * A ticket's estimate was stored as a new version: file a card when its effort moved. Never
   * throws — the estimate has committed.
   *
   * @param ticketId - `tickets.id`.
   * @param version - The version just stored.
   * @returns When the card is filed, or there was none to file (a first estimate, or no move).
   */
  async estimated(ticketId: string, version: number): Promise<void> {
    if (version < 2) {
      return;
    }

    try {
      const db = this.database.db;
      const ticket = await db
        .selectFrom("tickets")
        .select(["id", "organization_id", "external_key", "state"])
        .where("id", "=", ticketId)
        .executeTakeFirst();
      const estimates = await db
        .selectFrom("issue_estimates")
        .select(["version", "effort", "confidence"])
        .where("ticket_id", "=", ticketId)
        .where("version", "in", [version - 1, version])
        .execute();
      const before = estimates.find((row) => row.version === version - 1);
      const after = estimates.find((row) => row.version === version);

      if (
        ticket === undefined ||
        ticket.state === "closed" ||
        before === undefined ||
        after === undefined
      ) {
        return;
      }

      const emission = resizeReviewEmission({
        organizationId: ticket.organization_id,
        ticketId: ticket.id,
        ticketKey: ticket.external_key,
        version,
        fromEffort: before.effort,
        toEffort: after.effort,
        confidence: after.confidence,
      });

      if (emission !== null) {
        await this.registry.emit(emission);
      }
    } catch (error) {
      this.logger.error(
        `Could not file the re-size review for ticket ${ticketId}.`,
        describeForLog(error),
      );
    }
  }
}
