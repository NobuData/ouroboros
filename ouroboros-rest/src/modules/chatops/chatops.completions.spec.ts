import { COMPLETION_LIMIT, commandCompletions, complete, positionOf } from "./chatops.completions";
import type { Completion, CompletionSources } from "./grammar.ports";
import { GRAMMAR, GRAMMAR_VERSION, withCommands } from "./grammar.registry";
import type {
  ArgumentSpec,
  ArgumentType,
  CommandDefinition,
  CompletionSource,
  Invoker,
} from "./grammar.types";

/**
 * Completion hints (#537): the text is read as the dispatcher reads it, the argument being typed
 * is the one asked about, and every argument of the registry that declares a completion source
 * is served from that source.
 */

const ORG = "org-acme";

const MAYA: Invoker = {
  userId: "user-maya",
  name: "Maya Chen",
  roles: ["member"],
  canApproveLoops: null,
};

/**
 * What each vocabulary offers in these specs. Keyed by every {@link CompletionSource}, so a
 * source cannot be added to the grammar's types without an answer here.
 */
const VOCABULARY: Readonly<Record<CompletionSource, readonly Completion[]>> = {
  tickets: [{ value: "#485", label: "Flaky retry in the sync worker" }],
  loops: [{ value: "1847", label: "#485 · implement" }],
  workflows: [{ value: "standard-fix", label: "Standard fix" }],
  aliases: [{ value: "claude-fable-5", label: "Fable 5" }],
  questions: [{ value: "q-231", label: "Allow a write to a protected path?" }],
  actions: [{ value: "allow_once", label: "Allow once" }],
  task_kinds: [{ value: "implement", label: "Implement" }],
};

/** What is typed for an argument of each type, when it comes before the one being completed. */
const TYPED: Readonly<Record<ArgumentType, string>> = {
  ticket: "#485",
  loop: "1847",
  workflow: "standard-fix",
  alias: "claude-fable-5",
  task_kind: "implement",
  question: "q-231",
  action: "allow_once",
  pr: "514",
  keyword: "",
  confirm: "confirm",
};

/**
 * What is typed for one argument.
 *
 * @param argument - The argument.
 * @returns Its sample text — a keyword's own word.
 */
function rawOf(argument: ArgumentSpec): string {
  return argument.type === "keyword" ? (argument.word ?? "") : TYPED[argument.type];
}

/** One call to the completion port. */
interface Asked {
  organizationId: string;
  invoker: Invoker;
  source: CompletionSource;
  prefix: string;
  previous: Readonly<Record<string, string>>;
  limit: number;
}

/**
 * The planes' vocabularies, as a double.
 *
 * @param vocabulary - What each source offers.
 * @returns The port, and what it was asked.
 */
function sources(
  vocabulary: Readonly<Record<CompletionSource, readonly Completion[]>> = VOCABULARY,
): { port: CompletionSources; asked: Asked[] } {
  const asked: Asked[] = [];

  return {
    asked,
    port: {
      complete: (organizationId, invoker, source, prefix, previous, limit) => {
        asked.push({ organizationId, invoker, source, prefix, previous, limit });

        return Promise.resolve([...vocabulary[source]]);
      },
    },
  };
}

/** Every argument of the registry, with the command it belongs to and where it sits. */
const ARGUMENTS = GRAMMAR.commands.flatMap((definition) =>
  definition.arguments.map((argument, index) => ({ definition, argument, index })),
);

describe("every argument that has a completion source", () => {
  const completed = ARGUMENTS.filter(({ argument }) => argument.completion !== undefined);

  it.each(
    completed.map(
      (entry) =>
        [entry.definition.id, entry.argument.name, entry.argument.completion, entry] as const,
    ),
  )("/ouro %s — %s is served from %s", async (id, name, source, entry) => {
    const { port, asked } = sources();
    const before = entry.definition.arguments.slice(0, entry.index);
    const settled = [id, ...before.map(rawOf)].join(" ");
    const previous = Object.fromEntries(before.map((argument) => [argument.name, rawOf(argument)]));

    // With the argument not started, and with part of it typed.
    const empty = await complete(GRAMMAR, port, ORG, MAYA, `${settled} `);
    const partial = await complete(GRAMMAR, port, ORG, MAYA, `${settled} st`);

    expect(source).toBeDefined();
    expect(asked).toEqual([
      { organizationId: ORG, invoker: MAYA, source, prefix: "", previous, limit: COMPLETION_LIMIT },
      {
        organizationId: ORG,
        invoker: MAYA,
        source,
        prefix: "st",
        previous,
        limit: COMPLETION_LIMIT,
      },
    ]);

    for (const answer of [empty, partial]) {
      expect(answer).toEqual({
        grammarVersion: GRAMMAR_VERSION,
        command: id,
        argument: name,
        completions: VOCABULARY[source as CompletionSource],
      });
      expect(answer.completions.length).toBeGreaterThan(0);
    }
  });

  it("is every argument that names something a plane lists — only a PR number has no vocabulary", () => {
    const without = ARGUMENTS.filter(
      ({ argument }) =>
        argument.completion === undefined &&
        argument.type !== "confirm" &&
        argument.type !== "keyword",
    );

    expect(completed.length).toBeGreaterThan(0);
    expect(without.map(({ definition, argument }) => `${definition.id} ${argument.name}`)).toEqual([
      "explain pr pr",
    ]);
  });

  it("uses every source the grammar declares, and declares none nobody answers", () => {
    const declared = new Set(completed.map(({ argument }) => argument.completion));

    expect([...declared].sort()).toEqual(Object.keys(VOCABULARY).sort());
  });

  it("hands an action's source the question typed before it", async () => {
    const { port, asked } = sources();

    await complete(GRAMMAR, port, ORG, MAYA, "answer q-231 all");

    expect(asked).toEqual([
      {
        organizationId: ORG,
        invoker: MAYA,
        source: "actions",
        prefix: "all",
        previous: { question: "q-231" },
        limit: COMPLETION_LIMIT,
      },
    ]);
  });

  it("never offers more than the limit, whatever a source returns", async () => {
    const many = Array.from({ length: COMPLETION_LIMIT + 5 }, (_, index) => ({
      value: `#${String(400 + index)}`,
      label: `Issue ${String(400 + index)}`,
    }));
    const { port } = sources({ ...VOCABULARY, tickets: many });

    const answer = await complete(GRAMMAR, port, ORG, MAYA, "queue ");

    expect(answer.completions).toEqual(many.slice(0, COMPLETION_LIMIT));
  });

  it("answers an empty list, honestly, when the source has nothing", async () => {
    const { port } = sources({ ...VOCABULARY, loops: [] });

    expect(await complete(GRAMMAR, port, ORG, MAYA, "pause loop 99")).toEqual({
      grammarVersion: GRAMMAR_VERSION,
      command: "pause loop",
      argument: "loop",
      completions: [],
    });
  });
});

describe("arguments the grammar settles itself", () => {
  it.each(GRAMMAR.commands.filter((command) => command.destructive))(
    "offers the word confirm, with what it means, as $id's last argument",
    async (definition) => {
      const { port, asked } = sources();
      const confirm = definition.arguments[definition.arguments.length - 1];
      const settled = [definition.id, ...definition.arguments.slice(0, -1).map(rawOf)].join(" ");

      for (const typed of [`${settled} `, `${settled} co`, `${settled} CONF`]) {
        expect(await complete(GRAMMAR, port, ORG, MAYA, typed)).toEqual({
          grammarVersion: GRAMMAR_VERSION,
          command: definition.id,
          argument: "confirm",
          completions: [{ value: "confirm", label: confirm.description }],
        });
      }

      expect((await complete(GRAMMAR, port, ORG, MAYA, `${settled} yes`)).completions).toEqual([]);
      // No plane is asked about a word the grammar owns.
      expect(asked).toEqual([]);
    },
  );

  it("offers a keyword argument's own word", async () => {
    const tail: CommandDefinition = {
      id: "tail",
      aliases: [],
      summary: "follow a loop's log",
      usage: "tail loop 1847",
      arguments: [
        { name: "what", type: "keyword", optional: false, word: "loop", description: "the word" },
        {
          name: "loop",
          type: "loop",
          optional: false,
          completion: "loops",
          description: "the loop's number",
        },
      ],
      requires: { roles: [] },
      destructive: false,
      mode: "sync",
      stage: "available",
      binds: "a fixture",
    };
    const grammar = withCommands(GRAMMAR, tail);
    const { port, asked } = sources();

    expect((await complete(grammar, port, ORG, MAYA, "tail l")).completions).toEqual([
      { value: "loop", label: "the word" },
    ]);
    expect((await complete(grammar, port, ORG, MAYA, "tail x")).completions).toEqual([]);
    expect(asked).toEqual([]);

    // A fixture command's argument is completed from its source with no other change.
    expect(await complete(grammar, port, ORG, MAYA, "tail loop 18")).toMatchObject({
      command: "tail",
      argument: "loop",
      completions: VOCABULARY.loops,
    });
    expect(asked).toEqual([
      expect.objectContaining({ source: "loops", prefix: "18", previous: { what: "loop" } }),
    ]);
  });

  it("answers an empty list for an argument with no vocabulary, without asking a plane", async () => {
    const { port, asked } = sources();

    expect(await complete(GRAMMAR, port, ORG, MAYA, "explain pr 5")).toEqual({
      grammarVersion: GRAMMAR_VERSION,
      command: "explain pr",
      argument: "pr",
      completions: [],
    });
    expect(asked).toEqual([]);
  });
});

describe("while the command is being typed", () => {
  it("offers every command and help for nothing typed — and not Slack's own link and unlink", async () => {
    const { port, asked } = sources();

    const answer = await complete(GRAMMAR, port, ORG, MAYA, "");

    expect(answer).toMatchObject({
      grammarVersion: GRAMMAR_VERSION,
      command: null,
      argument: null,
    });
    expect(answer.completions.map((completion) => completion.value)).toEqual([
      ...GRAMMAR.commands.map((command) => command.id),
      "help",
    ]);
    expect(asked).toEqual([]);
  });

  it("narrows to the commands that start with what was typed, in the registry's order", () => {
    expect(commandCompletions(GRAMMAR, "pau")).toEqual([
      { value: "pause loop", label: "hold a loop mid-flight" },
      { value: "pause all", label: "the big red button" },
    ]);
    expect(commandCompletions(GRAMMAR, "pause l")).toEqual([
      { value: "pause loop", label: "hold a loop mid-flight" },
    ]);
    expect(commandCompletions(GRAMMAR, "zz")).toEqual([]);
  });

  it("reads a half-typed two-word name as still the command", async () => {
    const { port } = sources();

    for (const text of ["pau", "pause", "pause ", "PAUSE  "]) {
      const answer = await complete(GRAMMAR, port, ORG, MAYA, text);

      expect(answer.command).toBeNull();
      expect(answer.completions.map((completion) => completion.value)).toEqual([
        "pause loop",
        "pause all",
      ]);
    }
  });

  it("offers an alias when only the alias matches, and the id otherwise", () => {
    expect(commandCompletions(GRAMMAR, "dry").map((completion) => completion.value)).toEqual([
      "dry-run",
    ]);
    expect(commandCompletions(GRAMMAR, "dryr").map((completion) => completion.value)).toEqual([
      "dryrun",
    ]);
  });

  it("marks a command that is not available yet", () => {
    expect(commandCompletions(GRAMMAR, "ex")).toEqual([
      { value: "explain pr", label: "plain-language summary of a PR (v2)" },
    ]);
  });

  it("offers help by its own name", () => {
    expect(commandCompletions(GRAMMAR, "he")).toEqual([
      { value: "help", label: "this list, or one command in detail" },
    ]);
    expect(commandCompletions(GRAMMAR, "li")).toEqual([]);
    expect(commandCompletions(GRAMMAR, "unl")).toEqual([]);
  });

  it("lists a command added to the grammar with no other change", () => {
    const ping: CommandDefinition = {
      id: "ping",
      aliases: [],
      summary: "check the loop is listening",
      usage: "ping",
      arguments: [],
      requires: { roles: [] },
      destructive: false,
      mode: "sync",
      stage: "available",
      binds: "a fixture",
    };

    expect(commandCompletions(withCommands(GRAMMAR, ping), "pi")).toEqual([
      { value: "ping", label: "check the loop is listening" },
    ]);
  });
});

describe("past the last argument", () => {
  it.each(GRAMMAR.commands.map((definition) => [definition.id, definition] as const))(
    "/ouro %s has nothing left to offer once every argument is typed",
    async (id, definition) => {
      const { port, asked } = sources();
      const text = `${[id, ...definition.arguments.map(rawOf)].join(" ")} `;

      expect(await complete(GRAMMAR, port, ORG, MAYA, text)).toEqual({
        grammarVersion: GRAMMAR_VERSION,
        command: id,
        argument: null,
        completions: [],
      });
      expect(asked).toEqual([]);
    },
  );
});

describe("positionOf", () => {
  it("treats the last word as being typed unless the text ends in whitespace", () => {
    expect(positionOf(GRAMMAR, "queue #48")).toMatchObject({
      at: "argument",
      argument: { name: "ticket" },
      prefix: "#48",
      previous: {},
    });
    expect(positionOf(GRAMMAR, "queue #48 ")).toMatchObject({
      at: "argument",
      argument: { name: "workflow" },
      prefix: "",
      previous: { ticket: "#48" },
    });
    expect(positionOf(GRAMMAR, "queue #485 st")).toMatchObject({
      at: "argument",
      argument: { name: "workflow" },
      prefix: "st",
      previous: { ticket: "#485" },
    });
  });

  it("does not name a command whose name is still open, and names it once a space follows", () => {
    expect(positionOf(GRAMMAR, "queue")).toEqual({ at: "command", typed: "queue" });
    expect(positionOf(GRAMMAR, "queue ")).toMatchObject({
      at: "argument",
      definition: { id: "queue" },
    });
    expect(positionOf(GRAMMAR, "status ")).toMatchObject({
      at: "end",
      definition: { id: "status" },
    });
  });

  it("reads the same tokens the dispatcher does: any case, any spacing, the longest name", () => {
    expect(positionOf(GRAMMAR, "  PAUSE   Loop  18")).toMatchObject({
      at: "argument",
      definition: { id: "pause loop" },
      argument: { name: "loop" },
      prefix: "18",
    });
    expect(positionOf(GRAMMAR, "dryrun ")).toMatchObject({
      at: "argument",
      definition: { id: "dry-run" },
    });
    expect(positionOf(GRAMMAR, "Frob NIC")).toEqual({ at: "command", typed: "frob nic" });
    expect(positionOf(GRAMMAR, "")).toEqual({ at: "command", typed: "" });
    expect(positionOf(GRAMMAR, "   ")).toEqual({ at: "command", typed: "" });
  });

  it("works while the line is still wrong: nothing already typed is validated", () => {
    expect(positionOf(GRAMMAR, "queue not-a-ticket ")).toMatchObject({
      at: "argument",
      argument: { name: "workflow" },
      previous: { ticket: "not-a-ticket" },
    });
    // One word too many is past the end, not an error.
    expect(positionOf(GRAMMAR, "status now and more")).toMatchObject({ at: "end" });
  });
});
