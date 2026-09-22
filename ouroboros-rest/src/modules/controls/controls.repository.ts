/**
 * Every statement the control queue issues — AP.4
 * ([#306](https://github.com/NobuData/ouroboros/issues/306)), decision **R6**.
 *
 * The state machine is not here. V048's `run_controls_transition()` is what refuses an edge the
 * diagram does not draw, and V048's `run_controls_audit()` is what writes an audit row for
 * every insert and every state change. So nothing in this file can forget the audit, and a
 * statement that tried to move a control somewhere illegal would fail in the database rather
 * than succeed here.
 *
 * Two habits carried over from `ingest.repository.ts`:
 *
 *   * **Every write locks the run row first** ({@link ControlsRepository.lockRun}). A submit
 *     reads *"is a pause already outstanding?"* and then inserts, an ack reads the control and
 *     then may cancel the run, and both are check-then-act sequences that must not interleave
 *     with themselves.
 *   * **The clock is the database's.** Every instant (`requested_at`, `delivered_at`,
 *     `acked_at`, `expires_at`) is `now()` or `now()` plus a TTL, so V048's
 *     `run_controls_clock_order` compares instants from one clock rather than from this
 *     process's and the database's.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database, Run, RunControl, RunControlKind } from "../db/schema";

/** A connection or a transaction — every method takes whichever the caller is inside. */
export type Writer = Kysely<Database> | Transaction<Database>;

/** A control being submitted. */
export interface ControlSubmission {
  readonly runId: string;
  readonly kind: RunControlKind;
  /** The steering text; null for every other kind. */
  readonly payload: string | null;
  readonly remember: boolean;
  /** `"user".id` of whoever asked. */
  readonly requestedBy: string;
  /** How long it is worth delivering, in seconds. Added to the database's `now()`. */
  readonly ttlSeconds: number;
  /** The caller's key, or absent for the database's fresh one. */
  readonly idempotencyKey?: string;
}

/** A transcript entry the queue writes on a person's behalf. */
export interface UserEntry {
  readonly body: string;
  /** Present with {@link UserEntry.attempt} or not at all — `run_events_stage_ref_complete`. */
  readonly stageKey: string | null;
  readonly attempt: number | null;
  readonly payload: Record<string, unknown>;
}

@Injectable()
export class ControlsRepository {
  /** @param database - The typed connection. The pool belongs to `DatabaseService`. */
  constructor(private readonly database: DatabaseService) {}

  /** The connection, for the reads that need no transaction. */
  get db(): Kysely<Database> {
    return this.database.db;
  }

  /**
   * Run several statements as one transaction.
   *
   * @param work - What to run inside it.
   * @returns Whatever `work` resolved to, once committed.
   */
  async transaction<T>(work: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }

  // --- runs --------------------------------------------------------------------------------

  /**
   * Lock a run's row for the rest of the transaction.
   *
   * @param writer - The transaction.
   * @param runId - The run.
   * @param organizationId - The workspace it must belong to, for the public surface. Omitted on
   *   the internal surface, which resolves the workspace from the run rather than claiming one.
   * @returns The row, or `undefined` when there is no such run, or it belongs to another
   *   workspace. The two are deliberately one answer.
   */
  async lockRun(writer: Writer, runId: string, organizationId?: string): Promise<Run | undefined> {
    let query = writer.selectFrom("runs").selectAll().where("id", "=", runId);

    if (organizationId !== undefined) {
      query = query.where("organization_id", "=", organizationId);
    }

    return query.forUpdate().executeTakeFirst();
  }

  /**
   * Does this workspace have this run? The listing's check, which needs no lock.
   *
   * @param writer - A connection or transaction.
   * @param runId - The run.
   * @param organizationId - The workspace.
   * @returns Whether the run exists in the workspace.
   */
  async runExists(writer: Writer, runId: string, organizationId: string): Promise<boolean> {
    const row = await writer
      .selectFrom("runs")
      .select("id")
      .where("id", "=", runId)
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();

    return row !== undefined;
  }

  /**
   * Close a run as `canceled` — where an acknowledged abort leaves it (V050).
   *
   * `branch_name` is not touched, which is the *"the branch is preserved"* half of the
   * criterion. Guarded on `finished_at is null`, so a run something else closed first keeps the
   * status it was given.
   *
   * @param writer - The transaction.
   * @param runId - The run.
   * @returns Whether this statement closed it.
   */
  async cancelRun(writer: Writer, runId: string): Promise<boolean> {
    const result = await writer
      .updateTable("runs")
      .set({ status: "canceled", finished_at: sql<Date>`now()` })
      .where("id", "=", runId)
      .where("finished_at", "is", null)
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }

  /**
   * The stage attempt the run is working on now, if any — what a steer is attributed to in the
   * transcript.
   *
   * @param writer - The transaction.
   * @param runId - The run.
   * @returns The active stage and its attempt, or `undefined` between stages.
   */
  async activeStage(
    writer: Writer,
    runId: string,
  ): Promise<{ stage_key: string; attempt: number } | undefined> {
    return writer
      .selectFrom("run_stages")
      .select(["stage_key", "attempt"])
      .where("run_id", "=", runId)
      .where("status", "=", "active")
      .orderBy("started_at", "desc")
      .orderBy("attempt", "desc")
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * Append one `user` entry to the run's transcript — the steer, mirrored.
   *
   * V046's `run_events_append()` numbers it, raises its watermark to the run's, and applies the
   * caps, exactly as it does for an executor's entries.
   *
   * @param writer - The transaction.
   * @param runId - The run.
   * @param entry - The entry.
   * @returns The sequence number the store allocated.
   */
  async appendUserEntry(writer: Writer, runId: string, entry: UserEntry): Promise<number> {
    const row = await writer
      .insertInto("run_events")
      .values({
        run_id: runId,
        actor: "user",
        stage_key: entry.stageKey,
        attempt: entry.attempt,
        body: entry.body,
        payload: entry.payload,
      })
      .returning("seq")
      .executeTakeFirstOrThrow();

    return row.seq;
  }

  // --- controls ----------------------------------------------------------------------------

  /**
   * The control a key already names on this run.
   *
   * @param writer - The transaction.
   * @param runId - The run.
   * @param idempotencyKey - The caller's key.
   * @returns The control, or `undefined` when the key is new.
   */
  async findByKey(
    writer: Writer,
    runId: string,
    idempotencyKey: string,
  ): Promise<RunControl | undefined> {
    return writer
      .selectFrom("run_controls")
      .selectAll()
      .where("run_id", "=", runId)
      .where("idempotency_key", "=", idempotencyKey)
      .executeTakeFirst();
  }

  /**
   * One control of this run, locked.
   *
   * @param writer - The transaction.
   * @param runId - The run it must belong to.
   * @param controlId - The control.
   * @returns The control, or `undefined` when there is none by that id on this run.
   */
  async findForUpdate(
    writer: Writer,
    runId: string,
    controlId: string,
  ): Promise<RunControl | undefined> {
    return writer
      .selectFrom("run_controls")
      .selectAll()
      .where("id", "=", controlId)
      .where("run_id", "=", runId)
      .forUpdate()
      .executeTakeFirst();
  }

  /**
   * The newest control of this kind that is still waiting to be delivered or answered.
   *
   * @param writer - The transaction. Called after {@link sweep}, so nothing elapsed is found.
   * @param runId - The run.
   * @param kind - The kind.
   * @returns The control, or `undefined` when none is outstanding.
   */
  async findOutstanding(
    writer: Writer,
    runId: string,
    kind: RunControlKind,
  ): Promise<RunControl | undefined> {
    return writer
      .selectFrom("run_controls")
      .selectAll()
      .where("run_id", "=", runId)
      .where("kind", "=", kind)
      .where("state", "in", ["pending", "delivered"])
      .orderBy("requested_at", "desc")
      .orderBy("id", "desc")
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * Queue a control as `pending`.
   *
   * @param writer - The transaction.
   * @param control - The submission.
   * @returns The row as written.
   */
  async insertPending(writer: Writer, control: ControlSubmission): Promise<RunControl> {
    return this.insert(writer, control, { state: "pending", ack_detail: null });
  }

  /**
   * Record a control as `rejected`, with the reason — so a refusal is audited and displayable
   * rather than a request that vanished.
   *
   * @param writer - The transaction.
   * @param control - The submission.
   * @param reason - Why, in the words the console displays.
   * @returns The row as written.
   */
  async insertRejected(
    writer: Writer,
    control: ControlSubmission,
    reason: string,
  ): Promise<RunControl> {
    return this.insert(writer, control, { state: "rejected", ack_detail: reason });
  }

  /**
   * Move every elapsed control to `expired` — the TTL sweep, as one statement over
   * `run_controls_expiry_idx`.
   *
   * @param writer - A connection or transaction.
   * @param runId - Sweep only this run, which the listing, the fetch and the ack do first so
   *   their answer is correct without waiting for the periodic sweep. Omitted for the periodic
   *   sweep itself.
   * @returns How many controls expired.
   */
  async sweep(writer: Writer, runId?: string): Promise<number> {
    let query = writer
      .updateTable("run_controls")
      .set({ state: "expired" })
      .where("state", "in", ["pending", "delivered"])
      .where("expires_at", "<=", sql<Date>`now()`);

    if (runId !== undefined) {
      query = query.where("run_id", "=", runId);
    }

    const result = await query.executeTakeFirst();

    return Number(result.numUpdatedRows);
  }

  /**
   * Claim every pending control of this run: `pending → delivered`.
   *
   * `for update skip locked` in the subquery, so two fetches racing for one run each claim a
   * control once rather than both claiming it. The run lock already serialises fetches for one
   * run, so this is a second belt.
   *
   * @param writer - The transaction.
   * @param runId - The run.
   * @returns The claimed controls, oldest first.
   */
  async claimPending(writer: Writer, runId: string): Promise<RunControl[]> {
    const rows = await writer
      .updateTable("run_controls")
      .set({ state: "delivered", delivered_at: sql<Date>`now()` })
      .where(
        "id",
        "in",
        writer
          .selectFrom("run_controls")
          .select("id")
          .where("run_id", "=", runId)
          .where("state", "=", "pending")
          .where("expires_at", ">", sql<Date>`now()`)
          .forUpdate()
          .skipLocked(),
      )
      .returningAll()
      .execute();

    // `update … returning` promises no order, and the executor applies them in the order given.
    return rows.sort(
      (a, b) => a.requested_at.getTime() - b.requested_at.getTime() || a.id.localeCompare(b.id),
    );
  }

  /**
   * Record the executor's answer: `delivered → acked`.
   *
   * @param writer - The transaction.
   * @param controlId - The control, already locked and known to be `delivered`.
   * @param detail - What the ack said.
   * @returns The row as it now stands.
   */
  async ack(writer: Writer, controlId: string, detail: string): Promise<RunControl> {
    return writer
      .updateTable("run_controls")
      .set({ state: "acked", acked_at: sql<Date>`now()`, ack_detail: detail })
      .where("id", "=", controlId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * A run's recent controls, newest first, which is `run_controls_run_requested_at_idx`'s order.
   *
   * @param writer - A connection or transaction.
   * @param runId - The run.
   * @param limit - How many.
   * @returns The controls.
   */
  async list(writer: Writer, runId: string, limit: number): Promise<RunControl[]> {
    return writer
      .selectFrom("run_controls")
      .selectAll()
      .where("run_id", "=", runId)
      .orderBy("requested_at", "desc")
      .orderBy("id", "desc")
      .limit(limit)
      .execute();
  }

  /**
   * The one insert both {@link insertPending} and {@link insertRejected} make.
   *
   * @param writer - The transaction.
   * @param control - The submission.
   * @param outcome - The state it is written in, and the detail that goes with it.
   * @returns The row as written.
   */
  private async insert(
    writer: Writer,
    control: ControlSubmission,
    outcome: { state: "pending" | "rejected"; ack_detail: string | null },
  ): Promise<RunControl> {
    return writer
      .insertInto("run_controls")
      .values({
        run_id: control.runId,
        kind: control.kind,
        payload: control.payload,
        remember: control.remember,
        requested_by: control.requestedBy,
        expires_at: sql<Date>`now() + make_interval(secs => ${control.ttlSeconds})`,
        state: outcome.state,
        ack_detail: outcome.ack_detail,
        ...(control.idempotencyKey === undefined
          ? {}
          : { idempotency_key: control.idempotencyKey }),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
