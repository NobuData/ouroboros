/**
 * `/ouro help`, and the grammar as a document (BZ.3,
 * [#537](https://github.com/NobuData/ouroboros/issues/537)) — both generated from the registry
 * and from nothing else, so neither can list a command that does not exist or describe one
 * differently from how it runs.
 *
 * ```
 * /ouro help            the commands, one line each; a v2 command is marked
 * /ouro help <command>  its syntax, each argument, who may run it, and the confirm rule
 * renderReference()     the whole grammar as JSON — `chat-grammar.json`, GET /api/v1/chat/grammar
 * ```
 *
 * `chat-grammar.json` is committed and is what the docs site builds the `/ouro` reference page
 * from; `yarn chat-grammar` writes it and `grammar.help.spec.ts` fails when it has drifted.
 *
 * This file and what it imports load without a build (`scripts/chat-grammar.mjs`).
 */

import {
  CONFIRM_WORD,
  failureText,
  matchCommand,
  syntaxOf,
  tokenize,
  unknownCommand,
} from "./grammar.parser";
import { BUILTINS, COMMAND_PREFIX, type BuiltinCommand } from "./grammar.registry";
import type {
  ArgumentType,
  ChatSurface,
  CommandDefinition,
  CommandRequirement,
  CommandStage,
  CompletionSource,
  Grammar,
} from "./grammar.types";

/** How a role is named in a sentence, in the plural. */
const ROLE_WORDS: Readonly<Record<string, string>> = {
  owner: "owners",
  admin: "admins",
  member: "members",
  viewer: "viewers",
};

/** How a capability is named in a sentence. */
const CAPABILITY_WORDS: Readonly<Record<string, string>> = {
  can_approve_loops: "can approve loops",
};

/** What the confirm rule says, wherever it is said. */
const CONFIRM_RULE = `Runs only with \`${CONFIRM_WORD}\` as its last word. Without it nothing happens: the reply describes exactly what would.`;

/**
 * A list in words.
 *
 * @param items - `["owners", "admins", "members"]`.
 * @returns `owners, admins and members`.
 */
function listed(items: readonly string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

/**
 * Who may run a command, in words.
 *
 * @param requires - The requirement.
 * @returns `workspace owners and admins`, `every workspace member`, `members who can approve loops`.
 */
export function requirementWords(requires: CommandRequirement): string {
  const capability =
    requires.capability === undefined
      ? ""
      : ` who ${CAPABILITY_WORDS[requires.capability] ?? requires.capability}`;

  if (requires.roles.length === 0) {
    return capability === "" ? "every workspace member" : `workspace members${capability}`;
  }

  return `workspace ${listed(requires.roles.map((role) => ROLE_WORDS[role] ?? role))}${capability}`;
}

/**
 * What a command not yet available is marked with.
 *
 * @param definition - The command.
 * @returns ` (v2 — not available yet)`, or nothing.
 */
function stageMark(definition: CommandDefinition): string {
  return definition.stage === "v2" ? " (v2 — not available yet)" : "";
}

/**
 * `/ouro help` — every command, one line each.
 *
 * @param grammar - The grammar.
 * @param surface - Where it was asked; a built-in is listed only where it exists.
 * @returns The list.
 */
export function helpText(grammar: Grammar, surface: ChatSurface): string {
  const commands = grammar.commands.map(
    (command) => `\`${syntaxOf(command)}\` — ${command.summary}${stageMark(command)}`,
  );
  const builtins = BUILTINS.filter((builtin) => builtin.surfaces.includes(surface)).map(
    (builtin) => `\`${COMMAND_PREFIX} ${builtin.usage}\` — ${builtin.summary}`,
  );

  return [
    `Ouroboros commands (grammar v${String(grammar.version)}):`,
    ...commands,
    ...builtins,
  ].join("\n");
}

/**
 * `/ouro help <command>` — one command in detail.
 *
 * @param definition - The command.
 * @returns Its syntax, each argument, who may run it, and the confirm rule when it has one.
 */
export function commandHelpText(definition: CommandDefinition): string {
  const lines = [`\`${syntaxOf(definition)}\` — ${definition.summary}${stageMark(definition)}`];

  for (const argument of definition.arguments) {
    const optional = argument.optional && argument.type !== "confirm" ? " (optional)" : "";

    lines.push(`• ${argument.name}${optional} — ${argument.description}`);
  }

  lines.push(`Who: ${requirementWords(definition.requires)}.`);

  if (definition.destructive) {
    lines.push(`Confirm: ${CONFIRM_RULE}`);
  }

  if (definition.mode === "async") {
    lines.push(
      "Takes a while: the first reply says it started, and the result follows as its own message.",
    );
  }

  if (definition.unavailableReply !== undefined) {
    lines.push(definition.unavailableReply);
  } else {
    lines.push(`Example: \`${COMMAND_PREFIX} ${definition.usage}\``);
  }

  if (definition.aliases.length > 0) {
    lines.push(
      `Also typed as: ${definition.aliases.map((alias) => `\`${COMMAND_PREFIX} ${alias}\``).join(", ")}`,
    );
  }

  return lines.join("\n");
}

/**
 * Answer `/ouro help [command]`.
 *
 * @param grammar - The grammar.
 * @param surface - Where it was asked.
 * @param topic - The tokens after `help`; empty for the list.
 * @returns The text: the list, one command's detail, or — for a name that is no command — the
 *   same *unknown command* sentence the dispatcher gives, with the nearest names.
 */
export function help(grammar: Grammar, surface: ChatSurface, topic: readonly string[]): string {
  if (topic.length === 0) {
    return helpText(grammar, surface);
  }

  const builtin = BUILTINS.find(
    (candidate) =>
      candidate.id === topic[0]?.toLowerCase() &&
      topic.length === 1 &&
      candidate.surfaces.includes(surface),
  );

  if (builtin !== undefined) {
    return `\`${COMMAND_PREFIX} ${builtin.usage}\` — ${builtin.summary}`;
  }

  const match = matchCommand(grammar, topic);

  // Words after the command's name are its arguments, typed out of habit: the help is the same.
  return match === undefined
    ? failureText(unknownCommand(grammar, topic))
    : commandHelpText(match.definition);
}

/**
 * Whether some text asks for help — a bare `/ouro`, or `/ouro help …`.
 *
 * @param text - Everything after `/ouro`.
 * @returns The tokens after `help` when it does; `undefined` when it is a command.
 */
export function helpTopic(text: string): string[] | undefined {
  const tokens = tokenize(text);

  if (tokens.length === 0) {
    return [];
  }

  return tokens[0]?.toLowerCase() === "help" ? tokens.slice(1) : undefined;
}

/** One argument in the reference. */
export interface ReferenceArgument {
  readonly name: string;
  readonly type: ArgumentType;
  readonly optional: boolean;
  readonly description: string;
  /** The vocabulary that completes it, or null when there is none to offer. */
  readonly completion: CompletionSource | null;
}

/** One command in the reference. */
export interface ReferenceCommand {
  readonly id: string;
  readonly aliases: readonly string[];
  /** An example as mockup 19 prints it, without the prefix — `queue #485 [workflow]`. */
  readonly usage: string;
  /** What each position takes, with the prefix — `/ouro queue <ticket> [workflow]`. */
  readonly syntax: string;
  readonly summary: string;
  readonly arguments: readonly ReferenceArgument[];
  readonly requires: {
    /** Any one suffices; empty admits every member. */
    readonly roles: readonly string[];
    readonly capability: string | null;
    /** The same requirement as a phrase — `workspace owners and admins`. */
    readonly words: string;
  };
  readonly destructive: boolean;
  /** The first attempt's reply, with `{argument}` and `{workspace}` placeholders; null unless destructive. */
  readonly confirmPrompt: string | null;
  readonly mode: "sync" | "async";
  readonly stage: CommandStage;
  /** What a `v2` command says instead of running; null for an available one. */
  readonly unavailableReply: string | null;
  /** The existing API the command calls. */
  readonly binds: string;
}

/** The whole grammar, as a document. */
export interface GrammarReference {
  readonly version: number;
  readonly prefix: string;
  /** The rule every destructive command follows. */
  readonly confirmRule: string;
  readonly commands: readonly ReferenceCommand[];
  readonly builtins: readonly BuiltinCommand[];
}

/**
 * The grammar as a JSON-ready document — for the docs site, the console and the commands card.
 *
 * @param grammar - The grammar.
 * @returns The reference, in the registry's own order.
 */
export function renderReference(grammar: Grammar): GrammarReference {
  return {
    version: grammar.version,
    prefix: COMMAND_PREFIX,
    confirmRule: CONFIRM_RULE,
    commands: grammar.commands.map((command) => ({
      id: command.id,
      aliases: [...command.aliases],
      usage: command.usage,
      syntax: syntaxOf(command),
      summary: command.summary,
      arguments: command.arguments.map((argument) => ({
        name: argument.name,
        type: argument.type,
        optional: argument.optional,
        description: argument.description,
        completion: argument.completion ?? null,
      })),
      requires: {
        roles: [...command.requires.roles],
        capability: command.requires.capability ?? null,
        words: requirementWords(command.requires),
      },
      destructive: command.destructive,
      confirmPrompt: command.confirmPrompt ?? null,
      mode: command.mode,
      stage: command.stage,
      unavailableReply: command.unavailableReply ?? null,
      binds: command.binds,
    })),
    builtins: BUILTINS.map((builtin) => ({ ...builtin, surfaces: [...builtin.surfaces] })),
  };
}

/**
 * The reference as the text of `chat-grammar.json`.
 *
 * @param grammar - The grammar.
 * @returns Two-space JSON ending in a newline — committed and diffed, so how it is rendered is
 *   part of what has to be reproducible.
 */
export function renderReferenceText(grammar: Grammar): string {
  return `${JSON.stringify(renderReference(grammar), undefined, 2)}\n`;
}
