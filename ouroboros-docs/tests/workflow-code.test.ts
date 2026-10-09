import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The repository root, two levels above this file (`ouroboros-docs/tests/`). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The page under test. */
const PAGE = readFileSync(
  join(REPO_ROOT, "ouroboros-docs", "docs", "user-guide", "workflows", "code.mdx"),
  "utf8",
);

/**
 * Reads a file of the repository.
 *
 * @param path the file's path from the repository root.
 * @returns its text.
 */
function repoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

/**
 * Reads the value of one exported string constant, e.g. `export const VALIDATE_LABEL = "…";`.
 *
 * @param path the file's path under `ouroboros-ui/app/workflows/`.
 * @param name the constant's name.
 * @returns its value.
 * @throws {Error} when the file declares no such string constant.
 */
function constant(path: string, name: string): string {
  const source = repoFile(join("ouroboros-ui", "app", "workflows", path));
  const match = new RegExp(`export const ${name} =\\s*"([^"]+)";`).exec(source);
  if (!match) throw new Error(`${path} declares no string constant ${name}`);
  return match[1];
}

/** The words the page quotes, by the constant the code view draws them from. */
const QUOTED_COPY: readonly (readonly [file: string, name: string])[] = [
  ["code/code-view.ts", "VALIDATE_LABEL"],
  ["code/code-view.ts", "UNPROJECTABLE_TITLE"],
  ["code/code-view.ts", "UNPROJECTABLE_ACTION"],
  ["code/code-save.ts", "CODE_IDLE_NOTE"],
  ["code/code-save.ts", "CODE_INVALID_NOTE"],
  ["code/code-save.ts", "CODE_CONFLICT_TITLE"],
  ["code/code-save.ts", "RELOAD_THEIRS_LABEL"],
  ["code/code-save.ts", "KEEP_MINE_LABEL"],
  ["code/code-flows.ts", "VALIDATED_MESSAGE"],
  ["autosave.ts", "PENDING_NOTE"],
  ["autosave.ts", "SAVING_NOTE"],
  ["autosave.ts", "SAVED_NOTE"],
  ["mode-switch.ts", "SWITCH_PROMPT_TITLE"],
  ["mode-switch.ts", "SWITCH_PROMPT_CANCEL"],
];

describe("the Workflows as code page (#1180)", () => {
  it.each(QUOTED_COPY)("quotes %s's %s exactly as the code view prints it", (file, name) => {
    expect(PAGE).toContain(constant(file, name));
  });

  it("lists exactly the stage calls the DSL parser accepts", () => {
    const grammar = repoFile("ouroboros-rest/src/modules/workflows/code.grammar.ts");
    const block = grammar.slice(grammar.indexOf("export const STAGE_CALLEES"));
    const callees = [...block.slice(0, block.indexOf("] as const")).matchAll(/"([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(callees.length).toBeGreaterThanOrEqual(8);
    const primer = PAGE.slice(PAGE.indexOf("## A short primer on the DSL"));
    const sentence = /\*\*Stages\*\* are calls named after their kind — ([^—]+) —/.exec(primer);
    expect(sentence).not.toBeNull();
    const listed = [...(sentence?.[1] ?? "").matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    expect(listed).toEqual(callees);
  });

  it("shows the DSL's own minimal example, verbatim", () => {
    const example = repoFile("schemas/workflow-dsl/fixtures/code/minimal.loop.ts");
    const program = example.slice(0, example.indexOf("\n// Round-trips")).trimEnd();
    expect(PAGE).toContain(`\`\`\`ts\n${program}\n\`\`\``);
  });

  it("links the schema file that exists in the repository", () => {
    const link = /\]\(https:\/\/github\.com\/NobuData\/ouroboros\/blob\/main\/([^)]+)\)/.exec(PAGE);
    expect(link?.[1]).toBe("schemas/workflow-dsl/v1.json");
    expect(() => repoFile(link?.[1] ?? "")).not.toThrow();
  });

  it("shows the three screenshots the issue lists", () => {
    for (const id of [
      "user-guide.workflow.code",
      "user-guide.workflow.code.completion",
      "user-guide.workflow.code.diagnostic",
    ]) {
      expect(PAGE).toContain(`<Screenshot id="${id}" />`);
    }
  });

  it("carries no internal issue references in its prose", () => {
    const prose = PAGE.replace(/^---\n[\s\S]*?\n---\n/, "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`]+`/g, "");
    expect(prose).not.toMatch(/#\d{2,}|\[[A-Z]{1,2}\.\d+\]/);
  });
});
