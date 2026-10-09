import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The repository root, two levels above this file (`ouroboros-docs/tests/`). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The page under test. */
const PAGE = readFileSync(
  join(REPO_ROOT, "ouroboros-docs", "docs", "user-guide", "knowledge.mdx"),
  "utf8",
);

/** The page with its whitespace collapsed, so a quoted label may wrap over a line. */
const FLAT_PAGE = PAGE.replace(/\s+/g, " ");

/**
 * Reads a source file of the knowledge page.
 *
 * @param name the file's name under `ouroboros-ui/app/knowledge/`.
 * @returns its text.
 */
function knowledgeSource(name: string): string {
  return readFileSync(join(REPO_ROOT, "ouroboros-ui", "app", "knowledge", name), "utf8");
}

/**
 * Reads the value of one exported string constant, e.g. `export const CONFIRM = "Confirm";`.
 *
 * @param file the file under `ouroboros-ui/app/knowledge/`.
 * @param name the constant's name.
 * @returns its value.
 * @throws {Error} when the file declares no such string constant.
 */
function constant(file: string, name: string): string {
  const match = new RegExp(`export const ${name} =\\s*"([^"]+)";`).exec(knowledgeSource(file));
  if (!match) throw new Error(`${file} declares no string constant ${name}`);
  return match[1];
}

/**
 * Reads the string values of one `{ key: "Label" }` record a file declares.
 *
 * @param file the file under `ouroboros-ui/app/knowledge/`.
 * @param name the record's name.
 * @returns its labels, in order.
 * @throws {Error} when the file declares no such record.
 */
function recordLabels(file: string, name: string): string[] {
  const match = new RegExp(`const ${name}[^=]*= \\{([^}]+)\\}`).exec(knowledgeSource(file));
  if (!match) throw new Error(`${file} declares no record ${name}`);
  return [...match[1].matchAll(/: "([^"]+)"/g)].map((label) => label[1]);
}

/** The labels the page names, by the constant the page draws them from. */
const NAMED_LABELS: readonly (readonly [file: string, name: string])[] = [
  ["view.ts", "KNOWLEDGE_TITLE"],
  ["view.ts", "IMPORT_LABEL"],
  ["view.ts", "NEW_SKILL_LABEL"],
  ["view.ts", "SKILLS_TITLE"],
  ["view.ts", "FACTS_TITLE"],
  ["view.ts", "PLAYBOOKS_TITLE"],
  ["view.ts", "SCOPE_TITLE"],
  ["scope.ts", "SCOPE_CAPTION"],
  ["scope.ts", "CURRENT_LABEL"],
  ["scope.ts", "SHOW_EVERY_SCOPE"],
  ["preview.ts", "PREVIEW_ACTION"],
  ["preview.ts", "PREVIEW_TITLE"],
  ["preview.ts", "PREVIEW_REPO_LABEL"],
  ["preview.ts", "PREVIEW_WORKFLOW_LABEL"],
  ["preview.ts", "PREVIEW_CONSUMER_LABEL"],
  ["preview.ts", "FACTS_HEADING"],
  ["preview.ts", "TRIMMED_HEADING"],
  ["preview.ts", "ABSENT_HEADING"],
  ["preview.ts", "REQUIRED_BADGE"],
  ["skills.ts", "COLUMN_SCOPE"],
  ["skills.ts", "COLUMN_USED_BY"],
  ["skills.ts", "COLUMN_UPDATED"],
  ["skills.ts", "COLUMN_ON"],
  ["skills.ts", "DRAFT_PILL"],
  ["skills.ts", "REQUIRED_TAG"],
  ["skills.ts", "GENERATED_TAG"],
  ["skills.ts", "REGENERATE_GLYPH"],
  ["skills.ts", "OPEN_IN_EDITOR"],
  ["states.ts", "MAP_PENDING"],
  ["states.ts", "MAP_FAILED"],
  ["create.ts", "CREATE_TITLE"],
  ["create.ts", "SLUG_LABEL"],
  ["create.ts", "SCOPE_ORG_LABEL"],
  ["create.ts", "SCOPE_REPO_LABEL"],
  ["create.ts", "CREATE_SUBMIT"],
  ["create.ts", "SLUG_TAKEN"],
  ["create.ts", "SLUG_SHAPE"],
  ["import.ts", "IMPORT_TITLE"],
  ["import.ts", "PREVIEW_SUBMIT"],
  ["import.ts", "APPLY_SUBMIT"],
  ["import.ts", "NONE_FOUND_TITLE"],
  ["import.ts", "UNCHANGED_TITLE"],
  ["import.ts", "NOTHING_IMPORTED"],
  ["facts.ts", "REVIEW_ALL"],
  ["facts.ts", "ADD_FACT_LABEL"],
  ["facts.ts", "CONFIRM"],
  ["facts.ts", "REJECT"],
  ["facts.ts", "RECONFIRM"],
  ["facts.ts", "EXPIRE"],
  ["facts.ts", "RELEARN"],
  ["facts.ts", "VIEWER_REASON"],
  ["facts.ts", "EXPIRE_REASON_LABEL"],
  ["facts.ts", "EXPIRE_SUBMIT"],
  ["facts.ts", "EXPIRE_CANCEL"],
  ["facts.ts", "EXPIRE_REASON_REQUIRED"],
  ["facts.ts", "ADD_FACT_TITLE"],
  ["facts.ts", "ADD_FACT_SUBMIT"],
  ["facts.ts", "FACT_TEXT_LABEL"],
  ["facts.ts", "FACT_TEXT_REQUIRED"],
  ["facts.ts", "FACT_REPO_LABEL"],
  ["facts.ts", "FACT_REPO_WORKSPACE"],
  ["facts.ts", "FACT_PROVENANCE_LABEL"],
  ["facts.ts", "ANCHORS_LABEL"],
  ["facts.ts", "ANCHOR_VALUE_REQUIRED"],
  ["playbooks.ts", "RUN_ON_ISSUE"],
  ["playbooks.ts", "NEW_PLAYBOOK"],
  ["playbooks.ts", "PICKER_SEARCH_LABEL"],
  ["playbooks.ts", "LAUNCH"],
  ["playbooks.ts", "NEW_PLAYBOOK_TITLE"],
  ["playbooks.ts", "RUNS_LEGEND"],
  ["playbooks.ts", "CHOOSE_RUN"],
  ["playbooks.ts", "CAPTURED_LEGEND"],
  ["playbooks.ts", "PIN_LABEL"],
  ["playbooks.ts", "OVERRIDES_LABEL"],
  ["playbooks.ts", "STEERS_LABEL"],
  ["playbooks.ts", "LABELS_LABEL"],
  ["playbooks.ts", "CREATE_SUBMIT"],
  ["playbooks.ts", "NAME_TAKEN"],
  ["playbooks.ts", "NO_RUNS"],
  ["profile.ts", "REPO_SELECT_LABEL"],
  ["profile.ts", "NOT_SCANNED_TITLE"],
  ["profile.ts", "PROTECTED_PATHS_LABEL"],
  ["profile.ts", "ENV_EDIT"],
  ["profile.ts", "ENV_ADD"],
  ["profile.ts", "ENV_CANCEL"],
  ["profile.ts", "ENV_TEXT_LABEL"],
  ["profile.ts", "SNAPSHOT_LABEL"],
];

describe("the knowledge page (#1188)", () => {
  it.each(NAMED_LABELS)("names %s's %s exactly as the page draws it", (file, name) => {
    expect(FLAT_PAGE).toContain(constant(file, name));
  });

  it("names each fact status as its chip reads", () => {
    const chips = [
      ...knowledgeSource("facts.ts").matchAll(/^ {2}[a-z]+: \{ text: "([^"]+)"/gm),
    ].map((match) => match[1]);
    const table = [...PAGE.matchAll(/^\| \*\*([^*]+)\*\* \|/gm)].map((match) => match[1]);
    expect(table.length).toBeGreaterThan(0);
    for (const status of table) expect(chips).toContain(status);
  });

  it("names the skill scopes, the anchor kinds and the preview consumers as the UI labels them", () => {
    for (const label of [
      ...recordLabels("skills.ts", "SCOPE_LABEL"),
      ...recordLabels("facts.ts", "ANCHOR_KIND_LABELS"),
    ]) {
      expect(FLAT_PAGE).toContain(`**${label}**`);
    }
    for (const [, label] of knowledgeSource("preview.ts").matchAll(
      /value: "[a-z_]+", label: "([^"]+)"/g,
    )) {
      expect(FLAT_PAGE).toContain(`**${label}**`);
    }
  });

  it("names the rules files the import reads", () => {
    const lead = knowledgeSource("import.ts");
    for (const file of [
      "CLAUDE.md",
      "AGENTS.md",
      ".cursorrules",
      ".github/copilot-instructions.md",
    ]) {
      expect(lead).toContain(file);
      expect(PAGE).toContain(`\`${file}\``);
    }
  });

  it("anchors the repository profile where the UI links it", () => {
    expect(source("ouroboros-ui", "app", "paths.ts")).toMatch(
      /KNOWLEDGE_PROFILE_HASH = "repo-profile"/,
    );
    expect(PAGE).toContain("`/knowledge#repo-profile`");
  });

  it("shows the three screenshots the issue lists", () => {
    for (const id of [
      "user-guide.knowledge",
      "user-guide.knowledge.fact",
      "user-guide.knowledge.repo-profile",
    ]) {
      expect(PAGE).toContain(`<Screenshot id="${id}" />`);
    }
  });

  it("carries no internal issue references in its prose", () => {
    const prose = PAGE.replace(/^---\n[\s\S]*?\n---\n/, "")
      .replace(/\*\*[^*]+\*\*/g, "")
      .replace(/`[^`]+`/g, "")
      .replace(/\*[^*]+\*/g, "");
    expect(prose).not.toMatch(/#\d{2,}|\[[A-Z]{1,2}\.\d+\]/);
  });
});

/**
 * Reads a file of the repository.
 *
 * @param path the file's path segments, from the repository root.
 * @returns its text.
 */
function source(...path: string[]): string {
  return readFileSync(join(REPO_ROOT, ...path), "utf8");
}
