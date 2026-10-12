/**
 * The copilot's statements — sessions, messages, the draft and its operation log, and the
 * guarded apply. (The tickets a dry-run proposal is drawn from are the picker's — CD.4, #562.)
 *
 * Every read is org-scoped by its leading column, and the two writes that touch the draft go
 * through the database's own functions: `apply_draft_batch()` is the **only** writer of
 * `draft_operations` (V110, #556) and the application role cannot insert one directly, which is
 * what makes *every copilot edit is a recorded, attributable operation* a property of the schema
 * rather than of this file. **Discard draft** (CE.1, #565) is the same argument from the other
 * side: a draft is its row, its log and two counters, the application may not delete an
 * operation, and so `discard_workflow_draft()` (V129) drops all of it — and closes the
 * conversation — in one call.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import {
  DRY_RUN_TERMINAL_STATUSES,
  type CopilotChoice,
  type CopilotMessage,
  type CopilotMessageStatus,
  type CopilotModelProvenanceEntry,
  type CopilotSession,
  type CopilotToolTrace,
  type Database,
  type DryRun,
  type Workflow,
  type WorkflowVersion,
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

/** What `discard_workflow_draft()` returns. */
export interface DiscardedDraft {
  /** Whether a draft row was removed. */
  readonly draft_discarded: boolean;
  /** How many logged operations went with it. */
  readonly operations_removed: number;
  /** The session it closed as `discarded`, or `null` when none was active. */
  readonly session_id: string | null;
}

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
   * @param trx - The transaction to read within, when there is one.
   * @returns The session, or `undefined`.
   */
  async activeSession(
    organizationId: string,
    workflowId: string,
    trx?: Transaction<Database>,
  ): Promise<CopilotSession | undefined> {
    return queryOn(this.database, trx)
      .selectFrom("copilot_sessions")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("workflow_id", "=", workflowId)
      .where("status", "=", "active")
      .executeTakeFirst();
  }

  /**
   * The workflow's most recently closed session — promoted or discarded — if it has one.
   *
   * What the conversation read falls back to when nothing is active (CE.1, #565): the
   * transcript of a conversation that was promoted or discarded stays readable until the
   * retention sweep removes it. A workflow's sessions are few, and
   * `copilot_sessions_organization_workflow_idx` finds them.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @returns The session closed last, or `undefined` when none ever closed.
   */
  async lastClosedSession(
    organizationId: string,
    workflowId: string,
  ): Promise<CopilotSession | undefined> {
    return this.database.db
      .selectFrom("copilot_sessions")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("workflow_id", "=", workflowId)
      .where("status", "<>", "active")
      .orderBy("closed_at", "desc")
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * The highest version a workflow has published — what the next publish is numbered after.
   *
   * `max(version)` rather than `workflows.current_version`, because that is what
   * `WorkflowsRepository.publish` numbers from: the version in force is not necessarily the
   * newest, and the promote dialog must name the number a publish would really take.
   *
   * @param workflowId - The workflow.
   * @returns The number, or `null` for a workflow that has published nothing.
   */
  async highestVersion(workflowId: string): Promise<number | null> {
    const row = await this.database.db
      .selectFrom("workflow_versions")
      .where("workflow_id", "=", workflowId)
      .select(sql<number | null>`max(version)`.as("highest"))
      .executeTakeFirstOrThrow();

    return row.highest;
  }

  /**
   * The workflow's dry run that has not ended, if there is one — what a discard must not pull
   * the draft out from under.
   *
   * @param workflowId - The workflow.
   * @returns The open run's id, start and status, or `undefined`.
   */
  async openDryRun(
    workflowId: string,
  ): Promise<Pick<DryRun, "id" | "started_at" | "status"> | undefined> {
    return this.database.db
      .selectFrom("dry_runs")
      .select(["id", "started_at", "status"])
      .where("workflow_id", "=", workflowId)
      .where("status", "not in", DRY_RUN_TERMINAL_STATUSES)
      .orderBy("started_at", "desc")
      .limit(1)
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
   * A session's status, read under the workflow's row lock — the first half of the guarded
   * apply's *is this conversation still open?* (CE.2, #566).
   *
   * Both ways a conversation closes write the session while holding the workflow's row: a
   * publish locks it first (`WorkflowsRepository.lock`) and `discard_workflow_draft()` takes it
   * before it touches anything. So a transaction that holds that lock and then reads the status
   * — a fresh statement, which under read committed sees everything committed before it — reads
   * a status that cannot change until the transaction ends: a close that committed first is
   * seen, and one that has not is waiting. `apply_draft_batch()` takes the same lock next, so
   * this adds no lock the apply would not take anyway.
   *
   * @param workflowId - The workflow the session is bound to.
   * @param sessionId - The session.
   * @param trx - The apply's transaction. Required: the lock is what makes the answer hold.
   * @returns The status, or `undefined` when the workflow or the session is gone.
   */
  async sessionStatusLocked(
    workflowId: string,
    sessionId: string,
    trx: Transaction<Database>,
  ): Promise<CopilotSession["status"] | undefined> {
    await trx
      .selectFrom("workflows")
      .select("id")
      .where("id", "=", workflowId)
      .forUpdate()
      .executeTakeFirst();

    const row = await trx
      .selectFrom("copilot_sessions")
      .select("status")
      .where("workflow_id", "=", workflowId)
      .where("id", "=", sessionId)
      .executeTakeFirst();

    return row?.status;
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
   * Drop the workflow's draft and close the conversation about it —
   * `ouroboros.discard_workflow_draft()` (V129).
   *
   * One call rather than four statements because the application cannot make three of them:
   * the function deletes the draft row **and the current base's `draft_operations`**, returns
   * `draft_rev` to 0 and `provenance_summary` to zeros, and moves the active session to
   * `discarded` — under the workflow's lock, so the replay probe stays empty and the next first
   * edit is revision 1 over the base. The session's messages are not touched.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param trx - The transaction — the caller's, which holds the draft lock it decided under.
   * @returns Whether a draft went, how many operations with it, and the session closed.
   */
  async discardDraft(
    organizationId: string,
    workflowId: string,
    trx: Transaction<Database>,
  ): Promise<DiscardedDraft> {
    const result = await sql<DiscardedDraft>`
      select draft_discarded, operations_removed, session_id
        from ouroboros.discard_workflow_draft(${organizationId}, ${workflowId}::uuid)`.execute(trx);

    const [row] = result.rows;
    if (row === undefined) throw new Error("discard_workflow_draft returned no row");
    return row;
  }
}
