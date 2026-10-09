/**
 * The copilot's statements — sessions, messages, the draft and its operation log, and the
 * tickets a dry-run proposal is drawn from.
 *
 * Every read is org-scoped by its leading column, and the two writes that touch the draft go
 * through the database's own functions: `apply_draft_batch()` is the **only** writer of
 * `draft_operations` (V110, #556) and the application role cannot insert one directly, which is
 * what makes *every copilot edit is a recorded, attributable operation* a property of the schema
 * rather than of this file.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type {
  CopilotChoice,
  CopilotMessage,
  CopilotMessageStatus,
  CopilotModelProvenanceEntry,
  CopilotSession,
  CopilotToolTrace,
  Database,
  Workflow,
  WorkflowVersion,
} from "../db/schema";
import { queryOn } from "../tenancy/queries";
import type { ProposedOperation } from "./copilot.operations";

/** An empty trace — what a user message carries, and what a reply starts with. */
export const EMPTY_TRACE: CopilotToolTrace = { operations: [], reads: [], dry_run_proposals: [] };

/** What finishing a reply records. */
export interface ReplyRecord {
  readonly body: string;
  readonly choices: readonly CopilotChoice[] | null;
  readonly tool_trace: CopilotToolTrace;
  readonly tokens_in: number | null;
  readonly tokens_out: number | null;
  readonly cost_cents: number | null;
  readonly status: Exclude<CopilotMessageStatus, "streaming">;
}

/** What `apply_draft_batch()` returns. */
export interface AppliedBatch {
  readonly draft_rev: number;
  readonly batch_id: string;
}

/** An open ticket, as a dry-run proposal names one. */
export interface TicketCandidate {
  readonly key: string;
  readonly title: string;
  readonly labels: readonly string[];
}

/** How many tickets a lookup may answer with, at most. */
export const MAX_TICKET_CANDIDATES = 10;

@Injectable()
export class CopilotRepository {
  /**
   * @param database - The pool.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * A workflow, org-scoped.
   *
   * @param organizationId - The workspace.
   * @param id - The workflow.
   * @param trx - The transaction to read within, when there is one.
   * @returns The row, or `undefined` when there is none this caller may see.
   */
  async workflow(
    organizationId: string,
    id: string,
    trx?: Transaction<Database>,
  ): Promise<Workflow | undefined> {
    return queryOn(this.database, trx)
      .selectFrom("workflows")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /**
   * A workflow's draft row — the slot the etag is computed from.
   *
   * @param workflowId - The workflow.
   * @param trx - The transaction to read within.
   * @param lock - `for update`, when the read is the first step of a guarded write.
   * @returns The draft row, or `undefined` when the workflow has none.
   */
  async draftOf(
    workflowId: string,
    trx?: Transaction<Database>,
    lock = false,
  ): Promise<WorkflowVersion | undefined> {
    const query = queryOn(this.database, trx)
      .selectFrom("workflow_versions")
      .selectAll()
      .where("workflow_id", "=", workflowId)
      .where("version", "is", null);

    return (lock ? query.forUpdate() : query).executeTakeFirst();
  }

  /**
   * The draft's revision counters — what the `v{published}.{rev}` label is made of.
   *
   * @param workflowId - The workflow.
   * @param trx - The transaction to read within, when there is one.
   * @returns The version in force and the draft revision.
   */
  async revision(
    workflowId: string,
    trx?: Transaction<Database>,
  ): Promise<Pick<Workflow, "current_version" | "draft_rev">> {
    return queryOn(this.database, trx)
      .selectFrom("workflows")
      .select(["current_version", "draft_rev"])
      .where("id", "=", workflowId)
      .executeTakeFirstOrThrow();
  }

  /**
   * The workflow's active session, if it has one.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @returns The session, or `undefined`.
   */
  async activeSession(
    organizationId: string,
    workflowId: string,
  ): Promise<CopilotSession | undefined> {
    return this.database.db
      .selectFrom("copilot_sessions")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("workflow_id", "=", workflowId)
      .where("status", "=", "active")
      .executeTakeFirst();
  }

  /**
   * One session, org-scoped and bound to its workflow.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow the path named.
   * @param sessionId - The session.
   * @returns The session, or `undefined`.
   */
  async session(
    organizationId: string,
    workflowId: string,
    sessionId: string,
  ): Promise<CopilotSession | undefined> {
    return this.database.db
      .selectFrom("copilot_sessions")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("workflow_id", "=", workflowId)
      .where("id", "=", sessionId)
      .executeTakeFirst();
  }

  /**
   * Start a session.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param draftName - The `draft: …` tag.
   * @param createdBy - Who started it.
   * @returns The row.
   */
  async createSession(
    organizationId: string,
    workflowId: string,
    draftName: string,
    createdBy: string | null,
  ): Promise<CopilotSession> {
    return this.database.db
      .insertInto("copilot_sessions")
      .values({
        organization_id: organizationId,
        workflow_id: workflowId,
        draft_name: draftName,
        created_by: createdBy,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Record which alias an exchange resolved to — appended, never rewritten.
   *
   * @param sessionId - The session.
   * @param entry - The entry; its `seq` is the reply's.
   * @returns When recorded.
   */
  async appendProvenance(sessionId: string, entry: CopilotModelProvenanceEntry): Promise<void> {
    await this.database.transaction(async (trx) => {
      const row = await trx
        .selectFrom("copilot_sessions")
        .select("model_provenance")
        .where("id", "=", sessionId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      await trx
        .updateTable("copilot_sessions")
        .set({ model_provenance: JSON.stringify([...row.model_provenance, entry]) })
        .where("id", "=", sessionId)
        .execute();
    });
  }

  /**
   * Every message of a session, in order.
   *
   * @param sessionId - The session.
   * @returns The rows by `seq`.
   */
  async messages(sessionId: string): Promise<CopilotMessage[]> {
    return this.database.db
      .selectFrom("copilot_messages")
      .selectAll()
      .where("session_id", "=", sessionId)
      .orderBy("seq")
      .execute();
  }

  /**
   * One message of a session.
   *
   * @param sessionId - The session.
   * @param messageId - The message.
   * @returns The row, or `undefined`.
   */
  async message(sessionId: string, messageId: string): Promise<CopilotMessage | undefined> {
    return this.database.db
      .selectFrom("copilot_messages")
      .selectAll()
      .where("session_id", "=", sessionId)
      .where("id", "=", messageId)
      .executeTakeFirst();
  }

  /**
   * Record what the person said.
   *
   * @param organizationId - The workspace.
   * @param sessionId - The session.
   * @param body - The message.
   * @returns The row, with its allocated `seq`.
   */
  async insertUserMessage(
    organizationId: string,
    sessionId: string,
    body: string,
  ): Promise<CopilotMessage> {
    return this.database.db
      .insertInto("copilot_messages")
      .values({ organization_id: organizationId, session_id: sessionId, role: "user", body })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Open a reply that is about to stream.
   *
   * @param organizationId - The workspace.
   * @param sessionId - The session.
   * @returns The row, `streaming` with an empty body.
   */
  async insertStreamingReply(organizationId: string, sessionId: string): Promise<CopilotMessage> {
    return this.database.db
      .insertInto("copilot_messages")
      .values({
        organization_id: organizationId,
        session_id: sessionId,
        role: "copilot",
        status: "streaming",
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Close a reply with what it said, did and cost.
   *
   * @param messageId - The reply.
   * @param record - What to record.
   * @returns The row after.
   */
  async finishReply(messageId: string, record: ReplyRecord): Promise<CopilotMessage> {
    return this.database.db
      .updateTable("copilot_messages")
      .set({
        body: record.body,
        choices: record.choices === null ? null : JSON.stringify(record.choices),
        tool_trace: JSON.stringify(record.tool_trace),
        tokens_in: record.tokens_in,
        tokens_out: record.tokens_out,
        cost_cents: record.cost_cents,
        status: record.status,
      })
      .where("id", "=", messageId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Record the answers to a reply's questions.
   *
   * @param messageId - The reply.
   * @param choices - The questions, with the answer filled in.
   * @returns The row after.
   */
  async answerQuestions(
    messageId: string,
    choices: readonly CopilotChoice[],
  ): Promise<CopilotMessage> {
    return this.database.db
      .updateTable("copilot_messages")
      .set({ choices: JSON.stringify(choices) })
      .where("id", "=", messageId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Apply one batch of operations to the draft as the copilot — `ouroboros.apply_draft_batch()`.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param actorUserId - The person in the conversation.
   * @param sessionId - The session.
   * @param operations - The operations, validated.
   * @param trx - The transaction — the caller's, which holds the draft lock the etag was checked under.
   * @returns The revision the batch produced.
   */
  async applyBatch(
    organizationId: string,
    workflowId: string,
    actorUserId: string | null,
    sessionId: string,
    operations: readonly ProposedOperation[],
    trx: Transaction<Database>,
  ): Promise<AppliedBatch> {
    const result = await sql<AppliedBatch>`
      select draft_rev, batch_id
        from ouroboros.apply_draft_batch(
          ${organizationId}, ${workflowId}::uuid, 'copilot', ${actorUserId},
          ${sessionId}::uuid, null, ${JSON.stringify(operations)}::jsonb)`.execute(trx);

    const [row] = result.rows;
    if (row === undefined) throw new Error("apply_draft_batch returned no row");
    return row;
  }

  /**
   * Open tickets matching a query, newest first — what `lookup_tickets` answers with.
   *
   * Plain recency, deliberately: the edge-case scorer that ranks them for a dry run is CD.4's
   * (#562), and ranking by anything less would be a ranking nobody designed.
   *
   * @param organizationId - The workspace.
   * @param query - A substring of the title, or of a label; empty for any.
   * @param limit - How many, at most {@link MAX_TICKET_CANDIDATES}.
   * @returns The candidates.
   */
  async openTickets(
    organizationId: string,
    query: string,
    limit: number,
  ): Promise<TicketCandidate[]> {
    const pattern = `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    let statement = this.database.db
      .selectFrom("tickets")
      .select(["external_key", "title", "labels"])
      .where("organization_id", "=", organizationId)
      .where("state", "=", "open");

    if (query.trim() !== "") {
      statement = statement.where((eb) =>
        eb.or([
          eb("title", "ilike", pattern),
          sql<boolean>`exists (select 1 from jsonb_array_elements_text(${sql.ref("labels")}) label where label ilike ${pattern})`,
        ]),
      );
    }

    const rows = await statement
      .orderBy("source_updated_at", "desc")
      .limit(Math.min(limit, MAX_TICKET_CANDIDATES))
      .execute();

    return rows.map((row) => ({ key: row.external_key, title: row.title, labels: row.labels }));
  }
}
