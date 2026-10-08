import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The repository root, two levels above this file (`ouroboros-docs/tests/`). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The page under test. */
const PAGE = readFileSync(
  join(REPO_ROOT, "ouroboros-docs", "docs", "user-guide", "workflows", "studio.mdx"),
  "utf8",
);

/**
 * Reads a source file of the Workflow Studio.
 *
 * @param name the file's path under `ouroboros-ui/app/workflows/`.
 * @returns its text.
 */
function studioSource(name: string): string {
  return readFileSync(join(REPO_ROOT, "ouroboros-ui", "app", "workflows", name), "utf8");
}

/**
 * Reads the value of one exported string constant, e.g. `export const UNDO_LABEL = "Undo";`.
 *
 * @param file the file under `ouroboros-ui/app/workflows/`.
 * @param name the constant's name.
 * @returns its value.
 * @throws {Error} when the file declares no such string constant.
 */
function constant(file: string, name: string): string {
  const match = new RegExp(`export const ${name} = "([^"]+)";`).exec(studioSource(file));
  if (!match) throw new Error(`${file} declares no string constant ${name}`);
  return match[1];
}

/**
 * Returns the body of one `## ` section of the page — up to the next `## ` heading.
 *
 * @param heading the section's heading text, without the `## `.
 * @returns the section's text.
 * @throws {Error} when the page has no such section.
 */
function section(heading: string): string {
  const start = PAGE.indexOf(`\n## ${heading}\n`);
  if (start < 0) throw new Error(`no "## ${heading}" section on the page`);
  const end = PAGE.indexOf("\n## ", start + 1);
  return PAGE.slice(start, end < 0 ? undefined : end);
}

/**
 * The engine's structural rules (`structure.py`), with Python's implicit concatenation of
 * adjacent string literals joined — the text a reader is actually shown.
 */
const ENGINE_RULES = readFileSync(
  join(REPO_ROOT, "ouroboros-engine", "src", "ouroboros_engine", "workflows", "structure.py"),
  "utf8",
).replace(/"\s*\n\s*f?"/g, "");

/** The controls the page names, by the constant the Studio draws them from. */
const NAMED_CONTROLS: readonly (readonly [file: string, name: string])[] = [
  ["view.ts", "NEW_WORKFLOW_LABEL"],
  ["view.ts", "DRY_RUN_LABEL"],
  ["create.ts", "CREATE_SUBMIT"],
  ["canvas/view.ts", "AUTO_LAYOUT_LABEL"],
  ["canvas/view.ts", "ADD_STAGE_LABEL"],
  ["canvas/view.ts", "UNDO_LABEL"],
  ["canvas/view.ts", "REDO_LABEL"],
  ["autosave.ts", "SAVED_NOTE"],
  ["inspector/inspector.ts", "APPLY_LABEL"],
  ["inspector/inspector.ts", "DIRTY_NOTE"],
  ["dry-run.ts", "RUN_LABEL"],
  ["dry-run.ts", "CLOSE_DRY_RUN"],
  ["publish.ts", "CHANGE_NOTE_LABEL"],
];

describe("the Workflow Studio page (#1179)", () => {
  it.each(NAMED_CONTROLS)("names %s's %s exactly as the Studio draws it", (file, name) => {
    expect(PAGE).toContain(`**${constant(file, name)}**`);
  });

  it("quotes every validation message as the product words it", () => {
    const shipped = [
      studioSource("canvas/view.ts"),
      studioSource("inspector/inspector.ts"),
      ENGINE_RULES,
    ].join("\n");
    const quoted = [...section("Validation").matchAll(/\*\*([^*]+\.)\*\*/g)].map(
      // A message may wrap across lines in the page's source.
      (match) => match[1].replace(/\s+/g, " "),
    );
    expect(quoted.length).toBeGreaterThanOrEqual(10);
    for (const message of quoted) expect(shipped, message).toContain(message);
  });

  it("shows the five screenshots the issue lists", () => {
    for (const id of [
      "user-guide.workflows",
      "user-guide.workflow.canvas",
      "user-guide.workflow.inspector",
      "user-guide.workflow.validation-error",
      "user-guide.workflow.publish",
    ]) {
      expect(PAGE).toContain(`<Screenshot id="${id}" />`);
    }
  });

  it("carries no internal issue references in its prose", () => {
    // Bold spans quote the UI, which names issues such as "Dry run with issue #485".
    const prose = PAGE.replace(/^---\n[\s\S]*?\n---\n/, "")
      .replace(/\*\*[^*]+\*\*/g, "")
      .replace(/`[^`]+`/g, "");
    expect(prose).not.toMatch(/#\d{2,}|\[[A-Z]{1,2}\.\d+\]/);
  });
});
