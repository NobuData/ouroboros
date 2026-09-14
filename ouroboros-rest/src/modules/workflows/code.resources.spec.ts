import {
  CODE_SLUG_MISMATCH,
  CONFIG_FILE_PATH,
  slugMismatch,
  workflowCode,
  workflowCodeConfig,
  workflowCodeTree,
  workflowFilePath,
} from "./code.resources";

/**
 * The code view's wire shapes — U.3 ([#167](https://github.com/NobuData/ouroboros/issues/167)).
 *
 * Decision **C6** is the rule most of this suite holds: the explorer lists what exists. A file per
 * workflow on the rail and the configuration, directories only as the paths of files in them — so
 * no `skills/` or `lib/` row can be served before a file under it exists.
 */

/** Mockup 04's rail, as the registry statement returns it. */
const RAIL = [
  { slug: "standard-fix", status: "active" as const },
  { slug: "feature-loop", status: "active" as const },
  { slug: "hotfix-p0", status: "paused" as const },
];

describe("a workflow's file", () => {
  it("sits under workflows/, named for its slug", () => {
    expect(workflowFilePath("standard-fix")).toBe("workflows/standard-fix.loop.ts");
  });

  it("carries the text, the draft's etag, what it was printed from and the chip", () => {
    expect(
      workflowCode(
        { slug: "standard-fix", current_version: 14 },
        { text: "…", etag: "token", version: null, readOnly: false },
      ),
    ).toEqual({
      path: "workflows/standard-fix.loop.ts",
      slug: "standard-fix",
      text: "…",
      etag: "token",
      readOnly: false,
      version: null,
      currentVersion: 14,
      outlineRef: null,
      checksRef: null,
    });
  });

  it("references no outline or checks payload until W.2 serves one", () => {
    // A reference to a route that answers 404 would be a promise the page cannot keep.
    const file = workflowCode(
      { slug: "standard-fix", current_version: null },
      { text: "…", etag: "none", version: 14, readOnly: true },
    );

    expect(file.outlineRef).toBeNull();
    expect(file.checksRef).toBeNull();
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
