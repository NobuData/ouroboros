import { edit, golden } from "./code.parser.fixture";
import { projectWorkflowCode } from "./code.projection";
import { readExpectedCases, readFixture } from "./dsl.golden.fixture";
import { validateWorkflowDocument } from "./dsl.validator";

/**
 * The projection rule — U.3 ([#167](https://github.com/NobuData/ouroboros/issues/167)): a document
 * is shown as code exactly when the file reads back as that document.
 *
 * Three things follow and are held here. **Every valid document projects**, to the very bytes the
 * printer's committed fixtures record. **A document the validator refuses still projects when the
 * round trip keeps it**, because the code view edits work in progress. And **a document with no
 * faithful spelling has no projection** — however it fails, and without throwing.
 */

/** Every document the fixture set records as valid, once each. */
const VALID_DOCUMENTS = [
  ...new Set(
    readExpectedCases()
      .filter((entry) => entry.valid)
      .map((entry) => entry.document),
  ),
];

/** A fixture's name, from its path under `schemas/workflow-dsl/fixtures/`. */
function nameOf(relativePath: string): string {
  return relativePath.replace(/^valid\//, "").replace(/\.json$/, "");
}

/** A node of a fixture document, typed loosely enough to add to. */
type FixtureNode = Record<string, unknown>;

/**
 * The minimal fixture, freshly read so a test may change it.
 *
 * @returns The document.
 */
function minimal(): { nodes: FixtureNode[] } & Record<string, unknown> {
  return readFixture("valid/minimal.json") as { nodes: FixtureNode[] } & Record<string, unknown>;
}

describe("a valid document", () => {
  it.each(VALID_DOCUMENTS)("%s projects to the file committed beside it", (relativePath) => {
    const name = nameOf(relativePath);

    expect(projectWorkflowCode(name, readFixture(relativePath))).toBe(golden(name));
  });
});

describe("a document the validator refuses", () => {
  it("still projects when the round trip keeps it — the code view edits work in progress", () => {
    const document = minimal();
    document.nodes.push({
      id: "orphan",
      type: "term",
      title: "Nothing reaches this",
      position: { x: 480, y: 0 },
      config: { action: "needs_review", options: {} },
    });

    expect(validateWorkflowDocument(document).valid).toBe(false);

    const text = projectWorkflowCode("minimal", document);

    expect(text).toContain('needsReview("orphan", {');
  });
});

describe("a document with no faithful spelling", () => {
  it.each([
    ["the blank canvas", {}],
    ["null", null],
    ["a string", "standard-fix"],
    ["an array", []],
    ["a document whose nodes are not a list", { dsl_version: "1.0", nodes: "abc", edges: [] }],
    ["a document with a node that is null", { dsl_version: "1.0", nodes: [null], edges: [] }],
  ])("has none for %s, and does not throw", (_name, definition) => {
    expect(projectWorkflowCode("minimal", definition)).toBeUndefined();
  });

  it("has none when the print would drop a key, because saving it back would lose the key", () => {
    const document = minimal();
    document.nodes[0].colour = "teal";

    expect(projectWorkflowCode("minimal", document)).toBeUndefined();
  });

  it("has none when the print would read back as a different value", () => {
    // `dsl_version` is a string in the grammar; a number prints as one and reads back as a refusal.
    expect(projectWorkflowCode("minimal", { ...minimal(), dsl_version: 1 })).toBeUndefined();
  });

  it("has none under a slug the printer refuses", () => {
    expect(projectWorkflowCode("Standard Fix", minimal())).toBeUndefined();
  });

  it("names the slug it was given, so a file is always its own workflow's", () => {
    const text = projectWorkflowCode("standard-fix", minimal());

    expect(text).toBe(edit(golden("minimal"), 'defineLoop("minimal"', 'defineLoop("standard-fix"'));
  });
});
