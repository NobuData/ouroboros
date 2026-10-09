/**
 * The loop — one exchange of the conversation, from the person's message to the reply's last
 * token, with every tool executed where the data lives.
 *
 * The engine runs a *turn* (`POST /v0/copilot-workflow`: context in, reply text and structured
 * tool calls out); this module runs the *exchange*: it sends a turn, acts on each tool call in the
 * order the model made it, and sends the next turn with the results until the model stops calling
 * tools, asks the person something, or runs out of budget. Everything #559 names as REST-side is
 * here or behind the two ports it takes:
 *
 * * **Validation before application.** A typed operation is checked against the DSL
 *   (`copilot.operations.ts`) and applied through {@link DraftPort.apply} — under the draft's
 *   etag (WF-P.3, #134) with `copilot` provenance (CC.2, #556) — before the next event is
 *   emitted. An operation that does not validate is **bounced**: recorded on the trace with the
 *   validator's message, sent back to the model as a failed tool result, and counted against a
 *   bounded budget ({@link MAX_BOUNCES}). Exhausting it ends the exchange with a sentence in the
 *   reply saying so, never by dropping the intent silently.
 * * **Questions are first-class.** `ask_user` becomes a chip row on the reply and ends the
 *   exchange; the answer re-enters as the next user turn.
 * * **The draft is shared.** A canvas edit mid-conversation moves the etag; the apply port
 *   reports the conflict, the loop adopts the current draft, tells the model to re-plan from it,
 *   and tells the person what happened — no human edit is overwritten.
 * * **Invented references are named** (decision W7). Every applied operation is read for
 *   references the catalogue does not list; the model is told, and if the reply's own prose does
 *   not name them, the loop appends the sentence that does.
 * * **Cost is per exchange** and honest: tokens summed over every usage event, cost `null` when
 *   any of it was unpriced.
 *
 * Written as an async generator so the events reach the browser as they happen; the generator's
 * *return value* is what the service records.
 */

import { UpstreamError } from "../errors/error.envelope";
import type {
  EngineCopilotContext,
  EngineCopilotEvent,
  EngineCopilotTurnRequest,
  EngineToolCall,
  EngineTranscriptEntry,
} from "../engine/engine.copilot";
import type { CopilotChoice, CopilotToolTrace, CopilotTraceOperation } from "../db/schema";
import type { DslCatalogue } from "../workflows/dsl.references";
import { isKnownGuard } from "./copilot.guards";
import {
  GUARD_KIND,
  checkOperation,
  operationFromCall,
  type DraftOperation,
  type ProposedOperation,
} from "./copilot.operations";
import {
  introducedReferences,
  mentionsAll,
  unresolvedReferences,
  unresolvedSentence,
  type UnresolvedReference,
} from "./copilot.references";
import { copilotWarning } from "./copilot.resources";
import type { CopilotExchangeEvent } from "./copilot.stream";

/** How many bounces one exchange may absorb before it stops and says so. */
export const MAX_BOUNCES = 4;

/** How many model turns one exchange may take. */
export const MAX_TURNS = 8;

/** The tools that are not operations, by the engine's manifest names. */
export const ASK_USER = "ask_user";
export const READ_DRAFT = "read_draft";
export const READ_CATALOG = "read_catalog";
export const READ_SKILLS = "read_skills";
export const LOOKUP_TICKETS = "lookup_tickets";
export const PROPOSE_DRY_RUN = "propose_dry_run";

/** The draft as the loop holds it between operations. */
export interface DraftState {
  readonly document: unknown;
  readonly etag: string;
  /** `v0.3`. */
  readonly label: string;
}

/** The apply port's answer. */
export type ApplyResult =
  | { readonly ok: true; readonly draftRev: number; readonly draft: DraftState }
  | {
      readonly ok: false;
      /** The draft as it is now — what the etag no longer matched. */
      readonly draft: DraftState;
      /** Which editor moved it, when the row says. */
      readonly editedIn: string | null;
    };

/** What the loop needs of the draft and the workspace. */
export interface DraftPort {
  /**
   * Apply one operation as the copilot, if the draft is still the one the loop read.
   *
   * @param operation - The operation, validated.
   * @param expectedEtag - The etag the loop holds.
   * @returns Applied with the new revision, or the conflict with the current draft.
   */
  apply(operation: DraftOperation, expectedEtag: string): Promise<ApplyResult>;
  /**
   * Open tickets for a dry-run proposal.
   *
   * @param query - What the model asked for.
   * @param limit - How many.
   * @returns The candidates.
   */
  lookupTickets(
    query: string,
    limit: number,
  ): Promise<readonly { key: string; title: string; labels: readonly string[] }[]>;
}

/** What the loop needs of the engine. */
export interface TurnPort {
  /**
   * One model turn.
   *
   * @param request - The turn.
   * @returns Its events, as they stream.
   */
  copilotTurn(request: EngineCopilotTurnRequest): AsyncIterable<EngineCopilotEvent>;
}

/** One exchange's inputs. */
export interface ExchangeInput {
  readonly session: string;
  readonly alias: string;
  readonly resolutionVersion: string | null;
  readonly costCapCents: number | null;
  /** The grounding, minus the draft the loop fills in per turn. */
  readonly context: Omit<EngineCopilotContext, "draft" | "draftLabel">;
  /** The names that exist, for W7. */
  readonly catalogue: DslCatalogue;
  /** The conversation so far, ending in the person's new message. */
  readonly history: readonly EngineTranscriptEntry[];
  readonly draft: DraftState;
}

/** What one exchange produced — the reply's record. */
export interface ExchangeOutcome {
  readonly body: string;
  readonly choices: readonly CopilotChoice[] | null;
  readonly trace: CopilotToolTrace;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly costCents: number | null;
  readonly status: "complete" | "interrupted";
  /** The failure that interrupted it, when one did. */
  readonly failure: { readonly code: string; readonly message: string } | null;
  readonly draft: DraftState;
  /** Every reference the exchange introduced that does not resolve. */
  readonly introduced: readonly UnresolvedReference[];
}

/**
 * Run one exchange.
 *
 * @param input - The exchange.
 * @param turns - The engine.
 * @param drafts - The draft and the workspace.
 * @yields Each event, in order.
 * @returns The reply's record.
 */
export async function* runExchange(
  input: ExchangeInput,
  turns: TurnPort,
  drafts: DraftPort,
): AsyncGenerator<CopilotExchangeEvent, ExchangeOutcome> {
  const transcript: EngineTranscriptEntry[] = [...input.history];
  const trace: {
    operations: CopilotTraceOperation[];
    reads: { tool: string; [key: string]: unknown }[];
    dry_run_proposals: { ticket: string; reason: string }[];
  } = {
    operations: [],
    reads: [],
    dry_run_proposals: [],
  };
  const choices: CopilotChoice[] = [];
  const introduced: UnresolvedReference[] = [];
  const usage = { metered: false, unpriced: false, tokensIn: 0, tokensOut: 0, costCents: 0 };

  let body = "";
  let draft = input.draft;
  let bounces = 0;
  let lastBounce = "";
  let failure: ExchangeOutcome["failure"] = null;
  let finished = false;

  for (let turn = 1; turn <= MAX_TURNS && !finished; turn += 1) {
    const calls: Extract<EngineCopilotEvent, { kind: "tool_call" }>[] = [];
    let text = "";

    try {
      for await (const event of turns.copilotTurn({
        alias: input.alias,
        session: input.session,
        resolutionVersion: input.resolutionVersion,
        costCapCents: input.costCapCents,
        context: { ...input.context, draft: draft.document, draftLabel: draft.label },
        transcript,
      })) {
        switch (event.kind) {
          case "delta":
            text += event.text;
            body += event.text;
            yield { kind: "delta", text: event.text };
            break;
          case "tool_call":
            calls.push(event);
            break;
          case "usage":
            usage.metered = true;
            usage.tokensIn += event.inputTokens;
            usage.tokensOut += event.outputTokens;
            if (event.costCents === null) usage.unpriced = true;
            else usage.costCents += event.costCents;
            break;
          case "error":
            failure = { code: event.code, message: event.message };
            break;
          case "done":
            break;
        }
      }
    } catch (error) {
      if (error instanceof UpstreamError) {
        failure = { code: error.code, message: error.message };
      } else {
        throw error;
      }
    }

    if (failure !== null) {
      const sentence = `I could not finish this reply: ${failure.message}`;
      body = appendLine(body, sentence);
      yield { kind: "delta", text: sentence };
      break;
    }

    transcript.push({ role: "copilot", text, toolCalls: calls.map(recordedCall) });

    if (calls.length === 0) {
      finished = true;
      break;
    }

    const results: EngineTranscriptEntry[] = [];
    let asked = false;

    for (const call of calls) {
      const result = (content: string, ok = true): void => {
        results.push({ role: "tool", callId: call.id, ok, content });
      };

      if (call.error !== null || call.arguments === null) {
        const message = call.error ?? "the call carried no arguments";
        if (operationFromCall(call.tool, {}) !== undefined || call.tool === GUARD_KIND) {
          trace.operations.push({
            op: { kind: call.tool, params: {} },
            outcome: "bounced",
            validator_message: message,
          });
          yield operationEvent({ kind: call.tool, params: {} }, "bounced", message);
        }
        bounces += 1;
        lastBounce = message;
        result(message, false);
        continue;
      }

      const proposed = operationFromCall(call.tool, call.arguments);
      if (proposed !== undefined) {
        const check = checkOperation(draft.document, proposed, input.catalogue);
        if (!check.ok) {
          trace.operations.push({
            op: proposed,
            outcome: "bounced",
            validator_message: check.message,
          });
          yield operationEvent(proposed, "bounced", check.message);
          bounces += 1;
          lastBounce = check.message;
          result(check.message, false);
          continue;
        }

        const applied = await drafts.apply(check.operation, draft.etag);
        if (!applied.ok) {
          draft = applied.draft;
          const editor =
            applied.editedIn === null ? "another editor" : `the ${applied.editedIn} editor`;
          const note = `Someone changed the draft in ${editor} while we were talking; I re-read it (${draft.label}) before continuing.`;
          yield { kind: "conflict", message: note, etag: draft.etag };
          body = appendLine(body, note);
          yield { kind: "delta", text: note };
          result(
            `the draft changed while you were working (it is now ${draft.label}) — your operation was not applied. ` +
              `Re-plan from the current draft: ${JSON.stringify(draft.document ?? null)}`,
            false,
          );
          continue;
        }

        const before = unresolvedReferences(draft.document, input.catalogue);
        const after = unresolvedReferences(applied.draft.document, input.catalogue);
        const fresh = introducedReferences(before, after);
        introduced.push(...fresh);
        draft = applied.draft;

        trace.operations.push({ op: check.operation, outcome: "applied" });
        yield {
          kind: "operation",
          op: check.operation,
          outcome: "applied",
          validatorMessage: null,
          draftRev: applied.draftRev,
          etag: draft.etag,
          warnings: fresh.map(copilotWarning),
        };

        const notes = [`applied — the draft is now ${draft.label}.`];
        if (!check.documentValid) {
          notes.push(
            `The draft as a whole does not validate yet: ${check.documentErrors.map((error) => error.message).join(" ")}`,
          );
        }
        if (fresh.length > 0) {
          notes.push(
            "Unresolved references you introduced (tell the user these do not exist yet): " +
              fresh.map((reference) => reference.message).join(" "),
          );
        }
        result(notes.join(" "));
        continue;
      }

      switch (call.tool) {
        case GUARD_KIND: {
          const name = argumentText(call.arguments.guard);
          if (!isKnownGuard(name)) {
            const known = input.context.guards.map((guard) => guard.name).join(", ");
            const message = `no guard named "${name}" — this workspace honours: ${known}.`;
            trace.operations.push({
              op: { kind: GUARD_KIND, params: call.arguments },
              outcome: "bounced",
              validator_message: message,
            });
            yield operationEvent({ kind: GUARD_KIND, params: call.arguments }, "bounced", message);
            bounces += 1;
            lastBounce = message;
            result(message, false);
            break;
          }
          trace.operations.push({
            op: { kind: GUARD_KIND, params: call.arguments },
            outcome: "proposed",
          });
          yield operationEvent({ kind: GUARD_KIND, params: call.arguments }, "proposed", null);
          result(
            `recorded as a proposal. The workflow language has no guard construct yet, so ${name} is proposed, not enforced — say so to the user.`,
          );
          break;
        }
        case ASK_USER: {
          const prompt = argumentText(call.arguments.prompt);
          const options = Array.isArray(call.arguments.options)
            ? call.arguments.options.map(String)
            : [];
          const index = choices.push({ prompt, options, selected: null, answered_at: null }) - 1;
          yield { kind: "question", index, prompt, options };
          asked = true;
          result(
            "asked — the user's choice will arrive as their next message. Stop and wait for it.",
          );
          break;
        }
        case READ_DRAFT:
          trace.reads.push({ tool: "draft" });
          yield { kind: "read", tool: "draft" };
          result(`${draft.label}: ${JSON.stringify(draft.document ?? null)}`);
          break;
        case READ_CATALOG:
          trace.reads.push({ tool: "catalog" });
          yield { kind: "read", tool: "catalog" };
          result(JSON.stringify(input.context.catalog));
          break;
        case READ_SKILLS:
          trace.reads.push({ tool: "skills" });
          yield { kind: "read", tool: "skills" };
          result(JSON.stringify(input.context.skills));
          break;
        case LOOKUP_TICKETS: {
          const query = argumentText(call.arguments.query);
          const limit = Number(call.arguments.limit ?? 5);
          trace.reads.push({ tool: "tickets", query });
          yield { kind: "read", tool: "tickets" };
          const tickets = await drafts.lookupTickets(query, Number.isFinite(limit) ? limit : 5);
          result(
            tickets.length === 0
              ? "no open tickets match."
              : JSON.stringify(tickets) + " (newest first; not ranked for edge cases)",
          );
          break;
        }
        case PROPOSE_DRY_RUN: {
          const ticket = argumentText(call.arguments.ticket);
          const reason = argumentText(call.arguments.reason);
          trace.dry_run_proposals.push({ ticket, reason });
          yield { kind: "dry_run_proposal", ticket, reason };
          result("proposal recorded — the user can start the dry run from the conversation.");
          break;
        }
        default: {
          const message = `there is no tool named "${call.tool}".`;
          bounces += 1;
          lastBounce = message;
          result(message, false);
        }
      }
    }

    transcript.push(...results);

    if (asked) {
      finished = true;
      break;
    }

    if (bounces > MAX_BOUNCES) {
      const sentence =
        `I could not produce a valid change after ${bounces} attempts, so I have stopped here. ` +
        `The last validation message was: ${lastBounce}`;
      body = appendLine(body, sentence);
      yield { kind: "delta", text: sentence };
      finished = true;
      break;
    }

    if (turn === MAX_TURNS) {
      const sentence = `I stopped after ${MAX_TURNS} rounds of changes without finishing; the draft is ${draft.label} — tell me how to continue.`;
      body = appendLine(body, sentence);
      yield { kind: "delta", text: sentence };
    }
  }

  if (failure === null && introduced.length > 0 && !mentionsAll(body, introduced)) {
    const sentence = unresolvedSentence(introduced);
    body = appendLine(body, sentence);
    yield { kind: "delta", text: sentence };
  }

  if (failure === null && body.trim() === "") {
    const applied = trace.operations.filter((entry) => entry.outcome === "applied").length;
    body =
      applied === 0
        ? "Nothing to change."
        : `Applied ${applied} ${applied === 1 ? "change" : "changes"}; the draft is ${draft.label}.`;
    yield { kind: "delta", text: body };
  }

  return {
    body,
    choices: choices.length === 0 ? null : choices,
    trace,
    tokensIn: usage.metered ? usage.tokensIn : null,
    tokensOut: usage.metered ? usage.tokensOut : null,
    costCents: usage.metered && !usage.unpriced ? Math.round(usage.costCents) : null,
    status: failure === null ? "complete" : "interrupted",
    failure,
    draft,
    introduced,
  };
}

/**
 * A call as the transcript records it — arguments kept, or empty for one that did not validate.
 *
 * @param call - The event.
 * @returns The record.
 */
function recordedCall(call: Extract<EngineCopilotEvent, { kind: "tool_call" }>): EngineToolCall {
  return { id: call.id, tool: call.tool, arguments: call.arguments ?? {} };
}

function operationEvent(
  op: ProposedOperation,
  outcome: "bounced" | "proposed",
  validatorMessage: string | null,
): CopilotExchangeEvent {
  return {
    kind: "operation",
    op,
    outcome,
    validatorMessage,
    draftRev: null,
    etag: null,
    warnings: [],
  };
}

/**
 * A string argument, or empty for anything else — the engine validated the shape, so a
 * non-string here is a contract break rather than a value to stringify.
 *
 * @param value - The argument.
 * @returns The string, or `""`.
 */
function argumentText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * A sentence on its own line at the end of the reply.
 *
 * @param body - The reply so far.
 * @param sentence - What to add.
 * @returns The reply with the sentence appended.
 */
function appendLine(body: string, sentence: string): string {
  if (body === "") return sentence;
  return body.endsWith("\n") ? `${body}${sentence}` : `${body}\n${sentence}`;
}
