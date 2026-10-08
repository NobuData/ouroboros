import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SECTIONS } from "../site.constants";

/** The site's pages directory (`ouroboros-docs/docs/`). */
const DOCS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "docs");

/**
 * Every page the content epics name, keyed by its path under `docs/`, with the issue that
 * writes it: DA (#1158, User Guide), DB (#1159, Administration) and DC (#1160, CLI) in
 * `docs/ROADMAP_OUROBOROS_DOCUMENTATION_SITE.md`. CY.2 (#1165) creates each as a stub so the
 * sidebars are final before the content lands.
 */
const PLANNED_PAGES: Record<string, number> = {
  "user-guide/index.mdx": 1173,
  "user-guide/concepts.mdx": 1173,
  "user-guide/glossary.mdx": 1173,
  "user-guide/getting-started/sign-in.mdx": 1174,
  "user-guide/getting-started/wizard.mdx": 1174,
  "user-guide/getting-started/first-loop.mdx": 1174,
  "user-guide/finding-your-way.mdx": 1175,
  "user-guide/dashboard.mdx": 1176,
  "user-guide/issues.mdx": 1177,
  "user-guide/planning.mdx": 1178,
  "user-guide/workflows/studio.mdx": 1179,
  "user-guide/workflows/code.mdx": 1180,
  "user-guide/models.mdx": 1181,
  "user-guide/runs/console.mdx": 1182,
  "user-guide/runs/tests.mdx": 1183,
  "user-guide/pull-requests.mdx": 1184,
  "user-guide/inbox.mdx": 1185,
  "user-guide/insights.mdx": 1186,
  "user-guide/analyzer.mdx": 1187,
  "user-guide/knowledge.mdx": 1188,

  "administration/index.mdx": 1189,
  "administration/roles.mdx": 1189,
  "administration/deploy/overview.mdx": 1190,
  "administration/deploy/containers.mdx": 1190,
  "administration/deploy/compose.mdx": 1190,
  "administration/deploy/farm-gateway.mdx": 1190,
  "administration/deploy/app-host.mdx": 1190,
  "administration/deploy/checklist.mdx": 1190,
  "administration/configuration/index.mdx": 1191,
  "administration/sign-in-and-workspace.mdx": 1192,
  "administration/members-and-tokens.mdx": 1193,
  "administration/sources.mdx": 1194,
  "administration/providers.mdx": 1195,
  "administration/build-farm.mdx": 1196,
  "administration/policies.mdx": 1197,
  "administration/notifications-and-webhooks.mdx": 1198,
  "administration/retention-audit-lifecycle.mdx": 1199,
  "administration/operations.mdx": 1200,

  "cli/index.mdx": 1201,
  "cli/install-sh.mdx": 1202,
  "cli/runner/index.mdx": 1203,
  "cli/runner/enroll.mdx": 1203,
  "cli/runner/run.mdx": 1203,
  "cli/runner/version.mdx": 1203,
  "cli/runner/hello.mdx": 1203,
  "cli/runner/heartbeat.mdx": 1203,
  "cli/runner/help.mdx": 1203,
  "cli/stack-commands.mdx": 1204,
  "cli/rest-api.mdx": 1205,
};

/** The marker every stub page carries until its content issue replaces it. */
const STUB_MARKER = ":::info[Being written]";

/**
 * Lists every file under a directory, recursively.
 *
 * @param dir the directory to walk.
 * @returns paths relative to `DOCS_DIR`, with `/` separators.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? walk(path)
      : [relative(DOCS_DIR, path).split("\\").join("/")];
  });
}

/**
 * Reads a page's YAML front matter as flat `key: value` pairs — enough for the scalar
 * fields pages use; quoted values are unquoted.
 *
 * @param page a page path relative to `DOCS_DIR`.
 * @returns the front matter fields, or an empty object if the page has none.
 */
function frontMatter(page: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(join(DOCS_DIR, page), "utf8"));
  if (!match) return {};
  return Object.fromEntries(
    match[1].split("\n").flatMap((line) => {
      const field = /^(\w+):\s*(.*)$/.exec(line);
      if (!field) return [];
      const value = field[2].startsWith('"') ? JSON.parse(field[2]) : field[2];
      return [[field[1], String(value)]];
    }),
  );
}

/** Every page file under `docs/`. */
const pages = walk(DOCS_DIR).filter((file) => /\.mdx?$/.test(file));

describe("the planned pages", () => {
  it.each(Object.keys(PLANNED_PAGES))("%s exists", (page) => {
    expect(existsSync(join(DOCS_DIR, page))).toBe(true);
  });

  it.each(Object.keys(PLANNED_PAGES))("%s has a title, description, label and position", (page) => {
    const fields = frontMatter(page);
    for (const field of ["title", "description", "sidebar_label"]) {
      expect(fields[field], field).toMatch(/\S/);
    }
    expect(fields.sidebar_position).toMatch(/^\d+$/);
  });

  it.each(Object.entries(PLANNED_PAGES))("%s, while a stub, links its issue #%i", (page, issue) => {
    const body = readFileSync(join(DOCS_DIR, page), "utf8");
    if (!body.includes(STUB_MARKER)) return;
    expect(body).toContain(`(https://github.com/NobuData/ouroboros/issues/${issue})`);
  });
});

describe("admonitions", () => {
  it("use the MDX 3 title syntax on every page", () => {
    // `future.v4` turns off MDX 1 compatibility, so `:::info Title` renders as plain text;
    // only `:::info[Title]` becomes an admonition.
    const legacy = pages.filter((page) =>
      /^:::(note|tip|info|warning|danger|caution)[ \t]+\S/m.test(
        readFileSync(join(DOCS_DIR, page), "utf8"),
      ),
    );
    expect(legacy).toEqual([]);
  });
});

describe("the docs folder", () => {
  it("keeps every page but the home page inside one of the three sections", () => {
    const sectionDirs = SECTIONS.map((section) => `${section.dir}/`);
    const outside = pages.filter(
      (page) => page !== "index.md" && !sectionDirs.some((dir) => page.startsWith(dir)),
    );
    expect(outside).toEqual([]);
  });

  it.each(SECTIONS.map((section) => section.dir))("gives %s an index.mdx overview", (dir) => {
    expect(pages).toContain(`${dir}/index.mdx`);
  });

  it("gives every group folder a _category_.json with a label and a position", () => {
    const groups = new Set(pages.map((page) => dirname(page)).filter((dir) => dir.includes("/")));
    expect(groups.size).toBeGreaterThan(0);
    for (const group of groups) {
      const file = join(DOCS_DIR, group, "_category_.json");
      expect(existsSync(file), group).toBe(true);
      const category = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      expect(category.label, group).toEqual(expect.any(String));
      expect(category.position, group).toEqual(expect.any(Number));
    }
  });

  it("serves each generated group landing page under its own section", () => {
    const categories = walk(DOCS_DIR).filter((file) => file.endsWith("/_category_.json"));
    for (const file of categories) {
      const category = JSON.parse(readFileSync(join(DOCS_DIR, file), "utf8")) as {
        link?: { type: string; slug?: string };
      };
      if (category.link?.type !== "generated-index") continue;
      // Without a slug Docusaurus serves the landing page at /category/<label>, outside
      // every section's routes.
      expect(category.link.slug, file).toBe(`/${dirname(file)}`);
    }
  });
});
