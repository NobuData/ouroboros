import {
  BUILTINS,
  COMMAND_ID_MAX_LENGTH,
  COMMAND_ID_PATTERN,
  COMMAND_PREFIX,
  GRAMMAR,
  GRAMMAR_VERSION,
  bindingProblems,
  commandOf,
  grammarProblems,
  withCommands,
} from "./grammar.registry";
import type {
  ArgumentSpec,
  ArgumentType,
  CommandDefinition,
  CompletionSource,
  Grammar,
} from "./grammar.types";

/**
 * The `/ouro` registry (#537): mockup 19's COMMANDS card is in it word for word, the rules every
 * reader of a grammar leans on are checked, and a binding can neither be missing nor extra.
 */

/**
 * Mockup 19's COMMANDS card, row by row: the card's left column, its right column, and the
 * registry command that carries the row.
 */
const CARD: readonly (readonly [card: string, summary: string, id: string])[] = [
  ["status", "everything live, in one line", "status"],
  ["queue #485 [workflow]", "send an issue into the loop", "queue"],
  ["pause loop 1847 / resume", "hold a loop mid-flight", "pause loop"],
  ["abort loop 1847", "stop and clean up", "abort loop"],
  ["answer q-231 allow", "answer a blocking question", "answer"],
  ["dry-run #486 [workflow]", "rehearse with no writes", "dry-run"],
  ["route implement claude-fable-5", "repin a stage's model", "route"],
  ["explain pr 514", "plain-language summary of a PR", "explain pr"],
  ["estimate #490", "effort, cost, and cycle guess", "estimate"],
  ["pause all", "the big red button", "pause all"],
];

/** The vocabulary each argument type completes from; `undefined` where there is none to offer. */
const VOCABULARY: Readonly<Record<ArgumentType, CompletionSource | undefined>> = {
  ticket: "tickets",
  loop: "loops",
  workflow: "workflows",
  alias: "aliases",
  task_kind: "task_kinds",
  question: "questions",
  action: "actions",
  pr: undefined,
  keyword: undefined,
  confirm: undefined,
};

/**
 * A sound command, with whatever a test wants wrong about it.
 *
 * @param overrides - The fields to replace.
 * @returns The definition.
 */
function command(overrides: Partial<CommandDefinition> = {}): CommandDefinition {
  return {
    id: "ping",
    aliases: [],
    summary: "answer pong",
    usage: "ping",
    arguments: [],
    requires: { roles: [] },
    destructive: false,
    mode: "sync",
    stage: "available",
    binds: "none",
    ...overrides,
  };
}

/**
 * An argument of a fixture command.
 *
 * @param name - Its name.
 * @param type - Its type.
 * @param optional - Whether it may be left out.
 * @returns The argument.
 */
function argument(name: string, type: ArgumentType, optional: boolean): ArgumentSpec {
  return { name, type, optional, description: `the ${name}` };
}

/**
 * A grammar of fixture commands only.
 *
 * @param commands - The commands.
 * @returns The grammar.
 */
function grammarOf(...commands: CommandDefinition[]): Grammar {
  return { version: 1, commands };
}

/**
 * One command of the real grammar.
 *
 * @param id - Its id.
 * @returns The definition; the test fails when the registry has no such command.
 */
function registered(id: string): CommandDefinition {
  const definition = GRAMMAR.commands.find((candidate) => candidate.id === id);

  if (definition === undefined) {
    throw new Error(`the registry has no "${id}"`);
  }

  return definition;
}

/**
 * A binding for every available command of the real grammar — what the planes side injects.
 *
 * @returns The bindings, by command id.
 */
function everyBinding(): { command: string }[] {
  return GRAMMAR.commands
    .filter((definition) => definition.stage === "available")
    .map((definition) => ({ command: definition.id }));
}

describe("the registry", () => {
  it("carries a version, and the grammar is at it", () => {
    expect(Number.isInteger(GRAMMAR_VERSION)).toBe(true);
    expect(GRAMMAR_VERSION).toBeGreaterThanOrEqual(1);
    expect(GRAMMAR.version).toBe(GRAMMAR_VERSION);
  });

  it("is typed after /ouro", () => {
    expect(COMMAND_PREFIX).toBe("/ouro");
  });

  it("is sound by its own rules", () => {
    expect(grammarProblems(GRAMMAR)).toEqual([]);
  });

  it("holds eleven commands — the card's ten rows, the third being two", () => {
    expect(GRAMMAR.commands.map((definition) => definition.id)).toEqual([
      "status",
      "queue",
      "pause loop",
      "resume loop",
      "abort loop",
      "answer",
      "dry-run",
      "route",
      "explain pr",
      "estimate",
      "pause all",
    ]);
  });

  it.each(CARD)("has the card's row `%s` — %s", (_card, summary, id) => {
    expect(registered(id).summary).toBe(summary);
  });

  it("prints each usage as the card does, but for two honest departures", () => {
    const departures = CARD.filter(([card, , id]) => registered(id).usage !== card).map(
      ([card, , id]) => [card, registered(id).usage],
    );

    // The third row is two commands, and `answer` takes the action's real id — `allow` is not one.
    expect(departures).toEqual([
      ["pause loop 1847 / resume", "pause loop 1847"],
      ["answer q-231 allow", "answer q-231 allow_once"],
    ]);
    expect(registered("resume loop").usage).toBe("resume loop 1847");
  });

  it("starts every usage with the command's own name", () => {
    for (const definition of GRAMMAR.commands) {
      expect(`${definition.usage} `.startsWith(`${definition.id} `)).toBe(true);
    }
  });

  it("names every command in words chat_commands.command accepts", () => {
    for (const definition of GRAMMAR.commands) {
      for (const name of [definition.id, ...definition.aliases]) {
        expect(name).toMatch(COMMAND_ID_PATTERN);
        expect(name.length).toBeLessThanOrEqual(COMMAND_ID_MAX_LENGTH);
      }
    }
  });

  it("lists explain pr as v2: it says honestly that it does nothing yet, and who brings it", () => {
    const explain = registered("explain pr");

    expect(explain.stage).toBe("v2");
    expect(explain.unavailableReply).toContain("CB.1");
    expect(explain.unavailableReply).toContain("does not summarise anything yet");
    expect(GRAMMAR.commands.filter((definition) => definition.stage === "v2")).toEqual([explain]);
  });

  it("asks nothing of whoever types explain pr, and no binding of the planes", () => {
    expect(registered("explain pr").requires).toEqual({ roles: [] });
    expect(bindingProblems(GRAMMAR, everyBinding())).toEqual([]);
    expect(everyBinding().map((binding) => binding.command)).not.toContain("explain pr");
  });

  it("marks abort loop and pause all destructive, and nothing else", () => {
    expect(
      GRAMMAR.commands
        .filter((definition) => definition.destructive)
        .map((definition) => definition.id),
    ).toEqual(["abort loop", "pause all"]);
  });

  it.each(["abort loop", "pause all"])(
    "ends %s in an optional confirm, and says what to type to go through with it",
    (id) => {
      const definition = registered(id);
      const last = definition.arguments[definition.arguments.length - 1];

      expect(last).toMatchObject({ name: "confirm", type: "confirm", optional: true });
      expect(definition.confirmPrompt).toContain("Add `confirm`");
      expect(definition.confirmPrompt).toMatch(
        new RegExp(`\`${COMMAND_PREFIX} ${id}( \\{[a-z_]+\\})* confirm\`$`),
      );
    },
  );

  it("fills a confirm prompt only from the command's own arguments and the workspace", () => {
    for (const definition of GRAMMAR.commands) {
      const names = new Set(["workspace", ...definition.arguments.map((spec) => spec.name)]);
      const placeholders = [...(definition.confirmPrompt ?? "").matchAll(/\{([a-z_]+)\}/g)].map(
        (match) => match[1],
      );

      expect(placeholders.filter((name) => !names.has(name ?? ""))).toEqual([]);
    }
  });

  it("promises no clean-up an abort does not do", () => {
    expect(registered("abort loop").confirmPrompt).toContain(
      "Its branch is kept; nothing is reverted or deleted.",
    );
  });

  it("declares a completion source on every argument that has a vocabulary", () => {
    for (const definition of GRAMMAR.commands) {
      for (const spec of definition.arguments) {
        expect([definition.id, spec.name, spec.completion]).toEqual([
          definition.id,
          spec.name,
          VOCABULARY[spec.type],
        ]);
      }
    }
  });

  it("asks of each command the roles the UI's own route asks for", () => {
    const roles = Object.fromEntries(
      GRAMMAR.commands.map((definition) => [definition.id, definition.requires.roles.join(",")]),
    );

    expect(roles).toEqual({
      status: "",
      queue: "owner,admin,member",
      "pause loop": "owner,admin",
      "resume loop": "owner,admin",
      "abort loop": "owner,admin",
      answer: "",
      "dry-run": "owner,admin,member",
      route: "owner,admin",
      "explain pr": "",
      estimate: "",
      "pause all": "owner,admin",
    });
  });

  it("acknowledges only the dry run and answers the rest at once", () => {
    expect(
      GRAMMAR.commands
        .filter((definition) => definition.mode === "async")
        .map((definition) => definition.id),
    ).toEqual(["dry-run"]);
  });

  it("keeps the built-ins out of the grammar: help everywhere, linking in Slack only", () => {
    expect(BUILTINS.map((builtin) => [builtin.id, builtin.surfaces])).toEqual([
      ["help", ["slack", "console"]],
      ["link", ["slack"]],
      ["unlink", ["slack"]],
    ]);

    for (const builtin of BUILTINS) {
      expect(commandOf(GRAMMAR, builtin.id)).toBeUndefined();
    }
  });
});

describe("commandOf", () => {
  it("finds a command by its id or an alias", () => {
    expect(commandOf(GRAMMAR, "pause loop")?.id).toBe("pause loop");
    expect(commandOf(GRAMMAR, "dryrun")?.id).toBe("dry-run");
  });

  it("reads the name without regard to case or spacing", () => {
    expect(commandOf(GRAMMAR, "  Pause   LOOP ")?.id).toBe("pause loop");
  });

  it("finds nothing for a name that is no command", () => {
    expect(commandOf(GRAMMAR, "pause")).toBeUndefined();
    expect(commandOf(GRAMMAR, "")).toBeUndefined();
  });
});

describe("withCommands", () => {
  it("adds a command at the same version and leaves the grammar it was given alone", () => {
    const extended = withCommands(GRAMMAR, command());

    expect(extended.version).toBe(GRAMMAR.version);
    expect(extended.commands).toHaveLength(GRAMMAR.commands.length + 1);
    expect(commandOf(extended, "ping")?.summary).toBe("answer pong");
    expect(commandOf(GRAMMAR, "ping")).toBeUndefined();
    expect(grammarProblems(extended)).toEqual([]);
  });
});

describe("grammarProblems", () => {
  it("finds nothing wrong with a sound command", () => {
    expect(grammarProblems(grammarOf(command()))).toEqual([]);
  });

  it.each(["Queue", "pause  loop", " queue", "queue_all", "9lives", "pause loop!", ""])(
    "refuses the name %j, which chat_commands.command would",
    (name) => {
      expect(grammarProblems(grammarOf(command({ id: name })))).toEqual([
        `"${name}" is not a command name chat_commands.command accepts`,
      ]);
    },
  );

  it("refuses a name longer than the column", () => {
    const fits = "a".repeat(COMMAND_ID_MAX_LENGTH);

    expect(grammarProblems(grammarOf(command({ id: fits })))).toEqual([]);
    expect(grammarProblems(grammarOf(command({ id: `${fits}a` })))).toEqual([
      `"${fits}a" is not a command name chat_commands.command accepts`,
    ]);
  });

  it("holds an alias to the same rule as an id", () => {
    expect(grammarProblems(grammarOf(command({ aliases: ["Ping"] })))).toEqual([
      '"Ping" is not a command name chat_commands.command accepts',
    ]);
  });

  it("refuses a name that starts with a built-in's", () => {
    expect(grammarProblems(grammarOf(command({ id: "help me" })))).toEqual([
      '"help me" starts with a built-in\'s name',
    ]);
    expect(grammarProblems(grammarOf(command({ aliases: ["unlink"] })))).toEqual([
      '"unlink" starts with a built-in\'s name',
    ]);
    // Only the first word: a built-in's name further in shadows nothing.
    expect(grammarProblems(grammarOf(command({ id: "ping help" })))).toEqual([]);
  });

  it("refuses one name for two commands, whether id or alias", () => {
    expect(grammarProblems(grammarOf(command(), command()))).toEqual([
      '"ping" names both ping and ping',
    ]);
    expect(grammarProblems(withCommands(GRAMMAR, command({ aliases: ["queue"] })))).toEqual([
      '"queue" names both queue and ping',
    ]);
    expect(grammarProblems(withCommands(GRAMMAR, command({ id: "dryrun" })))).toEqual([
      '"dryrun" names both dry-run and dryrun',
    ]);
  });

  it("refuses a required argument after an optional one", () => {
    const broken = command({
      arguments: [argument("workflow", "workflow", true), argument("ticket", "ticket", false)],
    });

    expect(grammarProblems(grammarOf(broken))).toEqual([
      "ping: a required argument follows an optional one",
    ]);
  });

  it("refuses two arguments under one name", () => {
    const broken = command({
      arguments: [argument("ticket", "ticket", false), argument("ticket", "ticket", false)],
    });

    expect(grammarProblems(grammarOf(broken))).toEqual(["ping: two arguments share a name"]);
  });

  it("refuses a destructive command with no confirm argument", () => {
    const broken = command({ destructive: true, confirmPrompt: "Add `confirm`." });

    expect(grammarProblems(grammarOf(broken))).toEqual([
      "ping: destructive must mean exactly one confirm argument",
    ]);
  });

  it("refuses a confirm argument on a command that is not destructive", () => {
    const broken = command({ arguments: [argument("confirm", "confirm", true)] });

    expect(grammarProblems(grammarOf(broken))).toEqual([
      "ping: destructive must mean exactly one confirm argument",
    ]);
  });

  it("refuses two confirm arguments", () => {
    const broken = command({
      destructive: true,
      confirmPrompt: "Add `confirm`.",
      arguments: [argument("confirm", "confirm", true), argument("really", "confirm", true)],
    });

    expect(grammarProblems(grammarOf(broken))).toEqual([
      "ping: destructive must mean exactly one confirm argument",
    ]);
  });

  it("refuses a confirm that is not the last argument", () => {
    const broken = command({
      destructive: true,
      confirmPrompt: "Add `confirm`.",
      arguments: [argument("confirm", "confirm", true), argument("workflow", "workflow", true)],
    });

    expect(grammarProblems(grammarOf(broken))).toEqual([
      "ping: confirm is the last argument, and typed or left out",
    ]);
  });

  it("refuses a confirm that has to be typed: the first attempt must be able to describe", () => {
    const broken = command({
      destructive: true,
      confirmPrompt: "Add `confirm`.",
      arguments: [argument("confirm", "confirm", false)],
    });

    expect(grammarProblems(grammarOf(broken))).toEqual([
      "ping: confirm is the last argument, and typed or left out",
    ]);
  });

  it("refuses a destructive command with nothing to say on the first attempt", () => {
    const broken = command({
      destructive: true,
      arguments: [argument("confirm", "confirm", true)],
    });

    expect(grammarProblems(grammarOf(broken))).toEqual([
      "ping: destructive must mean a confirmPrompt",
    ]);
  });

  it("refuses a confirm prompt on a command that never asks", () => {
    expect(grammarProblems(grammarOf(command({ confirmPrompt: "Add `confirm`." })))).toEqual([
      "ping: destructive must mean a confirmPrompt",
    ]);
  });

  it("refuses a keyword argument with no word", () => {
    const missing = command({ arguments: [argument("kind", "keyword", false)] });
    const empty = command({ arguments: [{ ...argument("kind", "keyword", false), word: "" }] });
    const sound = command({ arguments: [{ ...argument("kind", "keyword", false), word: "pr" }] });

    expect(grammarProblems(grammarOf(missing))).toEqual(["ping: a keyword argument has no word"]);
    expect(grammarProblems(grammarOf(empty))).toEqual(["ping: a keyword argument has no word"]);
    expect(grammarProblems(grammarOf(sound))).toEqual([]);
  });

  it("refuses a v2 command with no honest reply, and a reply on a command that runs", () => {
    expect(grammarProblems(grammarOf(command({ stage: "v2" })))).toEqual([
      "ping: v2 must mean an unavailableReply",
    ]);
    expect(grammarProblems(grammarOf(command({ unavailableReply: "Not yet." })))).toEqual([
      "ping: v2 must mean an unavailableReply",
    ]);
    expect(
      grammarProblems(grammarOf(command({ stage: "v2", unavailableReply: "Not yet." }))),
    ).toEqual([]);
  });

  it("reports every broken rule, one sentence each", () => {
    const broken = command({ id: "Help", stage: "v2", destructive: true });

    expect(grammarProblems(grammarOf(broken))).toEqual([
      '"Help" is not a command name chat_commands.command accepts',
      "Help: destructive must mean exactly one confirm argument",
      "Help: destructive must mean a confirmPrompt",
      "Help: v2 must mean an unavailableReply",
    ]);
  });
});

describe("bindingProblems", () => {
  it("is satisfied by one binding per available command", () => {
    expect(bindingProblems(GRAMMAR, everyBinding())).toEqual([]);
  });

  it("refuses an available command with no binding: listed, and it could not run", () => {
    const bindings = everyBinding().filter((binding) => binding.command !== "status");

    expect(bindingProblems(GRAMMAR, bindings)).toEqual([
      '"status" is available and has no binding',
    ]);
  });

  it("refuses a binding for a command the grammar does not define", () => {
    expect(bindingProblems(GRAMMAR, [...everyBinding(), { command: "deploy" }])).toEqual([
      'a binding exists for "deploy", which the grammar does not define',
    ]);
  });

  it("knows a binding by the command's id, never an alias", () => {
    const bindings = everyBinding().map((binding) =>
      binding.command === "dry-run" ? { command: "dryrun" } : binding,
    );

    expect(bindingProblems(GRAMMAR, bindings)).toEqual([
      'a binding exists for "dryrun", which the grammar does not define',
      '"dry-run" is available and has no binding',
    ]);
  });

  it("refuses a binding for a v2 command: it would run what is listed as not running", () => {
    expect(bindingProblems(GRAMMAR, [...everyBinding(), { command: "explain pr" }])).toEqual([
      'a binding exists for "explain pr", which is not available yet',
    ]);
  });

  it("refuses two bindings for one command", () => {
    expect(bindingProblems(GRAMMAR, [...everyBinding(), { command: "queue" }])).toEqual([
      '"queue" has 2 bindings',
    ]);
  });

  it("asks for a binding as soon as a command is added", () => {
    expect(bindingProblems(withCommands(GRAMMAR, command()), everyBinding())).toEqual([
      '"ping" is available and has no binding',
    ]);
  });
});
