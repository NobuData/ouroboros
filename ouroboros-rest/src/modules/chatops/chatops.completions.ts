/**
 * Completion hints for a command being typed (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)) — mockup 19's *"Tab-completion
 * everywhere"*.
 *
 * ```
 * "pau"            → commands that start that way          pause loop · pause all
 * "queue "         → the first argument's vocabulary       open issues
 * "queue #485 st"  → the second's, narrowed                standard-fix
 * "status "        → nothing left to type                  []
 * ```
 *
 * The text is read exactly as the dispatcher reads it — the same tokens, the same longest-name
 * match (`grammar.parser.ts`) — so what is offered is what would be accepted. The vocabulary
 * itself belongs to the planes: this file decides only *which* argument is being typed, and asks
 * the {@link CompletionSources} port for that argument's source. An argument with no source
 * answers an empty list, honestly.
 *
 * Nothing here resolves or validates what was already typed: completion must stay cheap and must
 * work while the line is still wrong.
 */

import { CONFIRM_WORD, matchCommand, tokenize } from "./grammar.parser";
import type { Completion, CompletionSources } from "./grammar.ports";
import { BUILTINS } from "./grammar.registry";
import type { ArgumentSpec, CommandDefinition, Grammar, Invoker } from "./grammar.types";

/** The most completions an argument is offered. Commands are never cut: there are few. */
export const COMPLETION_LIMIT = 10;

/** `GET /api/v1/chat/completions`'s answer. */
export interface ChatCompletionsResource {
  /** The grammar the completions were read from. */
  readonly grammarVersion: number;
  /** The command the text names, once it names one; null while the command is being typed. */
  readonly command: string | null;
  /** The argument being typed; null while the command is, or when nothing is left to type. */
  readonly argument: string | null;
  readonly completions: readonly Completion[];
}

/** Where in a command the cursor is. */
export type CompletionPosition =
  /** Still typing the command's name. */
  | { readonly at: "command"; readonly typed: string }
  /** Typing an argument. */
  | {
      readonly at: "argument";
      readonly definition: CommandDefinition;
      readonly argument: ArgumentSpec;
      readonly prefix: string;
      /** The raw text of the arguments before it, by name. */
      readonly previous: Readonly<Record<string, string>>;
    }
  /** Past the command's last argument. */
  | { readonly at: "end"; readonly definition: CommandDefinition };

/**
 * Work out what is being typed.
 *
 * The last token is *being typed* unless the text ends in whitespace; everything before it is
 * settled. The command is named once the settled tokens begin with a command's name.
 *
 * @param grammar - The grammar.
 * @param text - What has been typed after `/ouro`.
 * @returns The position.
 */
export function positionOf(grammar: Grammar, text: string): CompletionPosition {
  const tokens = tokenize(text);
  const open = text !== "" && !/\s$/.test(text);
  const settled = open ? tokens.slice(0, -1) : tokens;
  const prefix = open ? (tokens[tokens.length - 1] ?? "") : "";
  const match = matchCommand(grammar, settled);

  if (match === undefined) {
    return { at: "command", typed: [...settled, prefix].join(" ").trim().toLowerCase() };
  }

  const argument = match.definition.arguments[match.rest.length];

  if (argument === undefined) {
    return { at: "end", definition: match.definition };
  }

  return {
    at: "argument",
    definition: match.definition,
    argument,
    prefix,
    previous: Object.fromEntries(
      match.rest.map((raw, index) => [match.definition.arguments[index]?.name ?? "", raw]),
    ),
  };
}

/**
 * The commands whose name starts with what was typed.
 *
 * @param grammar - The grammar.
 * @param typed - The name so far, lower-cased; may be empty.
 * @returns Every match, in the registry's order, then `help`.
 */
export function commandCompletions(grammar: Grammar, typed: string): Completion[] {
  const commands = grammar.commands.flatMap((command) => {
    const name = [command.id, ...command.aliases].find((candidate) => candidate.startsWith(typed));

    return name === undefined
      ? []
      : [
          {
            value: name,
            label: command.stage === "v2" ? `${command.summary} (v2)` : command.summary,
          },
        ];
  });
  // Only the built-ins every surface has: `link` and `unlink` are Slack's own.
  const builtins = BUILTINS.filter(
    (builtin) => builtin.surfaces.includes("console") && builtin.id.startsWith(typed),
  ).map((builtin) => ({ value: builtin.id, label: builtin.summary }));

  return [...commands, ...builtins];
}

/**
 * Complete the text typed so far.
 *
 * @param grammar - The grammar.
 * @param sources - The planes' vocabularies.
 * @param organizationId - The workspace.
 * @param invoker - Who is typing.
 * @param text - What has been typed after `/ouro`.
 * @returns The command and argument being typed, and what could come next.
 */
export async function complete(
  grammar: Grammar,
  sources: CompletionSources,
  organizationId: string,
  invoker: Invoker,
  text: string,
): Promise<ChatCompletionsResource> {
  const position = positionOf(grammar, text);

  if (position.at === "command") {
    return {
      grammarVersion: grammar.version,
      command: null,
      argument: null,
      completions: commandCompletions(grammar, position.typed),
    };
  }

  if (position.at === "end") {
    return {
      grammarVersion: grammar.version,
      command: position.definition.id,
      argument: null,
      completions: [],
    };
  }

  const { argument, definition, prefix, previous } = position;
  let completions: Completion[] = [];

  if (argument.type === "confirm" || argument.type === "keyword") {
    const word = argument.type === "confirm" ? CONFIRM_WORD : (argument.word ?? "");

    completions = word.startsWith(prefix.toLowerCase())
      ? [{ value: word, label: argument.description }]
      : [];
  } else if (argument.completion !== undefined) {
    completions = (
      await sources.complete(
        organizationId,
        invoker,
        argument.completion,
        prefix,
        previous,
        COMPLETION_LIMIT,
      )
    ).slice(0, COMPLETION_LIMIT);
  }

  return {
    grammarVersion: grammar.version,
    command: definition.id,
    argument: argument.name,
    completions,
  };
}
