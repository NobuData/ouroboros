import "server-only";

/**
 * The `/ouro` command plane, as the in-app console calls it (BZ.5,
 * [#539](https://github.com/NobuData/ouroboros/issues/539)) — one surface's calls to one tag,
 * kept together the way `app/api/chatops.ts` keeps the Slack plane's.
 *
 * Four operations: the **grammar** (BZ.3, [#537](https://github.com/NobuData/ouroboros/issues/537))
 * with what the caller may run resolved onto it, the **completions** for a line being typed,
 * **running** a line through the same dispatcher Slack's adapter calls, and reading one of the
 * caller's own **commands** back while its result is still on its way.
 *
 * ### The workspace and the person are the session's
 * No call names either. A command runs as the signed-in member in the session's workspace,
 * which is the whole of the console's difference from Slack: there is no linking step because
 * the session already *is* the member.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/* ------------------------------------------------------------- generated */

/** One command of the grammar, as the contract in `schema.d.ts` describes it. */
type GrammarCommand = components["schemas"]["ChatGrammarCommand"];

/** The grammar, as the contract in `schema.d.ts` describes it. */
type Grammar = components["schemas"]["ChatGrammar"];

/** What could be typed next, as the contract in `schema.d.ts` describes it. */
type Completions = components["schemas"]["ChatCompletions"];

/** One thing that could be typed next: what to insert, and what to show beside it. */
export type ConsoleCompletion = Completions["completions"][number];

/** One argument of a command, in the order it is typed. */
export type ConsoleArgument = GrammarCommand["arguments"][number];

/** The vocabulary that completes an argument — `tickets`, `loops`, … */
export type ConsoleCompletionSource = NonNullable<ConsoleArgument["completion"]>;

/** A word that is not a command of the grammar — `help`. */
export type ConsoleBuiltin = Grammar["builtins"][number];

/** What could be typed next — `openapi.yaml` § `ChatCompletions`. */
export type ConsoleCompletions = Completions;

/** One command, with what the caller may do with it resolved (`allowed`, `deniedReason`). */
export type ConsoleCommand = GrammarCommand;

/** The grammar, each command carrying what the caller may do with it. */
export type ConsoleGrammar = Grammar;

/** What `POST /chat/commands` is sent — `openapi.yaml` § `ChatCommandRequest`. */
export type ConsoleCommandRequest = components["schemas"]["ChatCommandRequest"];

/**
 * What `POST /chat/commands` answers — for anything typed, including a line that names no
 * command at all, which is an `error` outcome rather than a failed request.
 */
export type ConsoleCommandResult = components["schemas"]["ChatCommandResult"];

/** How a command came out. `async_pending` acknowledges; the result follows on its own. */
export type ConsoleOutcome = ConsoleCommandResult["outcome"];

/** What a command says back — `openapi.yaml` § `ChatCommandReply`. */
export type ConsoleReply = components["schemas"]["ChatCommandReply"];

/** Somewhere a reply points: the loop it started, the ticket it queued. */
export type ConsoleLink = NonNullable<ConsoleReply["link"]>;

/** One of the caller's own console commands, as `GET /chat/commands/{id}` answers. */
export type ConsoleCommandRecord = components["schemas"]["ChatCommand"];

/** Where a line is run from, when that is somewhere in particular. */
export interface ConsoleRunOptions {
  /** The bound channel whose mirror the line was typed under. */
  readonly channelId?: string;
}

/* ----------------------------------------------------------------- calls */

/** The `/ouro` grammar and its dispatcher, as `ouroboros-rest` serves them. */
export const consoleApi = {
  /**
   * The grammar, with what the caller may run resolved onto each command.
   *
   * @param client The client to call through. Defaults to the server-side one.
   * @param signal Aborts the read.
   * @returns The grammar.
   * @throws {ApiError} What the service answered.
   */
  async grammar(client: ApiClient = api(), signal?: AbortSignal): Promise<ConsoleGrammar> {
    return unwrap(await client.GET("/api/v1/chat/grammar", { signal }));
  },

  /**
   * What could be typed next.
   *
   * @param text What follows `/ouro`, as typed — a trailing space says the last word is finished.
   * @param client The client to call through.
   * @param signal Aborts the read.
   * @returns The completions, with the command and the argument they are for. An empty list
   *   still names the argument, so the console can say that nothing matches it.
   * @throws {ApiError} What the service answered.
   */
  async completions(
    text: string,
    client: ApiClient = api(),
    signal?: AbortSignal,
  ): Promise<ConsoleCompletions> {
    return unwrap(
      await client.GET("/api/v1/chat/completions", { params: { query: { text } }, signal }),
    );
  },

  /**
   * Run a line through the dispatcher, as the session's member.
   *
   * @param text What was typed after `/ouro`.
   * @param options.channelId The bound channel the line was typed under — the Chat Ops mirror's
   *   composer (CA.2, [#542](https://github.com/NobuData/ouroboros/issues/542)) — so the command
   *   is recorded against it and shows in that channel's mirror. Omitted by the palette, whose
   *   commands belong to no channel.
   * @param client The client to call through.
   * @returns What the dispatcher answered — for anything typed, a refusal and an unknown
   *   command included.
   * @throws {ApiError} `422 validation_failed` for an empty line or one over 2000 characters;
   *   `404 chat_channel_not_found` for a channel that is not a bound one of this workspace;
   *   `403` for a caller that is not a person.
   */
  async run(
    text: string,
    options: ConsoleRunOptions = {},
    client: ApiClient = api(),
  ): Promise<ConsoleCommandResult> {
    const body: ConsoleCommandRequest =
      options.channelId === undefined ? { text } : { text, channelId: options.channelId };

    return unwrap(await client.POST("/api/v1/chat/commands", { body }));
  },

  /**
   * One of the caller's own console commands — read while its result is still on its way.
   *
   * @param id The command, as `run` named it.
   * @param client The client to call through.
   * @param signal Aborts the read.
   * @returns The command as it now stands.
   * @throws {ApiError} `404 chat_command_not_found` for a command that is not the caller's.
   */
  async command(
    id: string,
    client: ApiClient = api(),
    signal?: AbortSignal,
  ): Promise<ConsoleCommandRecord> {
    return unwrap(
      await client.GET("/api/v1/chat/commands/{id}", {
        params: { path: { id } },
        signal,
      }),
    );
  },
};
