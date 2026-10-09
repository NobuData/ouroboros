import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The repository root, two levels above this file (`ouroboros-docs/tests/`). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The page under test. */
const PAGE = readFileSync(
  join(REPO_ROOT, "ouroboros-docs", "docs", "user-guide", "pull-requests.mdx"),
  "utf8",
);

/**
 * Reads a source file of the PR verification page.
 *
 * @param name the file's name under `ouroboros-ui/app/prs/`.
 * @returns its text.
 */
function prsSource(name: string): string {
  return readFileSync(join(REPO_ROOT, "ouroboros-ui", "app", "prs", name), "utf8");
}

/**
 * Reads the value of one exported string constant, e.g. `export const MERGE_LABEL = "…";`.
 *
 * @param file the file under `ouroboros-ui/app/prs/`.
 * @param name the constant's name.
 * @returns its value.
 * @throws {Error} when the file declares no such string constant.
 */
function constant(file: string, name: string): string {
  const match = new RegExp(`export const ${name} =\\s*"([^"]+)";`).exec(prsSource(file));
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
  ["view.ts", "PR_EYEBROW"],
  ["view.ts", "REVIEW_LABEL"],
  ["view.ts", "RETURN_LABEL"],
  ["view.ts", "MERGE_LABEL"],
  ["view.ts", "MERGE_NOW_LABEL"],
  ["view.ts", "RETURN_GATES_LABEL"],
  ["gates.ts", "GATES_TITLE"],
  ["gates.ts", "FOLLOW_LATEST"],
  ["gates.ts", "RUN_CONSOLE_LINK"],
  ["gates.ts", "UNAVAILABLE_NOTE"],
  ["gates.ts", "PENDING_PILL"],
  ["gates.ts", "AUTO_MERGE_ELIGIBLE"],
  ["gates.ts", "APPROVE_LABEL"],
  ["gates.ts", "DECLINE_LABEL"],
  ["gates.ts", "REQUEST_LABEL"],
  ["gates.ts", "AWAITS_APPROVER"],
  ["gates.ts", "DECLINE_NOTE_LABEL"],
  ["criteria.ts", "CRITERIA_TITLE"],
  ["criteria.ts", "ADD_CLAIM_LABEL"],
  ["criteria.ts", "IMPORT_LABEL"],
  ["criteria.ts", "ATTACH_LABEL"],
  ["criteria.ts", "VERIFY_LABEL"],
  ["criteria.ts", "WAIVE_LABEL"],
  ["criteria.ts", "WAIVE_AGAIN_LABEL"],
  ["criteria.ts", "VERIFIED_PILL"],
  ["criteria.ts", "UNVERIFIED_PILL"],
  ["criteria.ts", "WAIVED_ANNOTATED_PILL"],
  ["criteria.ts", "WAIVED_FAILED_PILL"],
  ["criteria.ts", "WAIVED_PENDING_PILL"],
  ["evidence-dialog.tsx", "KIND_LEGEND"],
  ["evidence-dialog.tsx", "QUALIFIER_LABEL"],
  ["waive-dialog.tsx", "WAIVE_REASON_LABEL"],
  ["waive-dialog.tsx", "WAIVE_CONFIRM"],
  ["strip.ts", "STRIP_TITLE"],
  ["strip.ts", "STRIP_TAG"],
  ["strip.ts", "SCOPED_HERE"],
  ["strip.ts", "CORRECTION_LABEL"],
  ["strip.ts", "ON_ALL_GREEN"],
  ["files.ts", "FILES_TITLE"],
  ["files.ts", "FULL_DIFF_LINK"],
  ["files.ts", "OUT_OF_SCOPE_TAG"],
  ["thread.ts", "THREAD_TITLE"],
  ["thread.ts", "BLOCKING_PILL"],
  ["thread.ts", "WAS_BLOCKING_PILL"],
  ["thread.ts", "RESOLVED_LINE"],
  ["thread.ts", "RESOLVE_LABEL"],
  ["thread.ts", "SIMULATED_MARK"],
  ["spend.ts", "SPEND_TITLE"],
  ["merge-plan.ts", "MERGE_PLAN_TITLE"],
  ["merge-plan.ts", "EDIT_POLICY_LINK"],
  ["merge-plan.ts", "STRATEGY_LABEL"],
  ["merge-plan.ts", "IRREVERSIBLE"],
  ["merge-plan.ts", "ARM_CONFIRM"],
  ["merge-plan.ts", "DISARM_LABEL"],
  ["merge-plan.ts", "EPIC_LABEL"],
  ["merge-message.ts", "MESSAGE_LABEL"],
  ["merge-message.ts", "SAVE_MESSAGE"],
  ["states.ts", "SYNC_LAG_RETRY"],
];

describe("the pull requests page (#1184)", () => {
  it.each(NAMED_LABELS)("names %s's %s exactly as the page draws it", (file, name) => {
    expect(PAGE).toContain(constant(file, name));
  });

  it("names the seven gates as the service titles them", () => {
    const definitions = readFileSync(
      join(
        REPO_ROOT,
        "ouroboros-rest",
        "src",
        "modules",
        "pull-requests",
        "gates",
        "gate.definitions.ts",
      ),
      "utf8",
    );
    const gates = [...section("Verification gates").matchAll(/^\| \*\*([^*]+)\*\*/gm)].map(
      (match) => match[1],
    );
    expect(gates).toHaveLength(7);
    for (const gate of gates) expect(definitions).toContain(`: "${gate}"`);
  });

  it("names each re-check refusal with the merge plan's own headline", () => {
    const refusals = [...section("What can go wrong").matchAll(/^ {2}- \*\*([^*]+)\*\* —/gm)].map(
      (match) => match[1],
    );
    expect(refusals).toHaveLength(5);
    for (const headline of refusals) expect(prsSource("merge-terms.ts")).toContain(`"${headline}"`);
  });

  it("shows the four screenshots the issue lists", () => {
    for (const id of [
      "user-guide.pr",
      "user-guide.pr.criteria",
      "user-guide.pr.evidence",
      "user-guide.pr.merge-confirm",
    ]) {
      expect(PAGE).toContain(`<Screenshot id="${id}" />`);
    }
  });

  it("carries no internal issue references in its prose", () => {
    // Bold spans quote the UI, which names pull requests and issues such as "PR #514".
    const prose = PAGE.replace(/^---\n[\s\S]*?\n---\n/, "")
      .replace(/\*\*[^*]+\*\*/g, "")
      .replace(/`[^`]+`/g, "");
    expect(prose).not.toMatch(/#\d{2,}|\[[A-Z]{1,2}\.\d+\]/);
  });
});
