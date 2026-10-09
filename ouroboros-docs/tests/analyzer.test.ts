import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The repository root, two levels above this file (`ouroboros-docs/tests/`). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The page under test. */
const PAGE = readFileSync(
  join(REPO_ROOT, "ouroboros-docs", "docs", "user-guide", "analyzer.mdx"),
  "utf8",
);

/** The page with its whitespace collapsed, so a quoted label may wrap over a line. */
const FLAT_PAGE = PAGE.replace(/\s+/g, " ");

/**
 * Reads a source file of the analyzer page.
 *
 * @param name the file's name under `ouroboros-ui/app/analyzer/`.
 * @returns its text.
 */
function analyzerSource(name: string): string {
  return readFileSync(join(REPO_ROOT, "ouroboros-ui", "app", "analyzer", name), "utf8");
}

/**
 * Reads the value of one exported string constant, e.g. `export const RUN_LABEL = "…";`.
 *
 * @param file the file under `ouroboros-ui/app/analyzer/`.
 * @param name the constant's name.
 * @returns its value.
 * @throws {Error} when the file declares no such string constant.
 */
function constant(file: string, name: string): string {
  const match = new RegExp(`export const ${name} =\\s*"([^"]+)";`).exec(analyzerSource(file));
  if (!match) throw new Error(`${file} declares no string constant ${name}`);
  return match[1];
}

/** The labels the page names, by the constant the page draws them from. */
const NAMED_LABELS: readonly (readonly [file: string, name: string])[] = [
  ["view.ts", "ANALYZER_EYEBROW"],
  ["view.ts", "RUN_LABEL"],
  ["view.ts", "RUN_MEMBER_REASON"],
  ["view.ts", "CHOSEN_REPO_HINT"],
  ["view.ts", "SAMPLED_TAG"],
  ["view.ts", "BASIS_HEADING"],
  ["view.ts", "PROGRESS_HEADING"],
  ["view.ts", "START_FAILED"],
  ["view.ts", "FOLLOW_RUNNING"],
  ["view.ts", "SCHEDULE_TITLE"],
  ["state-view.ts", "INSUFFICIENT_TITLE"],
  ["state-view.ts", "NEVER_RUN_TITLE"],
  ["state-view.ts", "FIRST_RUN_LABEL"],
  ["duration-view.ts", "UNATTRIBUTED_NAME"],
  ["duration-view.ts", "ATTRIBUTED_HEADING"],
  ["suggestions-view.ts", "EVIDENCE_LABEL"],
  ["suggestions-view.ts", "SPIKE_PILL"],
  ["suggestions-view.ts", "IMPACT_HEADING"],
  ["suggestions-view.ts", "CONFIDENCE_HEADING"],
  ["suggestions-view.ts", "DETAILS_LABEL"],
  ["suggestions-view.ts", "DISMISS_LABEL"],
  ["suggestions-view.ts", "SIMULATE_LABEL"],
  ["suggestions-view.ts", "SOON_MARK"],
  ["suggestions-view.ts", "DISMISSED_NOTE"],
  ["suggestions-view.ts", "DRAFT_HUMAN_NOTE"],
  ["suggestions-view.ts", "MEASUREMENTS_LINK"],
  ["suggestions-view.ts", "OPEN_STUDIO"],
  ["suggestions-view.ts", "OPEN_DRAFT"],
  ["suggestions-view.ts", "PREVIEW_EYEBROW"],
  ["suggestions-view.ts", "LANDS_LABEL"],
  ["suggestions-view.ts", "CANNOT_APPLY"],
  ["suggestions-view.ts", "ALREADY_RESOLVED"],
  ["suggestions-view.ts", "DISMISS_TITLE"],
  ["suggestions-view.ts", "REASON_LABEL"],
  ["suggestions-view.ts", "SPIKE_CONFIRM"],
  ["measurements-view.ts", "MEASUREMENTS_TITLE"],
  ["measurements-view.ts", "CONFOUNDED_MARK"],
  ["measurements-view.ts", "CONFOUNDS_HEADING"],
  ["measurements-view.ts", "RETRAINS_WORD"],
  ["measurements-view.ts", "RECALIBRATION_HEADING"],
  ["measurements-view.ts", "HOW_IT_WORKS_TITLE"],
  ["measurements-view.ts", "NOT_READ_LABEL"],
  ["measurements-view.ts", "LOCALITY_NOTE"],
  ["measurements-view.ts", "LOCALITY_LINK"],
  ["tickets-view.ts", "TICKETS_TITLE"],
  ["tickets-view.ts", "SELECT_ALL_LABEL"],
  ["tickets-view.ts", "RETRY_LABEL"],
  ["tickets-view.ts", "EDIT_DRAFTS_LABEL"],
  ["tickets-view.ts", "PUSH_FAILED"],
  ["tickets-view.ts", "OPEN_ISSUES_LABEL"],
  ["tickets-view.ts", "UNDRAFTED_HEADING"],
  ["tickets-view.ts", "DRAFT_TRACKER_LABEL"],
];

describe("the build analyzer page (#1187)", () => {
  it.each(NAMED_LABELS)("names %s's %s exactly as the page draws it", (file, name) => {
    expect(FLAT_PAGE).toContain(constant(file, name));
  });

  it("names both suggestion cards as they are titled", () => {
    const titles = /CARD_TITLES[^=]+= \{([^}]+)\}/.exec(analyzerSource("suggestions-view.ts"));
    expect(titles).not.toBeNull();
    for (const [, title] of titles![1].matchAll(/: "([^"]+)"/g)) {
      expect(FLAT_PAGE).toContain(`**${title}**`);
    }
  });

  it("names the summary strip's four slots as they are labelled", () => {
    const labels = /STRIP_LABELS = \{([^}]+)\}/.exec(analyzerSource("view.ts"));
    expect(labels).not.toBeNull();
    for (const [, label] of labels![1].matchAll(/: "([^"]+)"/g)) {
      expect(FLAT_PAGE).toContain(`**${label}**`);
    }
  });

  it("names the schedule sheet's fields as it labels them", () => {
    const sheet = analyzerSource("schedule-sheet.tsx");
    for (const field of [
      "Scheduled runs",
      "Weekly run",
      "Day",
      "Time (UTC)",
      "Every-N-builds run",
      "Builds between runs",
      "Max builds",
      "Max log lines",
      "Compute ceiling (s)",
    ]) {
      expect(sheet).toContain(`label="${field}"`);
      expect(FLAT_PAGE).toContain(`**${field}**`);
    }
  });

  it("names each primary action as the row composes it", () => {
    const view = analyzerSource("suggestions-view.ts");
    expect(view).toContain('label: "Apply"');
    expect(view).toContain('label: "Draft spike ticket"');
    expect(view).toContain("label: `Draft as v${suggestion.workflow.nextVersion}`");
    for (const label of ["Apply", "Draft as v15 →", "Draft spike ticket"]) {
      expect(PAGE).toContain(`**${label}**`);
    }
  });

  it("states the history floor the service enforces", () => {
    const manifest = readFileSync(
      join(
        REPO_ROOT,
        "ouroboros-rest",
        "src",
        "modules",
        "analyzer",
        "corpus",
        "corpus.manifest.ts",
      ),
      "utf8",
    );
    const floor = /MINIMUM_DAYS_WITH_BUILDS\s*=\s*(\d+)/.exec(manifest);
    expect(floor).not.toBeNull();
    expect(FLAT_PAGE).toContain(`builds on at least ${floor![1]} days`);
  });

  it("shows the six screenshots the issue lists", () => {
    for (const id of [
      "user-guide.analyzer",
      "user-guide.analyzer.duration",
      "user-guide.analyzer.suggestion",
      "user-guide.analyzer.predicted-vs-measured",
      "user-guide.analyzer.tickets",
      "user-guide.analyzer.gated",
    ]) {
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
