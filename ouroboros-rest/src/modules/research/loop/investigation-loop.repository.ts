/**
 * The investigation loop's storage (CM.1, [#620](https://github.com/NobuData/ouroboros/issues/620)):
 * V106's lifecycle row, V108's ledger and brief, and V120's loop state, usage rows and deliverable
 * inputs.
 *
 * **Each method is one transaction that holds the investigation row `for update`**, so the four
 * things that can race — a worker's checkpoint, a replacement worker's start, a person's cancel
 * and the resume pass — are serialised per investigation, and each answers a *named outcome*
 * instead of throwing: the service decides which refusal an outcome is.
 *
 * **Actuals are computed here, never sent.** `sources_used` is the ledger's row count and
 * `spend_cents` is `investigation_spend_cents()` over the usage rows, both read inside the
 * transaction that ends the run — so the figures on the investigation and the rows behind them
 * cannot disagree.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";

import { DatabaseService } from "../../db/db.service";
import {
  SCHEMA_NAME,
  type BriefBodyDocument,
  type BriefClaimType,
  type Database,
  type InvestigationActualsDocument,
  type InvestigationDeliverable,
  type InvestigationDepth,
  type InvestigationEstimateDocument,
  type InvestigationFailureReason,
  type InvestigationPlaybookDocument,
  type InvestigationStatus,
  type InvestigationUsageStage,
} from "../../db/schema";

/** An investigation, as dispatch and delivery need it. */
export interface LoopInvestigation {
  readonly id: string;
  readonly organizationId: string;
  /** `RS-127`. */
  readonly displayId: string;
  readonly status: InvestigationStatus;
  readonly kind: string;
  readonly playbook: InvestigationPlaybookDocument;
  readonly question: string;
  readonly depth: InvestigationDepth;
  readonly tools: readonly string[];
  readonly estimate: InvestigationEstimateDocument | null;
}

/** One ledger record, as the engine cites it. */
export interface LedgerSource {
  readonly id: string;
  readonly citeNo: number;
  readonly citeKey: string | null;
  readonly tool: string;
  readonly kind: string;
  readonly title: string;
  readonly locator: string;
  readonly excerpt: string;
}

/** One model call's usage. */
export interface UsageRow {
  readonly seq: number;
  readonly stage: InvestigationUsageStage;
  readonly alias: string;
  readonly hop: number;
  readonly connection: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costCents: number | null;
}

/** What a start records. */
export interface StartWrite {
  readonly loopVersion: string;
  readonly alias: string;
  readonly resolutionRef: string | null;
  readonly task: string;
}

/** What a checkpoint writes. */
export interface CheckpointWrite {
  readonly attempt: number;
  readonly seq: number;
  readonly checkpoint: Record<string, unknown>;
  readonly durationMs: number;
  readonly usage: readonly UsageRow[];
}

/** One claim of a delivered brief. */
export interface ClaimWrite {
  readonly ref: string;
  readonly type: BriefClaimType;
  readonly text: string;
  readonly sources: readonly string[];
  readonly demoted: boolean;
}

/** What a delivery writes. */
export interface DeliveryWrite {
  readonly attempt: number;
  readonly durationMs: number;
  readonly usage: readonly UsageRow[];
  readonly body: BriefBodyDocument;
  readonly claims: readonly ClaimWrite[];
  readonly deliverables: ReadonlyMap<InvestigationDeliverable, Record<string, unknown>>;
}

/** How a run ends without a brief. */
export interface EndingWrite {
  readonly attempt: number;
  readonly outcome: "failed" | "cancelled";
  readonly reason: InvestigationFailureReason | null;
  readonly detail: string | null;
  readonly durationMs: number;
  readonly usage: readonly UsageRow[];
  readonly seq: number;
  readonly checkpoint: Record<string, unknown>;
}

/** A write that could not be made, and why. */
export type Refused =
  | { readonly outcome: "not_found" }
  | {
      readonly outcome: "not_running";
      readonly displayId: string;
      readonly status: InvestigationStatus;
    }
  | { readonly outcome: "stale"; readonly displayId: string };

/** The answer to a start. */
export type StartOutcome =
  | { readonly outcome: "not_found" }
  | {
      readonly outcome: "not_runnable";
      readonly displayId: string;
      readonly status: InvestigationStatus;
    }
  | {
      readonly outcome: "started";
      readonly displayId: string;
      readonly attempt: number;
      readonly checkpoint: Record<string, unknown> | null;
      readonly checkpointSeq: number;
      readonly durationMs: number;
      readonly cancelRequested: boolean;
    };

/** The answer to a checkpoint. */
export type CheckpointOutcome =
  Refused | { readonly outcome: "saved"; readonly cancelRequested: boolean };

/** The answer to a delivery or an ending. */
export type EndOutcome =
  | Refused
  | {
      readonly outcome: "ended";
      readonly organizationId: string;
      readonly displayId: string;
      readonly status: InvestigationStatus;
      readonly actuals: InvestigationActualsDocument;
      /** The brief, when one was delivered. */
      readonly brief: { readonly id: string; readonly version: number } | null;
    };

/** The answer to a cancel request. */
export type CancelOutcome =
  | { readonly outcome: "not_found" }
  | {
      readonly outcome: "not_cancellable";
      readonly displayId: string;
      readonly status: InvestigationStatus;
    }
  /** It had not started (or no worker ever claimed it), so it is cancelled outright. */
  | { readonly outcome: "cancelled"; readonly displayId: string }
  /** A worker holds it; the request is recorded and honoured between operations. */
  | { readonly outcome: "requested"; readonly displayId: string };

/** A running investigation whose checkpoint has stopped moving. */
export interface StalledInvestigation {
  readonly id: string;
  readonly displayId: string;
  readonly attempt: number;
  /** A person asked for it to stop, and no worker has ended it. */
  readonly cancelRequested: boolean;
}

/** The storage the loop's services are written against; tests substitute an in-memory one. */
export interface InvestigationLoopStore {
  /** @returns The investigation, or undefined. */
  find(investigationId: string): Promise<LoopInvestigation | undefined>;
  /** @returns The investigation of that workspace, or undefined. */
  findIn(organizationId: string, investigationId: string): Promise<LoopInvestigation | undefined>;
  /** Claim a queued investigation, or resume a running one as a new attempt. */
  start(investigationId: string, write: StartWrite): Promise<StartOutcome>;
  /** @returns The investigation's ledger, in cite-number order. */
  ledger(investigationId: string): Promise<LedgerSource[]>;
  /** @returns Which of `sourceIds` the investigation's ledger holds. */
  knownSources(investigationId: string, sourceIds: readonly string[]): Promise<Set<string>>;
  /** Save the loop's state and its usage since the last write. */
  checkpoint(investigationId: string, write: CheckpointWrite): Promise<CheckpointOutcome>;
  /** Write the brief, its claims, links and deliverable inputs; the run becomes `brief_ready`. */
  deliver(investigationId: string, write: DeliveryWrite): Promise<EndOutcome>;
  /** End the run as `failed` or `cancelled`, keeping the partial. */
  finish(investigationId: string, write: EndingWrite): Promise<EndOutcome>;
  /** Cancel outright, or record the request for the worker to honour. */
  requestCancel(
    organizationId: string,
    investigationId: string,
    userId: string | null,
  ): Promise<CancelOutcome>;
  /** @returns Running investigations not written to since `before`, oldest first. */
  stalled(before: Date, limit: number): Promise<StalledInvestigation[]>;
  /**
   * End a run no worker is going to end: `failed` as `engine_error` with `detail`, or — with a
   * null `detail` — `cancelled`. No-op unless it is still running at `attempt`.
   */
  abandon(investigationId: string, attempt: number, detail: string | null): Promise<boolean>;
}

type Trx = Transaction<Database>;

/** A running investigation, locked, whose current attempt is the one writing. */
interface Owned {
  readonly outcome: "owned";
  readonly loop: {
    readonly attempt: number;
    readonly checkpoint_seq: number;
    readonly duration_ms: string;
    readonly cancel_requested_at: Date | null;
  };
  readonly organizationId: string;
  readonly displayId: string;
}

@Injectable()
export class InvestigationLoopRepository implements InvestigationLoopStore {
  /** @param database - The connection pool. */
  constructor(private readonly database: DatabaseService) {}

  /** @inheritdoc */
  async find(investigationId: string): Promise<LoopInvestigation | undefined> {
    return this.read(investigationId, null);
  }

  /** @inheritdoc */
  async findIn(
    organizationId: string,
    investigationId: string,
  ): Promise<LoopInvestigation | undefined> {
    return this.read(investigationId, organizationId);
  }

  /** @inheritdoc */
  async start(investigationId: string, write: StartWrite): Promise<StartOutcome> {
    return this.database.db.transaction().execute(async (trx) => {
      const held = await lock(trx, investigationId);
      if (held === undefined) return { outcome: "not_found" };
      if (held.status !== "queued" && held.status !== "running") {
        return { outcome: "not_runnable", displayId: held.display_id, status: held.status };
      }

      if (held.status === "queued") {
        await trx
          .updateTable("investigations")
          .set({
            status: "running",
            provenance: JSON.stringify({
              researcher: write.loopVersion,
              alias: write.alias,
              resolution_ref: write.resolutionRef,
            }),
            engine_task_ref: write.task,
          })
          .where("id", "=", investigationId)
          .execute();
      } else {
        await trx
          .updateTable("investigations")
          .set({ engine_task_ref: write.task })
          .where("id", "=", investigationId)
          .execute();
      }

      // A first start inserts attempt 1; a resume bumps the attempt, which is what makes the
      // replaced worker's next checkpoint stale.
      const loop = await trx
        .insertInto("investigation_loops")
        .values({ investigation_id: investigationId, loop_version: write.loopVersion })
        .onConflict((conflict) =>
          conflict
            .column("investigation_id")
            .doUpdateSet({ attempt: sql<number>`investigation_loops.attempt + 1` }),
        )
        .returning([
          "attempt",
          "checkpoint",
          "checkpoint_seq",
          "duration_ms",
          "cancel_requested_at",
        ])
        .executeTakeFirstOrThrow();

      return {
        outcome: "started",
        displayId: held.display_id,
        attempt: loop.attempt,
        checkpoint: loop.checkpoint,
        checkpointSeq: loop.checkpoint_seq,
        durationMs: Number(loop.duration_ms),
        cancelRequested: loop.cancel_requested_at !== null,
      };
    });
  }

  /** @inheritdoc */
  async ledger(investigationId: string): Promise<LedgerSource[]> {
    const rows = await this.database.db
      .selectFrom("source_records")
      .select(["id", "cite_no", "cite_key", "tool_slug", "kind", "title", "locator", "excerpt"])
      .where("investigation_id", "=", investigationId)
      .orderBy("cite_no")
      .execute();

    return rows.map((row) => ({
      id: row.id,
      citeNo: row.cite_no,
      citeKey: row.cite_key,
      tool: row.tool_slug,
      kind: row.kind,
      title: row.title,
      locator: row.locator,
      excerpt: row.excerpt,
    }));
  }

  /** @inheritdoc */
  async knownSources(investigationId: string, sourceIds: readonly string[]): Promise<Set<string>> {
    if (sourceIds.length === 0) return new Set();
    const rows = await this.database.db
      .selectFrom("source_records")
      .select("id")
      .where("investigation_id", "=", investigationId)
      .where("id", "in", [...sourceIds])
      .execute();

    return new Set(rows.map((row) => row.id));
  }

  /** @inheritdoc */
  async checkpoint(investigationId: string, write: CheckpointWrite): Promise<CheckpointOutcome> {
    return this.database.db.transaction().execute(async (trx) => {
      const refused = await owned(trx, investigationId, write.attempt);
      if (refused.outcome !== "owned") return refused;
      if (write.seq <= refused.loop.checkpoint_seq) {
        return { outcome: "stale", displayId: refused.displayId };
      }

      await recordUsage(trx, investigationId, write.usage);
      await trx
        .updateTable("investigation_loops")
        .set({
          checkpoint: JSON.stringify(write.checkpoint),
          checkpoint_seq: write.seq,
          checkpointed_at: sql<Date>`now()`,
          duration_ms: sql<number>`greatest(duration_ms, ${write.durationMs}::bigint)`,
        })
        .where("investigation_id", "=", investigationId)
        .execute();

      return { outcome: "saved", cancelRequested: refused.loop.cancel_requested_at !== null };
    });
  }

  /** @inheritdoc */
  async deliver(investigationId: string, write: DeliveryWrite): Promise<EndOutcome> {
    return this.database.db.transaction().execute(async (trx) => {
      const refused = await owned(trx, investigationId, write.attempt);
      if (refused.outcome !== "owned") return refused;

      await recordUsage(trx, investigationId, write.usage);

      const { version } = await trx
        .selectFrom("briefs")
        .select(sql<number>`coalesce(max(version), 0) + 1`.as("version"))
        .where("investigation_id", "=", investigationId)
        .executeTakeFirstOrThrow();
      const brief = await trx
        .insertInto("briefs")
        .values({
          investigation_id: investigationId,
          version,
          body: JSON.stringify(write.body),
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      for (const claim of write.claims) {
        const row = await trx
          .insertInto("brief_claims")
          .values({
            investigation_id: investigationId,
            brief_id: brief.id,
            span_ref: claim.ref,
            claim_type: claim.type,
            text: claim.text,
            demoted: claim.demoted,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        if (claim.sources.length > 0) {
          await trx
            .insertInto("brief_claim_sources")
            .values(
              claim.sources.map((source) => ({
                investigation_id: investigationId,
                claim_id: row.id,
                source_id: source,
              })),
            )
            .execute();
        }
      }

      for (const [deliverable, payload] of write.deliverables) {
        await trx
          .insertInto("investigation_deliverable_inputs")
          .values({
            investigation_id: investigationId,
            brief_id: brief.id,
            deliverable,
            payload: JSON.stringify(payload),
          })
          .execute();
      }

      const actuals = await end(trx, investigationId, "brief_ready", write.durationMs);

      return {
        outcome: "ended",
        organizationId: refused.organizationId,
        displayId: refused.displayId,
        status: "brief_ready",
        actuals,
        brief: { id: brief.id, version },
      };
    });
  }

  /** @inheritdoc */
  async finish(investigationId: string, write: EndingWrite): Promise<EndOutcome> {
    return this.database.db.transaction().execute(async (trx) => {
      const refused = await owned(trx, investigationId, write.attempt);
      if (refused.outcome !== "owned") return refused;

      await recordUsage(trx, investigationId, write.usage);
      // The status first: V120 lets a failure reason stand only on a failed investigation.
      const actuals = await end(trx, investigationId, write.outcome, write.durationMs);
      await trx
        .updateTable("investigation_loops")
        .set({
          checkpoint: JSON.stringify(write.checkpoint),
          checkpoint_seq: sql<number>`greatest(checkpoint_seq, ${write.seq}::integer)`,
          checkpointed_at: sql<Date>`now()`,
          failure_reason: write.outcome === "failed" ? write.reason : null,
          failure_detail: write.outcome === "failed" ? write.detail : null,
        })
        .where("investigation_id", "=", investigationId)
        .execute();

      return {
        outcome: "ended",
        organizationId: refused.organizationId,
        displayId: refused.displayId,
        status: write.outcome,
        actuals,
        brief: null,
      };
    });
  }

  /** @inheritdoc */
  async requestCancel(
    organizationId: string,
    investigationId: string,
    userId: string | null,
  ): Promise<CancelOutcome> {
    return this.database.db.transaction().execute(async (trx) => {
      const held = await lock(trx, investigationId, organizationId);
      if (held === undefined) return { outcome: "not_found" };
      if (held.status !== "queued" && held.status !== "running") {
        return { outcome: "not_cancellable", displayId: held.display_id, status: held.status };
      }

      const requested = await trx
        .updateTable("investigation_loops")
        .set({
          cancel_requested_at: sql<Date>`coalesce(cancel_requested_at, now())`,
          cancel_requested_by: sql<string | null>`coalesce(cancel_requested_by, ${userId})`,
        })
        .where("investigation_id", "=", investigationId)
        .returning("investigation_id")
        .executeTakeFirst();

      // Running under a worker: the worker ends it, with its ledger and actuals.
      if (held.status === "running" && requested !== undefined) {
        return { outcome: "requested", displayId: held.display_id };
      }

      // Queued, or running with no loop row (nothing ever claimed it): nothing to wait for.
      await trx
        .updateTable("investigations")
        .set({ status: "cancelled" })
        .where("id", "=", investigationId)
        .execute();
      return { outcome: "cancelled", displayId: held.display_id };
    });
  }

  /** @inheritdoc */
  async stalled(before: Date, limit: number): Promise<StalledInvestigation[]> {
    const rows = await this.database.db
      .selectFrom("investigation_loops as l")
      .innerJoin("investigations as i", "i.id", "l.investigation_id")
      .select(["i.id", "i.display_id", "l.attempt", "l.cancel_requested_at"])
      .where("i.status", "=", "running")
      .where("l.updated_at", "<", before)
      .orderBy("l.updated_at")
      .limit(limit)
      .execute();

    return rows.map((row) => ({
      id: row.id,
      displayId: row.display_id,
      attempt: row.attempt,
      cancelRequested: row.cancel_requested_at !== null,
    }));
  }

  /** @inheritdoc */
  async abandon(investigationId: string, attempt: number, detail: string | null): Promise<boolean> {
    return this.database.db.transaction().execute(async (trx) => {
      const refused = await owned(trx, investigationId, attempt);
      if (refused.outcome !== "owned") return false;

      const duration = Number(refused.loop.duration_ms);
      if (detail === null) {
        await end(trx, investigationId, "cancelled", duration);
        return true;
      }
      await end(trx, investigationId, "failed", duration);
      await trx
        .updateTable("investigation_loops")
        .set({ failure_reason: "engine_error", failure_detail: detail })
        .where("investigation_id", "=", investigationId)
        .execute();
      return true;
    });
  }

  /**
   * Read an investigation with its kind's playbook.
   *
   * @param investigationId - The investigation.
   * @param organizationId - The workspace it must belong to, or null for any.
   * @returns It, or undefined.
   */
  private async read(
    investigationId: string,
    organizationId: string | null,
  ): Promise<LoopInvestigation | undefined> {
    let query = this.database.db
      .selectFrom("investigations as i")
      .innerJoin("investigation_kinds as k", "k.id", "i.kind_id")
      .select([
        "i.id",
        "i.organization_id",
        "i.display_id",
        "i.status",
        "i.question",
        "i.depth",
        "i.tools_enabled",
        "i.estimate",
        "k.slug",
        "k.playbook",
      ])
      .where("i.id", "=", investigationId);
    if (organizationId !== null) {
      query = query.where("i.organization_id", "=", organizationId);
    }
    const row = await query.executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          id: row.id,
          organizationId: row.organization_id,
          displayId: row.display_id,
          status: row.status,
          kind: row.slug,
          playbook: row.playbook,
          question: row.question,
          depth: row.depth,
          tools: row.tools_enabled,
          estimate: row.estimate,
        };
  }
}

/**
 * Lock an investigation's row for the rest of the transaction.
 *
 * @param trx - The transaction.
 * @param investigationId - The investigation.
 * @param organizationId - The workspace it must belong to, when the caller is a person.
 * @returns Its id, workspace, display id and status, or undefined.
 */
async function lock(trx: Trx, investigationId: string, organizationId?: string) {
  let query = trx
    .selectFrom("investigations")
    .select(["id", "organization_id", "display_id", "status"])
    .where("id", "=", investigationId);
  if (organizationId !== undefined) {
    query = query.where("organization_id", "=", organizationId);
  }
  return query.forUpdate().executeTakeFirst();
}

/**
 * Lock an investigation and check that `attempt` is the one that owns it.
 *
 * @param trx - The transaction.
 * @param investigationId - The investigation.
 * @param attempt - The attempt writing.
 * @returns The loop row and the investigation's names, or the refusal.
 */
async function owned(trx: Trx, investigationId: string, attempt: number): Promise<Refused | Owned> {
  const held = await lock(trx, investigationId);
  if (held === undefined) return { outcome: "not_found" };
  if (held.status !== "running") {
    return { outcome: "not_running", displayId: held.display_id, status: held.status };
  }

  const loop = await trx
    .selectFrom("investigation_loops")
    .select(["attempt", "checkpoint_seq", "duration_ms", "cancel_requested_at"])
    .where("investigation_id", "=", investigationId)
    .executeTakeFirst();
  if (loop?.attempt !== attempt) {
    return { outcome: "stale", displayId: held.display_id };
  }

  return {
    outcome: "owned",
    loop,
    organizationId: held.organization_id,
    displayId: held.display_id,
  };
}

/**
 * Record model usage; a row already recorded (a re-sent write) is left as it is.
 *
 * @param trx - The transaction.
 * @param investigationId - The investigation.
 * @param usage - The rows.
 */
async function recordUsage(
  trx: Trx,
  investigationId: string,
  usage: readonly UsageRow[],
): Promise<void> {
  if (usage.length === 0) return;
  await trx
    .insertInto("investigation_usage")
    .values(
      usage.map((row) => ({
        investigation_id: investigationId,
        seq: row.seq,
        stage: row.stage,
        alias: row.alias,
        hop: row.hop,
        connection: row.connection,
        model: row.model,
        input_tokens: row.inputTokens,
        output_tokens: row.outputTokens,
        cost_cents: row.costCents,
      })),
    )
    .onConflict((conflict) => conflict.columns(["investigation_id", "seq"]).doNothing())
    .execute();
}

/**
 * Move an investigation to its end and write its actuals from the rows that are there.
 *
 * @param trx - The transaction.
 * @param investigationId - The investigation.
 * @param status - Where it ends.
 * @param durationMs - Working time the worker reports; the stored figure never goes down.
 * @returns The actuals written.
 */
async function end(
  trx: Trx,
  investigationId: string,
  status: "brief_ready" | "failed" | "cancelled",
  durationMs: number,
): Promise<InvestigationActualsDocument> {
  const loop = await trx
    .updateTable("investigation_loops")
    .set({ duration_ms: sql<number>`greatest(duration_ms, ${durationMs}::bigint)` })
    .where("investigation_id", "=", investigationId)
    .returning("duration_ms")
    .executeTakeFirstOrThrow();
  const { rows } = await sql<{ sources: string; spend: number | null }>`
    select (select count(*) from ${sql.id(SCHEMA_NAME)}.source_records
             where investigation_id = ${investigationId}::uuid) as sources,
           ${sql.id(SCHEMA_NAME)}.investigation_spend_cents(${investigationId}::uuid) as spend
  `.execute(trx);

  const actuals: InvestigationActualsDocument = {
    sources_used: Number(rows[0].sources),
    spend_cents: rows[0].spend,
    duration_ms: Number(loop.duration_ms),
  };
  await trx
    .updateTable("investigations")
    .set({ status, actuals: JSON.stringify(actuals) })
    .where("id", "=", investigationId)
    .execute();

  return actuals;
}
