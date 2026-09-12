/**
 * The YAML projection's proof: mockup 05's code view is a *view*
 * ([#133](https://github.com/NobuData/ouroboros/issues/133)).
 *
 * Two claims, and the fixture set is what makes them claims about real documents rather than
 * about a happy path. Every valid golden document, rendered and re-parsed, is the document it
 * started as — value for value, including the multi-line prompt templates and the labels with
 * arrows in them. And the rendering itself is committed under `fixtures/yaml/`, so a change
 * that silently reformats the code view is a diff a reviewer sees.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FIXTURES_DIR, readExpectedCases, readFixture } from "./dsl.golden.fixture";
import { validateWorkflowDocument } from "./dsl.validator";
import { fromWorkflowYaml, toWorkflowYaml } from "./dsl.yaml";

/** Every document the fixture set records as valid, once each. */
const VALID_DOCUMENTS = [
  ...new Set(
    readExpectedCases()
      .filter((entry) => entry.valid)
      .map((entry) => entry.document),
  ),
];

/** The minimal document with one model stage carrying the given prompt template. */
function withPromptTemplate(template: string) {
  const source = readFixture("valid/minimal.json") as {
    nodes: Record<string, unknown>[];
    edges: Record<string, unknown>[];
  };
  source.nodes.splice(1, 0, {
    id: "stage",
    type: "llm",
    title: "Code the change",
    position: { x: 120, y: 0 },
    config: {
      mode: "prompt",
      prompt_template: template,
      routing: { inherit_task: "implement" },
      limits: { max_retries: 1, token_budget: 10000 },
      permissions: { push_fixup: false, touch_ci: false },
    },
  });
  source.edges = [
    { from: "start", to: "stage", kind: "default" },
    { from: "stage", to: "done", kind: "default" },
  ];
  const verdict = validateWorkflowDocument(source);
  if (!verdict.document) throw new Error("the constructed document should validate");
  return verdict.document;
}

/** Parse a document and insist it was valid, so a broken fixture fails loudly here. */
function parse(relativePath: string) {
  const verdict = validateWorkflowDocument(readFixture(relativePath));
  if (!verdict.document)
    throw new Error(`${relativePath} does not validate: see dsl.parity.spec.ts`);
  return verdict.document;
}

describe.each(VALID_DOCUMENTS)("%s", (relativePath) => {
  const name = relativePath.replace(/^valid\//, "").replace(/\.json$/, "");

  it("round-trips through YAML without losing anything", () => {
    const document = parse(relativePath);
    expect(fromWorkflowYaml(toWorkflowYaml(document))).toEqual(document);
  });

  it("round-trips back to the stored JSON, not merely to itself", () => {
    // The stronger claim, and the one decision P3 rests on: the canonical artifact is the
    // JSON in `workflow_versions.definition`, so a text view has to return *that*, not a
    // normalised cousin of it that the validator would also accept.
    expect(fromWorkflowYaml(toWorkflowYaml(parse(relativePath)))).toEqual(
      readFixture(relativePath),
    );
  });

  it("re-validates after the round trip", () => {
    const again = validateWorkflowDocument(fromWorkflowYaml(toWorkflowYaml(parse(relativePath))));
    expect(again.errors).toEqual([]);
    expect(again.valid).toBe(true);
  });

  it("renders exactly the projection committed beside it", () => {
    const committed = readFileSync(join(FIXTURES_DIR, "yaml", `${name}.yaml`), "utf8");
    expect(toWorkflowYaml(parse(relativePath))).toBe(committed);
  });
});

describe("toWorkflowYaml", () => {
  const document = parse("valid/standard-fix.json");

  it("puts the document's own properties in reading order", () => {
    const yaml = toWorkflowYaml(document);
    const topLevel = yaml
      .split("\n")
      .filter((line) => /^[a-z_]+:/.test(line))
      .map((line) => line.split(":")[0]);
    expect(topLevel).toEqual(["dsl_version", "trigger", "nodes", "edges"]);
  });

  it("keeps a multi-line prompt template readable rather than escaping its newlines", () => {
    // A code view whose prompts are one long line of `\n` is a code view nobody edits in.
    const yaml = toWorkflowYaml(document);
    expect(yaml).toContain("prompt_template: |-");
    expect(yaml).not.toContain("\\n");
  });

  it("does not fold a long line, so the inspector and the code view show the same text", () => {
    const long = parse("valid/standard-fix.json");
    const yaml = toWorkflowYaml(long);
    // The longest description in the fixture is over eighty characters; a folding renderer
    // would have broken it across lines.
    expect(yaml).toContain(
      "description: Reads the issue against a map of the repository and states what the change touches.",
    );
  });

  it("quotes the version, so 1.0 does not come back as the number one", () => {
    expect(toWorkflowYaml(document)).toContain('dsl_version: "1.0"');
    expect(fromWorkflowYaml(toWorkflowYaml(document))).toEqual(
      expect.objectContaining({ dsl_version: "1.0" }),
    );
  });

  it("ends with a newline, because it is a file rather than a fragment", () => {
    expect(toWorkflowYaml(document).endsWith("\n")).toBe(true);
  });

  it("carries an edge label with arrows in it through unchanged", () => {
    const roundTripped = fromWorkflowYaml(toWorkflowYaml(document)) as {
      edges: { label?: string }[];
    };
    expect(roundTripped.edges.map((edge) => edge.label)).toContain("fail ↺");
  });
});

describe("toWorkflowYaml — the scalars YAML is fussy about", () => {
  // A literal block cannot hold a carriage return or a trailing space, and a naive renderer
  // that reached for one anyway would lose them silently — which is the one way a *view*
  // becomes a rewrite. The library falls back to a quoted scalar for each of these; this is
  // the assertion that says so out loud, because the fallback is the load-bearing part.
  it.each([
    ["a carriage return", "before\r\nafter"],
    ["a trailing space on a line", "before \nafter"],
    ["trailing newlines", "before\n\n"],
    ["leading whitespace", "  indented"],
    ["a tab", "before\tafter"],
    ["a non-breaking space", "before\u00a0after"],
  ])("round-trips a prompt template holding %s", (_label, template) => {
    const document = withPromptTemplate(template);
    expect(fromWorkflowYaml(toWorkflowYaml(document))).toEqual(document);
  });
});

describe("fromWorkflowYaml", () => {
  it("hands back whatever the text said, for the validator to judge", () => {
    // YAML can express anything, so text that parses is not yet a workflow. There is no path
    // into the system that skips `validateWorkflowDocument`.
    expect(fromWorkflowYaml("- 1\n- 2\n")).toEqual([1, 2]);
    expect(validateWorkflowDocument(fromWorkflowYaml("- 1\n- 2\n")).valid).toBe(false);
  });

  it("throws on text that is not YAML at all", () => {
    expect(() => fromWorkflowYaml("{unclosed: [")).toThrow();
  });
});
