import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The repository root, two levels above this file (`ouroboros-docs/tests/`). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The page under test. */
const PAGE = readFileSync(
  join(REPO_ROOT, "ouroboros-docs", "docs", "user-guide", "inbox.mdx"),
  "utf8",
);

/**
 * Reads a file of the repository.
 *
 * @param path the file's path segments, from the repository root.
 * @returns its text.
 */
function source(...path: string[]): string {
  return readFileSync(join(REPO_ROOT, ...path), "utf8");
}

/**
 * Reads a source file of the inbox page.
 *
 * @param name the file's name under `ouroboros-ui/app/inbox/`.
 * @returns its text.
 */
function inboxSource(name: string): string {
  return source("ouroboros-ui", "app", "inbox", name);
}

/**
 * Reads the value of one exported string constant, e.g. `export const SNOOZE_LABEL = "Snooze";`.
 *
 * @param file the file under `ouroboros-ui/app/inbox/`.
 * @param name the constant's name.
 * @returns its value.
 * @throws {Error} when the file declares no such string constant.
 */
function constant(file: string, name: string): string {
  const match = new RegExp(`export const ${name} =\\s*"([^"]+)";`).exec(inboxSource(file));
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

/** The labels the page names, by the constant the page draws them from. */
const NAMED_LABELS: readonly (readonly [file: string, name: string])[] = [
  ["view.ts", "INBOX_EYEBROW"],
  ["view.ts", "SNOOZE_ALL_LABEL"],
  ["view.ts", "NOTIFICATIONS_LABEL"],
  ["view.ts", "VIEWER_CANNOT_SNOOZE"],
  ["view.ts", "SNOOZED_LABEL"],
  ["view.ts", "STALE_HEADLINE"],
  ["view.ts", "LAST_REFRESHED"],
  ["view.ts", "CARD_FAILED_TITLE"],
  ["card-view.ts", "ANSWERING"],
  ["card-view.ts", "ANSWER_FAILED"],
  ["card-view.ts", "NOTE_LABEL"],
  ["card-view.ts", "NOTE_HINT"],
  ["card-view.ts", "SNOOZE_LABEL"],
  ["card-view.ts", "SNOOZE_GROUP_LABEL"],
  ["card-view.ts", "NEEDS_APPROVER"],
  ["snoozed-view.ts", "WAKE_LABEL"],
  ["resolved-view.ts", "EARLIER_LABEL"],
  ["resolved-view.ts", "LATER_LABEL"],
  ["resolved-view.ts", "TODAY_LABEL"],
  ["resolved-view.ts", "POLICY_NOTE_LABEL"],
  ["resolved-view.ts", "POLICY_CONFIGURE"],
  ["side-view.ts", "CHANNELS_TITLE"],
  ["side-view.ts", "CONNECTED_MARK"],
  ["side-view.ts", "NOT_CONNECTED"],
  ["side-view.ts", "NOT_YET"],
  ["side-view.ts", "CHAT_OPS_LABEL"],
  ["side-view.ts", "SOON_MARK"],
  ["side-view.ts", "DIGEST_LEAD"],
  ["side-view.ts", "DIGEST_TIME_FIELD"],
  ["side-view.ts", "DIGEST_TIME_SAVE"],
  ["side-view.ts", "CHANNEL_SETTINGS_LABEL"],
  ["side-view.ts", "POLICY_TITLE"],
  ["side-view.ts", "EDIT_POLICIES_LABEL"],
  ["side-view.ts", "POLICY_SOURCE_LABEL"],
  ["side-view.ts", "POLICY_EDIT_LABEL"],
  ["stats-view.ts", "STATS_TITLE"],
  ["stats-view.ts", "MEDIAN_LEAD"],
  ["stats-view.ts", "WAIT_LEAD"],
  ["stats-view.ts", "STATS_METHOD_LABEL"],
  ["notifications-view.ts", "PREFERENCES_TITLE"],
  ["notifications-view.ts", "DIGEST_TOGGLE"],
  ["notifications-view.ts", "DIGEST_TIME_LABEL"],
  ["notifications-view.ts", "INSTANT_TOGGLE"],
  ["notifications-view.ts", "MUTES_LEGEND"],
  ["notifications-view.ts", "SAVE_LABEL"],
  ["notifications-view.ts", "SAVED"],
  ["notifications-view.ts", "PREFERENCES_UNREADABLE"],
];

/** The migrations that declare the shipped decision kinds and their action rows. */
const KIND_DECLARATIONS = [
  source("ouroboros-db", "migrations", "V093__decision_kinds_items.sql"),
  source("ouroboros-db", "migrations", "V097__decision_kinds_mvp_source_resolved.sql"),
]
  .join("\n")
  // SQL doubles a quote inside a string literal: `can''t` is `can't`.
  .replaceAll("''", "'");

describe("the needs-you inbox page (#1185)", () => {
  it.each(NAMED_LABELS)("names %s's %s exactly as the page draws it", (file, name) => {
    // Bold spans may wrap over a line; compare with the page's whitespace collapsed.
    expect(PAGE.replace(/\s+/g, " ")).toContain(constant(file, name));
  });

  it("names every answer and link of each kind as its declaration labels it", () => {
    const table = section("Decision kinds")
      .split("\n")
      .filter((line) => line.startsWith("| **"));
    expect(table).toHaveLength(8);
    for (const row of table) {
      const [, answers, links] = row.split(" | ");
      for (const [, label] of `${answers} ${links}`.matchAll(/\*\*([^*]+)\*\*/g)) {
        expect(KIND_DECLARATIONS).toContain(`"label": "${label}"`);
      }
    }
  });

  it("asks each kind's question as its declaration does", () => {
    const questions = [...section("Decision kinds").matchAll(/^\| \*\*([^*]+)\*\*/gm)].map(
      (match) => match[1],
    );
    // A templated question is shown with the seed's values; compare up to the first value.
    for (const question of questions) {
      const fixed = question.split(/ (?:refactor|6|#486)\b/)[0];
      expect(KIND_DECLARATIONS).toContain(fixed);
    }
  });

  it("names every kind the sheet lets you mute", () => {
    const labels = [
      ...inboxSource("notifications-view.ts").matchAll(/\{ id: "[a-z_]+", label: "([^"]+)" \}/g),
    ].map((match) => match[1]);
    expect(labels).toHaveLength(8);
    const sheet = section("Notification settings").replace(/\s+/g, " ");
    for (const label of labels) expect(sheet).toContain(`**${label}**`);
  });

  it("names the four channels as the service labels them", () => {
    const truth = source("ouroboros-rest", "src", "modules", "inbox-channels", "channels.truth.ts");
    const channels = [...section("The side column").matchAll(/^- \*\*([^*]+)\*\* —/gm)].map(
      (match) => match[1],
    );
    expect(channels).toEqual(["Slack", "Email", "Mobile push", "GitHub"]);
    for (const channel of channels) expect(truth).toContain(`label: "${channel}"`);
  });

  it("names each answer-link problem with its page's own heading", () => {
    const pages = source(
      "ouroboros-rest",
      "src",
      "modules",
      "inbox-channels",
      "answer",
      "answer.pages.ts",
    );
    const headings = [...section("Answering by email").matchAll(/^\| \*\*([^*]+)\*\* \|/gm)].map(
      (match) => match[1],
    );
    expect(headings).toHaveLength(6);
    for (const heading of headings) expect(pages).toContain(`heading: "${heading}"`);
  });

  it("quotes the refusals as the service words them", () => {
    const errors = source(
      "ouroboros-rest",
      "src",
      "modules",
      "inbox-actions",
      "inbox-actions.errors.ts",
    );
    for (const refusal of [
      "The guardrails still block this run after the one-time allowance; nothing was granted.",
      "This PR has no ticket, so there is no tracker to draft the bench upgrade into.",
    ]) {
      expect(section("What can go wrong")).toContain(refusal);
      expect(errors).toContain(refusal);
    }
  });

  it("shows the five screenshots the issue lists", () => {
    for (const id of [
      "user-guide.inbox",
      "user-guide.inbox.card",
      "user-guide.inbox.snooze",
      "user-guide.inbox.resolved",
      "user-guide.inbox.preferences",
    ]) {
      expect(PAGE).toContain(`<Screenshot id="${id}" />`);
    }
  });

  it("carries no internal issue references in its prose", () => {
    // Bold spans quote the UI, which names loops and issues such as "loop #1844".
    const prose = PAGE.replace(/^---\n[\s\S]*?\n---\n/, "")
      .replace(/\*\*[^*]+\*\*/g, "")
      .replace(/`[^`]+`/g, "");
    expect(prose).not.toMatch(/#\d{2,}|\[[A-Z]{1,2}\.\d+\]/);
  });
});
