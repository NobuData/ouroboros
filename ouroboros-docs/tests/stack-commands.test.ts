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

/** The page under test. */
const PAGE = source("ouroboros-docs/docs/cli/stack-commands.mdx");

/** The root `package.json`'s scripts — the verbs the page documents. */
const SCRIPTS = (JSON.parse(source("package.json")) as { scripts: Record<string, string> }).scripts;

/** The verbs the issue names, each of which gets a section of its own. */
const VERBS = ["setup", "dev", "dev:stop", "dev:reset", "dev:web", "dev:docs", "verify", "e2e"];

/**
 * Returns the text of one `##` section of the page.
 *
 * @param heading the section's heading text, e.g. "`yarn setup`".
 * @returns the section, from its heading to the next `##` heading.
 * @throws {Error} when the page has no such section.
 */
function section(heading: string): string {
  const start = PAGE.indexOf(`\n## ${heading}\n`);
  if (start < 0) throw new Error(`the page has no "## ${heading}" section`);
  const end = PAGE.indexOf("\n## ", start + 1);
  return PAGE.slice(start, end < 0 ? undefined : end);
}

/**
 * Lists the exit statuses a script's header comment documents, e.g. `#   2  bad usage`.
 *
 * @param script the script's text.
 * @returns the documented statuses, in order.
 */
function documentedStatuses(script: string): string[] {
  const header = script.slice(script.indexOf("# Exit status"));
  return [...header.matchAll(/^#\s+(\d)\s+\S/gm)].map((match) => match[1]);
}

/**
 * Lists the statuses an exit-status table on the page gives, from its first column.
 *
 * @param text the section holding the table.
 * @returns the statuses, in table order.
 */
function tableStatuses(text: string): string[] {
  const table = text.slice(text.indexOf("| Exit status |"));
  return [...table.matchAll(/^\| `(\d)` \|/gm)].map((match) => match[1]);
}

describe("the stack commands page (#1204)", () => {
  it("names only verbs the root package.json defines", () => {
    const named = new Set([...PAGE.matchAll(/`yarn ([a-z][a-z0-9:]*)/g)].map((match) => match[1]));
    named.delete("install"); // Yarn's own command, not a script
    expect(named.size).toBeGreaterThan(0);
    for (const verb of named) expect(SCRIPTS, verb).toHaveProperty(verb);
  });

  it("gives every verb the issue names a section", () => {
    for (const verb of ["install", ...VERBS])
      expect(() => section(`\`yarn ${verb}\``)).not.toThrow();
  });

  it("leaves the contributor-only yarn test to the module READMEs", () => {
    expect(PAGE).not.toContain("yarn test");
  });

  it("states what each wrapping verb runs, as package.json defines it", () => {
    expect(section("`yarn setup`")).toContain(`Runs \`${SCRIPTS.setup}\`.`);
    expect(section("`yarn dev:stop`")).toContain(`Runs \`${SCRIPTS["dev:stop"]}\`.`);
    expect(section("`yarn dev:reset`")).toContain(`Runs \`${SCRIPTS["dev:reset"]}\`.`);
    expect(section("`yarn verify`")).toContain(`Runs \`${SCRIPTS.verify}\``);
  });

  it("warns that dev:reset deletes the volumes", () => {
    expect(SCRIPTS["dev:reset"]).toMatch(/ -v$/);
    expect(section("`yarn dev:reset`")).toContain(":::caution[This deletes your local data]");
  });

  it("documents exactly the options setup.sh accepts", () => {
    const usage = source("scripts/setup.sh").match(/^Usage: scripts\/setup\.sh (.*)$/m)?.[1];
    expect(usage).toBeDefined();
    expect(section("`yarn setup`")).toContain(`scripts/setup.sh ${usage}`);
    const options = [...(usage ?? "").matchAll(/--[a-z-]+/g)].map((match) => match[0]);
    for (const option of [...options, "--help"]) {
      expect(section("`yarn setup`")).toMatch(new RegExp(`^\\| (\`-[a-z]\`, )?\`${option}`, "m"));
    }
  });

  it("gives setup.sh's, run-tests.sh's and the e2e runner's exit statuses", () => {
    expect(tableStatuses(section("`yarn setup`"))).toEqual(
      documentedStatuses(source("scripts/setup.sh")),
    );
    expect(tableStatuses(section("`yarn verify`"))).toEqual(
      documentedStatuses(source("scripts/run-tests.sh")),
    );
    expect(tableStatuses(section("`yarn e2e`"))).toEqual(
      documentedStatuses(source("tests/e2e/scripts/run.sh")),
    );
  });

  it("documents the e2e runner's options", () => {
    const runner = source("tests/e2e/scripts/run.sh");
    for (const option of ["--keep", "--no-build"]) {
      expect(runner).toContain(`scripts/run.sh ${option}`);
      expect(section("`yarn e2e`")).toContain(`| \`${option}\` |`);
    }
  });

  it("gives the development seed's password", () => {
    expect(source("ouroboros-db/README.md")).toContain("signs in with `ouroboros-dev-password`");
    expect(PAGE).toContain("`ouroboros-dev-password`");
  });

  it("serves the docs site on the port its dev script uses", () => {
    expect(source("ouroboros-docs/package.json")).toContain("--port 3100");
    expect(section("`yarn dev:docs`")).toContain("`http://localhost:3100`");
  });
});
