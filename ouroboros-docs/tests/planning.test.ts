import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The repository root, two levels above this file (`ouroboros-docs/tests/`). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The page under test. */
const PAGE = readFileSync(
  join(REPO_ROOT, "ouroboros-docs", "docs", "user-guide", "planning.mdx"),
  "utf8",
);

/**
 * Reads a source file of the Planning screen.
 *
 * @param name the file's name under `ouroboros-ui/app/planning/`.
 * @returns its text.
 */
function planningSource(name: string): string {
  return readFileSync(join(REPO_ROOT, "ouroboros-ui", "app", "planning", name), "utf8");
}

/**
 * Reads the value of one exported string constant, e.g. `export const DRAFT_LABEL = "…";`.
 *
 * @param file the file under `ouroboros-ui/app/planning/`.
 * @param name the constant's name.
 * @returns its value.
 * @throws {Error} when the file declares no such string constant.
 */
function constant(file: string, name: string): string {
  const match = new RegExp(`export const ${name} = "([^"]+)";`).exec(planningSource(file));
  if (!match) throw new Error(`${file} declares no string constant ${name}`);
  return match[1];
}

/** The controls the page names, by the constant the screen draws them from. */
const NAMED_CONTROLS: readonly (readonly [file: string, name: string])[] = [
  ["generator.ts", "PROMPT_LABEL"],
  ["generator.ts", "OUTLINE_TOGGLE_LABEL"],
  ["generator.ts", "AUTO_SIZE_LABEL"],
  ["generator.ts", "QUEUE_SMALL_LABEL"],
  ["generator.ts", "DRAFT_LABEL"],
  ["generator.ts", "REGENERATE_LABEL"],
  ["generator.ts", "RESUME_LABEL"],
  ["generator.ts", "NO_MILESTONE"],
  ["generator.ts", "NEW_MILESTONE_OPTION"],
  ["generator.ts", "PUSHED_EDIT_REASON"],
  ["view.ts", "NEW_ROADMAP_LABEL"],
  ["create.ts", "CREATE_SUBMIT"],
  ["gantt.ts", "ADD_EPIC_LABEL"],
];

describe("the Planning page (#1178)", () => {
  it.each(NAMED_CONTROLS)("names %s's %s exactly as the screen draws it", (file, name) => {
    expect(PAGE).toContain(`**${constant(file, name)}**`);
  });

  it("names every epic status the epic sheet offers", () => {
    const source = planningSource("epic-draft.ts");
    const block = source.slice(source.indexOf("export const STATUS_OPTIONS"));
    const labels = [...block.slice(0, block.indexOf("];")).matchAll(/label: "([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(labels).toHaveLength(4);
    for (const label of labels) expect(PAGE).toContain(`**${label}**`);
  });

  it("warns about write-back in a caution admonition", () => {
    expect(PAGE).toMatch(/^:::caution\[[^\]]+\]$/m);
  });

  it("shows the four screenshots the issue lists", () => {
    for (const id of [
      "user-guide.planning",
      "user-guide.planning.tickets",
      "user-guide.planning.timeline",
      "user-guide.planning.write-back",
    ]) {
      expect(PAGE).toContain(`<Screenshot id="${id}" />`);
    }
  });

  it("carries no internal issue references in its prose", () => {
    // Bold spans quote the UI, which names tracker issues such as "pushed ✓ #612".
    const prose = PAGE.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/\*\*[^*]+\*\*/g, "");
    expect(prose).not.toMatch(/#\d{2,}|\[[A-Z]{1,2}\.\d+\]/);
  });
});
