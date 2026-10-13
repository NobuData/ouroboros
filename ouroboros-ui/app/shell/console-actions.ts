"use server";

/**
 * What the in-app console asks the service (BZ.5,
 * [#539](https://github.com/NobuData/ouroboros/issues/539)): the grammar, the completions for a
 * line being typed, running a line, and reading a command back while its result is on its way.
 * Each answers the payload or `{ error }` rather than throwing — a refusal is something the
 * palette prints where the reply would have been, in the service's own words, and never a box
 * left waiting.
 *
 * Server Actions rather than a route of this origin, for the reason the palette's sign-out is
 * one (`app/shell/actions.ts`): the session's cookies are the server's to forward, and a
 * command is a write made as the person holding them.
 */

import {
  type ConsoleCommandRecord,
  type ConsoleCommandResult,
  type ConsoleCompletions,
  type ConsoleGrammar,
  consoleApi,
} from "@/app/api/console";
import { isApiError } from "@/app/api/errors";

import type { ConsoleAnswer } from "./console";

/**
 * Run a call, turning the service's refusal into an answer.
 *
 * @param call The call.
 * @returns The value, or the refusal. Anything that was not an answer from the service is
 *   rethrown.
 */
async function answerOf<T>(call: () => Promise<T>): Promise<ConsoleAnswer<T>> {
  try {
    return await call();
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { error: error.message, code: error.code };
  }
}

/**
 * Read the grammar, with what the caller may run resolved onto it.
 *
 * @returns The grammar, or the refusal.
 */
export async function readConsoleGrammar(): Promise<ConsoleAnswer<ConsoleGrammar>> {
  return answerOf(() => consoleApi.grammar());
}

/**
 * Read what could be typed next.
 *
 * @param text What follows `/ouro`, as typed up to the caret.
 * @returns The completions, or the refusal.
 */
export async function readConsoleCompletions(
  text: string,
): Promise<ConsoleAnswer<ConsoleCompletions>> {
  return answerOf(() => consoleApi.completions(text));
}

/**
 * Run a line as the signed-in member.
 *
 * @param text What was typed after `/ouro`.
 * @param channelId The bound channel the line was typed under, from the Chat Ops mirror's
 *   composer (#542). Omitted by the palette.
 * @returns What the dispatcher answered — a denial and an unknown command are answers, not
 *   refusals — or the refusal for a line it would not read at all.
 */
export async function runConsoleCommand(
  text: string,
  channelId?: string,
): Promise<ConsoleAnswer<ConsoleCommandResult>> {
  return answerOf(() => consoleApi.run(text, channelId === undefined ? {} : { channelId }));
}

/**
 * Read one of the caller's own commands back.
 *
 * @param id The command.
 * @returns The command as it now stands, or the refusal.
 */
export async function readConsoleCommand(
  id: string,
): Promise<ConsoleAnswer<ConsoleCommandRecord>> {
  return answerOf(() => consoleApi.command(id));
}
