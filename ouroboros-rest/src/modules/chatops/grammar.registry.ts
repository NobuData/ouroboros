/**
 * The `/ouro` grammar (BZ.3, [#537](https://github.com/NobuData/ouroboros/issues/537)) — the one
 * place a command is defined.
 *
 * Everything a surface shows or does about a command is read from here: the parser reads the
 * arguments, the dispatcher reads who may run it and whether the first attempt only describes,
 * `/ouro help` and the docs reference (`chat-grammar.json`) are generated from it, and the
 * completion endpoint reads each argument's source. What a command *does* is not here: that is
 * its {@link CommandBinding} on the planes side, one call to the service the UI's own route
 * calls, named below in `binds` as documentation.
 *
 * **Adding a command is one entry here and one binding.** Nothing else lists commands — the
 * dispatcher refuses to start over a binding for a command this file does not define, or over an
 * `available` command with no binding ({@link bindingProblems}).
 *
 * **The words are mockup 19's.** `summary` is the COMMANDS card's right-hand column verbatim, and
 * `usage` its left-hand one, with three honest departures: the card's third row
 * (`pause loop 1847 / resume`) is two commands; `answer` takes the action's real id
 * (`allow_once`, not the card's `allow`); and nothing here promises a clean-up `abort` does not
 * do — the confirm prompts are worded from what the planes really do
 * (`controls.service.ts`, `lifecycle.service.ts`).
 *
 * **Versioning.** {@link GRAMMAR_VERSION} is bumped whenever a command, an argument or a
 * requirement changes; it is recorded on every invocation's audit event and served with every
 * completion, so a client holding an older grammar can tell.
 *
 * This file imports types only: `scripts/chat-grammar.mjs` loads it without a build.
 */

import type { OrganizationRole } from "../db/schema";
import type { CommandBinding, CommandDefinition, Grammar } from "./grammar.types";

/** The injection token of the {@link Grammar} the dispatcher runs — {@link GRAMMAR} in the app. */
export const CHAT_GRAMMAR = Symbol("CHAT_GRAMMAR");

/** What every command is typed after. */
export const COMMAND_PREFIX = "/ouro";

/** The grammar's version. See the header for when it moves. */
export const GRAMMAR_VERSION = 1;

/** `chat_commands.command`'s CHECK (V131): lower-case words separated by single spaces. */
export const COMMAND_ID_PATTERN = /^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)*$/;

/** `chat_commands.command`'s length bound (V131). */
export const COMMAND_ID_MAX_LENGTH = 64;

/** Changing what the workspace is. */
const OWNERS_AND_ADMINS: readonly OrganizationRole[] = ["owner", "admin"];

/** Making the product do something — the roles guard's `CONTRIBUTORS`. */
const CONTRIBUTORS: readonly OrganizationRole[] = ["owner", "admin", "member"];

/** Every member, viewers included. */
const EVERY_MEMBER: readonly OrganizationRole[] = [];

/** The eleven commands — mockup 19's ten rows, the third being two. */
const COMMANDS: readonly CommandDefinition[] = [
  {
    id: "status",
    aliases: [],
    summary: "everything live, in one line",
    usage: "status",
    arguments: [],
    requires: { roles: EVERY_MEMBER },
    destructive: false,
    mode: "sync",
    stage: "available",
    binds: "GET /api/v1/dashboard · GET /api/v1/farm · GET /api/v1/inbox",
  },
  {
    id: "queue",
    aliases: [],
    summary: "send an issue into the loop",
    usage: "queue #485 [workflow]",
    arguments: [
      {
        name: "ticket",
        type: "ticket",
        optional: false,
        completion: "tickets",
        description: "the issue to queue — `#485`, `485`, `repo#485` or its GitHub URL",
      },
      {
        name: "workflow",
        type: "workflow",
        optional: true,
        completion: "workflows",
        description: "the workflow to pin; left out, the workspace's triggers choose",
      },
    ],
    requires: { roles: CONTRIBUTORS },
    destructive: false,
    mode: "sync",
    stage: "available",
    binds: "POST /api/v1/backlog/queue",
  },
  {
    id: "pause loop",
    aliases: [],
    summary: "hold a loop mid-flight",
    usage: "pause loop 1847",
    arguments: [
      {
        name: "loop",
        type: "loop",
        optional: false,
        completion: "loops",
        description: "the loop's number — `1847` or `#1847`",
      },
    ],
    requires: { roles: OWNERS_AND_ADMINS },
    destructive: false,
    mode: "sync",
    stage: "available",
    binds: "POST /api/v1/runs/{id}/controls (pause)",
  },
  {
    id: "resume loop",
    aliases: [],
    summary: "let a held loop continue",
    usage: "resume loop 1847",
    arguments: [
      {
        name: "loop",
        type: "loop",
        optional: false,
        completion: "loops",
        description: "the loop's number — `1847` or `#1847`",
      },
    ],
    requires: { roles: OWNERS_AND_ADMINS },
    destructive: false,
    mode: "sync",
    stage: "available",
    binds: "POST /api/v1/runs/{id}/controls (resume)",
  },
  {
    id: "abort loop",
    aliases: [],
    summary: "stop and clean up",
    usage: "abort loop 1847",
    arguments: [
      {
        name: "loop",
        type: "loop",
        optional: false,
        completion: "loops",
        description: "the loop's number — `1847` or `#1847`",
      },
      {
        name: "confirm",
        type: "confirm",
        optional: true,
        description: "the word `confirm` — without it nothing is aborted",
      },
    ],
    requires: { roles: OWNERS_AND_ADMINS },
    destructive: true,
    confirmPrompt:
      "Add `confirm` to abort — this stops loop {loop} for good and closes its run as canceled. Its branch is kept; nothing is reverted or deleted. `/ouro abort loop {loop} confirm`",
    mode: "sync",
    stage: "available",
    binds: "POST /api/v1/runs/{id}/controls (abort)",
  },
  {
    id: "answer",
    aliases: [],
    summary: "answer a blocking question",
    usage: "answer q-231 allow_once",
    arguments: [
      {
        name: "question",
        type: "question",
        optional: false,
        completion: "questions",
        description: "the question's short id, as its card shows it — `q-231`",
      },
      {
        name: "action",
        type: "action",
        optional: false,
        completion: "actions",
        description: "one of the answers that question takes — `allow_once`",
      },
    ],
    requires: { roles: EVERY_MEMBER },
    destructive: false,
    mode: "sync",
    stage: "available",
    binds: "POST /api/v1/inbox/items/{id}/actions/{actionId}",
  },
  {
    id: "dry-run",
    aliases: ["dryrun"],
    summary: "rehearse with no writes",
    usage: "dry-run #486 [workflow]",
    arguments: [
      {
        name: "ticket",
        type: "ticket",
        optional: false,
        completion: "tickets",
        description: "the issue to rehearse — `#486`, `486`, `repo#486` or its GitHub URL",
      },
      {
        name: "workflow",
        type: "workflow",
        optional: true,
        completion: "workflows",
        description: "the workflow to rehearse; left out, the one the triggers would pin",
      },
    ],
    requires: { roles: CONTRIBUTORS },
    destructive: false,
    mode: "async",
    stage: "available",
    binds: "POST /api/v1/workflows/{id}/dry-runs",
  },
  {
    id: "route",
    aliases: [],
    summary: "repin a stage's model",
    usage: "route implement claude-fable-5",
    arguments: [
      {
        name: "task",
        type: "task_kind",
        optional: false,
        completion: "task_kinds",
        description: "the task kind to repin — `implement`",
      },
      {
        name: "alias",
        type: "alias",
        optional: false,
        completion: "aliases",
        description: "the model alias its primary hop should use — never a raw model id",
      },
    ],
    requires: { roles: OWNERS_AND_ADMINS },
    destructive: false,
    mode: "sync",
    stage: "available",
    binds: "PUT /api/v1/routing/routes/{taskKind}",
  },
  {
    id: "explain pr",
    aliases: [],
    summary: "plain-language summary of a PR",
    usage: "explain pr 514",
    arguments: [
      {
        name: "pr",
        type: "pr",
        optional: false,
        description: "the pull request's number — `514` or `#514`",
      },
    ],
    requires: { roles: EVERY_MEMBER },
    destructive: false,
    mode: "sync",
    stage: "v2",
    unavailableReply:
      "Plain-language PR summaries arrive with AI presence (CB.1, #546). `/ouro explain pr` is listed so you know it is coming; it does not summarise anything yet.",
    binds: "none yet — AI presence (#546, CB.1)",
  },
  {
    id: "estimate",
    aliases: [],
    summary: "effort, cost, and cycle guess",
    usage: "estimate #490",
    arguments: [
      {
        name: "ticket",
        type: "ticket",
        optional: false,
        completion: "tickets",
        description: "the issue to estimate — `#490`, `490`, `repo#490` or its GitHub URL",
      },
    ],
    requires: { roles: EVERY_MEMBER },
    destructive: false,
    mode: "sync",
    stage: "available",
    binds: "GET /api/v1/backlog/{id} · POST /api/v1/backlog/{id}/estimate",
  },
  {
    id: "pause all",
    aliases: [],
    summary: "the big red button",
    usage: "pause all",
    arguments: [
      {
        name: "confirm",
        type: "confirm",
        optional: true,
        description: "the word `confirm` — without it nothing is paused",
      },
    ],
    requires: { roles: OWNERS_AND_ADMINS },
    destructive: true,
    confirmPrompt:
      "Add `confirm` to pause everything — this stops every loop in {workspace} from starting anything new. Stages already running finish, and queued work stays queued until an owner or admin resumes the workspace. `/ouro pause all confirm`",
    mode: "sync",
    stage: "available",
    binds: "POST /api/v1/settings/lifecycle/pause",
  },
];

/** The grammar the application runs. */
export const GRAMMAR: Grammar = { version: GRAMMAR_VERSION, commands: COMMANDS };

/** A command every surface (or one surface) answers itself, outside the grammar's bindings. */
export interface BuiltinCommand {
  readonly id: string;
  /** As typed after `/ouro`. */
  readonly usage: string;
  readonly summary: string;
  /** The surfaces that have it. */
  readonly surfaces: readonly ("slack" | "console")[];
}

/**
 * The built-ins: `help`, which the dispatcher generates from the grammar, and Slack's two
 * identity commands, which stay in the Slack adapter because linking is a Slack matter.
 */
export const BUILTINS: readonly BuiltinCommand[] = [
  {
    id: "help",
    usage: "help [command]",
    summary: "this list, or one command in detail",
    surfaces: ["slack", "console"],
  },
  {
    id: "link",
    usage: "link",
    summary: "link your Slack identity to your Ouroboros account",
    surfaces: ["slack"],
  },
  {
    id: "unlink",
    usage: "unlink",
    summary: "undo the link",
    surfaces: ["slack"],
  },
];

/**
 * A grammar with more commands — how a test (or a later plane) adds one without touching the
 * dispatcher.
 *
 * @param grammar - The grammar to extend.
 * @param commands - The definitions to add.
 * @returns A new grammar at the same version.
 */
export function withCommands(grammar: Grammar, ...commands: CommandDefinition[]): Grammar {
  return { version: grammar.version, commands: [...grammar.commands, ...commands] };
}

/**
 * One command by its id or an alias.
 *
 * @param grammar - The grammar.
 * @param name - An id or alias, in any case.
 * @returns The definition, or `undefined`.
 */
export function commandOf(grammar: Grammar, name: string): CommandDefinition | undefined {
  const wanted = name.trim().toLowerCase().replace(/\s+/g, " ");

  return grammar.commands.find(
    (command) => command.id === wanted || command.aliases.includes(wanted),
  );
}

/**
 * What is wrong with a grammar, by the rules every reader of it leans on.
 *
 * @param grammar - The grammar.
 * @returns One sentence per broken rule; empty when it is sound.
 */
export function grammarProblems(grammar: Grammar): string[] {
  const problems: string[] = [];
  const names = new Map<string, string>();
  const reserved = new Set(BUILTINS.map((builtin) => builtin.id));

  for (const command of grammar.commands) {
    for (const name of [command.id, ...command.aliases]) {
      if (!COMMAND_ID_PATTERN.test(name) || name.length > COMMAND_ID_MAX_LENGTH) {
        problems.push(`"${name}" is not a command name chat_commands.command accepts`);
      }

      if (reserved.has(name.split(" ")[0] ?? "")) {
        problems.push(`"${name}" starts with a built-in's name`);
      }

      const owner = names.get(name);

      if (owner !== undefined) {
        problems.push(`"${name}" names both ${owner} and ${command.id}`);
      }

      names.set(name, command.id);
    }

    const firstOptional = command.arguments.findIndex((argument) => argument.optional);

    if (
      firstOptional !== -1 &&
      command.arguments.slice(firstOptional).some((argument) => !argument.optional)
    ) {
      problems.push(`${command.id}: a required argument follows an optional one`);
    }

    if (
      new Set(command.arguments.map((argument) => argument.name)).size !== command.arguments.length
    ) {
      problems.push(`${command.id}: two arguments share a name`);
    }

    const confirms = command.arguments.filter((argument) => argument.type === "confirm");
    const last = command.arguments[command.arguments.length - 1];

    if (command.destructive !== (confirms.length === 1)) {
      problems.push(`${command.id}: destructive must mean exactly one confirm argument`);
    }

    if (confirms.length > 0 && (last?.type !== "confirm" || !last.optional)) {
      problems.push(`${command.id}: confirm is the last argument, and typed or left out`);
    }

    if (command.destructive !== (command.confirmPrompt !== undefined)) {
      problems.push(`${command.id}: destructive must mean a confirmPrompt`);
    }

    if (command.arguments.some((argument) => argument.type === "keyword" && !argument.word)) {
      problems.push(`${command.id}: a keyword argument has no word`);
    }

    if ((command.stage === "v2") !== (command.unavailableReply !== undefined)) {
      problems.push(`${command.id}: v2 must mean an unavailableReply`);
    }
  }

  return problems;
}

/**
 * What is wrong between a grammar and the bindings handed to it: a binding for a command the
 * grammar does not define is a command outside the registry, and an available command with no
 * binding (or two) is one that is listed and cannot run.
 *
 * @param grammar - The grammar.
 * @param bindings - The bindings as injected.
 * @returns One sentence per problem; empty when every available command has exactly one.
 */
export function bindingProblems(
  grammar: Grammar,
  bindings: readonly Pick<CommandBinding, "command">[],
): string[] {
  const problems: string[] = [];
  const counts = new Map<string, number>();

  for (const binding of bindings) {
    counts.set(binding.command, (counts.get(binding.command) ?? 0) + 1);
  }

  for (const [command, count] of counts) {
    const definition = grammar.commands.find((candidate) => candidate.id === command);

    if (definition === undefined) {
      problems.push(`a binding exists for "${command}", which the grammar does not define`);
    } else if (definition.stage !== "available") {
      problems.push(`a binding exists for "${command}", which is not available yet`);
    } else if (count > 1) {
      problems.push(`"${command}" has ${String(count)} bindings`);
    }
  }

  for (const command of grammar.commands) {
    if (command.stage === "available" && !counts.has(command.id)) {
      problems.push(`"${command.id}" is available and has no binding`);
    }
  }

  return problems;
}
