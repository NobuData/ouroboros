import { vi } from "vitest";

import type {
  ConsoleCommand,
  ConsoleCommandRecord,
  ConsoleCommandResult,
  ConsoleCompletions,
  ConsoleGrammar,
} from "@/app/api/console";
import type { ConsoleAnswer } from "@/app/shell/console";

/**
 * Fixtures for the in-app console (#539): the grammar as `ouroboros-rest` commits it
 * (`chat-grammar.json`, version 1) with what the caller may run resolved onto it, the
 * dispatcher's answers, and the stub the four Server Actions are replaced by.
 *
 * Every suite that renders the palette needs the stub — the actions sit over a `server-only`
 * client — which is why it is written once here:
 *
 * ```ts
 * vi.mock("@/app/shell/console-actions", async () =>
 *   (await import("../helpers/console")).consoleActionsModule(),
 * );
 * ```
 */

/** What every command of the fixture has in common. */
const COMMON = {
  aliases: [] as string[],
  destructive: false,
  confirmPrompt: null,
  mode: "sync",
  stage: "available",
  unavailableReply: null,
  binds: "",
  allowed: true,
  deniedReason: null,
} as const;

/** The requirement every member meets. */
const EVERYONE = { roles: [], capability: null, words: "every workspace member" };

/** The requirement a contributor meets. */
const MEMBERS = {
  roles: ["owner", "admin", "member"],
  capability: null,
  words: "workspace owners, admins and members",
};

/** The requirement only an owner or an admin meets. */
const ADMINS = { roles: ["owner", "admin"], capability: null, words: "workspace owners and admins" };

/** What `explain pr` answers instead of running. */
export const EXPLAIN_UNAVAILABLE =
  "Plain-language PR summaries arrive with AI presence (CB.1, #546). `/ouro explain pr` is listed so you know it is coming; it does not summarise anything yet.";

/**
 * An argument of a command.
 *
 * @param name Its name.
 * @param type What it takes.
 * @param completion The vocabulary that completes it, or null.
 * @param optional Whether it may be left out.
 * @returns The argument.
 */
function argument(
  name: string,
  type: ConsoleCommand["arguments"][number]["type"],
  completion: ConsoleCommand["arguments"][number]["completion"],
  optional = false,
): ConsoleCommand["arguments"][number] {
  return { name, type, optional, description: "", completion };
}

/**
 * The eleven commands, as the service answers a caller it lets do everything but pause, resume
 * and repin: those four are not allowed, and say so.
 *
 * @returns The commands, in the grammar's own order.
 */
export function commands(): ConsoleCommand[] {
  const loop = [argument("loop", "loop", "loops")];
  const denied = { allowed: false, deniedReason: "needs admin" };

  return [
    {
      ...COMMON,
      id: "status",
      usage: "status",
      syntax: "/ouro status",
      summary: "everything live, in one line",
      arguments: [],
      requires: EVERYONE,
    },
    {
      ...COMMON,
      id: "queue",
      usage: "queue #485 [workflow]",
      syntax: "/ouro queue <ticket> [workflow]",
      summary: "send an issue into the loop",
      arguments: [
        argument("ticket", "ticket", "tickets"),
        argument("workflow", "workflow", "workflows", true),
      ],
      requires: MEMBERS,
    },
    {
      ...COMMON,
      ...denied,
      id: "pause loop",
      usage: "pause loop 1847",
      syntax: "/ouro pause loop <loop>",
      summary: "hold a loop mid-flight",
      arguments: loop,
      requires: ADMINS,
    },
    {
      ...COMMON,
      ...denied,
      id: "resume loop",
      usage: "resume loop 1847",
      syntax: "/ouro resume loop <loop>",
      summary: "let a held loop continue",
      arguments: loop,
      requires: ADMINS,
    },
    {
      ...COMMON,
      id: "abort loop",
      usage: "abort loop 1847",
      syntax: "/ouro abort loop <loop> confirm",
      summary: "stop and clean up",
      arguments: [...loop, argument("confirm", "confirm", null, true)],
      requires: ADMINS,
      destructive: true,
      confirmPrompt: "This would abort loop {loop}.",
    },
    {
      ...COMMON,
      id: "answer",
      usage: "answer q-231 allow_once",
      syntax: "/ouro answer <question> <action>",
      summary: "answer a blocking question",
      arguments: [
        argument("question", "question", "questions"),
        argument("action", "action", "actions"),
      ],
      requires: EVERYONE,
    },
    {
      ...COMMON,
      id: "dry-run",
      aliases: ["dryrun"],
      usage: "dry-run #486 [workflow]",
      syntax: "/ouro dry-run <ticket> [workflow]",
      summary: "rehearse with no writes",
      arguments: [
        argument("ticket", "ticket", "tickets"),
        argument("workflow", "workflow", "workflows", true),
      ],
      requires: MEMBERS,
      mode: "async",
    },
    {
      ...COMMON,
      ...denied,
      id: "route",
      usage: "route implement claude-fable-5",
      syntax: "/ouro route <task> <alias>",
      summary: "repin a stage's model",
      arguments: [
        argument("task", "task_kind", "task_kinds"),
        argument("alias", "alias", "aliases"),
      ],
      requires: ADMINS,
    },
    {
      ...COMMON,
      id: "explain pr",
      usage: "explain pr 514",
      syntax: "/ouro explain pr <pr>",
      summary: "plain-language summary of a PR",
      arguments: [argument("pr", "pr", null)],
      requires: EVERYONE,
      stage: "v2",
      unavailableReply: EXPLAIN_UNAVAILABLE,
    },
    {
      ...COMMON,
      id: "estimate",
      usage: "estimate #490",
      syntax: "/ouro estimate <ticket>",
      summary: "effort, cost, and cycle guess",
      arguments: [argument("ticket", "ticket", "tickets")],
      requires: EVERYONE,
    },
    {
      ...COMMON,
      ...denied,
      id: "pause all",
      usage: "pause all",
      syntax: "/ouro pause all confirm",
      summary: "the big red button",
      arguments: [argument("confirm", "confirm", null, true)],
      requires: ADMINS,
      destructive: true,
      confirmPrompt: "This would pause every loop in {workspace}.",
    },
  ];
}

/**
 * The grammar.
 *
 * @param over What differs.
 * @returns The grammar, as a member is answered it.
 */
export function grammar(over: Partial<ConsoleGrammar> = {}): ConsoleGrammar {
  return {
    version: 1,
    prefix: "/ouro",
    confirmRule:
      "Runs only with `confirm` as its last word. Without it nothing happens: the reply describes exactly what would.",
    commands: commands(),
    builtins: [
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
      { id: "unlink", usage: "unlink", summary: "undo the link", surfaces: ["slack"] },
    ],
    ...over,
  };
}

/**
 * What the completions endpoint answers.
 *
 * @param command The command the text names.
 * @param argumentName The argument being typed.
 * @param values What could be typed, as value–label pairs.
 * @returns The answer.
 */
export function completions(
  command: string | null,
  argumentName: string | null,
  values: readonly (readonly [string, string])[] = [],
): ConsoleCompletions {
  return {
    grammarVersion: 1,
    command,
    argument: argumentName,
    completions: values.map(([value, label]) => ({ value, label })),
    // Left for the console to look up in the grammar, as it does for a service that names none.
    source: null,
  };
}

/** The two open tickets the seeded workspace offers for `#4`. */
export const TICKETS: readonly (readonly [string, string])[] = [
  ["#485", "OTA rollback flag"],
  ["#486", "Telemetry backoff"],
];

/** What `status` says — mockup 19's line. */
export const STATUS_REPLY =
  "3 loops live · 12 queued · farm 4/5 online · spend today $18.60 · needs-you: 3";

/**
 * What the dispatcher answers.
 *
 * @param over What differs.
 * @returns A `status` that ran.
 */
export function result(over: Partial<ConsoleCommandResult> = {}): ConsoleCommandResult {
  return {
    commandId: "5eed0539-0000-4000-8000-000000000001",
    command: "status",
    outcome: "ok",
    reply: { text: STATUS_REPLY },
    ...over,
  };
}

/** The id of the dry run the async cases wait for. */
export const DRY_RUN_ID = "5eed0539-0000-4000-8000-000000000002";

/**
 * One of the caller's commands, read back.
 *
 * @param over What differs.
 * @returns A dry run that has settled, with its deep link.
 */
export function record(over: Partial<ConsoleCommandRecord> = {}): ConsoleCommandRecord {
  return {
    id: DRY_RUN_ID,
    command: "dry-run",
    outcome: "ok",
    rawText: "dry-run #486",
    invokedAt: "2026-10-12T14:00:00.000Z",
    completedAt: "2026-10-12T14:00:41.000Z",
    settledReply: {
      text: "Dry run of #486 passed: 4 stages, 0 writes.",
      link: { label: "Open the dry run", url: "/workflows/dry-runs/41" },
    },
    errorDetail: null,
    ...over,
  };
}

/** The four Server Actions, as mocks a case answers. */
export const consoleActions = {
  readConsoleGrammar: vi.fn<() => Promise<ConsoleAnswer<ConsoleGrammar>>>(),
  readConsoleCompletions: vi.fn<(text: string) => Promise<ConsoleAnswer<ConsoleCompletions>>>(),
  runConsoleCommand: vi.fn<(text: string) => Promise<ConsoleAnswer<ConsoleCommandResult>>>(),
  readConsoleCommand: vi.fn<(id: string) => Promise<ConsoleAnswer<ConsoleCommandRecord>>>(),
};

/**
 * Put the actions back to a service that answers: the grammar, no completions, a `status`
 * that ran, a dry run that has settled. Call it in `beforeEach`.
 *
 * @returns Nothing.
 */
export function resetConsoleActions(): void {
  consoleActions.readConsoleGrammar.mockReset().mockResolvedValue(grammar());
  consoleActions.readConsoleCompletions.mockReset().mockResolvedValue(completions(null, null));
  consoleActions.runConsoleCommand.mockReset().mockResolvedValue(result());
  consoleActions.readConsoleCommand.mockReset().mockResolvedValue(record());
}

/**
 * The module `@/app/shell/console-actions` is replaced by.
 *
 * @returns The mocked module, each action forwarding to {@link consoleActions} — so a case can
 *   re-answer one after the module under test has already imported it.
 */
export function consoleActionsModule(): Record<string, unknown> {
  return {
    readConsoleGrammar: () => consoleActions.readConsoleGrammar(),
    readConsoleCompletions: (text: string) => consoleActions.readConsoleCompletions(text),
    runConsoleCommand: (text: string) => consoleActions.runConsoleCommand(text),
    readConsoleCommand: (id: string) => consoleActions.readConsoleCommand(id),
  };
}

resetConsoleActions();
