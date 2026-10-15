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
 * that locks the draft row, checks the session is still active (a reply can outlive its
 * conversation — CE.2, #566), compares the etag the loop holds to the slot's, and only then calls
 * `apply_draft_batch()` — the same discipline the canvas and the code editor save under (WF-P.3).
 * **Continuity** (decision W9) is `conversation()`: the active session, its messages, and the
 * draft as it stands — what a surface read when it switches back. With nothing active it
 * answers the conversation closed last, read-only: a transcript outlives its draft.
 * **A conversation ends one of two ways** (CE.1, #565). *Promote* is the workflow's own publish
 * (`workflows.service.ts` moves the active session to `promoted` in the publish's transaction);
 * what this service adds is `promotion()`, the read that says what a publish would create and
 * names each guard with its real enforcement (`copilot.promotion.ts`). *Discard* is
 * `discard()`: the draft is dropped whole — row, operation log and counters, by V129's
 * `discard_workflow_draft()` — the session moves to `discarded`, and the workflow stays: its
 * published version again, or empty and unpublished.
 */

import { Injectable, type OnModuleInit } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { CopilotChoice, CopilotMessage, CopilotSession, DryRun, Workflow } from "../db/schema";
import { EngineClient } from "../engine/engine.client";
import type { EngineTranscriptEntry } from "../engine/engine.copilot";
import { NotFoundError } from "../errors/error.envelope";
import { DryRunAftermath } from "../dry-runs/dry-runs.aftermath";
import { DryRunPickerService } from "../dry-runs/dry-runs.picker.service";
import { dryRunInProgress } from "../dry-runs/dry-runs.errors";
import { DryRunSuggestionsService } from "../dry-runs/suggestions.service";
import { ENGINE_DRY_RUN_TIMEOUT_MS } from "../engine/engine.dryruns";
import { INVOCATION_GATEWAY_AVAILABLE } from "../internal/invoke.contract";
import { COPILOT_TASK_KIND } from "../routing/copilot.task-kind";
import { ResolutionService } from "../routing/resolution.service";
import { draftEtag } from "../workflows/draft.etag";
import { validateWorkflowDocument } from "../workflows/dsl.validator";
import { workflowNotFound } from "../workflows/workflows.errors";
import { CopilotContextService } from "./copilot.context";
import type { CopilotAnswerBody, StartCopilotSessionBody } from "./copilot.dto";
import {
  answerInvalid,
  exchangeBusy,
  messageNotFound,
  nothingToDiscard,
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
import { blockedReasons, promotionGuards, promotionReference } from "./copilot.promotion";
import { unresolvedReferences } from "./copilot.references";
import { CopilotRepository, EMPTY_TRACE } from "./copilot.repository";
import {
  copilotMessage,
  copilotNodeProvenance,
  copilotReadiness,
  copilotSession,
  copilotWarning,
  draftLabel,
  type CopilotConversationResource,
  type CopilotDiscardResource,
  type CopilotDraftResource,
  type CopilotPromotionResource,
  type CopilotReadinessResource,
  type CopilotSessionResource,
} from "./copilot.resources";
import type { CopilotStreamEvent } from "./copilot.stream";
import type { DslCatalogue } from "../workflows/dsl.references";

/** The task kind the copilot is routed as — a `task_kinds.name` a workspace routes like any other. */
export { COPILOT_TASK_KIND };

/** The reply could not be made because nothing routes the copilot in this workspace. */
export const COPILOT_UNROUTED = "copilot_unrouted";

/** How an unrouted reply begins; what follows is the reason the readiness read reports. */
export const UNROUTED_PREFIX = "I can't reach a model: ";

/** The read a reply's trace carries when a dry run's results were its input (CD.5, #563). */
export const DRY_RUN_RESULTS = "dry_run_results";

/** How many tickets one `lookup_tickets` may answer with, at most. */
export const MAX_TICKET_CANDIDATES = 10;

/** How a resolved alias is recorded, and how the exchange is told which to use. */
interface RoutedModel {
  readonly alias: string;
  readonly modelId: string;
  readonly resolutionVersion: string;
  readonly costCapCents: number | null;
}

@Injectable()
export class CopilotService implements OnModuleInit {
  /**
   * @param copilots - The statements.
   * @param grounding - The context assembly (catalog, skills, task routes, guards).
   * @param routing - Z.1's resolution, for the `copilot-workflow` kind.
   * @param engine - The typed engine client, for the turn.
   * @param database - The pool, for the etag-guarded apply.
   * @param picker - The edge-case picker `lookup_tickets` ranks with (CD.4, #562).
   * @param suggestions - Where a `propose_suggestion` is validated and recorded (CD.5, #563).
   * @param aftermath - Where this service registers to be told a dry run ended.
   */
  constructor(
    private readonly copilots: CopilotRepository,
    private readonly grounding: CopilotContextService,
    private readonly routing: ResolutionService,
    private readonly engine: EngineClient,
    private readonly database: DatabaseService,
    private readonly picker: DryRunPickerService,
    private readonly suggestions: DryRunSuggestionsService,
    private readonly aftermath: DryRunAftermath,
  ) {}

  /** Ask to be told when a dry run ends, so its results reach the conversation it came from. */
  onModuleInit(): void {
    this.aftermath.register((run) => this.debrief(run));
  }

  /**
   * Feed a finished dry run's results to the conversation it was started from — LLM
   * enrichment (CD.5, #563).
   *
   * One exchange nobody is watching: the results enter as the turn's input (not as a message
   * the person typed), and the copilot's reply is recorded as its next bubble, with
   * `dry_run_results` on its trace's reads. Anything it proposes through `propose_suggestion`
   * is validated as operations and filed under the run as `source: llm`.
   *
   * Skipped, silently, whenever the conversation is not there to receive it: the run had no
   * session, the session is closed, or an exchange is already streaming.
   *
   * @param run - The dry run, as it ended.
   * @returns When the reply is recorded, or at once when there is nothing to do.
   */
  async debrief(run: DryRun): Promise<void> {
    if (run.session_id === null) return;

    const results = await this.suggestions.debriefing(run);
    if (results === undefined) return;

    const workflow = await this.copilots.workflow(run.organization_id, run.workflow_id);
    if (workflow === undefined) return;

    const session = await this.copilots.session(run.organization_id, workflow.id, run.session_id);
    if (session?.status !== "active") return;

    const messages = await this.copilots.messages(session.id);
    if (messages.some((message) => message.status === "streaming")) return;

    const reply = await this.copilots.insertStreamingReply(run.organization_id, session.id);
    const events = this.reply(workflow, session, reply, messages, session.created_by, results, [
      { tool: DRY_RUN_RESULTS },
    ]);
    // Nobody is on the stream; the conversation read shows the reply.
    for await (const event of events) void event;
  }

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
   * The conversation and the draft as it stands — decision **W9**'s continuity read.
   *
   * The active session when there is one. Otherwise the session closed last — promoted or
   * discarded, its `status` says which — with its messages, read-only (CE.1, #565): every
   * route that writes to a session still refuses a closed one with `copilot_session_closed`.
   * The draft beside it is always the workflow's draft *now*, which after a discard is none.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @returns The session, its messages in order, and the draft with its W7 warnings.
   * @throws {NotFoundError} `workflow_not_found`, or `copilot_session_not_found` when the
   *   workflow never had a conversation.
   */
  async conversation(
    organizationId: string,
    workflowId: string,
  ): Promise<CopilotConversationResource> {
    const workflow = await this.requireWorkflow(organizationId, workflowId);
    const session = await this.latestSession(organizationId, workflow.id);
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
   * The shared draft as it stands, with who each stage is by — what the stage list reads
   * (CE.3, #567).
   *
   * Unlike {@link CopilotService.conversation} it needs no conversation: a draft drawn on the
   * canvas alone reads here too, every stage `human`. A workflow without a draft answers a
   * `null` definition and no stages.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @returns The draft, its W7 warnings and its per-stage provenance.
   * @throws {NotFoundError} `workflow_not_found`.
   */
  async draft(organizationId: string, workflowId: string): Promise<CopilotDraftResource> {
    const workflow = await this.requireWorkflow(organizationId, workflowId);
    const { catalogue } = await this.grounding.grounding(organizationId);

    return this.draftResource(workflow, catalogue);
  }

  /**
   * What **Promote to workflow** would publish — the version, the guards with where each is
   * really enforced, and the references that do not resolve (CE.1, #565).
   *
   * A read, and an honest one: it runs the publish gate's first stage — the in-process DSL
   * validator, over the registry's aliases (#1745) — but **not** the engine's validation, so
   * `blocked` is what can be known without asking: no draft, a document the validator refuses
   * (no ending, an unreachable stage, a schema error), or a pinned alias the registry does not
   * hold. The publish still runs both stages, and its `422 workflow_definition_invalid` is the
   * authority.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @returns The promotion as it stands.
   * @throws {NotFoundError} `workflow_not_found`.
   */
  async promotion(organizationId: string, workflowId: string): Promise<CopilotPromotionResource> {
    const workflow = await this.requireWorkflow(organizationId, workflowId);
    const [draft, highest, session, spendCapCents, catalogue] = await Promise.all([
      this.copilots.draftOf(workflow.id),
      this.copilots.highestVersion(workflow.id),
      this.latestSession(organizationId, workflow.id),
      this.suggestions.draftSpendGuardCents(organizationId, workflow.id),
      this.grounding.promotionCatalogue(organizationId),
    ]);

    const definition = draft?.definition ?? null;
    const version = (highest ?? 0) + 1;
    const references = unresolvedReferences(definition, catalogue).map(promotionReference);
    const findings =
      draft === undefined ? [] : validateWorkflowDocument(definition, { catalogue }).errors;
    const reasons = blockedReasons(draft !== undefined, references, findings);

    return {
      workflow: { id: workflow.id, slug: workflow.slug, name: workflow.name },
      publishes: { version, label: `${workflow.slug} v${version}` },
      draft: {
        present: draft !== undefined,
        label: draftLabel(workflow),
        etag: draftEtag(draft),
      },
      session: session === undefined ? null : { id: session.id, status: session.status },
      guards: promotionGuards(definition, spendCapCents),
      references,
      blocked: reasons.length > 0,
      blockedReasons: reasons,
    };
  }

  /**
   * Whether a message sent now could be answered, and whether a dry run stands in the way of a
   * discard — what the conversation card says before anybody types (CE.2, #566).
   *
   * Reports only what this service already knows: the deployment's invocation gateway, what
   * `route()` would decide for the next reply, and the workflow's dry run that has not ended.
   * Nothing is asked of the engine or of a provider, and nothing is written.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @returns The readiness as it stands.
   * @throws {NotFoundError} `workflow_not_found`.
   */
  async readiness(organizationId: string, workflowId: string): Promise<CopilotReadinessResource> {
    const workflow = await this.requireWorkflow(organizationId, workflowId);
    const [routed, open] = await Promise.all([
      this.route(organizationId),
      this.copilots.openDryRun(workflow.id),
    ]);

    return copilotReadiness(
      INVOCATION_GATEWAY_AVAILABLE,
      COPILOT_TASK_KIND,
      routed.ok ? { alias: routed.model.alias, modelId: routed.model.modelId } : routed.reason,
      // A run past the harness deadline is one nothing is relaying any more: the next start
      // reaps it and a discard ignores it, so it must not hold the composer shut either.
      open !== undefined && this.inFlight(open) ? open : undefined,
    );
  }

  /**
   * Whether an open dry run can still be running — it started within the harness's deadline.
   *
   * @param run - The open run's start.
   * @returns False for a run older than {@link ENGINE_DRY_RUN_TIMEOUT_MS}.
   */
  private inFlight(run: { readonly started_at: Date }): boolean {
    return Date.now() - run.started_at.getTime() <= ENGINE_DRY_RUN_TIMEOUT_MS;
  }

  /**
   * **Discard draft**: drop the draft and close the conversation; keep the workflow and the
   * transcript (CE.1, #565).
   *
   * The workflow returns to its published version, or — never published — to an empty
   * unpublished workflow that stays listed. One transaction: the draft row is locked first
   * (every draft writer takes that lock first, so a save in flight finishes before the draft
   * goes, and one arriving after finds no draft and is told so by its etag), then
   * `discard_workflow_draft()` (V129) removes the row, its operation log and its counters and
   * moves the active session to `discarded`.
   *
   * **Refused while a dry run is in progress.** The run was sent a copy of the draft, so it
   * would not fail — it would go on spending against, and then file suggestions for, a draft
   * that no longer exists. The person is told which run, to follow or cancel it. A run left
   * open longer than the harness's own deadline cannot still be running anywhere and does not
   * stand in the way; the next dry run's start ends it (`DryRunsService`).
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @returns Whether a draft went, and the session that was closed, if one was.
   * @throws {NotFoundError} `workflow_not_found`.
   * @throws {ConflictError} `dry_run_in_progress`, or `copilot_nothing_to_discard` when the
   *   workflow has neither a draft nor an active session.
   */
  async discard(organizationId: string, workflowId: string): Promise<CopilotDiscardResource> {
    const workflow = await this.requireWorkflow(organizationId, workflowId);

    const open = await this.copilots.openDryRun(workflow.id);
    if (open !== undefined && this.inFlight(open)) {
      throw dryRunInProgress(open.id);
    }

    const discarded = await this.database.transaction(async (trx) => {
      const draft = await this.copilots.draftOf(workflow.id, trx, true);
      const active = await this.copilots.activeSession(organizationId, workflow.id, trx);
      if (draft === undefined && active === undefined) throw nothingToDiscard(workflow.id);

      return this.copilots.discardDraft(organizationId, workflow.id, trx);
    });

    const session =
      discarded.session_id === null
        ? undefined
        : await this.copilots.session(organizationId, workflow.id, discarded.session_id);

    return {
      workflowId: workflow.id,
      draftDiscarded: discarded.draft_discarded,
      session: session === undefined ? null : copilotSession(session),
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

    yield* this.reply(workflow, session, reply, history, userId, text);
  }

  /**
   * Build one reply: route, run the loop, record what it produced.
   *
   * @param workflow - The workflow.
   * @param session - The session.
   * @param reply - The reply's row, already inserted `streaming`.
   * @param history - The messages before this turn.
   * @param userId - Whose provenance the operations carry.
   * @param text - The turn's input — the person's message, or a dry run's results.
   * @param reads - Reads to record on the reply's trace ahead of the loop's own.
   * @yields The events after `accepted`, `done` last.
   */
  private async *reply(
    workflow: Workflow,
    session: CopilotSession,
    reply: CopilotMessage,
    history: readonly CopilotMessage[],
    userId: string | null,
    text: string,
    reads: readonly { readonly tool: string }[] = [],
  ): AsyncGenerator<CopilotStreamEvent> {
    const organizationId = workflow.organization_id;
    const { context, catalogue } = await this.grounding.grounding(organizationId);
    const routed = await this.route(organizationId);

    if (!routed.ok) {
      const message = unroutedMessage(routed.reason);
      const recorded = await this.copilots.finishReply(reply.id, {
        body: message,
        choices: null,
        tool_trace: EMPTY_TRACE,
        tokens_in: null,
        tokens_out: null,
        cost_cents: null,
        status: "interrupted",
      });
      yield { kind: "delta", text: message };
      yield { kind: "error", code: COPILOT_UNROUTED, message };
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
      this.draftPort(workflow, session, userId, routed.model),
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
      tool_trace: { ...outcome.trace, reads: [...reads, ...outcome.trace.reads] },
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
   * @returns The chain's primary, or why there is none — the reason an unrouted reply gives
   *   after {@link UNROUTED_PREFIX}, and the one the readiness read reports as it is.
   */
  private async route(
    organizationId: string,
  ): Promise<{ ok: true; model: RoutedModel } | { ok: false; reason: string }> {
    let resolution;
    try {
      resolution = await this.routing.resolve(organizationId, COPILOT_TASK_KIND);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return {
          ok: false,
          reason:
            `this workspace has no route for the \`${COPILOT_TASK_KIND}\` task kind. ` +
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
        reason: `the \`${COPILOT_TASK_KIND}\` route did not resolve — ${reason}`,
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
   * **Only while the conversation is open** (CE.2, #566). A reply can outlive its session: a
   * publish or a discard may close it between two operations. Each apply therefore re-reads the
   * session's status inside its own transaction, under the workflow's row lock — the lock both
   * closers hold while they write the session, and the one `apply_draft_batch()` takes next —
   * so no close can commit between the check and the write. A session that is not `active`
   * applies nothing and the port answers `closed`.
   *
   * @param workflow - The workflow.
   * @param session - The session.
   * @param userId - The person in the conversation.
   * @param model - The model the exchange resolved to — a suggestion's provenance.
   * @returns The port the loop applies through.
   */
  private draftPort(
    workflow: Workflow,
    session: CopilotSession,
    userId: string | null,
    model: RoutedModel,
  ): DraftPort {
    return {
      suggest: async (proposal) => {
        const outcome = await this.suggestions.propose(
          workflow.organization_id,
          workflow.id,
          proposal,
          {
            sessionId: session.id,
            alias: model.alias,
            resolutionVersion: model.resolutionVersion,
          },
        );
        return outcome.ok ? { ok: true } : outcome;
      },
      apply: async (operation: DraftOperation, expectedEtag: string) =>
        this.database.transaction(async (trx) => {
          const existing = await this.copilots.draftOf(workflow.id, trx, true);

          // Before the etag: a discard removes the draft, and a reply told only that "the draft
          // changed" would re-plan and write a new one for a conversation that is over.
          const status = await this.copilots.sessionStatusLocked(workflow.id, session.id, trx);
          if (status !== "active") return { ok: false as const, closed: true as const };

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
      lookupTickets: async (query, limit) => {
        // Ranked against the draft as it stands now, by the scorer the dry-run menu uses.
        const draft = await this.copilots.draftOf(workflow.id);
        const ranked = await this.picker.rank(workflow.organization_id, draft?.definition ?? null, {
          limit: Math.min(Math.max(1, Math.trunc(limit)), MAX_TICKET_CANDIDATES),
          query,
        });

        return ranked.map((candidate) => ({
          key: candidate.ticket.key,
          title: candidate.ticket.title,
          labels: candidate.ticket.labels,
          reason: candidate.reason,
        }));
      },
    };
  }

  /**
   * The draft as the conversation shows it, with who each stage is by.
   *
   * @param workflow - The workflow row.
   * @param catalogue - The names that exist, for the warnings.
   * @returns The resource.
   */
  private async draftResource(
    workflow: Workflow,
    catalogue: DslCatalogue,
  ): Promise<CopilotDraftResource> {
    const [draft, provenance] = await Promise.all([
      this.copilots.draftOf(workflow.id),
      this.copilots.nodeProvenance(workflow.id),
    ]);
    const definition = draft?.definition ?? null;
    return {
      etag: draftEtag(draft),
      label: draftLabel(workflow),
      definition,
      provenanceSummary: workflow.provenance_summary,
      warnings: unresolvedReferences(definition, catalogue).map(copilotWarning),
      nodeProvenance: copilotNodeProvenance(definition, provenance),
    };
  }

  /**
   * The session a read is about: the active one, else the one closed last.
   *
   * @param organizationId - The workspace.
   * @param workflowId - The workflow.
   * @returns The session, or `undefined` when the workflow never had one.
   */
  private async latestSession(
    organizationId: string,
    workflowId: string,
  ): Promise<CopilotSession | undefined> {
    return (
      (await this.copilots.activeSession(organizationId, workflowId)) ??
      (await this.copilots.lastClosedSession(organizationId, workflowId))
    );
  }

  private async requireWorkflow(organizationId: string, workflowId: string): Promise<Workflow> {
    const workflow = await this.copilots.workflow(organizationId, workflowId);
    if (workflow === undefined) throw workflowNotFound(workflowId);
    return workflow;
  }
}

/**
 * What an unrouted reply says.
 *
 * @param reason - Why the `copilot-workflow` kind did not resolve, as `route()` gives it.
 * @returns The reply's sentence.
 */
export function unroutedMessage(reason: string): string {
  return `${UNROUTED_PREFIX}${reason}`;
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
