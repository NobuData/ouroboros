/**
 * Reading what was typed after `/ouro` (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)).
 *
 * ```
 * "pause loop 1847"  ─▶ tokens ─▶ the longest command name the tokens start with ─▶ arguments
 * ```
 *
 * **Deterministic, and the same on every surface.** Tokens are whitespace-separated; nothing is
 * quoted, because no argument holds a space. The command is the *longest* id or alias the tokens
 * begin with, which is what tells `pause loop` from `pause all` and `explain pr` from a future
 * `explain`. Arguments are positional, in the order the registry declares them.
 *
 * **Two kinds of argument are settled here** — a `keyword` must be its word, and `confirm` is the
 * literal `confirm` or nothing. Every other argument names something a plane owns (`#485`, a
 * workflow, `q-231`), so it is handed to the {@link Resolve} port in order, with the arguments
 * before it — an `action` is read against its `question`.
 *
 * **Errors teach.** Each failure names what was wrong and shows the way out: the nearest command
 * names, the syntax line, or the plane's own nearest valid names.
 *
 * Everything but {@link parseArguments} is pure; that one is pure given its resolver.
 */

import { ChatArgumentError } from "./grammar.ports";
import { COMMAND_PREFIX } from "./grammar.registry";
import type { ArgumentSpec, CommandDefinition, Grammar, ResolvedArgument } from "./grammar.types";

/** The word that confirms a destructive command. */
export const CONFIRM_WORD = "confirm";

/** How many alternatives an error offers. */
const SUGGESTION_LIMIT = 3;

/** How much of what somebody typed is repeated back to them. */
const ECHO_LIMIT = 48;

/** Turns one argument's text into the thing it names — the planes' resolver, bound to a workspace. */
export type Resolve = (
  spec: ArgumentSpec,
  raw: string,
  previous: Readonly<Record<string, ResolvedArgument>>,
) => Promise<ResolvedArgument>;

/** A command found at the start of the tokens. */
export interface CommandMatch {
  readonly definition: CommandDefinition;
  /** The tokens after the command's name — its arguments, as typed. */
  readonly rest: readonly string[];
}

/** Why some text was not a runnable command. */
export type ParseFailure =
  | { readonly kind: "unknown_command"; readonly typed: string; readonly suggestions: string[] }
  | {
      readonly kind: "missing_argument";
      readonly definition: CommandDefinition;
      readonly argument: ArgumentSpec;
    }
  | {
      readonly kind: "extra_argument";
      readonly definition: CommandDefinition;
      readonly extra: string;
    }
  | {
      readonly kind: "wrong_keyword";
      readonly definition: CommandDefinition;
      readonly argument: ArgumentSpec;
      readonly typed: string;
    }
  | {
      readonly kind: "bad_argument";
      readonly definition: CommandDefinition;
      readonly argument: string;
      readonly message: string;
      readonly suggestions: readonly string[];
    };

/** A command's arguments, read. */
export type ParsedArguments =
  | {
      readonly ok: true;
      /** By {@link ArgumentSpec.name}; an optional argument not typed is absent. */
      readonly args: Readonly<Record<string, ResolvedArgument>>;
      /** Whether the command's `confirm` argument was typed. Always false without one. */
      readonly confirmed: boolean;
    }
  | { readonly ok: false; readonly failure: ParseFailure };

/**
 * Split what was typed into tokens.
 *
 * @param text - Everything after `/ouro`.
 * @returns The tokens, in order; empty for blank text.
 */
export function tokenize(text: string): string[] {
  return text.split(/\s+/).filter((token) => token !== "");
}

/**
 * The command the tokens begin with — the longest id or alias that matches.
 *
 * @param grammar - The grammar.
 * @param tokens - The tokens, as typed; the name is matched without regard to case.
 * @returns The command and its argument tokens, or `undefined` when no command starts there.
 */
export function matchCommand(
  grammar: Grammar,
  tokens: readonly string[],
): CommandMatch | undefined {
  let best: { definition: CommandDefinition; length: number } | undefined;

  for (const definition of grammar.commands) {
    for (const name of [definition.id, ...definition.aliases]) {
      const words = name.split(" ");

      if (
        words.length <= tokens.length &&
        words.length > (best?.length ?? 0) &&
        words.every((word, index) => tokens[index]?.toLowerCase() === word)
      ) {
        best = { definition, length: words.length };
      }
    }
  }

  return best === undefined
    ? undefined
    : { definition: best.definition, rest: tokens.slice(best.length) };
}

/**
 * The edit distance between two words.
 *
 * @param left - One word.
 * @param right - The other.
 * @returns How many single-character insertions, deletions or substitutions separate them.
 */
export function distance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];

    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        (previous[column] ?? 0) + 1,
        (current[column - 1] ?? 0) + 1,
        (previous[column - 1] ?? 0) + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }

    previous = current;
  }

  return previous[right.length] ?? 0;
}

/**
 * The names nearest to what was typed.
 *
 * A name that starts with the text — `pause` for `pause loop` and `pause all` — is nearest of
 * all; after those, names within a few edits, closest first. A name nothing like the text is not
 * offered: a wrong suggestion is worse than none.
 *
 * @param typed - What was typed.
 * @param candidates - The valid names.
 * @param limit - The most to return.
 * @returns The nearest names, best first; possibly empty.
 */
export function nearest(
  typed: string,
  candidates: readonly string[],
  limit = SUGGESTION_LIMIT,
): string[] {
  const wanted = typed.toLowerCase();

  if (wanted === "") {
    return [];
  }

  return candidates
    .map((candidate, index) => {
      const prefixed = candidate.startsWith(wanted) || wanted.startsWith(candidate);
      const edits = distance(wanted, candidate);

      return { candidate, index, prefixed, edits };
    })
    .filter(({ candidate, prefixed, edits }) => {
      return (
        prefixed || edits <= Math.max(2, Math.floor(Math.min(wanted.length, candidate.length) / 2))
      );
    })
    .sort(
      (a, b) => Number(b.prefixed) - Number(a.prefixed) || a.edits - b.edits || a.index - b.index,
    )
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

/**
 * The failure for text that begins with no command.
 *
 * @param grammar - The grammar.
 * @param tokens - The tokens typed; at least one.
 * @returns An `unknown_command` failure offering the nearest command names.
 */
export function unknownCommand(grammar: Grammar, tokens: readonly string[]): ParseFailure {
  const names = grammar.commands.map((command) => command.id);
  const one = (tokens[0] ?? "").toLowerCase();
  const two = tokens.slice(0, 2).join(" ").toLowerCase();
  // Two words first: `pause lop` is nearer `pause loop` than `pause` alone says.
  const suggestions = [...new Set([...nearest(two, names), ...nearest(one, names)])];

  return {
    kind: "unknown_command",
    typed: one,
    suggestions: suggestions.slice(0, SUGGESTION_LIMIT),
  };
}

/**
 * Read a command's arguments.
 *
 * @param definition - The command.
 * @param tokens - The tokens after its name.
 * @param resolve - The planes' resolver, for every argument that is not a keyword or `confirm`.
 * @returns The arguments by name, or the first thing wrong.
 * @throws Whatever `resolve` throws that is not a {@link ChatArgumentError} — a failure of the
 *   plane, not of what was typed.
 */
export async function parseArguments(
  definition: CommandDefinition,
  tokens: readonly string[],
  resolve: Resolve,
): Promise<ParsedArguments> {
  const args: Record<string, ResolvedArgument> = {};
  let confirmed = false;

  if (tokens.length > definition.arguments.length) {
    return {
      ok: false,
      failure: {
        kind: "extra_argument",
        definition,
        extra: tokens[definition.arguments.length] ?? "",
      },
    };
  }

  for (const [index, argument] of definition.arguments.entries()) {
    const raw = tokens[index];

    if (raw === undefined) {
      if (!argument.optional) {
        return { ok: false, failure: { kind: "missing_argument", definition, argument } };
      }

      continue;
    }

    if (argument.type === "confirm" || argument.type === "keyword") {
      const word = argument.type === "confirm" ? CONFIRM_WORD : (argument.word ?? "");

      if (raw.toLowerCase() !== word) {
        return {
          ok: false,
          failure: { kind: "wrong_keyword", definition, argument, typed: raw },
        };
      }

      if (argument.type === "confirm") {
        confirmed = true;
        args[argument.name] = { type: "confirm" };
      } else {
        args[argument.name] = { type: "keyword", word };
      }

      continue;
    }

    try {
      args[argument.name] = await resolve(argument, raw, { ...args });
    } catch (error) {
      if (error instanceof ChatArgumentError) {
        return {
          ok: false,
          failure: {
            kind: "bad_argument",
            definition,
            argument: error.argument,
            message: error.message,
            suggestions: error.suggestions,
          },
        };
      }

      throw error;
    }
  }

  return { ok: true, args, confirmed };
}

/**
 * A command's syntax line — what each position takes, generated from its arguments.
 *
 * @param definition - The command.
 * @returns `/ouro queue <ticket> [workflow]`; a destructive command ends in `confirm`.
 */
export function syntaxOf(definition: CommandDefinition): string {
  const parts = definition.arguments.map((argument) => {
    if (argument.type === "confirm") {
      return CONFIRM_WORD;
    }

    if (argument.type === "keyword") {
      return argument.word ?? argument.name;
    }

    return argument.optional ? `[${argument.name}]` : `<${argument.name}>`;
  });

  return [COMMAND_PREFIX, definition.id, ...parts].join(" ");
}

/**
 * What somebody typed, safe to say back: bounded, and without the characters a chat platform
 * would read as markup or a mention.
 *
 * @param raw - The text.
 * @returns The text to quote.
 */
export function echo(raw: string): string {
  const plain = raw.replace(/[`<>&\p{Cc}]/gu, "");

  return plain.length > ECHO_LIMIT ? `${plain.slice(0, ECHO_LIMIT)}…` : plain;
}

/**
 * The sentence a parse failure is answered with.
 *
 * @param failure - What was wrong.
 * @returns What to say: the problem, then the way out.
 */
export function failureText(failure: ParseFailure): string {
  switch (failure.kind) {
    case "unknown_command":
      return failure.suggestions.length > 0
        ? `unknown command "${echo(failure.typed)}" — try: ${failure.suggestions.join(", ")}`
        : `unknown command "${echo(failure.typed)}" — \`${COMMAND_PREFIX} help\` lists the commands`;
    case "missing_argument":
      return `\`${COMMAND_PREFIX} ${failure.definition.id}\` needs ${article(failure.argument.name)} — usage: \`${syntaxOf(failure.definition)}\``;
    case "extra_argument":
      return `\`${COMMAND_PREFIX} ${failure.definition.id}\` has nowhere to put "${echo(failure.extra)}" — usage: \`${syntaxOf(failure.definition)}\``;
    case "wrong_keyword": {
      const word =
        failure.argument.type === "confirm" ? CONFIRM_WORD : (failure.argument.word ?? "");

      return `\`${COMMAND_PREFIX} ${failure.definition.id}\` takes the word \`${word}\` where "${echo(failure.typed)}" was typed — usage: \`${syntaxOf(failure.definition)}\``;
    }
    case "bad_argument":
      return argumentErrorText(failure.argument, failure.message, failure.suggestions);
  }
}

/**
 * The sentence for an argument a plane could not read: the plane's own words, the argument
 * named, and the nearest valid names.
 *
 * @param argument - The argument at fault.
 * @param message - The plane's sentence — `unknown workflow "feature-lopp"`.
 * @param suggestions - Valid alternatives, nearest first.
 * @returns `unknown workflow "feature-lopp" — try: standard-fix, feature-loop, hotfix`.
 */
export function argumentErrorText(
  argument: string,
  message: string,
  suggestions: readonly string[],
): string {
  // The plane's sentence usually names the argument itself; when it does not, it is prefixed.
  const named = message.toLowerCase().includes(argument.toLowerCase());
  const said = named ? message : `${argument}: ${message}`;

  return suggestions.length > 0 ? `${said} — try: ${suggestions.join(", ")}` : said;
}

/**
 * A noun with its article.
 *
 * @param noun - `ticket`, `alias`.
 * @returns `a ticket`, `an alias`.
 */
function article(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
}
