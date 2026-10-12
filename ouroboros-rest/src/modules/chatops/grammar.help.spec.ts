import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  commandHelpText,
  help,
  helpText,
  helpTopic,
  renderReference,
  renderReferenceText,
  requirementWords,
} from "./grammar.help";
import { syntaxOf } from "./grammar.parser";
import { BUILTINS, GRAMMAR, GRAMMAR_VERSION, commandOf, withCommands } from "./grammar.registry";
import type { CommandDefinition } from "./grammar.types";

/**
 * `/ouro help` and the grammar as a document (#537): both are generated from the registry and
 * from nothing else, so a command added to a grammar is listed, explained and documented with no
 * other change — and the committed `chat-grammar.json` is exactly what the registry renders.
 */

/** The module root — where `chat-grammar.json` and `scripts/` live. */
const MODULE_ROOT = join(__dirname, "..", "..", "..");

/** A command no file but this one knows about. */
const FIXTURE: CommandDefinition = {
  id: "rewind loop",
  aliases: ["rewind"],
  summary: "take a loop back one stage",
  usage: "rewind loop 1847",
  arguments: [
    {
      name: "loop",
      type: "loop",
      optional: false,
      completion: "loops",
      description: "the loop to take back",
    },
    {
      name: "confirm",
      type: "confirm",
      optional: true,
      description: "the word `confirm` — without it nothing is rewound",
    },
  ],
  requires: { roles: ["owner"], capability: "can_approve_loops" },
  destructive: true,
  confirmPrompt: "Add `confirm` to rewind loop {loop}.",
  mode: "async",
  stage: "available",
  binds: "none — a fixture",
};

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
 * `/ouro help`, line by line.
 *
 * @param surface - Where it was asked.
 * @returns The lines of the list.
 */
function listLines(surface: "slack" | "console"): string[] {
  return help(GRAMMAR, surface, []).split("\n");
}

describe("helpTopic", () => {
  it("reads a bare /ouro as a request for the list", () => {
    expect(helpTopic("")).toEqual([]);
    expect(helpTopic("  \t ")).toEqual([]);
  });

  it("reads help, in any case, and hands back what follows it", () => {
    expect(helpTopic("help")).toEqual([]);
    expect(helpTopic("HELP  pause loop")).toEqual(["pause", "loop"]);
  });

  it("leaves a command alone", () => {
    expect(helpTopic("status")).toBeUndefined();
    expect(helpTopic("helpme")).toBeUndefined();
    expect(helpTopic("queue help")).toBeUndefined();
  });
});

describe("/ouro help", () => {
  it("opens with the grammar's version", () => {
    expect(listLines("slack")[0]).toBe(`Ouroboros commands (grammar v${String(GRAMMAR_VERSION)}):`);
  });

  it("lists every command of the registry, one line each, in the registry's order", () => {
    expect(listLines("console").slice(1, GRAMMAR.commands.length + 1)).toEqual(
      GRAMMAR.commands.map(
        (definition) =>
          `\`${syntaxOf(definition)}\` — ${definition.summary}${definition.stage === "v2" ? " (v2 — not available yet)" : ""}`,
      ),
    );
  });

  it("prints the card's words beside each syntax line", () => {
    const lines = listLines("slack");

    expect(lines).toContain("`/ouro status` — everything live, in one line");
    expect(lines).toContain("`/ouro queue <ticket> [workflow]` — send an issue into the loop");
    expect(lines).toContain("`/ouro abort loop <loop> confirm` — stop and clean up");
    expect(lines).toContain("`/ouro pause all confirm` — the big red button");
  });

  it("marks explain pr as v2, and only it", () => {
    const marked = listLines("slack").filter((line) => line.includes("v2"));

    expect(marked).toEqual([
      "`/ouro explain pr <pr>` — plain-language summary of a PR (v2 — not available yet)",
    ]);
  });

  it("ends with the built-ins the surface has: linking is Slack's", () => {
    const builtins = (surface: "slack" | "console"): string[] =>
      listLines(surface).slice(GRAMMAR.commands.length + 1);

    expect(builtins("slack")).toEqual([
      "`/ouro help [command]` — this list, or one command in detail",
      "`/ouro link` — link your Slack identity to your Ouroboros account",
      "`/ouro unlink` — undo the link",
    ]);
    expect(builtins("console")).toEqual([
      "`/ouro help [command]` — this list, or one command in detail",
    ]);
  });

  it("is the same text from help() and helpText()", () => {
    expect(help(GRAMMAR, "slack", [])).toBe(helpText(GRAMMAR, "slack"));
  });

  it("lists a command added to the grammar with no other change", () => {
    const extended = withCommands(GRAMMAR, FIXTURE);
    const lines = help(extended, "console", []).split("\n");

    expect(help(GRAMMAR, "console", [])).not.toContain("rewind");
    expect(lines).toHaveLength(listLines("console").length + 1);
    expect(lines).toContain("`/ouro rewind loop <loop> confirm` — take a loop back one stage");
  });
});

describe("/ouro help <command>", () => {
  it("gives the syntax, each argument, who may run it, and an example", () => {
    expect(help(GRAMMAR, "slack", ["queue"]).split("\n")).toEqual([
      "`/ouro queue <ticket> [workflow]` — send an issue into the loop",
      "• ticket — the issue to queue — `#485`, `485`, `repo#485` or its GitHub URL",
      "• workflow (optional) — the workflow to pin; left out, the workspace's triggers choose",
      "Who: workspace owners, admins and members.",
      "Example: `/ouro queue #485 [workflow]`",
    ]);
  });

  it("is short for a command with no arguments", () => {
    expect(help(GRAMMAR, "console", ["status"]).split("\n")).toEqual([
      "`/ouro status` — everything live, in one line",
      "Who: every workspace member.",
      "Example: `/ouro status`",
    ]);
  });

  it("finds a command of two words, in any case", () => {
    expect(help(GRAMMAR, "slack", ["Pause", "LOOP"])).toBe(
      commandHelpText(registered("pause loop")),
    );
  });

  it("states the confirm rule for a destructive command, and does not call confirm optional", () => {
    const lines = help(GRAMMAR, "slack", ["abort", "loop"]).split("\n");

    expect(lines).toContain("• confirm — the word `confirm` — without it nothing is aborted");
    expect(lines).toContain(
      "Confirm: Runs only with `confirm` as its last word. Without it nothing happens: the reply describes exactly what would.",
    );
    expect(help(GRAMMAR, "slack", ["pause", "all"])).toContain("Confirm: Runs only with");
    expect(help(GRAMMAR, "slack", ["pause", "loop"])).not.toContain("Confirm:");
  });

  it("says a dry run takes a while, and how else it is typed", () => {
    const lines = help(GRAMMAR, "slack", ["dry-run"]).split("\n");

    expect(lines).toContain(
      "Takes a while: the first reply says it started, and the result follows as its own message.",
    );
    expect(lines[lines.length - 1]).toBe("Also typed as: `/ouro dryrun`");
    expect(help(GRAMMAR, "slack", ["dryrun"])).toBe(help(GRAMMAR, "slack", ["dry-run"]));
  });

  it("labels a v2 command and gives its honest reply where the example would be", () => {
    const explain = registered("explain pr");
    const lines = help(GRAMMAR, "slack", ["explain", "pr"]).split("\n");

    expect(lines[0]).toBe(
      "`/ouro explain pr <pr>` — plain-language summary of a PR (v2 — not available yet)",
    );
    expect(lines).toContain("Who: every workspace member.");
    expect(lines[lines.length - 1]).toBe(explain.unavailableReply);
    expect(lines.join("\n")).toContain("CB.1");
    expect(lines.join("\n")).not.toContain("Example:");
  });

  it("explains a command added to the grammar with no other change", () => {
    const extended = withCommands(GRAMMAR, FIXTURE);

    expect(help(GRAMMAR, "slack", ["rewind", "loop"])).toContain("unknown command");
    expect(help(extended, "slack", ["rewind", "loop"]).split("\n")).toEqual([
      "`/ouro rewind loop <loop> confirm` — take a loop back one stage",
      "• loop — the loop to take back",
      "• confirm — the word `confirm` — without it nothing is rewound",
      "Who: workspace owners who can approve loops.",
      "Confirm: Runs only with `confirm` as its last word. Without it nothing happens: the reply describes exactly what would.",
      "Takes a while: the first reply says it started, and the result follows as its own message.",
      "Example: `/ouro rewind loop 1847`",
      "Also typed as: `/ouro rewind`",
    ]);
  });

  it("explains a built-in where the surface has it", () => {
    expect(help(GRAMMAR, "slack", ["help"])).toBe(
      "`/ouro help [command]` — this list, or one command in detail",
    );
    expect(help(GRAMMAR, "slack", ["LINK"])).toBe(
      "`/ouro link` — link your Slack identity to your Ouroboros account",
    );
    expect(help(GRAMMAR, "console", ["link"])).toBe(
      'unknown command "link" — `/ouro help` lists the commands',
    );
  });

  it("answers a name that is no command as the dispatcher would, with the nearest names", () => {
    expect(help(GRAMMAR, "slack", ["pause"])).toBe(
      'unknown command "pause" — try: pause all, pause loop',
    );
    expect(help(GRAMMAR, "slack", ["staus"])).toBe('unknown command "staus" — try: status');
    expect(help(GRAMMAR, "slack", ["frobnicate"])).toBe(
      'unknown command "frobnicate" — `/ouro help` lists the commands',
    );
  });
});

describe("requirementWords", () => {
  it("says who may, in words", () => {
    expect(requirementWords({ roles: [] })).toBe("every workspace member");
    expect(requirementWords({ roles: ["owner"] })).toBe("workspace owners");
    expect(requirementWords({ roles: ["owner", "admin"] })).toBe("workspace owners and admins");
    expect(requirementWords({ roles: ["owner", "admin", "member"] })).toBe(
      "workspace owners, admins and members",
    );
  });

  it("names a capability beside the roles, or alone", () => {
    expect(requirementWords({ roles: [], capability: "can_approve_loops" })).toBe(
      "workspace members who can approve loops",
    );
    expect(requirementWords({ roles: ["owner", "admin"], capability: "can_approve_loops" })).toBe(
      "workspace owners and admins who can approve loops",
    );
  });
});

describe("the grammar as a document", () => {
  it("carries the version, the prefix and the confirm rule", () => {
    const reference = renderReference(GRAMMAR);

    expect(reference.version).toBe(GRAMMAR_VERSION);
    expect(reference.prefix).toBe("/ouro");
    expect(reference.confirmRule).toContain("Runs only with `confirm` as its last word.");
    expect(reference.builtins).toEqual(BUILTINS);
  });

  it("describes every command of the registry, in its order, as it runs", () => {
    const reference = renderReference(GRAMMAR);

    expect(reference.commands.map((entry) => entry.id)).toEqual(
      GRAMMAR.commands.map((definition) => definition.id),
    );

    for (const [index, definition] of GRAMMAR.commands.entries()) {
      expect(reference.commands[index]).toMatchObject({
        usage: definition.usage,
        syntax: syntaxOf(definition),
        summary: definition.summary,
        aliases: definition.aliases,
        destructive: definition.destructive,
        mode: definition.mode,
        stage: definition.stage,
        binds: definition.binds,
        requires: {
          roles: definition.requires.roles,
          words: requirementWords(definition.requires),
        },
      });
    }
  });

  it("writes null, not nothing, where a command has no such thing", () => {
    const [status] = renderReference(GRAMMAR).commands;
    const explain = renderReference(GRAMMAR).commands.find((entry) => entry.id === "explain pr");

    expect(status).toMatchObject({
      confirmPrompt: null,
      unavailableReply: null,
      requires: { capability: null },
    });
    expect(explain?.arguments).toEqual([
      {
        name: "pr",
        type: "pr",
        optional: false,
        description: "the pull request's number — `514` or `#514`",
        completion: null,
      },
    ]);
    expect(explain?.unavailableReply).toContain("CB.1");
  });

  it("documents a command added to the grammar with no other change", () => {
    const reference = renderReference(withCommands(GRAMMAR, FIXTURE));

    expect(reference.commands[reference.commands.length - 1]).toEqual({
      id: "rewind loop",
      aliases: ["rewind"],
      usage: "rewind loop 1847",
      syntax: "/ouro rewind loop <loop> confirm",
      summary: "take a loop back one stage",
      arguments: [
        {
          name: "loop",
          type: "loop",
          optional: false,
          description: "the loop to take back",
          completion: "loops",
        },
        {
          name: "confirm",
          type: "confirm",
          optional: true,
          description: "the word `confirm` — without it nothing is rewound",
          completion: null,
        },
      ],
      requires: {
        roles: ["owner"],
        capability: "can_approve_loops",
        words: "workspace owners who can approve loops",
      },
      destructive: true,
      confirmPrompt: "Add `confirm` to rewind loop {loop}.",
      mode: "async",
      stage: "available",
      unavailableReply: null,
      binds: "none — a fixture",
    });
  });

  it("renders as two-space JSON ending in a newline", () => {
    const text = renderReferenceText(GRAMMAR);

    expect(text.endsWith("}\n")).toBe(true);
    expect(text.startsWith(`{\n  "version": ${String(GRAMMAR_VERSION)},\n`)).toBe(true);
    expect(JSON.parse(text)).toEqual(renderReference(GRAMMAR));
  });
});

describe("chat-grammar.json", () => {
  it("is the registry, rendered — run `yarn chat-grammar` after changing a command", () => {
    const committed = readFileSync(join(MODULE_ROOT, "chat-grammar.json"), "utf8");

    expect(committed).toBe(renderReferenceText(GRAMMAR));
  });

  it("is rendered exactly as `yarn chat-grammar` writes it", () => {
    // The verb the docs name, not a reimplementation of it: it loads the registry from source
    // with no build, and `--check` writes nothing and exits non-zero on drift, which is what
    // makes execFileSync throw.
    const check = (): string =>
      execFileSync(
        process.execPath,
        [join(MODULE_ROOT, "scripts", "chat-grammar.mjs"), "--check"],
        { encoding: "utf8" },
      );

    expect(check).not.toThrow();
  });
});

describe("help for a command typed with its arguments", () => {
  it("is the command's help — never an unknown command naming itself", () => {
    expect(help(GRAMMAR, "slack", ["queue", "#485"])).toBe(help(GRAMMAR, "slack", ["queue"]));
  });
});
