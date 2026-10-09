import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The repository root, two levels above this file (`ouroboros-docs/tests/`). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

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
 * Reads one page of the Administration section, with its whitespace collapsed so a quoted
 * sentence may wrap over lines.
 *
 * @param name the page's file name under `ouroboros-docs/docs/administration/`.
 * @returns its text.
 */
function page(name: string): string {
  return source("ouroboros-docs", "docs", "administration", name).replace(/\s+/g, " ");
}

/** The overview page. */
const OVERVIEW = page("index.mdx");

/** The roles page. */
const ROLES = page("roles.mdx");

/**
 * Reads the value of one exported string constant of the UI, joining a value written as
 * several `"…" +` pieces — e.g. `export const NOTE =\n  "One " +\n  "two.";`.
 *
 * @param file the file, from `ouroboros-ui/app/`.
 * @param name the constant's name.
 * @returns its value.
 * @throws {Error} when the file declares no such string constant.
 */
function constant(file: string, name: string): string {
  const text = source("ouroboros-ui", "app", ...file.split("/"));
  const match = new RegExp(`export const ${name} =\\s*((?:"[^"]*"\\s*\\+?\\s*)+);`).exec(text);
  if (!match) throw new Error(`${file} declares no string constant ${name}`);
  return [...match[1].matchAll(/"([^"]*)"/g)].map((piece) => piece[1]).join("");
}

/**
 * Lists every `*.controller.ts` file of the REST service, recursively.
 *
 * @param dir the directory to walk.
 * @returns absolute paths.
 */
function controllers(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return controllers(path);
    return entry.name.endsWith(".controller.ts") ? [path] : [];
  });
}

describe("the administration overview (#1189)", () => {
  it("names the settings hub's head as the page draws it", () => {
    for (const name of [
      "SETTINGS_TITLE",
      "SETTINGS_SUBLINE",
      "EXPORT_AUDIT_LABEL",
      "IMMEDIATE_MARK",
    ]) {
      expect(OVERVIEW).toContain(constant("settings/view.ts", name));
    }
  });

  it("lists every tab of the settings tab row, in its order", () => {
    const view = source("ouroboros-ui", "app", "settings", "view.ts");
    // The six section tabs, in TAB_ORDER, then the four mounted tabs.
    const order = /const TAB_ORDER[^=]*=\s*\[([^\]]+)\]/.exec(view)?.[1] ?? "";
    const ids = [...order.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
    const tabs = ids.map((id) => {
      const tab = new RegExp(`id: "${id}",\\s*title: "[^"]+",\\s*tab: "([^"]+)"`).exec(view);
      if (!tab) throw new Error(`no tab for section ${id}`);
      return tab[1];
    });
    const mounted = /export const MOUNTED_TABS[\s\S]*?\];/.exec(view)?.[0] ?? "";
    tabs.push(...[...mounted.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]));
    expect(tabs).toHaveLength(10);

    const rows = [...OVERVIEW.matchAll(/\| \*\*([^*]+)\*\* \| [^|]+ \| \[/g)]
      .map((match) => match[1])
      .filter((label) => tabs.includes(label));
    expect(rows).toEqual(tabs);
  });

  it("quotes the read-only note as the hub words it", () => {
    expect(OVERVIEW).toContain(constant("settings/access.ts", "READ_ONLY_BODY"));
    expect(ROLES).toContain(constant("settings/access.ts", "READ_ONLY_BODY"));
  });

  it("shows the settings screenshot the issue lists", () => {
    expect(OVERVIEW).toContain('<Screenshot id="administration.settings" />');
  });
});

describe("the roles & capabilities page (#1189)", () => {
  it("offers the three roles the role picker offers, stored as the service stores them", () => {
    const view = source("ouroboros-ui", "app", "members", "view.ts");
    const choices = [...view.matchAll(/\{ label: "([A-Za-z]+)", role: "([a-z]+)", note:/g)].map(
      (match) => [match[1], match[2]],
    );
    expect(choices).toEqual([
      ["Owner", "owner"],
      ["Maintainer", "admin"],
      ["Viewer", "viewer"],
    ]);
    for (const [label, role] of choices) {
      expect(ROLES).toContain(`| **${label}** | \`${role}\` |`);
    }
  });

  it("prints the Members card's footer as the service builds it", () => {
    const roles = source("ouroboros-rest", "src", "modules", "members", "members.roles.ts");
    expect(roles).toContain('{ label: "Owner", roles: ["owner"] }');
    expect(roles).toContain('{ label: "Maintainer", roles: ["admin"] }');
    expect(roles).toContain('{ label: "Viewer", roles: ["member", "viewer"] }');
    expect(ROLES).toContain("**Owner > Maintainer (approve/merge) > Viewer (read-only)**");
  });

  it("documents the only capability there is, with the card's own words", () => {
    const capabilities = source("ouroboros-rest", "src", "modules", "tenancy", "capabilities.ts");
    expect(capabilities).toContain(
      'export const MEMBER_CAPABILITIES = ["can_approve_loops"] as const;',
    );
    expect(capabilities).toContain(
      'export const APPROVING_ROLES: readonly OrganizationRole[] = ["owner", "admin"];',
    );
    expect(source("ouroboros-ui", "app", "members", "view.ts")).toContain(
      'capability: "Can approve loops"',
    );
    expect(ROLES).toContain("**Can approve loops**");
    for (const name of ["CAPABILITY_CONSEQUENCE", "SERVICE_NO_CAPABILITY", "OWNER_ONLY_REASON"]) {
      expect(ROLES).toContain(constant("members/view.ts", name));
    }
    expect(ROLES).toContain(constant("inbox/card-view.ts", "NEEDS_APPROVER"));
  });

  it("names as approval answers exactly the inbox actions that need the capability", () => {
    const declarations = [
      source("ouroboros-db", "migrations", "V093__decision_kinds_items.sql"),
      source("ouroboros-db", "migrations", "V097__decision_kinds_mvp_source_resolved.sql"),
    ].join("\n");
    // Only the kinds something raises today — the inbox page's table lists those; a kind that is
    // declared but never raised (such as a spend approval) asks nobody anything.
    const inbox = source("ouroboros-docs", "docs", "user-guide", "inbox.mdx");
    const approver = new Set(
      [...declarations.matchAll(/"label": "([^"]+)"[^}]*"required_role": "approver"/g)]
        .map((match) => match[1])
        .filter((label) => inbox.includes(`**${label}**`)),
    );
    expect(approver.size).toBeGreaterThan(0);
    const named =
      /answer the approval decisions in the Needs-you inbox — (.*?);/.exec(ROLES)?.[1] ?? "";
    const labels = new Set([...named.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1]));
    expect(labels).toEqual(approver);
  });

  it("names delete and restore as the only owner-only routes", () => {
    const owners = controllers(join(REPO_ROOT, "ouroboros-rest", "src", "modules")).flatMap(
      (file) => {
        const text = readFileSync(file, "utf8");
        // Each handler's run of decorators, in whatever order they are written.
        return [...text.matchAll(/(?:@\w+\([^)]*\)\s*)+/g)]
          .map((block) => block[0])
          .filter((block) => block.includes('@Roles("owner")'))
          .map((block) => /@(?:Post|Put|Patch|Delete)\("([^"]+)"\)/.exec(block)?.[1] ?? block);
      },
    );
    expect(owners.sort()).toEqual(["delete", "restore"]);
    expect(ROLES).toContain("Owner to delete and restore");
  });

  it("quotes the refusals as the app words them", () => {
    for (const [file, name] of [
      ["members/view.ts", "LAST_OWNER_DEMOTE"],
      ["lifecycle/danger.ts", "DELETE_OWNER_ONLY"],
    ] as const) {
      expect(ROLES).toContain(constant(file, name));
    }
    for (const [file, sentence] of [
      [
        "policies/card-view.ts",
        "Not published — this edit loosens a rule, and only an owner can publish that.",
      ],
      [
        "audit-log/view.ts",
        "The audit log is read by owners and admins. Ask one of them for what you need from it.",
      ],
    ] as const) {
      expect(ROLES).toContain(sentence);
      expect(source("ouroboros-ui", "app", ...file.split("/"))).toContain(sentence);
    }
  });

  it("covers every section of the settings hub and every mounted tab", () => {
    const view = source("ouroboros-ui", "app", "settings", "view.ts");
    const titles = [...view.matchAll(/id: "[a-z]+",\s*title: "([^"]+)"/g)].map((match) => match[1]);
    expect(titles).toHaveLength(8);
    const mounted = /export const MOUNTED_TABS[\s\S]*?\];/.exec(view)?.[0] ?? "";
    const labels = [...mounted.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
    for (const name of [...titles, ...labels]) expect(ROLES).toContain(`| **${name}** |`);
  });

  it("carries no internal issue references or migration numbers in its prose", () => {
    for (const text of [OVERVIEW, ROLES]) {
      const prose = text
        .replace(/^--- .*? --- /, "")
        .replace(/\*\*[^*]+\*\*/g, "")
        .replace(/`[^`]+`/g, "");
      expect(prose).not.toMatch(/#\d{2,}|\[[A-Z]{1,2}\.\d+\]|\bV\d{3}\b/);
    }
  });
});
