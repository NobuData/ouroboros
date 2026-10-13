import { describe, expect, it } from "vitest";

import { commands, grammar, record, result } from "../helpers/console";
import {
  CONSOLE_PREFIX,
  acceptCompletion,
  completionRequest,
  completionTarget,
  confirmLabel,
  consoleEntries,
  consoleOffset,
  consoleQuery,
  consoleText,
  deniedView,
  entryQuery,
  filterEntries,
  isConsoleQuery,
  isConsoleRefusal,
  namedEntry,
  noCommandMatches,
  nothingMatches,
  refusalView,
  replyView,
  runningLabel,
  settledToast,
} from "@/app/shell/console";

/**
 * The console's model (#539): when the palette's box holds a command, what the line names,
 * which word the caret is completing, and the sentences the mode says. Pure functions of a
 * line and a grammar, so none of it needs a palette.
 */

const ENTRIES = consoleEntries(grammar());

/**
 * One entry of the fixture grammar.
 *
 * @param id The command.
 * @returns The entry.
 */
function entry(id: string) {
  const found = ENTRIES.find((one) => one.id === id);
  if (found === undefined) throw new Error(`No entry ${id}`);
  return found;
}

describe("the prefix", () => {
  it("is the grammar's own", () => {
    expect(CONSOLE_PREFIX).toBe(grammar().prefix);
  });

  it.each([
    ["/ouro", true],
    ["/ouro ", true],
    ["/ouro status", true],
    ["/OURO status", true],
    ["/ouro  queue #485", true],
  ])("reads %j as a command", (query, expected) => {
    expect(isConsoleQuery(query)).toBe(expected);
  });

  it.each([
    [""],
    ["/"],
    ["/our"],
    ["/ouroboros"],
    ["/ourostatus"],
    [" /ouro status"],
    ["ouro status"],
    ["issues /ouro"],
  ])("reads %j as a search", (query) => {
    expect(isConsoleQuery(query)).toBe(false);
  });

  it("leaves command mode as soon as the prefix is cut into", () => {
    // Deleting back out of it, one character at a time.
    expect(isConsoleQuery("/ouro s")).toBe(true);
    expect(isConsoleQuery("/ouro ")).toBe(true);
    expect(isConsoleQuery("/ouro")).toBe(true);
    expect(isConsoleQuery("/our")).toBe(false);
  });

  it("gives back what follows it", () => {
    expect(consoleText("/ouro")).toBe("");
    expect(consoleText("/ouro ")).toBe("");
    expect(consoleText("/ouro status")).toBe("status");
    expect(consoleText("/ouro queue #485 ")).toBe("queue #485 ");
    expect(consoleText("dashboard")).toBe("");
  });

  it("counts the prefix and its space, and no more than the box holds", () => {
    expect(consoleOffset("/ouro")).toBe(5);
    expect(consoleOffset("/ouro status")).toBe(6);
  });

  it("puts a command's text behind it, once", () => {
    expect(consoleQuery("")).toBe("/ouro ");
    expect(consoleQuery("status")).toBe("/ouro status");
    // A service that sent the whole line as `confirmWith` still fills something that runs.
    expect(consoleQuery("/ouro abort loop 1847 confirm")).toBe("/ouro abort loop 1847 confirm");
  });
});

describe("the entries", () => {
  it("are every command of the grammar, in its order, then the words the console answers", () => {
    expect(ENTRIES.map((one) => one.id)).toEqual([...commands().map((one) => one.id), "help"]);
  });

  it("leave out the words that are only Slack's", () => {
    expect(ENTRIES.map((one) => one.id)).not.toContain("link");
    expect(ENTRIES.map((one) => one.id)).not.toContain("unlink");
  });

  it("show the usage with the prefix, as mockup 19 prints it", () => {
    expect(entry("queue").usage).toBe("/ouro queue #485 [workflow]");
    expect(entry("queue").syntax).toBe("/ouro queue <ticket> [workflow]");
    expect(entry("help").usage).toBe("/ouro help [command]");
  });

  it("carry the reason a command is not the caller's to run", () => {
    expect(entry("route")).toMatchObject({ allowed: false, deniedReason: "needs admin" });
    expect(entry("status")).toMatchObject({ allowed: true, deniedReason: null });
  });

  it("read a missing `allowed` as allowed, which is what an older service answers", () => {
    const bare = commands().map((command) => {
      const { allowed, deniedReason, ...rest } = command;
      void allowed;
      void deniedReason;
      return rest;
    });

    // The contract now requires both fields; an older service's answer is what this stands for.
    const older = bare as unknown as ReturnType<typeof commands>;

    for (const one of consoleEntries(grammar({ commands: older }))) {
      expect(one).toMatchObject({ allowed: true, deniedReason: null });
    }
  });

  it("fall back on the grammar's own words when a denial arrives without a reason", () => {
    const [route] = consoleEntries(
      grammar({
        commands: commands()
          .filter((command) => command.id === "route")
          .map((command) => ({ ...command, deniedReason: null })),
      }),
    );

    expect(route.deniedReason).toBe("for workspace owners and admins only");
  });

  it("mark the command the grammar lists for later", () => {
    expect(ENTRIES.filter((one) => one.v2).map((one) => one.id)).toEqual(["explain pr"]);
  });
});

describe("naming a command", () => {
  it.each([
    ["status", "status", 6],
    ["status ", "status", 6],
    ["STATUS", "status", 6],
    ["  status", "status", 8],
    ["pause loop", "pause loop", 10],
    ["pause   loop 1847", "pause loop", 12],
    ["queue #485 standard-fix", "queue", 5],
    ["dryrun #486", "dry-run", 6],
    ["help", "help", 4],
    ["explain pr 514", "explain pr", 10],
  ])("%j names %s", (text, id, end) => {
    expect(namedEntry(text, ENTRIES)).toEqual({ entry: entry(id), end });
  });

  it.each([[""], ["sta"], ["pause"], ["pause "], ["statusx"], ["foo bar"], ["explain"]])(
    "%j names nothing yet",
    (text) => {
      expect(namedEntry(text, ENTRIES)).toBeNull();
    },
  );

  it("prefers the longest name, so a command is not read as a shorter one with an argument", () => {
    const both = [
      { ...entry("status"), id: "pause", names: ["pause"] },
      entry("pause all"),
    ];

    expect(namedEntry("pause all", both)?.entry.id).toBe("pause all");
    expect(namedEntry("pause now", both)?.entry.id).toBe("pause");
  });
});

describe("filtering the list", () => {
  it("offers everything before anything is typed", () => {
    expect(filterEntries("", ENTRIES)).toEqual(ENTRIES);
    expect(filterEntries("   ", ENTRIES)).toEqual(ENTRIES);
  });

  it("puts the commands that start with what was typed first", () => {
    expect(filterEntries("pause", ENTRIES).map((one) => one.id)).toEqual(["pause loop", "pause all"]);
    expect(filterEntries("e", ENTRIES).map((one) => one.id).slice(0, 2)).toEqual([
      "explain pr",
      "estimate",
    ]);
  });

  it("then the ones that merely contain it", () => {
    expect(filterEntries("loop", ENTRIES).map((one) => one.id)).toEqual([
      "pause loop",
      "resume loop",
      "abort loop",
    ]);
  });

  it("matches an alias, without regard to case or spacing", () => {
    expect(filterEntries("DRYR", ENTRIES).map((one) => one.id)).toEqual(["dry-run"]);
    expect(filterEntries(" pause   l", ENTRIES).map((one) => one.id)).toEqual(["pause loop"]);
  });

  it("offers nothing for a line no command begins", () => {
    expect(filterEntries("deploy", ENTRIES)).toEqual([]);
    expect(noCommandMatches(" deploy ")).toBe(
      "No command matches “deploy”. Press ↵ to send it as typed, or Esc to close.",
    );
  });

  it("fills a chosen command's name in, ready for its argument", () => {
    expect(entryQuery(entry("pause loop"))).toBe("/ouro pause loop ");
  });
});

describe("which word the caret is completing", () => {
  it("is the word the caret is in, up to the caret", () => {
    expect(completionTarget("queue #48", 9)).toEqual({ start: 6, end: 9, typed: "#48" });
    expect(completionTarget("queue #485 standard", 8)).toEqual({ start: 6, end: 10, typed: "#4" });
  });

  it("is a word not started yet, just after a space", () => {
    expect(completionTarget("queue ", 6)).toEqual({ start: 6, end: 6, typed: "" });
  });

  it("clamps a caret that is outside the line", () => {
    expect(completionTarget("queue", 99)).toEqual({ start: 0, end: 5, typed: "queue" });
    expect(completionTarget("queue", -1)).toEqual({ start: 0, end: 5, typed: "" });
  });

  it("asks the service only once the caret is on an argument", () => {
    const queue = namedEntry("queue #4", ENTRIES);

    expect(completionRequest("queue #4", 8, queue)).toBe("queue #4");
    expect(completionRequest("queue ", 6, namedEntry("queue ", ENTRIES))).toBe("queue ");
    // The caret is still in the command's name.
    expect(completionRequest("queue #4", 5, queue)).toBeNull();
    expect(completionRequest("queue #4", 2, queue)).toBeNull();
    // No command is named: the completions are names, which the console already holds.
    expect(completionRequest("que", 3, null)).toBeNull();
  });

  it("asks for the text up to the caret, not the whole line", () => {
    const text = "queue #4 standard-fix";

    expect(completionRequest(text, 8, namedEntry(text, ENTRIES))).toBe("queue #4");
    expect(completionRequest("  queue #4", 10, namedEntry("  queue #4", ENTRIES))).toBe("queue #4");
  });
});

describe("accepting a completion", () => {
  it("replaces the word and follows it with a space", () => {
    expect(acceptCompletion("queue #4", 8, "#485")).toEqual({ text: "queue #485 ", caret: 11 });
  });

  it("starts a word that had not been started", () => {
    expect(acceptCompletion("queue ", 6, "#485")).toEqual({ text: "queue #485 ", caret: 11 });
  });

  it("replaces the whole word under the caret and keeps what came after it", () => {
    expect(acceptCompletion("queue #486 standard-fix", 8, "#485")).toEqual({
      text: "queue #485 standard-fix",
      caret: 11,
    });
  });
});

describe("saying that nothing matches", () => {
  /**
   * What an older service says it was completing: the argument, and no vocabulary.
   *
   * @param argument The argument's name.
   * @returns The answer's two fields.
   */
  const of = (argument: string | null) => ({ argument });

  it("names the vocabulary the service says it was completing from", () => {
    expect(nothingMatches(entry("queue"), { argument: "ticket", source: "tickets" }, "#9")).toBe(
      "No open tickets match “#9”.",
    );
    // The service's word wins over the grammar's, should the two ever differ.
    expect(nothingMatches(entry("queue"), { argument: "ticket", source: "loops" }, "9")).toBe(
      "No live loops match “9”.",
    );
  });

  it("looks the argument up in the grammar when the service names no vocabulary", () => {
    expect(nothingMatches(entry("queue"), of("ticket"), "#9")).toBe("No open tickets match “#9”.");
    expect(nothingMatches(entry("queue"), of("workflow"), "zz")).toBe("No workflows match “zz”.");
    expect(nothingMatches(entry("pause loop"), of("loop"), "99")).toBe("No live loops match “99”.");
    expect(nothingMatches(entry("route"), of("task"), "x")).toBe("No task kinds match “x”.");
    expect(nothingMatches(entry("route"), of("alias"), "x")).toBe("No model aliases match “x”.");
    expect(nothingMatches(entry("answer"), of("question"), "q-9")).toBe(
      "No open questions match “q-9”.",
    );
    expect(nothingMatches(entry("answer"), of("action"), "x")).toBe("No answers match “x”.");
  });

  it("says there is nothing to offer when nothing was typed yet", () => {
    expect(nothingMatches(entry("pause loop"), of("loop"), "")).toBe(
      "There are no live loops to offer.",
    );
  });

  it("says nothing of an argument that has no vocabulary, or of a finished line", () => {
    expect(nothingMatches(entry("explain pr"), { argument: "pr", source: null }, "514")).toBeNull();
    expect(nothingMatches(entry("explain pr"), of("pr"), "514")).toBeNull();
    expect(nothingMatches(entry("abort loop"), of("confirm"), "con")).toBeNull();
    expect(nothingMatches(entry("status"), of(null), "")).toBeNull();
    expect(nothingMatches(entry("status"), of("unheard-of"), "x")).toBeNull();
  });

  it("says nothing of a vocabulary it has no word for", () => {
    expect(
      nothingMatches(entry("queue"), { argument: "ticket", source: "branches" as never }, "x"),
    ).toBeNull();
  });
});

describe("a reply", () => {
  it("is drawn as the dispatcher's outcome", () => {
    expect(replyView("status", result())).toEqual({
      line: "/ouro status",
      tone: "ok",
      text: result().reply.text,
      link: null,
      confirmWith: null,
    });
    expect(replyView("x", result({ outcome: "error" })).tone).toBe("error");
    expect(replyView("x", result({ outcome: "denied" })).tone).toBe("denied");
    expect(replyView("x", result({ outcome: "async_pending" })).tone).toBe("pending");
  });

  it("carries its link", () => {
    const link = { label: "Open loop #1851", url: "/runs/1851" };

    expect(replyView("queue #485", result({ reply: { text: "Queued.", link } })).link).toEqual(link);
  });

  it("is a preview, whatever its outcome, when it says what would confirm it", () => {
    const view = replyView("abort loop 1847", result({ confirmWith: "abort loop 1847 confirm" }));

    expect(view.tone).toBe("preview");
    expect(view.confirmWith).toBe("/ouro abort loop 1847 confirm");
    expect(confirmLabel(view.confirmWith!)).toBe("Put “/ouro abort loop 1847 confirm” in the box");
  });

  it("is an error in the service's words when the line was never read", () => {
    expect(refusalView("x", "The command is too long.")).toMatchObject({
      line: "/ouro x",
      tone: "error",
      text: "The command is too long.",
    });
  });

  it("says why a command the caller may not run was not run", () => {
    expect(deniedView(entry("route"))).toMatchObject({
      line: "/ouro route",
      tone: "denied",
      text: "You cannot run /ouro route here: needs admin.",
    });
  });

  it("says what is out while a line runs", () => {
    expect(runningLabel("status")).toBe("Running /ouro status…");
  });
});

describe("a result that followed", () => {
  it("is the settled reply and its deep link", () => {
    expect(settledToast(record())).toEqual({
      id: record().id,
      line: "/ouro dry-run #486",
      tone: "ok",
      text: "Dry run of #486 passed: 4 stages, 0 writes.",
      link: { label: "Open the dry run", url: "/workflows/dry-runs/41" },
    });
  });

  it("is what went wrong, for one that failed without a reply", () => {
    expect(
      settledToast(record({ outcome: "error", settledReply: null, errorDetail: "The farm refused it." })),
    ).toMatchObject({ tone: "error", text: "The farm refused it.", link: null });
  });

  it("says so when it settled with nothing to say at all", () => {
    expect(settledToast(record({ settledReply: null })).text).toBe(
      "/ouro dry-run #486 finished without a reply.",
    );
  });
});

describe("telling a refusal from an answer", () => {
  it("knows a refusal by its sentence", () => {
    expect(isConsoleRefusal({ error: "No.", code: "forbidden" })).toBe(true);
    expect(isConsoleRefusal(result())).toBe(false);
    expect(isConsoleRefusal(grammar())).toBe(false);
  });
});
