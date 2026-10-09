import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The repository root, two levels above this file (`ouroboros-docs/tests/`). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The page under test. */
const PAGE = readFileSync(
  join(REPO_ROOT, "ouroboros-docs", "docs", "user-guide", "insights.mdx"),
  "utf8",
);

/** The page with its whitespace collapsed, so a quoted label may wrap over a line. */
const FLAT_PAGE = PAGE.replace(/\s+/g, " ");

/**
 * Reads a source file of the insights page.
 *
 * @param name the file's name under `ouroboros-ui/app/insights/`.
 * @returns its text.
 */
function insightsSource(name: string): string {
  return readFileSync(join(REPO_ROOT, "ouroboros-ui", "app", "insights", name), "utf8");
}

/**
 * Reads the value of one exported string constant, e.g. `export const DORA_TITLE = "…";`.
 *
 * @param file the file under `ouroboros-ui/app/insights/`.
 * @param name the constant's name.
 * @returns its value.
 * @throws {Error} when the file declares no such string constant.
 */
function constant(file: string, name: string): string {
  const match = new RegExp(`export const ${name} =\\s*"([^"]+)";`).exec(insightsSource(file));
  if (!match) throw new Error(`${file} declares no string constant ${name}`);
  return match[1];
}

/**
 * Returns the body of one `## ` section of the page — up to the next `## ` heading.
 *
 * @param heading the section's heading text, without the `## `.
 * @returns the section's text, whitespace collapsed.
 * @throws {Error} when the page has no such section.
 */
function section(heading: string): string {
  const start = PAGE.indexOf(`\n## ${heading}\n`);
  if (start < 0) throw new Error(`no "## ${heading}" section on the page`);
  const end = PAGE.indexOf("\n## ", start + 1);
  return PAGE.slice(start, end < 0 ? undefined : end).replace(/\s+/g, " ");
}

/** The labels the page names, by the constant the page draws them from. */
const NAMED_LABELS: readonly (readonly [file: string, name: string])[] = [
  ["view.ts", "NO_MERGES"],
  ["view.ts", "NOTHING_NEEDED_A_HUMAN"],
  ["view.ts", "SOON_MARK"],
  ["view.ts", "NOT_MEASURED"],
  ["view.ts", "NOTHING_MEASURED"],
  ["view.ts", "UNTOUCHED_CONTEXT"],
  ["view.ts", "TOKENS_PER_MERGED_PR"],
  ["view.ts", "PER_WEEK"],
  ["view.ts", "FORMULA_HEADING"],
  ["view.ts", "SOURCES_HEADING"],
  ["view.ts", "CAVEATS_HEADING"],
  ["view.ts", "PROXY_BADGE"],
  ["view.ts", "INSIGHTS_UNREAD_HEADLINE"],
  ["range.ts", "RANGE_GROUP_LABEL"],
  ["range.ts", "CUSTOM_LABEL"],
  ["bars-view.ts", "INTERVENTIONS_TITLE"],
  ["bars-view.ts", "STAGES_TITLE"],
  ["bars-view.ts", "SUITES_TITLE"],
  ["bars-view.ts", "EFFORT_TITLE"],
  ["bars-view.ts", "EFFORT_TAG"],
  ["bars-view.ts", "TOKENS_TITLE"],
  ["bars-view.ts", "RECATEGORIZE_FORBIDDEN"],
  ["bars-view.ts", "RECATEGORIZE_INVALID"],
  ["interventions-card.tsx", "RECATEGORIZE_OPEN"],
  ["interventions-card.tsx", "RECATEGORIZE_CLOSE"],
  ["series-view.ts", "COST_TITLE"],
  ["series-view.ts", "PROJECTED_MONTH"],
  ["performance-view.ts", "PERFORMANCE_TITLE"],
  ["performance-view.ts", "BUILDS_TITLE"],
  ["performance-view.ts", "ALL_WORKFLOWS"],
  ["performance-view.ts", "ALL_REPOSITORIES"],
  ["performance-view.ts", "UNPRICED"],
  ["scoreboard-view.ts", "SCOREBOARD_TITLE"],
  ["scoreboard-view.ts", "SCOREBOARD_CAPTION"],
  ["scoreboard-view.ts", "ROUTING_RULES_LABEL"],
  ["scoreboard-view.ts", "APPLY_LABEL"],
  ["scoreboard-view.ts", "LOW_SAMPLE"],
  ["flaky-view.ts", "FLAKY_TITLE"],
  ["flaky-view.ts", "UNDER_THRESHOLD"],
  ["flaky-view.ts", "BACK_TO_HEALTHY"],
  ["flaky-view.ts", "FLAKY_PLAYBOOK_NAME"],
  ["flaky-view.ts", "PLAYBOOKS_LINK"],
  ["dora-view.ts", "DORA_TITLE"],
  ["dora-view.ts", "DORA_CAPTION"],
  ["dora-view.ts", "DORA_NOT_ENOUGH"],
  ["digest-view.ts", "DIGEST_TITLE"],
  ["digest-view.ts", "DIGEST_TOGGLE"],
  ["digest-view.ts", "PREVIEW_HEADING"],
  ["states-view.ts", "COLD_TITLE"],
  ["states-view.ts", "LAG_HEADLINE"],
  ["states-view.ts", "FAILING_HEADLINE"],
  ["states-view.ts", "CARD_FAILED_TITLE"],
];

/**
 * Reads the string values of one `{ key: "Label" }` record a file declares.
 *
 * @param file the file under `ouroboros-ui/app/insights/`.
 * @param name the record's name.
 * @returns its labels, in order.
 * @throws {Error} when the file declares no such record.
 */
function recordLabels(file: string, name: string): string[] {
  const match = new RegExp(`const ${name}[^=]*= \\{([^}]+)\\}`).exec(insightsSource(file));
  if (!match) throw new Error(`${file} declares no record ${name}`);
  return [...match[1].matchAll(/: "([^"]+)"/g)].map((label) => label[1]);
}

describe("the insights page (#1186)", () => {
  it.each(NAMED_LABELS)("names %s's %s exactly as the page draws it", (file, name) => {
    expect(FLAT_PAGE).toContain(constant(file, name));
  });

  it("names the five headline cards as they are captioned, in order", () => {
    const cards = [...PAGE.matchAll(/^\| \*\*([^*]+)\*\* \|/gm)].map((match) => match[1]);
    expect(cards).toEqual(recordLabels("view.ts", "KPI_LABEL"));
  });

  it("names every intervention cause", () => {
    const causes = recordLabels("bars-view.ts", "CAUSE_NAMES");
    expect(causes).toHaveLength(5);
    for (const cause of causes) {
      expect(section("Where loops still need humans")).toContain(`**${cause}**`);
    }
  });

  it("names the six performance figures and the four DORA figures", () => {
    for (const label of [
      ...recordLabels("performance-view.ts", "CELL_LABEL"),
      ...recordLabels("dora-view.ts", "DORA_LABEL"),
    ]) {
      expect(section("The rest of the page")).toContain(`**${label}**`);
    }
  });

  it("offers exactly the ranges the page answers", () => {
    const ranges = /export const RANGES: [^=]+= \[([^\]]+)\]/.exec(insightsSource("range.ts"));
    expect(ranges).not.toBeNull();
    for (const [, range] of ranges![1].matchAll(/"([^"]+)"/g)) {
      expect(section("Choosing a range")).toContain(`**${range}**`);
    }
  });

  it("names the head's actions as the page labels them", () => {
    for (const [, label] of insightsSource("view.ts").matchAll(/label: "([^"]+)", soonNote/g)) {
      expect(section("The headline")).toContain(`**${label}**`);
    }
  });

  it("names the re-categorize panel's fields as it labels them", () => {
    const panel = insightsSource("recategorize-panel.tsx");
    for (const [, label] of section("Where loops still need humans").matchAll(
      /\*\*(Bar|Intervention|Move it to|Why|Re-categorize)\*\*/g,
    )) {
      expect(panel).toContain(`: "${label}",`);
    }
  });

  it("shows the two screenshots the issue lists", () => {
    for (const id of ["user-guide.insights", "user-guide.insights.range"]) {
      expect(PAGE).toContain(`<Screenshot id="${id}" />`);
    }
  });

  it("carries no internal issue references in its prose", () => {
    const prose = PAGE.replace(/^---\n[\s\S]*?\n---\n/, "")
      .replace(/\*\*[^*]+\*\*/g, "")
      .replace(/`[^`]+`/g, "");
    expect(prose).not.toMatch(/#\d{2,}|\[[A-Z]{1,2}\.\d+\]/);
  });
});
