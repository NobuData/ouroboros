/**
 * What the chat routes answer with (BZ.5, [#539](https://github.com/NobuData/ouroboros/issues/539))
 * — the console's half of the `/ouro` contract.
 *
 * ```
 * GET  /chat/grammar         the reference, and for each command whether *this caller* may run it
 * POST /chat/commands        how a command went and what it said — the dispatcher's own result
 * GET  /chat/commands/{id}   the caller's own console command, for an async result
 * ```
 *
 * **The caller's view is laid over the reference, never written into it.** `chat-grammar.json`
 * and `renderReference()` are the grammar for everybody — what the docs print; `allowed` and
 * `deniedReason` are one member's, computed per request with the dispatcher's own
 * {@link permitted}, so the list cannot promise what a dispatch would refuse.
 */

import type { ChatCommandOutcome } from "../db/schema";
import { CHAT_REPLIES, deniedReason } from "./chatops.replies";
import type { OwnConsoleCommand, SettledReply } from "./chatops.repository";
import { settledReply } from "./chatops.repository";
import { permitted } from "./dispatcher.service";
import { renderReference, type GrammarReference, type ReferenceCommand } from "./grammar.help";
import type { CommandReply, DispatchResult, Grammar, Invoker } from "./grammar.types";

/** One command of the reference, as the caller stands to it. */
export interface CallerCommand extends ReferenceCommand {
  /**
   * Whether a dispatch by this caller would get past the permission check. A `v2` command is
   * allowed for everybody: it runs nothing, so there is nothing to deny.
   */
  readonly allowed: boolean;
  /** What is missing, when not allowed — `for workspace owners and admins`; else null. */
  readonly deniedReason: string | null;
}

/** `GET /api/v1/chat/grammar`'s answer. */
export interface CallerGrammarResource extends Omit<GrammarReference, "commands"> {
  readonly commands: readonly CallerCommand[];
}

/** Who is asking for the grammar: a member, or nobody in particular (a service account). */
export type GrammarCaller = Pick<Invoker, "roles" | "canApproveLoops"> | null;

/**
 * The reference with the caller's standing on each command.
 *
 * @param grammar - The grammar.
 * @param caller - The member asking, or `null` for a caller who is not a person — who can run
 *   nothing, since a command acts as somebody.
 * @returns The reference, each command with `allowed` and `deniedReason`.
 */
export function callerGrammar(grammar: Grammar, caller: GrammarCaller): CallerGrammarResource {
  const reference = renderReference(grammar);

  return {
    ...reference,
    commands: reference.commands.map((command, index) => {
      const definition = grammar.commands[index];

      if (caller === null) {
        return { ...command, allowed: false, deniedReason: CHAT_REPLIES.notAPerson };
      }

      // The dispatcher answers a v2 command before it asks who may: so does this.
      const allowed = definition.stage === "v2" || permitted(definition, caller);

      return { ...command, allowed, deniedReason: allowed ? null : deniedReason(definition) };
    }),
  };
}

/** `POST /api/v1/chat/commands`'s answer. */
export interface ChatCommandResultResource {
  /** The `chat_commands` row; null for `help`, which records nothing, or when recording failed. */
  readonly commandId: string | null;
  /** The grammar command the text named; null for `help` and for text that names none. */
  readonly command: string | null;
  /** How it went. `unlinked` is Slack's alone and never answered here. */
  readonly outcome: DispatchResult["outcome"];
  readonly reply: SettledReply;
  /** Only on a destructive command's preview: the text to send to really do it. */
  readonly confirmWith?: string;
}

/**
 * A reply as the wire carries it — its text, and its link only when it has one.
 *
 * @param reply - The dispatcher's reply.
 * @returns The same reply with no other key.
 */
export function toReply(reply: CommandReply): SettledReply {
  return settledReply(reply);
}

/**
 * A dispatch result as the route answers it.
 *
 * @param result - What the dispatcher handed back.
 * @returns The resource; `confirmWith` is absent unless the dispatcher set it.
 */
export function toCommandResult(result: DispatchResult): ChatCommandResultResource {
  return {
    commandId: result.commandId,
    command: result.command,
    outcome: result.outcome,
    reply: toReply(result.reply),
    ...(result.confirmWith === undefined ? {} : { confirmWith: result.confirmWith }),
  };
}

/** `GET /api/v1/chat/commands/{id}`'s answer. */
export interface ChatCommandResource {
  readonly id: string;
  /** What `chat_commands.command` holds: the command's id, or the first word of text that named none. */
  readonly command: string;
  readonly outcome: ChatCommandOutcome;
  /** The text as typed, with its `/ouro` prefix. */
  readonly rawText: string;
  readonly invokedAt: string;
  /** Null exactly while `outcome` is `async_pending`. */
  readonly completedAt: string | null;
  /** What an async command said when it finished; null while pending and for a command that answered at once. */
  readonly settledReply: SettledReply | null;
  /** The stable reason of an `error` outcome — `bad_arguments`, a plane's code; else null. */
  readonly errorDetail: string | null;
}

/**
 * A console command's row as the route answers it.
 *
 * @param row - The row.
 * @returns The resource.
 */
export function toCommand(row: OwnConsoleCommand): ChatCommandResource {
  return {
    id: row.id,
    command: row.command,
    outcome: row.outcome,
    rawText: row.raw_text,
    invokedAt: row.invoked_at.toISOString(),
    completedAt: row.completed_at === null ? null : row.completed_at.toISOString(),
    settledReply: row.settled_reply === null ? null : settledReply(row.settled_reply),
    errorDetail: row.error_detail,
  };
}
