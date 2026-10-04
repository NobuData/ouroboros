/**
 * The `split_approval` emitter — the planner's batch files *"Approve a split into 6 tickets?"*.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)), AL.4
 * ([#280](https://github.com/NobuData/ouroboros/issues/280)). When **Draft tickets ⟳** stores a
 * planner batch, the split it proposes waits on a person to push it; this files one card per batch
 * (`planning` / `batch:<id>`), refreshed when a regenerate changes the count.
 *
 * **Out-of-band settlement**: the batch pushed or abandoned from the planning page closes the card
 * as `policy(source_resolved)`.
 */

import {
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
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
export const SPLIT_APPROVAL_KIND = "split_approval";

/** The plane's name in the idempotency key. */
export const SPLIT_APPROVAL_PLANE = "planning";

/** A batch's source ref. */
const BATCH_SOURCE_REF = /^batch:([0-9a-f-]{36})$/;

/** What the card is composed from. */
export interface SplitApprovalFacts {
  readonly organizationId: string;
  readonly batchId: string;
  /** The batch's outline, or its prompt when it has none. */
  readonly subject: string;
  /** How many drafts the planner proposed. */
  readonly draftCount: number;
  /** The target source's display name. */
  readonly target: string;
}

/**
 * The subject a batch is called by — its outline's first line, else its prompt's.
 *
 * @param outline - The outline, or null.
 * @param prompt - The prompt.
 * @returns One line of text.
 */
export function batchSubject(outline: string | null, prompt: string): string {
  const firstLine = (text: string) =>
    text
      .split(/\r?\n/)
      .find((line) => line.trim() !== "")
      ?.trim() ?? "";
  const fromOutline = outline === null ? "" : firstLine(outline).replace(/^#+\s*/, "");

  return fromOutline !== "" ? fromOutline : firstLine(prompt) || "a planning batch";
}

/**
 * The emission for one batch, or null when it proposes nothing.
 *
 * @param facts - The batch.
 * @returns The emission; null for a batch with no drafts.
 */
export function splitApprovalEmission(facts: SplitApprovalFacts): DecisionEmission | null {
  if (facts.draftCount < 1) {
    return null;
  }

  return {
    organizationId: facts.organizationId,
    kindId: SPLIT_APPROVAL_KIND,
    payload: {
      subject: clipFact(facts.subject, 120),
      draft_count: facts.draftCount,
      target: clipFact(facts.target, 200),
    },
    refs: [],
    key: { plane: SPLIT_APPROVAL_PLANE, sourceRef: `batch:${facts.batchId}` },
  };
}

/**
 * The detector: a batch pushed or abandoned is settled.
 *
 * @returns The detector.
 */
export function batchSettledDetector(): DecisionSourceDetector {
  return {
    name: "batch-settled",
    kinds: [SPLIT_APPROVAL_KIND],
    async settled(items, db) {
      const parsed = items
        .map((item) => ({ item, match: BATCH_SOURCE_REF.exec(item.sourceRef) }))
        .filter(
          (entry): entry is { item: AskingDecision; match: RegExpExecArray } =>
            entry.match !== null,
        );

      if (parsed.length === 0) {
        return [];
      }

      const rows = await db
        .selectFrom("draft_batches")
        .select(["id", "organization_id"])
        .where(
          "id",
          "in",
          parsed.map((entry) => entry.match[1]),
        )
        .where("status", "in", ["pushed", "abandoned"])
        .execute();
      const settled = new Set(rows.map((row) => `${row.organization_id}:${row.id}`));

      return parsed
        .filter(({ item, match }) => settled.has(`${item.organizationId}:${match[1]}`))
        .map(({ item }) => settledOf(item, "batch_settled", "web"));
    },
  };
}

@Injectable()
export class SplitApprovalEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SplitApprovalEmitter.name);

  private readonly unsubscribe: (() => void)[] = [];

  /**
   * @param database - The pool, for the batch.
   * @param registry - Where the card is filed.
   * @param watcher - Where the batch-settled detector registers. Optional so a suite can omit it.
   */
  constructor(
    private readonly database: DatabaseService,
    private readonly registry: DecisionKindRegistry,
    @Optional() private readonly watcher?: DecisionSourceWatcher,
  ) {}

  /** Register how a split approval settles out of band. */
  onModuleInit(): void {
    if (this.watcher !== undefined) {
      this.unsubscribe.push(this.watcher.register(batchSettledDetector()));
    }
  }

  /** Unregister. */
  onModuleDestroy(): void {
    for (const stop of this.unsubscribe.splice(0)) {
      stop();
    }
  }

  /**
   * A planner batch was stored: file (or refresh) its card. Never throws — the batch has
   * committed, and the planning page shows it either way.
   *
   * @param organizationId - The workspace.
   * @param batchId - The batch.
   * @returns When the card is filed, or there was none to file.
   */
  async drafted(organizationId: string, batchId: string): Promise<void> {
    try {
      const db = this.database.db;
      const batch = await db
        .selectFrom("draft_batches")
        .innerJoin("ticket_sources", "ticket_sources.id", "draft_batches.target_source_id")
        .select([
          "draft_batches.id",
          "draft_batches.outline",
          "draft_batches.source_prompt",
          "draft_batches.status",
          "ticket_sources.display_name",
        ])
        .where("draft_batches.id", "=", batchId)
        .where("draft_batches.organization_id", "=", organizationId)
        .executeTakeFirst();

      if (batch === undefined || batch.status === "pushed" || batch.status === "abandoned") {
        return;
      }

      const drafts = await db
        .selectFrom("ticket_drafts")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .where("batch_id", "=", batchId)
        .executeTakeFirstOrThrow();
      const emission = splitApprovalEmission({
        organizationId,
        batchId,
        subject: batchSubject(batch.outline, batch.source_prompt),
        draftCount: Number(drafts.count),
        target: batch.display_name,
      });

      if (emission !== null) {
        await this.registry.emit(emission);
      }
    } catch (error) {
      this.logger.error(
        `Could not file the split approval for batch ${batchId}.`,
        describeForLog(error),
      );
    }
  }
}
