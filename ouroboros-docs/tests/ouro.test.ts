import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The repository root, two levels above this file (`ouroboros-docs/tests/`). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Reads a file relative to the repository root.
 *
 * @param path the file's path under the repository root.
 * @returns its text.
 */
function source(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

/** One command of the committed grammar, as far as the page documents it. */
interface Command {
  id: string;
  syntax: string;
  summary: string;
  destructive: boolean;
  confirmPrompt: string | null;
  stage: "available" | "v2";
  arguments: { name: string; type: string }[];
}

/** The `/ouro` grammar as `ouroboros-rest` commits it — rendered from the registry (#537). */
const GRAMMAR = JSON.parse(source("ouroboros-rest/chat-grammar.json")) as {
  prefix: string;
  commands: Command[];
  builtins: { id: string }[];
};

/** The reference page. */
const PAGE = source("ouroboros-docs/docs/cli/ouro.mdx");

/** The user guide's overview. */
const GUIDE = source("ouroboros-docs/docs/user-guide/chatops.mdx");

/**
 * Returns the text of one `##` section of the reference page.
 *
 * @param anchor the section's anchor as the site derives it from the heading, e.g. `abort-loop`.
 * @returns the section, from its heading to the next `##` heading.
 * @throws {Error} when the page has no such section.
 */
function section(anchor: string): string {
  const heading = [...PAGE.matchAll(/\n## ([^\n]+)\n/g)].find(
    (match) => match[1].replaceAll("`", "").toLowerCase().replace(/\s+/g, "-") === anchor,
  );
  if (heading === undefined) throw new Error(`the page has no section #${anchor}`);
  const end = PAGE.indexOf("\n## ", heading.index + 1);
  return PAGE.slice(heading.index, end < 0 ? undefined : end);
}

/**
 * Collapses a section's line wrapping, so a sentence can be looked for whole.
 *
 * @param text the text.
 * @returns the text with every run of whitespace as one space.
 */
function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

describe("the /ouro reference page", () => {
  it("lists every command of the grammar, with its syntax and summary as the registry has them", () => {
    for (const command of GRAMMAR.commands) {
      expect(PAGE, command.id).toContain(`\`${command.syntax}\``);
      expect(PAGE, command.id).toContain(`| ${command.summary} |`);
    }
  });

  it("lists no command the grammar does not have", () => {
    const listed = [...PAGE.matchAll(/^\| \[`\/ouro ([^`]+)`\]/gm)].map((match) => match[1]);
    const known = GRAMMAR.commands.map((command) => command.syntax.replace("/ouro ", ""));

    expect(listed.sort()).toEqual(known.sort());
  });

  it("explains every argument type a command takes", () => {
    const types = new Set(
      GRAMMAR.commands.flatMap((command) =>
        command.arguments
          .filter((argument) => argument.type !== "keyword" && argument.type !== "confirm")
          .map((argument) => argument.name),
      ),
    );

    for (const name of types) {
      expect(PAGE, name).toContain(`| \`<${name}>\` |`);
    }
  });

  it("states the confirm rule for exactly the destructive commands", () => {
    const destructive = GRAMMAR.commands.filter((command) => command.destructive);

    expect(destructive.map((command) => command.id).sort()).toEqual(["abort loop", "pause all"]);

    for (const command of destructive) {
      expect(section("the-confirm-rule")).toContain(`\`/ouro ${command.id}\``);
      expect(section(command.id.replace(" ", "-"))).toContain("(#the-confirm-rule)");
    }
  });

  it("quotes abort's first reply as the registry words it", () => {
    const abort = GRAMMAR.commands.find((command) => command.id === "abort loop");

    expect(flat(section("abort-loop"))).toContain(
      (abort?.confirmPrompt ?? "").replaceAll("{loop}", "1847"),
    );
  });

  it("marks a v2 command as not available yet, and only those", () => {
    for (const command of GRAMMAR.commands) {
      const text = section(
        command.id
          .replace(/ /g, "-")
          .replace(/^(pause|resume)-loop$/, "pause-loop-and-resume-loop"),
      );

      if (command.stage === "v2") {
        expect(text, command.id).toContain(":::info[Not available yet]");
      } else {
        expect(text, command.id).not.toContain("Not available yet");
      }
    }
  });

  it("documents the built-ins", () => {
    for (const builtin of GRAMMAR.builtins) {
      expect(PAGE, builtin.id).toContain(`\`/ouro ${builtin.id}\``);
    }
  });
});

describe("the user guide's Commands overview", () => {
  it("points at the reference", () => {
    expect(GUIDE).toContain("## Commands");
    expect(GUIDE).toContain("(../cli/ouro.mdx)");
  });

  it("shows only commands that run today", () => {
    for (const command of GRAMMAR.commands) {
      if (command.stage === "v2") {
        expect(GUIDE, command.id).not.toContain(`/ouro ${command.id}`);
      } else {
        expect(GUIDE, command.id).toContain(`/ouro ${command.id}`);
      }
    }
  });
});
