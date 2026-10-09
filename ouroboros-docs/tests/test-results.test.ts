import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The repository root, two levels above this file (`ouroboros-docs/tests/`). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The page under test. */
const PAGE = readFileSync(
  join(REPO_ROOT, "ouroboros-docs", "docs", "user-guide", "runs", "tests.mdx"),
  "utf8",
);

/**
 * Reads a source file of the test-results page.
 *
 * @param name the file's name under `ouroboros-ui/app/test-results/`.
 * @returns its text.
 */
function testsSource(name: string): string {
  return readFileSync(join(REPO_ROOT, "ouroboros-ui", "app", "test-results", name), "utf8");
}

/**
 * Reads the value of one exported string constant, e.g. `export const WAIVE_LABEL = "…";`.
 *
 * @param file the file under `ouroboros-ui/app/test-results/`.
 * @param name the constant's name.
 * @returns its value.
 * @throws {Error} when the file declares no such string constant.
 */
function constant(file: string, name: string): string {
  const match = new RegExp(`export const ${name} =\\s*"([^"]+)";`).exec(testsSource(file));
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
 * Returns the bold first cell of every row of the section's tables.
 *
 * @param heading the section's heading text.
 * @returns the cells' text, in order.
 */
function firstCells(heading: string): string[] {
  return [...section(heading).matchAll(/^\| \*\*([^*]+)\*\*/gm)].map((match) => match[1]);
}

/** The labels the page names, by the constant the page draws them from. */
const NAMED_LABELS: readonly (readonly [file: string, name: string])[] = [
  ["mark-route.ts", "MARK_ROUTE_TITLE"],
  ["mark-route.ts", "CLASSIFY_LEGEND"],
  ["mark-route.ts", "NOTE_LABEL"],
  ["mark-route.ts", "WAIVE_LABEL"],
  ["mark-route.ts", "RECLASSIFY_LABEL"],
  ["mark-route.ts", "RECORDED_EYEBROW"],
  ["mark-route.ts", "RECEIPT_EYEBROW"],
  ["mark-route-pick.ts", "HEURISTIC_AFFIX"],
  ["failure.ts", "FAILURE_TITLE"],
  ["failure.ts", "NO_HINT"],
  ["failure.ts", "AI_SLOT_TITLE"],
  ["physical.ts", "PHYSICAL_TITLE"],
  ["physical.ts", "HIL_SCHEMA_HINT"],
  ["suites.ts", "SUITES_TITLE"],
  ["suites.ts", "PHYSICAL_PREFIX"],
  ["artifacts.ts", "ARTIFACTS_TITLE"],
  ["artifacts.ts", "EXPIRED"],
  ["timeline.ts", "TIMELINE_TITLE"],
  ["timeline.ts", "NEXT_LABEL"],
  ["states.ts", "PARTIAL_LABEL"],
  ["states.ts", "NO_TEST_STAGE_TITLE"],
  ["states.ts", "NO_RESULTS_TITLE"],
  ["states.ts", "OPEN_WORKFLOW"],
  ["states.ts", "TESTS_LAG_RETRY"],
  ["view.ts", "RERUN_FULL_LABEL"],
  ["view.ts", "SEND_BACK_LABEL"],
];

describe("the test results page (#1183)", () => {
  it.each(NAMED_LABELS)("names %s's %s exactly as the page draws it", (file, name) => {
    expect(PAGE).toContain(constant(file, name));
  });

  it("names the four classes and the summary's five figures as the page draws them", () => {
    const classes = firstCells("Deciding what happens next");
    expect(classes).toHaveLength(4);
    for (const label of classes) expect(testsSource("mark-route-pick.ts")).toContain(`"${label}"`);

    const figures = firstCells("Builds and the summary");
    expect(figures).toHaveLength(5);
    for (const label of figures) expect(testsSource("view.ts")).toContain(`label: "${label}"`);
  });

  it("names each class's button as Mark & Route words it", () => {
    const buttons = [
      ...section("Deciding what happens next").matchAll(/^\| \*\*[^*]+\*\* \| \*\*([^*]+)\*\*/gm),
    ].map((match) => match[1]);
    expect(buttons).toHaveLength(4);
    for (const label of buttons) expect(testsSource("mark-route.ts")).toContain(`"${label}"`);
  });

  it("states the triage rules in the failure card's words", () => {
    const rules = firstCells("Reading a failure");
    expect(rules).toHaveLength(3);
    for (const rule of rules) expect(testsSource("failure.ts")).toContain(`"${rule}"`);
  });

  it("shows the three screenshots the issue lists", () => {
    for (const id of ["user-guide.tests", "user-guide.tests.failure", "user-guide.tests.flaky"]) {
      expect(PAGE).toContain(`<Screenshot id="${id}" />`);
    }
  });

  it("carries no internal issue references in its prose", () => {
    // Bold spans quote the UI, which names runs and pull requests such as "#1847" and "PR #514".
    const prose = PAGE.replace(/^---\n[\s\S]*?\n---\n/, "")
      .replace(/\*\*[^*]+\*\*/g, "")
      .replace(/`[^`]+`/g, "");
    expect(prose).not.toMatch(/#\d{2,}|\[[A-Z]{1,2}\.\d+\]/);
  });
});
