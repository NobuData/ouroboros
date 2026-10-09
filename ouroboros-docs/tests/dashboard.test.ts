import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The repository root, two levels above this file (`ouroboros-docs/tests/`). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The page under test. */
const PAGE = readFileSync(
  join(REPO_ROOT, "ouroboros-docs", "docs", "user-guide", "dashboard.mdx"),
  "utf8",
);

/** The page with its whitespace collapsed, so a quoted label may wrap over a line. */
const FLAT_PAGE = PAGE.replace(/\s+/g, " ");

/**
 * Reads a source file of the dashboard.
 *
 * @param name the file's name under `ouroboros-ui/app/dashboard/`.
 * @returns its text.
 */
function dashboardSource(name: string): string {
  return readFileSync(join(REPO_ROOT, "ouroboros-ui", "app", "dashboard", name), "utf8");
}

/**
 * Reads the value of one string constant a file declares, exported or not.
 *
 * @param file the file under `ouroboros-ui/app/dashboard/`.
 * @param name the constant's name.
 * @returns its value.
 * @throws {Error} when the file declares no such string constant.
 */
function constant(file: string, name: string): string {
  const match = new RegExp(`const ${name} =\\s*"([^"]+)";`).exec(dashboardSource(file));
  if (!match) throw new Error(`${file} declares no string constant ${name}`);
  return match[1];
}

/** The labels the page names, by the constant the dashboard draws them from. */
const NAMED_LABELS: readonly (readonly [file: string, name: string])[] = [
  ["view.ts", "LEVEL_WITH_LAST_WEEK"],
  ["view.ts", "PULSE_UNMEASURED"],
  ["view.ts", "AUTO_MERGE_READ_ONLY"],
  ["view.ts", "AUTO_MERGE_WRITE_FAILURE"],
  ["auto-merge-switch.tsx", "AUTO_MERGE_LABEL"],
  ["active-loops-card.tsx", "TITLE"],
  ["active-loops-card.tsx", "NOTHING_RUNNING"],
  ["active-loops-card.tsx", "LOOPS_NOT_READ"],
  ["pulse-card.tsx", "TITLE"],
  ["pulse-card.tsx", "PULSE_WINDOW_TAG"],
  ["recently-closed-card.tsx", "TITLE"],
  ["recently-closed-card.tsx", "REVIEW_LABEL"],
  ["queue-card.tsx", "TITLE"],
  ["queue-card.tsx", "MANAGE_LABEL"],
  ["stale-banner.tsx", "UNREAD_HEADLINE"],
];

describe("the dashboard page (#1176)", () => {
  it.each(NAMED_LABELS)("names %s's %s exactly as the dashboard draws it", (file, name) => {
    expect(FLAT_PAGE).toContain(constant(file, name));
  });

  it("names the four figures as their cards are captioned", () => {
    const view = dashboardSource("view.ts");
    const figures = [...PAGE.matchAll(/^\| \*\*([^*]+)\*\* \|/gm)].map((match) => match[1]);
    expect(figures).toHaveLength(4);
    for (const figure of figures) expect(view).toContain(`label: "${figure}"`);
  });

  it("names the head's two actions as the screen labels them", () => {
    const screen = dashboardSource("dashboard-screen.tsx");
    for (const [, label] of screen.matchAll(/label: "([^"]+)",\s*tone:/g)) {
      expect(FLAT_PAGE).toContain(`**${label}**`);
    }
  });

  it("names the three pulse bars and every outcome as the dashboard does", () => {
    const view = dashboardSource("view.ts");
    for (const bar of ["Autonomous merge rate", "Median cycle time", "Human interventions"]) {
      expect(view).toContain(`label: "${bar}"`);
      expect(FLAT_PAGE).toContain(`**${bar}**`);
    }
    const outcomes = dashboardSource("recently-closed-card.tsx");
    for (const outcome of ["merged", "needs human", "failed", "canceled"]) {
      expect(outcomes).toContain(`: "${outcome}",`);
      expect(FLAT_PAGE).toContain(`**${outcome}**`);
    }
  });

  it("names the system summary's words as the card draws them", () => {
    const labels = /STATE_LABEL[^=]+= \{([^}]+)\}/.exec(dashboardSource("view.ts"));
    expect(labels).not.toBeNull();
    for (const [, word] of labels![1].matchAll(/: "([^"]+)"/g)) {
      expect(FLAT_PAGE).toContain(`**${word}**`);
    }
  });

  it("quotes the stale banner's headline in the shape the banner composes it", () => {
    expect(dashboardSource("stale-banner.tsx")).toContain(
      "`Showing data from ${clockTime(readAt)} — the latest refresh failed.`",
    );
    expect(FLAT_PAGE).toContain("Showing data from 14:20 — the latest refresh failed.");
  });

  it("shows the full page, one crop per card group and the fresh workspace", () => {
    for (const id of [
      "user-guide.dashboard",
      "user-guide.dashboard.loops",
      "user-guide.dashboard.pulse",
      "user-guide.dashboard.system",
      "user-guide.dashboard.closed",
      "user-guide.dashboard.queue",
      "user-guide.dashboard.empty",
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
