import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The repository root, two levels above this file (`ouroboros-docs/tests/`). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The page under test. */
const PAGE = readFileSync(
  join(REPO_ROOT, "ouroboros-docs", "docs", "user-guide", "issues.mdx"),
  "utf8",
);

/**
 * Reads a source file of the Issues screen.
 *
 * @param name the file's name under `ouroboros-ui/app/issues/`.
 * @returns its text.
 */
function issuesSource(name: string): string {
  return readFileSync(join(REPO_ROOT, "ouroboros-ui", "app", "issues", name), "utf8");
}

/**
 * Returns the body of a `{ … }` or `[ … ]` literal that follows a declaration.
 *
 * @param source the file's text.
 * @param declaration the text that opens the literal, e.g. `STATUS_LABEL`.
 * @returns the text from the declaration to the first closing `};` or `];` after it.
 * @throws {Error} when the declaration is not in the file.
 */
function literalAfter(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error(`"${declaration}" is not in the source`);
  const end = source.slice(start).search(/\n[}\]];/);
  return source.slice(start, start + end);
}

/**
 * Collects every double-quoted string in a piece of source.
 *
 * @param text the source.
 * @returns the strings, in order.
 */
function quoted(text: string): string[] {
  return [...text.matchAll(/"([^"\n]+)"/g)].map((match) => match[1]);
}

describe("the Issues page (#1177)", () => {
  it("names every status pill the backlog table draws", () => {
    const labels = quoted(literalAfter(issuesSource("table.ts"), "STATUS_LABEL"));
    expect(labels).toHaveLength(5);
    for (const label of labels) expect(PAGE).toContain(`| **${label}** |`);
  });

  it("names the state and sort options exactly as the filter bar does", () => {
    const source = issuesSource("filter.ts");
    const options = [
      ...literalAfter(source, "STATE_OPTIONS").matchAll(/label: "([^"]+)"/g),
      ...literalAfter(source, "SORT_OPTIONS").matchAll(/label: "([^"]+)"/g),
    ].map((match) => match[1]);
    expect(options.length).toBeGreaterThanOrEqual(7);
    for (const option of options) expect(PAGE).toContain(`**${option}**`);
  });

  it("explains every sync-paused banner the screen can show", () => {
    const headlines = quoted(literalAfter(issuesSource("states.ts"), "not_configured:")).filter(
      (text) => text.startsWith("Sync paused"),
    );
    expect(headlines).toHaveLength(6);
    for (const headline of headlines) expect(PAGE).toContain(`| **${headline}** |`);
  });

  it("explains every reason the queue gives for refusing an issue", () => {
    const bar = issuesSource("bar.ts");
    const start = bar.indexOf("export function offenderLine");
    expect(start).toBeGreaterThanOrEqual(0);
    const source = bar.slice(start, bar.indexOf("\n}\n", start));
    const reasons = [...source.matchAll(/`\$\{subject\} ([^`]+)`/g)]
      .map((match) => match[1].split(" —")[0].replace(/\.$/, ""))
      .filter((reason) => reason !== "cannot be queued");
    expect(reasons).toHaveLength(7);
    const table = PAGE.slice(PAGE.indexOf("## When an issue cannot be queued"));
    for (const reason of reasons) expect(table).toContain(`**${reason}`);
  });

  it("shows the three screenshots the issue lists", () => {
    for (const id of [
      "user-guide.issues",
      "user-guide.issues.estimate",
      "user-guide.issues.queue-dialog",
    ]) {
      expect(PAGE).toContain(`<Screenshot id="${id}" />`);
    }
  });

  it("carries no internal issue references in its prose", () => {
    const body = PAGE.replace(/^---\n[\s\S]*?\n---\n/, "");
    expect(body).not.toMatch(/#\d{2,}|\[[A-Z]{1,2}\.\d+\]/);
  });
});
