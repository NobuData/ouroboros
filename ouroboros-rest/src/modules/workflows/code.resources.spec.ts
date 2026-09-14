import { API_BASE_PATH } from "../../application";
import {
  CODE_SLUG_MISMATCH,
  CONFIG_FILE_PATH,
  WORKFLOWS_PATH,
  slugMismatch,
  workflowCode,
  workflowCodeChecks,
  workflowCodeChecksPath,
  workflowCodeConfig,
  workflowCodeTree,
  workflowFilePath,
} from "./code.resources";

/**
 * The code view's wire shapes — U.3 ([#167](https://github.com/NobuData/ouroboros/issues/167)) and
 * W.2 ([#178](https://github.com/NobuData/ouroboros/issues/178)).
 *
 * Decision **C6** is the rule most of this suite holds: the explorer lists what exists. A file per
 * workflow on the rail and the configuration, directories only as the paths of files in them — so
 * no `skills/` or `lib/` row can be served before a file under it exists. W.2 adds what a file
 * carries beside its text: its span map, its diagnostics, and where its Loop Checks are read.
 */

/** Mockup 04's rail, as the registry statement returns it. */
const RAIL = [
  { slug: "standard-fix", status: "active" as const },
  { slug: "feature-loop", status: "active" as const },
  { slug: "hotfix-p0", status: "paused" as const },
];

/** A span map and a diagnostic, as the printer and the diagnostics hand them over. */
const SPANS = [{ node: "start", startLine: 9, endLine: 12 }];
const DIAGNOSTICS = [
  {
    severity: "warning" as const,
    range: { line: 9, column: 5, endLine: 12, endColumn: 8 },
    code: "reference.unknown_task",
    message: "No route is configured for the task `split`.",
    node: "start",
  },
];

describe("a workflow's file", () => {
  it("sits under workflows/, named for its slug", () => {
    expect(workflowFilePath("standard-fix")).toBe("workflows/standard-fix.loop.ts");
  });

  it("carries the text, its span map and diagnostics, the draft's etag, its origin and the chip", () => {
    expect(
      workflowCode(
        { slug: "standard-fix", current_version: 14 },
        {
          text: "…",
          spans: SPANS,
          diagnostics: DIAGNOSTICS,
          etag: "token",
          version: null,
          readOnly: false,
        },
      ),
    ).toEqual({
      path: "workflows/standard-fix.loop.ts",
      slug: "standard-fix",
      text: "…",
      etag: "token",
      readOnly: false,
      version: null,
      currentVersion: 14,
      spans: SPANS,
      diagnostics: DIAGNOSTICS,
      outlineRef: null,
      checksRef: "/api/v1/workflows/standard-fix/code/checks",
    });
  });

  it("points a published version's checks at that version, and references no outline", () => {
    const file = workflowCode(
      { slug: "standard-fix", current_version: null },
      { text: "…", spans: [], diagnostics: [], etag: "none", version: 14, readOnly: true },
    );

    expect(file.checksRef).toBe("/api/v1/workflows/standard-fix/code/checks?version=14");
    expect(file.outlineRef).toBeNull();
  });

  it("points an editable file opened on the version in force at the plain checks route", () => {
    // With no draft, `GET …/code` and `GET …/code/checks` both open the version in force, so the
    // reference names no version: after the first save it must follow the draft.
    const file = workflowCode(
      { slug: "standard-fix", current_version: 3 },
      { text: "…", spans: [], diagnostics: [], etag: "none", version: 3, readOnly: false },
    );

    expect(file.checksRef).toBe(workflowCodeChecksPath("standard-fix", null));
  });

  it("spells the workflow routes where the application serves them", () => {
    expect(WORKFLOWS_PATH).toBe(`${API_BASE_PATH}/workflows`);
  });
});

describe("a file's Loop Checks", () => {
  it("names the file, what it was printed from and the draft's etag beside the rows", () => {
    const rows = [{ id: "graph" as const, status: "ok" as const, title: "Graph acyclic" }];

    expect(
      workflowCodeChecks(
        { slug: "standard-fix" },
        { etag: "token", version: 14, readOnly: true },
        rows,
      ),
    ).toEqual({
      path: "workflows/standard-fix.loop.ts",
      slug: "standard-fix",
      etag: "token",
      readOnly: true,
      version: 14,
      rows,
    });
  });
});

describe("the explorer", () => {
  it("lists the rail's workflows in its order, then the configuration", () => {
    expect(workflowCodeTree(RAIL).files).toEqual([
      {
        path: "workflows/standard-fix.loop.ts",
        kind: "workflow",
        readOnly: false,
        slug: "standard-fix",
        status: "active",
      },
      {
        path: "workflows/feature-loop.loop.ts",
        kind: "workflow",
        readOnly: false,
        slug: "feature-loop",
        status: "active",
      },
      {
        path: "workflows/hotfix-p0.loop.ts",
        kind: "workflow",
        readOnly: false,
        slug: "hotfix-p0",
        status: "paused",
      },
      { path: CONFIG_FILE_PATH, kind: "config", readOnly: true, slug: null, status: null },
    ]);
  });

  it("marks the configuration read-only, and nothing else", () => {
    const readOnly = workflowCodeTree(RAIL).files.filter((file) => file.readOnly);

    expect(readOnly.map((file) => file.path)).toEqual(["ouroboros.config.ts"]);
  });

  it("lists only files, so no empty directory and no skills/ or lib/ row can appear (C6)", () => {
    const paths = workflowCodeTree(RAIL).files.map((file) => file.path);

    expect(paths.every((path) => path.endsWith(".ts"))).toBe(true);
    expect(paths.filter((path) => /^(skills|lib)\//.test(path))).toEqual([]);
  });

  it("is only the configuration for a workspace with no workflows", () => {
    expect(workflowCodeTree([]).files.map((file) => file.path)).toEqual(["ouroboros.config.ts"]);
  });
});

describe("the configuration file", () => {
  it("is read-only, at ouroboros.config.ts", () => {
    expect(workflowCodeConfig("export default {};\n")).toEqual({
      path: "ouroboros.config.ts",
      text: "export default {};\n",
      readOnly: true,
    });
  });
});

describe("a slug mismatch", () => {
  it("is anchored where the file writes its slug, and names both slugs", () => {
    const range = { line: 3, column: 27, endLine: 3, endColumn: 41 };
    const issue = slugMismatch(range, "standard-fix", "docs-loop");

    expect(issue).toMatchObject({ code: CODE_SLUG_MISMATCH, ...range });
    expect(issue.message).toContain('"standard-fix"');
    expect(issue.message).toContain('defineLoop("docs-loop", …)');
    expect(issue).not.toHaveProperty("hint");
  });
});
