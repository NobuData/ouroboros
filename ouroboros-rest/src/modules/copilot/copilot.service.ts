/**
 * The conversation's rules — sessions, exchanges, answers, continuity — with the loop in
 * `copilot.exchange.ts` and the statements in `copilot.repository.ts`.
 *
 * **One active session per workflow**, bound to its shared draft (V107's `copilot_sessions_one_active`).
 * **One exchange at a time** on a session: a reply still `streaming` refuses the next message.
 * **Every exchange is routed** — the `copilot-workflow` task kind resolved through Z.1 (#194) —
 * and the alias it resolved to is appended to the session's model provenance before a token is
 * asked for. A workspace with no route for the kind, or a resolution that fails, is an honest
 * reply the conversation shows (`copilot_unrouted`), recorded `interrupted` with no cost: nothing
 * was invoked, so nothing is metered.
 * **Operations apply under the etag.** The exchange's apply port runs each one in a transaction
 * that locks the draft row, compares the etag the loop holds to the slot's, and only then calls
 * `apply_draft_batch()` — the same discipline the canvas and the code editor save under (WF-P.3).
 * **Continuity** (decision W9) is `conversation()`: the active session, its messages, and the
 * draft as it stands — what a surface read when it switches back.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { CopilotChoice, CopilotMessage, CopilotSession, Workflow } from "../db/schema";
import { EngineClient } from "../engine/engine.client";
import type { EngineTranscriptEntry } from "../engine/engine.copilot";
import { NotFoundError } from "../errors/error.envelope";
import { ResolutionService } from "../routing/resolution.service";
import { draftEtag } from "../workflows/draft.etag";
import { workflowNotFound } from "../workflows/workflows.errors";
import { CopilotContextService } from "./copilot.context";
import type { CopilotAnswerBody, StartCopilotSessionBody } from "./copilot.dto";
import {
  answerInvalid,
  exchangeBusy,
  messageNotFound,
  sessionActive,
  sessionClosed,
  sessionNotFound,
} from "./copilot.errors";
import {
  runExchange,
  type DraftPort,
  type DraftState,
  type ExchangeOutcome,
} from "./copilot.exchange";
import type { DraftOperation } from "./copilot.operations";
import { unresolvedReferences } from "./copilot.references";
import { CopilotRepository, EMPTY_TRACE } from "./copilot.repository";
import {
  copilotMessage,
  copilotSession,
  copilotWarning,
  draftLabel,
  type CopilotConversationResource,
  type CopilotDraftResource,
  type CopilotSessionResource,
} from "./copilot.resources";
import type { CopilotStreamEvent } from "./copilot.stream";
import type { DslCatalogue } from "../workflows/dsl.references";

/** The task kind the copilot is routed as — a `task_kinds.name` a workspace routes like any other. */
export const COPILOT_TASK_KIND = "copilot-workflow";

/** The reply could not be made because nothing routes the copilot in this workspace. */
export const COPILOT_UNROUTED = "copilot_unrouted";

/** How a resolved alias is recorded, and how the exchange is told which to use. */
interface RoutedModel {
  readonly alias: string;
  readonly modelId: string;
  readonly resolutionVersion: string;
  readonly costCapCents: number | null;
}

@Injectable()
export class CopilotService {
  /**
   * @param copilots - The statements.
   * @param grounding - The context assembly (catalog, skills, task routes, guards).
   * @param routing - Z.1's resolution, for the `copilot-workflow` kind.
   * @param engine - The typed engine client, for the turn.
   * @param database - The pool, for the etag-guarded apply.
   */
  constructor(
    private readonly copilots: CopilotRepository,
    private readonly grounding: CopilotContextService,
    private readonly routing: ResolutionService,
    private readonly engine: EngineClient,
    private readonly database: DatabaseService,
  ) {}

  /**
   * Start a conversation on a workflow's draft.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param userId - Who is starting it.
   * @param body - The draft tag, when the caller names one.
   * @returns The session.
   * @throws {NotFoundError} `workflow_not_found`.
   * @throws {ConflictError} `copilot_session_active` when one is already open, naming it.
   */
  async start(
    organizationId: string,
    workflowId: string,
    userId: string | null,
    body: StartCopilotSessionBody,
  ): Promise<CopilotSessionResource> {
    const workflow = await this.requireWorkflow(organizationId, workflowId);
    const active = await this.copilots.activeSession(organizationId, workflow.id);
    if (active !== undefined) throw sessionActive(active.id);

    const session = await this.copilots.createSession(
      organizationId,
      workflow.id,
      body.draftName ?? workflow.slug,
      userId,
    );
    return copilotSession(session);
  }

  /**
   * The active conversation and the draft as it stands — decision **W9**'s continuity read.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @returns The session, its messages in order, and the draft with its W7 warnings.
   * @throws {NotFoundError} `workflow_not_found`, or `copilot_session_not_found` when none is active.
   */
  async conversation(
    organizationId: string,
    workflowId: string,
  ): Promise<CopilotConversationResource> {
    const workflow = await this.requireWorkflow(organizationId, workflowId);
    const session = await this.copilots.activeSession(organizationId, workflow.id);
    if (session === undefined) throw sessionNotFound(workflow.id);

    const [messages, { catalogue }] = await Promise.all([
      this.copilots.messages(session.id),
      this.grounding.grounding(organizationId),
    ]);

    return {
      session: copilotSession(session),
      messages: messages.map(copilotMessage),
      draft: await this.draftResource(workflow, catalogue),
    };
  }

  /**
   * Send a message and stream the reply.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param sessionId - The session.
   * @param userId - Who is speaking, for the operations' provenance.
   * @param text - What they said.
   * @yields The exchange's events, `accepted` first and `done` last.
   * @throws {NotFoundError} `workflow_not_found`, `copilot_session_not_found`.
   * @throws {ConflictError} `copilot_session_closed`, `copilot_exchange_busy`.
   */
  async *send(
    organizationId: string,
    workflowId: string,
    sessionId: string,
    userId: string | null,
    text: string,
  ): AsyncGenerator<CopilotStreamEvent> {
    const { workflow, session, messages } = await this.openExchange(
      organizationId,
      workflowId,
      sessionId,
    );
    yield* this.exchange(workflow, session, messages, userId, text);
  }

  /**
   * Answer one of a reply's questions — the chip — and stream what the copilot does with it.
   *
   * The answer is recorded on the reply's `choices` (each question may be answered once;
   * `copilot_messages_transition` enforces it) and re-enters the loop as the person's next
   * message, spelled `<prompt> → <selected>` so the model knows which question it answers.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param sessionId - The session.
   * @param messageId - The reply that asked.
   * @param userId - Who is answering.
   * @param body - Which question, and which option.
   * @yields The exchange's events.
   * @throws {NotFoundError} `copilot_message_not_found` and the others of {@link send}.
   * @throws {InvalidRequestError} `copilot_answer_invalid` for a question the reply did not ask,
   *   an option it did not offer, or one already answered.
   */
  async *answer(
    organizationId: string,
    workflowId: string,
    sessionId: string,
    messageId: string,
    userId: string | null,
    body: CopilotAnswerBody,
  ): AsyncGenerator<CopilotStreamEvent> {
    const { workflow, session, messages } = await this.openExchange(
      organizationId,
      workflowId,
      sessionId,
    );
    const reply = messages.find((message) => message.id === messageId);
    if (reply === undefined || reply.role !== "copilot") throw messageNotFound(messageId);

    const question = reply.choices?.[body.question];
    if (question === undefined)
      throw answerInvalid(`The reply asked no question ${body.question}.`);
    if (question.selected !== null) throw answerInvalid("That question was already answered.");
    if (!question.options.includes(body.selected)) {
      throw answerInvalid(`"${body.selected}" is not one of the options offered.`);
    }

    const answered: CopilotChoice[] = (reply.choices ?? []).map((choice, index) =>
      index === body.question
        ? { ...choice, selected: body.selected, answered_at: new Date().toISOString() }
        : choice,
    );
    const updated = await this.copilots.answerQuestions(reply.id, answered);
    const history = messages.map((message) => (message.id === updated.id ? updated : message));

    yield* this.exchange(
      workflow,
      session,
      history,
      userId,
      `${question.prompt} → ${body.selected}`,
    );
  }

  /**
   * Everything an exchange checks before it opens a stream.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @param sessionId - The session.
   * @returns The workflow, the session and its messages.
   */
  private async openExchange(organizationId: string, workflowId: string, sessionId: string) {
    const workflow = await this.requireWorkflow(organizationId, workflowId);
    const session = await this.copilots.session(organizationId, workflow.id, sessionId);
    if (session === undefined) throw sessionNotFound(workflow.id);
    if (session.status !== "active") throw sessionClosed(session.id, session.status);

    const messages = await this.copilots.messages(session.id);
    if (messages.some((message) => message.status === "streaming")) throw exchangeBusy(session.id);

    return { workflow, session, messages };
  }

  /**
   * One exchange: record the message, route, run the loop, record the reply.
   *
   * @param workflow - The workflow.
   * @param session - The session.
   * @param history - The messages so far.
   * @param userId - Who is speaking.
   * @param text - What they said.
   * @yields The events.
   */
  private async *exchange(
    workflow: Workflow,
    session: CopilotSession,
    history: readonly CopilotMessage[],
    userId: string | null,
    text: string,
  ): AsyncGenerator<CopilotStreamEvent> {
    const organizationId = workflow.organization_id;
    const message = await this.copilots.insertUserMessage(organizationId, session.id, text);
    const reply = await this.copilots.insertStreamingReply(organizationId, session.id);
    yield {
      kind: "accepted",
      message: copilotMessage(message),
      replyId: reply.id,
      replySeq: reply.seq,
    };

    const { context, catalogue } = await this.grounding.grounding(organizationId);
    const routed = await this.route(organizationId);

    if (!routed.ok) {
      const recorded = await this.copilots.finishReply(reply.id, {
        body: routed.message,
        choices: null,
        tool_trace: EMPTY_TRACE,
        tokens_in: null,
        tokens_out: null,
        cost_cents: null,
        status: "interrupted",
      });
      yield { kind: "delta", text: routed.message };
      yield { kind: "error", code: COPILOT_UNROUTED, message: routed.message };
      yield {
        kind: "done",
        message: copilotMessage(recorded),
        draft: await this.draftResource(workflow, catalogue),
      };
      return;
    }

    await this.copilots.appendProvenance(session.id, {
      seq: reply.seq,
      alias: routed.model.alias,
      model_id: routed.model.modelId,
    });

    const initial = await this.draftState(workflow.id);
    const loop = runExchange(
      {
        session: session.id,
        alias: routed.model.alias,
        resolutionVersion: routed.model.resolutionVersion,
        costCapCents: routed.model.costCapCents,
        context,
        catalogue,
        history: [...transcriptOf(history), { role: "user", text }],
        draft: initial,
      },
      this.engine,
      this.draftPort(workflow, session, userId),
    );

    let outcome: ExchangeOutcome;
    for (;;) {
      const next = await loop.next();
      if (next.done === true) {
        outcome = next.value;
        break;
      }
      yield next.value;
    }

    const recorded = await this.copilots.finishReply(reply.id, {
      body: outcome.body,
      choices: outcome.choices,
      tool_trace: outcome.trace,
      tokens_in: outcome.tokensIn,
      tokens_out: outcome.tokensOut,
      cost_cents: outcome.costCents,
      status: outcome.status,
    });

    yield {
      kind: "usage",
      tokensIn: outcome.tokensIn,
      tokensOut: outcome.tokensOut,
      costCents: outcome.costCents,
    };
    if (outcome.failure !== null) {
      yield { kind: "error", code: outcome.failure.code, message: outcome.failure.message };
    }
    const current = (await this.copilots.workflow(organizationId, workflow.id)) ?? workflow;
    yield {
      kind: "done",
      message: copilotMessage(recorded),
      draft: await this.draftResource(current, catalogue),
    };
  }

  /**
   * Resolve the `copilot-workflow` kind, honestly.
   *
   * @param organizationId - The workspace.
   * @returns The chain's primary, or the sentence the reply says instead.
   */
  private async route(
    organizationId: string,
  ): Promise<{ ok: true; model: RoutedModel } | { ok: false; message: string }> {
    let resolution;
    try {
      resolution = await this.routing.resolve(organizationId, COPILOT_TASK_KIND);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return {
          ok: false,
          message:
            `I can't reach a model: this workspace has no route for the \`${COPILOT_TASK_KIND}\` task kind. ` +
            "Add one under Model routing and try again.",
        };
      }
      throw error;
    }

    const primary = resolution.chain.find((hop) => hop.decision === "kept");
    if (resolution.outcome !== "resolved" || primary === undefined) {
      const reason =
        resolution.failure?.explanation ?? "no provider in the chain can serve it right now";
      return {
        ok: false,
        message: `I can't reach a model: the \`${COPILOT_TASK_KIND}\` route did not resolve — ${reason}`,
      };
    }

    return {
      ok: true,
      model: {
        alias: primary.alias,
        modelId: primary.modelId,
        resolutionVersion: resolution.resolutionVersion,
        costCapCents: resolution.maxCostCents,
      },
    };
  }

  /**
   * The draft as the loop starts from it.
   *
   * @param workflowId - The workflow.
   * @returns The document, the etag and the label.
   */
  private async draftState(workflowId: string): Promise<DraftState> {
    const [draft, workflow] = await Promise.all([
      this.copilots.draftOf(workflowId),
      this.copilots.revision(workflowId),
    ]);
    return {
      document: draft?.definition ?? null,
      etag: draftEtag(draft),
      label: draftLabel(workflow),
    };
  }

  /**
   * The apply port — the etag discipline, then `apply_draft_batch()`.
   *
   * @param workflow - The workflow.
   * @param session - The session.
   * @param userId - The person in the conversation.
   * @returns The port the loop applies through.
   */
  private draftPort(workflow: Workflow, session: CopilotSession, userId: string | null): DraftPort {
    return {
      apply: async (operation: DraftOperation, expectedEtag: string) =>
        this.database.transaction(async (trx) => {
          const existing = await this.copilots.draftOf(workflow.id, trx, true);
          if (draftEtag(existing) !== expectedEtag) {
            const row = await this.copilots.revision(workflow.id, trx);
            return {
              ok: false as const,
              draft: {
                document: existing?.definition ?? null,
                etag: draftEtag(existing),
                label: draftLabel(row),
              },
              editedIn: existing?.edited_in ?? null,
            };
          }

          const batch = await this.copilots.applyBatch(
            workflow.organization_id,
            workflow.id,
            userId,
            session.id,
            [operation],
            trx,
          );
          const [written, row] = await Promise.all([
            this.copilots.draftOf(workflow.id, trx),
            this.copilots.revision(workflow.id, trx),
          ]);
          return {
            ok: true as const,
            draftRev: batch.draft_rev,
            draft: {
              document: written?.definition ?? null,
              etag: draftEtag(written),
              label: draftLabel(row),
            },
          };
        }),
      lookupTickets: (query, limit) =>
        this.copilots.openTickets(workflow.organization_id, query, limit),
    };
  }

  /**
   * The draft as the conversation shows it.
   *
   * @param workflow - The workflow row.
   * @param catalogue - The names that exist, for the warnings.
   * @returns The resource.
   */
  private async draftResource(
    workflow: Workflow,
    catalogue: DslCatalogue,
  ): Promise<CopilotDraftResource> {
    const draft = await this.copilots.draftOf(workflow.id);
    const definition = draft?.definition ?? null;
    return {
      etag: draftEtag(draft),
      label: draftLabel(workflow),
      definition,
      provenanceSummary: workflow.provenance_summary,
      warnings: unresolvedReferences(definition, catalogue).map(copilotWarning),
    };
  }

  private async requireWorkflow(organizationId: string, workflowId: string): Promise<Workflow> {
    const workflow = await this.copilots.workflow(organizationId, workflowId);
    if (workflow === undefined) throw workflowNotFound(workflowId);
    return workflow;
  }
}

/**
 * The stored conversation as the engine's transcript.
 *
 * Replies are rendered as their prose plus a one-line summary of what they did, rather than as
 * the calls they made: the trace records outcomes, not call ids, and what the next turn needs is
 * what happened. The live exchange carries its own calls and results in full.
 *
 * @param messages - The messages, in order.
 * @returns The transcript.
 */
export function transcriptOf(messages: readonly CopilotMessage[]): EngineTranscriptEntry[] {
  return messages
    .filter((message) => message.status !== "streaming")
    .map((message) => {
      if (message.role === "user") return { role: "user" as const, text: message.body };

      const parts = [message.body];
      const operations = message.tool_trace.operations.map(
        (entry) => `${entry.op.kind} ${describeParams(entry.op)} → ${entry.outcome}`,
      );
      if (operations.length > 0) parts.push(`[operations: ${operations.join("; ")}]`);
      const questions = (message.choices ?? []).map(
        (choice) =>
          `${choice.prompt} (${choice.options.join(" / ")})${choice.selected === null ? "" : ` → ${choice.selected}`}`,
      );
      if (questions.length > 0) parts.push(`[asked: ${questions.join("; ")}]`);
      return { role: "copilot" as const, text: parts.join("\n"), toolCalls: [] };
    });
}

function describeParams(op: {
  readonly kind: string;
  readonly params?: Record<string, unknown>;
}): string {
  const params = op.params ?? {};
  const node = params.node as { id?: unknown } | undefined;
  const edge = params.edge as { from?: unknown; to?: unknown } | undefined;
  if (typeof node?.id === "string") return node.id;
  if (typeof params.id === "string") return params.id;
  if (edge !== undefined) return `${String(edge.from)} → ${String(edge.to)}`;
  if (typeof params.from === "string") return `${params.from} → ${String(params.to)}`;
  return "";
}
