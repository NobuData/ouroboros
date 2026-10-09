import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The repository root, two levels above this file (`ouroboros-docs/tests/`). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The page under test. */
const PAGE = readFileSync(
  join(REPO_ROOT, "ouroboros-docs", "docs", "user-guide", "models.mdx"),
  "utf8",
);

/** The page with its whitespace collapsed, so a quoted label may wrap over a line. */
const FLAT_PAGE = PAGE.replace(/\s+/g, " ");

/**
 * Reads a UI source file.
 *
 * @param path the file's path under `ouroboros-ui/app/`.
 * @returns its text.
 */
function uiSource(path: string): string {
  return readFileSync(join(REPO_ROOT, "ouroboros-ui", "app", path), "utf8");
}

/**
 * Reads the value of one string constant a file declares, exported or not.
 *
 * @param path the file under `ouroboros-ui/app/`.
 * @param name the constant's name.
 * @returns its value.
 * @throws {Error} when the file declares no such string constant.
 */
function constant(path: string, name: string): string {
  const match = new RegExp(`const ${name} =\\s*"([^"]+)";`).exec(uiSource(path));
  if (!match) throw new Error(`${path} declares no string constant ${name}`);
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
 * The bold first-column cells of the page's tables within one section.
 *
 * @param heading the section's heading.
 * @returns the cells, in order.
 */
function tableColumns(heading: string): string[] {
  return [...section(heading).matchAll(/^\| \*\*([^*]+)\*\* \|/gm)].map((match) => match[1]);
}

/** The labels the page names, by the constant the UI draws them from. */
const NAMED_LABELS: readonly (readonly [path: string, name: string])[] = [
  ["models/chain.ts", "SAVE_ROUTES"],
  ["models/chain.ts", "DISCARD"],
  ["models/chain.ts", "ADD_HOP"],
  ["models/chain.ts", "RESOLVES"],
  ["models/chain.ts", "ROUTES_FORBIDDEN"],
  ["models/inspector.ts", "ALLOW_LOCAL_LABEL"],
  ["models/inspector.ts", "MAX_COST_LABEL"],
  ["models/inspector.ts", "OPEN_REGISTRY"],
  ["models/inspector.ts", "SIMULATE_ROUTE"],
  ["models/matrix.ts", "MATRIX_TITLE"],
  ["models/matrix.ts", "INSPECTOR_TITLE"],
  ["models/rules.ts", "RULES_TITLE"],
  ["models/rules.ts", "ADD_RULE"],
  ["models/rules.ts", "SAVE_RULE"],
  ["models/rules.ts", "DELETE_TITLE"],
  ["models/rules.ts", "LABEL_REQUIRED"],
  ["models/simulation.ts", "SIMULATE_TITLE"],
  ["models/simulation.ts", "RUN_SIMULATION"],
  ["models/simulation.ts", "TASK_KIND_LABEL"],
  ["models/simulation.ts", "EFFORT_LABEL"],
  ["models/simulation.ts", "LABELS_LABEL"],
  ["models/simulation.ts", "DIFF_LABEL"],
  ["models/simulation.ts", "CHAIN_HEADING"],
  ["models/simulation.ts", "RULES_HEADING"],
  ["models/simulation.ts", "VOTES_HEADING"],
  ["models/simulation.ts", "FLOOR_HEADING"],
  ["models/simulation.ts", "COST_HEADING"],
  ["models/simulation.ts", "LOCAL_HEADING"],
  ["models/states.ts", "ROUTING_FAILED_HEADLINE"],
  ["registry/table.ts", "TABLE_TITLE"],
  ["registry/table.ts", "FIX_IN_PROVIDERS"],
  ["registry/table.ts", "SWITCH_OFF_CONFIRM"],
  ["registry/table.ts", "INSPECTOR_TITLE"],
  ["registry/chain.ts", "CHAIN_TITLE"],
  ["registry/chain.ts", "CHAIN_CAPTION"],
  ["registry/inspector.ts", "USED_BY_LABEL"],
  ["registry/inspector.ts", "RESTRICTIONS_TITLE"],
  ["registry/inspector.ts", "SAVE_LABEL"],
  ["registry/inspector.ts", "DUPLICATE_LABEL"],
  ["registry/inspector.ts", "REMOVE_LABEL"],
  ["registry/inspector.ts", "NAME_TAKEN"],
  ["registry/create.ts", "MODE_NOW_LABEL"],
  ["registry/create.ts", "MODE_LATER_LABEL"],
  ["registry/create.ts", "CREATE_SUBMIT"],
  ["registry/view.ts", "IMPORT_LABEL"],
  ["registry/view.ts", "NEW_ALIAS_LABEL"],
  ["registry/view.ts", "REGISTRY_FAILED_HEADLINE"],
  ["registry/wizard.ts", "REVIEW_NEXT"],
  ["registry/wizard.ts", "IMPORT_SUBMIT"],
];

describe("the models page (#1181)", () => {
  it.each(NAMED_LABELS)("names %s's %s exactly as the UI draws it", (path, name) => {
    expect(FLAT_PAGE).toContain(constant(path, name));
  });

  it("names the routing matrix's columns as the matrix heads them", () => {
    const matrix = uiSource("models/routing-matrix.tsx");
    const columns = tableColumns("Routing");
    expect(columns).toHaveLength(6);
    for (const column of columns) expect(matrix).toContain(`header: "${column}"`);
  });

  it("names the allowed-models columns as the registry table heads them", () => {
    const table = uiSource("registry/registry-table.tsx");
    const columns = tableColumns("The model registry");
    expect(columns).toHaveLength(8);
    for (const column of columns) expect(table).toContain(`header: "${column}"`);
  });

  it("names every rule condition and action as the builder words them", () => {
    const rules = uiSource("models/rules.ts");
    for (const [, words] of rules.matchAll(
      /^ {2}(?:effort_gte|label|diff_kind|use_alias|add_vote|route_local|docs_only): "([^"]+)",/gm,
    )) {
      expect(FLAT_PAGE).toContain(`**${words}**`);
    }
  });

  it("quotes the floor as the route card composes it", () => {
    expect(uiSource("models/inspector.ts")).toContain(
      "`Fail run instead of degrading below fallback ${hop.toString()}`",
    );
    expect(FLAT_PAGE).toContain("Fail run instead of degrading below fallback N");
  });

  it("links the administrators' providers page", () => {
    expect(PAGE).toContain("](../administration/providers.mdx)");
  });

  it("shows the four screenshots the issue lists", () => {
    for (const id of [
      "user-guide.models.routing",
      "user-guide.models.routing.escalation",
      "user-guide.models.registry",
      "user-guide.models.registry.detail",
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
