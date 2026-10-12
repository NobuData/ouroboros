import {
  CONFIRM_WORD,
  argumentErrorText,
  distance,
  echo,
  failureText,
  matchCommand,
  nearest,
  parseArguments,
  syntaxOf,
  tokenize,
  unknownCommand,
  type ParsedArguments,
  type Resolve,
} from "./grammar.parser";
import { ChatArgumentError } from "./grammar.ports";
import { GRAMMAR, commandOf, withCommands } from "./grammar.registry";
import type { ArgumentSpec, CommandDefinition, ResolvedArgument } from "./grammar.types";

/**
 * Reading what was typed after `/ouro` (#537): the same tokens and the same command every time,
 * arguments in the registry's order, and errors that name what was wrong and show the way out.
 */

/** The workflows the fake plane offers. */
const WORKFLOWS = ["standard-fix", "feature-loop", "hotfix"];

/** One call the fake resolver received. */
interface ResolveCall {
  readonly name: string;
  readonly raw: string;
  readonly previous: readonly string[];
}

/**
 * A command of the real grammar.
 *
 * @param name - Its id or an alias.
 * @returns The definition; the test fails when the registry has no such command.
 */
function registered(name: string): CommandDefinition {
  const definition = commandOf(GRAMMAR, name);

  if (definition === undefined) {
    throw new Error(`the registry has no "${name}"`);
  }

  return definition;
}

/**
 * A stand-in for the planes' resolver: numbers are issues and loops, three workflows exist, and
 * an action is read against the question before it.
 *
 * @returns The resolver, and every call it received in order.
 */
function fakeResolver(): { resolve: Resolve; calls: ResolveCall[] } {
  const calls: ResolveCall[] = [];

  const resolve: Resolve = (spec, raw, previous) => {
    calls.push({ name: spec.name, raw, previous: Object.keys(previous) });

    return Promise.resolve().then(() => read(spec, raw, previous));
  };

  return { resolve, calls };
}

/**
 * What the fake plane makes of one argument.
 *
 * @param spec - The argument.
 * @param raw - What was typed for it.
 * @param previous - The arguments already resolved.
 * @returns The resolved argument.
 * @throws {ChatArgumentError} When the text names nothing the fake plane knows.
 */
function read(
  spec: ArgumentSpec,
  raw: string,
  previous: Readonly<Record<string, ResolvedArgument>>,
): ResolvedArgument {
  const number = /^#?(\d+)$/.exec(raw)?.[1];

  switch (spec.type) {
    case "ticket":
      if (number === undefined) {
        throw new ChatArgumentError(spec.name, `"${raw}" is not an issue number`);
      }

      return {
        type: "ticket",
        issueId: `issue-${number}`,
        number: Number(number),
        repository: "acme/helios",
        ticketId: null,
      };
    case "loop":
      if (number === undefined) {
        throw new ChatArgumentError(spec.name, `no live loop "${raw}"`, ["1847", "1851"]);
      }

      return { type: "loop", runId: `run-${number}`, loopSeq: Number(number) };
    case "workflow":
      if (!WORKFLOWS.includes(raw)) {
        throw new ChatArgumentError(spec.name, `unknown workflow "${raw}"`, WORKFLOWS);
      }

      return { type: "workflow", slug: raw };
    case "question":
      return { type: "question", itemId: `item-${raw}`, shortId: raw };
    case "action": {
      const question = previous["question"];

      if (question?.type !== "question" || raw !== "allow_once") {
        throw new ChatArgumentError(spec.name, `${raw} is not an answer`, ["allow_once", "deny"]);
      }

      return { type: "action", actionId: raw };
    }
    default:
      throw new Error(`the fake plane does not read ${spec.type}`);
  }
}

/**
 * Parse some text against the real grammar with the fake resolver.
 *
 * @param text - Everything after `/ouro`; it must begin with a command.
 * @returns What the parser made of the arguments, and the resolver's calls.
 */
async function parse(text: string): Promise<{ parsed: ParsedArguments; calls: ResolveCall[] }> {
  const match = matchCommand(GRAMMAR, tokenize(text));

  if (match === undefined) {
    throw new Error(`"${text}" begins with no command`);
  }

  const { resolve, calls } = fakeResolver();

  return { parsed: await parseArguments(match.definition, match.rest, resolve), calls };
}

/**
 * The sentence some text is refused with.
 *
 * @param text - Everything after `/ouro`; it must begin with a command and fail to parse.
 * @returns The failure's text.
 */
async function refusal(text: string): Promise<string> {
  const { parsed } = await parse(text);

  if (parsed.ok) {
    throw new Error(`"${text}" parsed`);
  }

  return failureText(parsed.failure);
}

describe("tokenize", () => {
  it("splits on any run of whitespace", () => {
    expect(tokenize("  pause   loop\t1847 \n")).toEqual(["pause", "loop", "1847"]);
  });

  it("makes nothing of blank text", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize(" \t ")).toEqual([]);
  });

  it("leaves each token as typed: case and punctuation are the reader's business", () => {
    expect(tokenize("Queue #485 Standard-Fix")).toEqual(["Queue", "#485", "Standard-Fix"]);
  });

  it("quotes nothing, because no argument holds a space", () => {
    expect(tokenize('queue "feature loop"')).toEqual(["queue", '"feature', 'loop"']);
  });

  it("gives the same tokens for the same text, every time", () => {
    const text = "dry-run  #486   feature-loop";

    expect(tokenize(text)).toEqual(tokenize(text));
    expect(tokenize(text)).toEqual(tokenize(tokenize(text).join(" ")));
  });
});

describe("matchCommand", () => {
  it("finds the command and hands back the tokens after its name", () => {
    const match = matchCommand(GRAMMAR, ["queue", "#485", "hotfix"]);

    expect(match?.definition.id).toBe("queue");
    expect(match?.rest).toEqual(["#485", "hotfix"]);
  });

  it("tells pause loop from pause all by the second word", () => {
    expect(matchCommand(GRAMMAR, ["pause", "loop", "1847"])?.definition.id).toBe("pause loop");
    expect(matchCommand(GRAMMAR, ["pause", "loop", "1847"])?.rest).toEqual(["1847"]);
    expect(matchCommand(GRAMMAR, ["pause", "all"])?.definition.id).toBe("pause all");
    expect(matchCommand(GRAMMAR, ["pause", "all"])?.rest).toEqual([]);
  });

  it("finds no command in half a name", () => {
    expect(matchCommand(GRAMMAR, ["pause"])).toBeUndefined();
    expect(matchCommand(GRAMMAR, ["pause", "1847"])).toBeUndefined();
    expect(matchCommand(GRAMMAR, ["explain", "514"])).toBeUndefined();
  });

  it("finds no command in nothing, or in a word that is none", () => {
    expect(matchCommand(GRAMMAR, [])).toBeUndefined();
    expect(matchCommand(GRAMMAR, ["frobnicate"])).toBeUndefined();
    expect(matchCommand(GRAMMAR, ["queued", "#485"])).toBeUndefined();
  });

  it("reads the name without regard to case, and leaves the arguments as typed", () => {
    const match = matchCommand(GRAMMAR, ["PAUSE", "Loop", "#1847"]);

    expect(match?.definition.id).toBe("pause loop");
    expect(matchCommand(GRAMMAR, ["Queue", "#485", "HotFix"])?.rest).toEqual(["#485", "HotFix"]);
  });

  it("reaches a command by its alias", () => {
    const match = matchCommand(GRAMMAR, ["dryrun", "#486"]);

    expect(match?.definition.id).toBe("dry-run");
    expect(match?.rest).toEqual(["#486"]);
  });

  it("takes the longest name the tokens start with, wherever the shorter one is listed", () => {
    const explain: CommandDefinition = {
      ...registered("status"),
      id: "explain",
      usage: "explain",
      summary: "explain anything",
    };
    const after = withCommands(GRAMMAR, explain);
    const before = { version: GRAMMAR.version, commands: [explain, ...GRAMMAR.commands] };

    for (const grammar of [after, before]) {
      expect(matchCommand(grammar, ["explain", "pr", "514"])?.definition.id).toBe("explain pr");
      expect(matchCommand(grammar, ["explain", "pr", "514"])?.rest).toEqual(["514"]);
      expect(matchCommand(grammar, ["explain", "514"])?.definition.id).toBe("explain");
      expect(matchCommand(grammar, ["explain", "514"])?.rest).toEqual(["514"]);
    }
  });
});

describe("distance", () => {
  it("counts the single-character edits between two words", () => {
    expect(distance("loop", "loop")).toBe(0);
    expect(distance("lopp", "loop")).toBe(1);
    expect(distance("", "abc")).toBe(3);
    expect(distance("kitten", "sitting")).toBe(3);
  });
});

describe("nearest", () => {
  it("offers a near miss", () => {
    expect(nearest("feature-lopp", WORKFLOWS)).toEqual(["feature-loop"]);
  });

  it("puts names that start with the text first, then the closest", () => {
    expect(nearest("pause", ["status", "pause loop", "pause all", "pauze"])).toEqual([
      "pause all",
      "pause loop",
      "pauze",
    ]);
  });

  it("offers nothing for a name nothing like the text: a wrong suggestion is worse than none", () => {
    expect(nearest("frobnicate", WORKFLOWS)).toEqual([]);
    expect(nearest("", WORKFLOWS)).toEqual([]);
  });

  it("offers no more than it was asked for", () => {
    expect(nearest("a", ["ab", "ac", "ad", "ae"])).toEqual(["ab", "ac", "ad"]);
    expect(nearest("a", ["ab", "ac", "ad", "ae"], 1)).toEqual(["ab"]);
  });
});

describe("unknownCommand", () => {
  it("names the word typed and offers the nearest commands", () => {
    const failure = unknownCommand(GRAMMAR, ["staus"]);

    expect(failure).toEqual({ kind: "unknown_command", typed: "staus", suggestions: ["status"] });
    expect(failureText(failure)).toBe('unknown command "staus" — try: status');
  });

  it("offers both commands half a name could have meant", () => {
    expect(failureText(unknownCommand(GRAMMAR, ["pause"]))).toBe(
      'unknown command "pause" — try: pause all, pause loop',
    );
  });

  it("reads two words before one: pause lop is nearest pause loop", () => {
    expect(failureText(unknownCommand(GRAMMAR, ["pause", "lop", "1847"]))).toBe(
      'unknown command "pause" — try: pause loop, pause all',
    );
  });

  it("offers the command a first word begins", () => {
    expect(failureText(unknownCommand(GRAMMAR, ["explain"]))).toBe(
      'unknown command "explain" — try: explain pr',
    );
    expect(failureText(unknownCommand(GRAMMAR, ["Queu", "#485"]))).toBe(
      'unknown command "queu" — try: queue',
    );
  });

  it("points at help when nothing is near", () => {
    const failure = unknownCommand(GRAMMAR, ["frobnicate"]);

    expect(failure).toEqual({ kind: "unknown_command", typed: "frobnicate", suggestions: [] });
    expect(failureText(failure)).toBe(
      'unknown command "frobnicate" — `/ouro help` lists the commands',
    );
  });

  it("says back what was typed without the markup a chat platform would act on", () => {
    expect(failureText(unknownCommand(GRAMMAR, ["<!channel>"]))).toBe(
      'unknown command "!channel" — `/ouro help` lists the commands',
    );
  });
});

describe("parseArguments", () => {
  it("reads the arguments in the registry's order, by name", async () => {
    const { parsed, calls } = await parse("queue #485 feature-loop");

    expect(parsed).toEqual({
      ok: true,
      confirmed: false,
      args: {
        ticket: {
          type: "ticket",
          issueId: "issue-485",
          number: 485,
          repository: "acme/helios",
          ticketId: null,
        },
        workflow: { type: "workflow", slug: "feature-loop" },
      },
    });
    expect(calls).toEqual([
      { name: "ticket", raw: "#485", previous: [] },
      { name: "workflow", raw: "feature-loop", previous: ["ticket"] },
    ]);
  });

  it("leaves an optional argument that was not typed absent", async () => {
    const { parsed, calls } = await parse("queue 485");

    expect(parsed.ok && Object.keys(parsed.args)).toEqual(["ticket"]);
    expect(calls).toHaveLength(1);
  });

  it("takes no arguments for a command that has none", async () => {
    expect((await parse("status")).parsed).toEqual({ ok: true, confirmed: false, args: {} });
  });

  it("names the argument that is missing, and shows the syntax", async () => {
    const { parsed, calls } = await parse("queue");

    expect(parsed).toMatchObject({
      ok: false,
      failure: { kind: "missing_argument", argument: { name: "ticket" } },
    });
    expect(calls).toEqual([]);
    expect(await refusal("queue")).toBe(
      "`/ouro queue` needs a ticket — usage: `/ouro queue <ticket> [workflow]`",
    );
  });

  it("names the second argument when the first was given", async () => {
    expect(await refusal("answer q-231")).toBe(
      "`/ouro answer` needs an action — usage: `/ouro answer <question> <action>`",
    );
    expect(await refusal("route")).toBe(
      "`/ouro route` needs a task — usage: `/ouro route <task> <alias>`",
    );
  });

  it("names the word it has nowhere to put, before asking a plane anything", async () => {
    const { parsed, calls } = await parse("queue #485 hotfix now please");

    expect(parsed).toMatchObject({ ok: false, failure: { kind: "extra_argument", extra: "now" } });
    expect(calls).toEqual([]);
    expect(await refusal("queue #485 hotfix now please")).toBe(
      '`/ouro queue` has nowhere to put "now" — usage: `/ouro queue <ticket> [workflow]`',
    );
    expect(await refusal("status please")).toBe(
      '`/ouro status` has nowhere to put "please" — usage: `/ouro status`',
    );
  });

  it("answers a name the plane does not know with the plane's words and its alternatives", async () => {
    const { parsed } = await parse("queue #485 feature-lopp");

    expect(parsed).toMatchObject({
      ok: false,
      failure: {
        kind: "bad_argument",
        argument: "workflow",
        message: 'unknown workflow "feature-lopp"',
        suggestions: WORKFLOWS,
      },
    });
    expect(await refusal("queue #485 feature-lopp")).toBe(
      'unknown workflow "feature-lopp" — try: standard-fix, feature-loop, hotfix',
    );
  });

  it("prefixes the argument's name when the plane's sentence does not say it", async () => {
    expect(await refusal("estimate soon")).toBe('ticket: "soon" is not an issue number');
  });

  it("stops at the first argument that is wrong", async () => {
    const { parsed, calls } = await parse("queue soon feature-lopp");

    expect(parsed).toMatchObject({ ok: false, failure: { argument: "ticket" } });
    expect(calls.map((call) => call.name)).toEqual(["ticket"]);
  });

  it("hands a later argument the ones before it: an action is read against its question", async () => {
    const { parsed, calls } = await parse("answer q-231 allow_once");

    expect(parsed.ok && parsed.args).toEqual({
      question: { type: "question", itemId: "item-q-231", shortId: "q-231" },
      action: { type: "action", actionId: "allow_once" },
    });
    expect(calls[1]).toEqual({ name: "action", raw: "allow_once", previous: ["question"] });
    expect(await refusal("answer q-231 allow")).toBe(
      "action: allow is not an answer — try: allow_once, deny",
    );
  });

  it("hands the resolver a copy of what came before, not the arguments it is building", async () => {
    const seen: Readonly<Record<string, ResolvedArgument>>[] = [];
    const { resolve } = fakeResolver();
    const parsed = await parseArguments(registered("queue"), ["#485", "hotfix"], (...call) => {
      seen.push(call[2]);

      return resolve(...call);
    });

    expect(parsed.ok).toBe(true);
    expect(seen.map((previous) => Object.keys(previous))).toEqual([[], ["ticket"]]);
  });

  it("lets a failure of the plane through: that is not something typed wrong", async () => {
    const down: Resolve = () => Promise.reject(new Error("connection refused"));

    await expect(parseArguments(registered("queue"), ["#485"], down)).rejects.toThrow(
      "connection refused",
    );
  });

  it("is not confirmed until confirm is typed", async () => {
    const { parsed, calls } = await parse("abort loop 1847");

    expect(parsed).toEqual({
      ok: true,
      confirmed: false,
      args: { loop: { type: "loop", runId: "run-1847", loopSeq: 1847 } },
    });
    expect(calls.map((call) => call.name)).toEqual(["loop"]);
  });

  it("is confirmed by the literal word, which no plane is asked about", async () => {
    const { parsed, calls } = await parse("abort loop #1847 confirm");

    expect(CONFIRM_WORD).toBe("confirm");
    expect(parsed).toEqual({
      ok: true,
      confirmed: true,
      args: {
        loop: { type: "loop", runId: "run-1847", loopSeq: 1847 },
        confirm: { type: "confirm" },
      },
    });
    expect(calls.map((call) => call.name)).toEqual(["loop"]);
  });

  it("reads confirm without regard to case", async () => {
    expect((await parse("pause all CONFIRM")).parsed).toMatchObject({ ok: true, confirmed: true });
    expect((await parse("pause all")).parsed).toEqual({ ok: true, confirmed: false, args: {} });
  });

  it("takes nothing else for confirm, and says which word it wanted", async () => {
    const { parsed } = await parse("abort loop 1847 yes");

    expect(parsed).toMatchObject({
      ok: false,
      failure: { kind: "wrong_keyword", argument: { name: "confirm" }, typed: "yes" },
    });
    expect(await refusal("abort loop 1847 yes")).toBe(
      '`/ouro abort loop` takes the word `confirm` where "yes" was typed — usage: `/ouro abort loop <loop> confirm`',
    );
    expect(await refusal("pause all now")).toBe(
      '`/ouro pause all` takes the word `confirm` where "now" was typed — usage: `/ouro pause all confirm`',
    );
  });

  it("never confirms a command that has no confirm argument", async () => {
    const { parsed } = await parse("pause loop 1847 confirm");

    expect(parsed).toMatchObject({
      ok: false,
      failure: { kind: "extra_argument", extra: "confirm" },
    });
  });

  it("names a missing loop on a destructive command before any talk of confirming", async () => {
    expect(await refusal("abort loop")).toBe(
      "`/ouro abort loop` needs a loop — usage: `/ouro abort loop <loop> confirm`",
    );
    expect(await refusal("abort loop confirm")).toBe('no live loop "confirm" — try: 1847, 1851');
  });

  it("settles a keyword itself: the word as written, in any case, and nothing else", async () => {
    const show: CommandDefinition = {
      ...registered("status"),
      id: "show",
      usage: "show pr 514",
      arguments: [
        { name: "kind", type: "keyword", word: "pr", optional: false, description: "the word pr" },
      ],
    };
    const { resolve, calls } = fakeResolver();

    expect(await parseArguments(show, ["PR"], resolve)).toEqual({
      ok: true,
      confirmed: false,
      args: { kind: { type: "keyword", word: "pr" } },
    });

    const wrong = await parseArguments(show, ["mr"], resolve);

    expect(calls).toEqual([]);
    expect(syntaxOf(show)).toBe("/ouro show pr");
    expect(!wrong.ok && failureText(wrong.failure)).toBe(
      '`/ouro show` takes the word `pr` where "mr" was typed — usage: `/ouro show pr`',
    );
  });
});

describe("syntaxOf", () => {
  it("generates the syntax line from the arguments", () => {
    expect(syntaxOf(registered("status"))).toBe("/ouro status");
    expect(syntaxOf(registered("queue"))).toBe("/ouro queue <ticket> [workflow]");
    expect(syntaxOf(registered("route"))).toBe("/ouro route <task> <alias>");
  });

  it("ends a destructive command in the word confirm", () => {
    expect(syntaxOf(registered("abort loop"))).toBe("/ouro abort loop <loop> confirm");
    expect(syntaxOf(registered("pause all"))).toBe("/ouro pause all confirm");
  });

  it("names a command by its id, whichever alias reached it", () => {
    expect(syntaxOf(registered("dryrun"))).toBe("/ouro dry-run <ticket> [workflow]");
  });
});

describe("argumentErrorText", () => {
  it("says the plane's sentence, then the alternatives", () => {
    expect(argumentErrorText("workflow", 'unknown workflow "feature-lopp"', WORKFLOWS)).toBe(
      'unknown workflow "feature-lopp" — try: standard-fix, feature-loop, hotfix',
    );
  });

  it("offers nothing when the plane had nothing near", () => {
    expect(argumentErrorText("workflow", 'unknown workflow "x"', [])).toBe('unknown workflow "x"');
  });

  it("names the argument itself when the sentence does not", () => {
    expect(argumentErrorText("ticket", "no open issue #999", ["#485"])).toBe(
      "ticket: no open issue #999 — try: #485",
    );
  });

  it("finds the argument's name in the sentence without regard to case", () => {
    expect(argumentErrorText("alias", "Alias gpt-9 is not offered", [])).toBe(
      "Alias gpt-9 is not offered",
    );
  });
});

describe("echo", () => {
  it("drops what a chat platform would read as markup, a mention or a control", () => {
    expect(echo(`a\`b<c>d&e${String.fromCharCode(7)}f`)).toBe("abcdef");
    expect(echo("<@U07MAYA>")).toBe("@U07MAYA");
  });

  it("repeats only so much of what was typed", () => {
    expect(echo("x".repeat(48))).toBe("x".repeat(48));
    expect(echo("x".repeat(49))).toBe(`${"x".repeat(48)}…`);
  });
});
