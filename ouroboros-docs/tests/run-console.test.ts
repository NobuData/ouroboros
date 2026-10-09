import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The repository root, two levels above this file (`ouroboros-docs/tests/`). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The page under test. */
const PAGE = readFileSync(
  join(REPO_ROOT, "ouroboros-docs", "docs", "user-guide", "runs", "console.mdx"),
  "utf8",
);

/**
 * Reads a source file of the run console.
 *
 * @param name the file's name under `ouroboros-ui/app/runs/`.
 * @returns its text.
 */
function runsSource(name: string): string {
  return readFileSync(join(REPO_ROOT, "ouroboros-ui", "app", "runs", name), "utf8");
}

/**
 * Reads the value of one exported string constant, e.g. `export const PAUSE_LABEL = "…";`.
 *
 * @param file the file under `ouroboros-ui/app/runs/`.
 * @param name the constant's name.
 * @returns its value.
 * @throws {Error} when the file declares no such string constant.
 */
function constant(file: string, name: string): string {
  const match = new RegExp(`export const ${name} =\\s*"([^"]+)";`).exec(runsSource(file));
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

/** The controls and labels the page names, by the constant the console draws them from. */
const NAMED_LABELS: readonly (readonly [file: string, name: string])[] = [
  ["controls.ts", "PAUSE_LABEL"],
  ["controls.ts", "RESUME_LABEL"],
  ["controls.ts", "TAKEOVER_LABEL"],
  ["controls.ts", "ABORT_LABEL"],
  ["controls.ts", "ABORT_NEEDS_CONFIRMATION"],
  ["handoff.ts", "COPY_COMMANDS_LABEL"],
  ["transcript.ts", "RAW_JSONL"],
  ["transcript.ts", "SHOW_ALL"],
  ["transcript.ts", "JUMP_TO_LATEST"],
  ["transcript.ts", "STEER_LABEL"],
  ["transcript.ts", "STEER_SEND"],
  ["stepper.ts", "TEST_RESULTS_LINK"],
  ["view.ts", "SIMULATED_HEADLINE"],
  ["view.ts", "VERIFICATION_LINK"],
  ["run-missing.tsx", "RUN_MISSING_TITLE"],
];

describe("the run console page (#1182)", () => {
  it.each(NAMED_LABELS)("names %s's %s exactly as the console draws it", (file, name) => {
    expect(PAGE).toContain(constant(file, name));
  });

  it("quotes the guardrail rows exactly as the Guardrails card words them", () => {
    const cards = runsSource("cards.ts");
    const rows = [
      ...section("Changes, resources and guardrails").matchAll(/\| \*\*([^*]+)\*\*(?= \|)/g),
    ].map((match) => match[1]);
    expect(rows).toHaveLength(6);
    for (const row of rows) expect(cards).toContain(`"${row}"`);
  });

  it("shows the four screenshots the issue lists", () => {
    for (const id of [
      "user-guide.run.live",
      "user-guide.run.completed",
      "user-guide.run.guardrail",
      "user-guide.run.controls",
    ]) {
      expect(PAGE).toContain(`<Screenshot id="${id}" />`);
    }
  });

  it("carries no internal issue references in its prose", () => {
    // Bold spans quote the UI, which names issues and loops such as "#482" and "Loop #1847".
    const prose = PAGE.replace(/^---\n[\s\S]*?\n---\n/, "")
      .replace(/\*\*[^*]+\*\*/g, "")
      .replace(/`[^`]+`/g, "");
    expect(prose).not.toMatch(/#\d{2,}|\[[A-Z]{1,2}\.\d+\]/);
  });
});
