/**
 * The parser, reading files it accepts — U.2 ([#166](https://github.com/NobuData/ouroboros/issues/166)).
 *
 * The issue's acceptance criteria about reading a file successfully:
 *
 * * **Golden fixtures.** Every committed projection under `schemas/workflow-dsl/fixtures/code/`
 *   parses back to a document deep-equal to the JSON it was printed from, and prints back to the
 *   same bytes. The seeded workflows are `code.seed.spec.ts`'s, and every document the printer
 *   suite constructs is parsed back there.
 * * **Positions and edge kinds recovered from trivia match what the printer emitted.**
 * * **Shape, not semantics.** A file that spells an invalid workflow still parses, and the shared
 *   validator is what reports it.
 *
 * And the two decisions docs/WORKFLOW_CODE_DSL.md §11 left to this issue: which non-canonical
 * spellings are accepted and normalised, and what a stale layout line means. The refusals are
 * `code.parser.errors.spec.ts`'s.
 */

import { LAYOUT_MARKER } from "./code.grammar";
import { parseWorkflowCode } from "./code.parser";
import { edit, golden } from "./code.parser.fixture";
import { printWorkflowCode } from "./code.printer";
import { validDocument } from "./code.recover.fixture";
import type { DslDiagnostic } from "./dsl.errors";
import { readExpectedCases, readFixture } from "./dsl.golden.fixture";
import { validateWorkflowDocument } from "./dsl.validator";

/** Every document the fixture set records as valid, once each. */
const VALID_DOCUMENTS = [
  ...new Set(
    readExpectedCases()
      .filter((entry) => entry.valid)
      .map((entry) => entry.document),
  ),
];

/** U+2028, built from its code point so this file never holds it raw. */
const LINE_SEPARATOR = String.fromCharCode(0x2028);

/** A fixture document as JSON, typed loosely enough to edit. */
interface FixtureDocument {
  nodes: { position: { x: number; y: number }; config: Record<string, unknown> }[];
  edges: Record<string, unknown>[];
}

/**
 * A valid fixture document, freshly read so a test may edit it.
 *
 * @param name - The fixture's name.
 * @returns The JSON document.
 */
function fixture(name: string): FixtureDocument {
  return readFixture(`valid/${name}.json`) as FixtureDocument;
}

/**
 * Assert a file reads as a fixture's document, under the fixture's slug.
 *
 * @param text - The file.
 * @param name - The fixture whose slug the file carries.
 * @param document - The document expected; the fixture's own by default.
 */
function expectDocument(text: string, name: string, document: unknown = fixture(name)): void {
  expect(parseWorkflowCode(text)).toStrictEqual({ slug: name, document, errors: [] });
}

/**
 * Validator findings as `code node` or `code from→to` strings, for `toContain`.
 *
 * @param errors - The validator's errors.
 * @returns One string per error.
 */
function anchored(errors: readonly DslDiagnostic[]): string[] {
  return errors.map(({ code, node, edge }) =>
    [code, node, edge === undefined ? undefined : `${edge.from}→${edge.to}`]
      .filter((part) => part !== undefined)
      .join(" "),
  );
}

describe.each(VALID_DOCUMENTS)("%s", (relativePath) => {
  const name = relativePath.replace(/^valid\//, "").replace(/\.json$/, "");
  const text = golden(name);
  const parsed = parseWorkflowCode(text);

  it("parses its committed projection without an error", () => {
    expect(parsed.errors).toEqual([]);
  });

  it("reads back exactly the document it was printed from, under its slug", () => {
    expect(parsed).toStrictEqual({ slug: name, document: readFixture(relativePath), errors: [] });
  });

  it("recovers every position, and every edge's kind, condition, label and place in the order", () => {
    const document = fixture(name);
    const read = parsed.document as unknown as FixtureDocument;

    expect(read.nodes.map((node) => node.position)).toStrictEqual(
      document.nodes.map((node) => node.position),
    );
    expect(read.edges).toStrictEqual(document.edges);
  });

  it("reads back a document the shared validator accepts", () => {
    expect(validateWorkflowDocument(parsed.document).errors).toEqual([]);
  });

  it("prints back to the bytes it was read from", () => {
    expect(printWorkflowCode(name, validDocument(parsed.document)).text).toBe(text);
  });
});

describe("spellings the parser accepts, and the next print normalises", () => {
  const standard = golden("standard-fix");
  const minimal = golden("minimal");
  const kinds = golden("predicate-kinds");

  it("reads a reformatted file: other whitespace, comments, parentheses and no trailing commas", () => {
    let text = edit(
      standard,
      '    trigger("issue-queued", {\n      title: "Issue queued",\n',
      '    // where every run starts\n    trigger(  "issue-queued" ,{ title : "Issue queued" ,\n',
    );
    text = edit(
      text,
      "      deleteBranch: true,\n    }),\n  ],\n});",
      "      deleteBranch: true\n    })\n  ]\n})",
    );
    text = edit(
      text,
      "    when: (i) => i.effort.lte(effort.M),\n  },",
      "    when: ((i) => (i.effort.lte((effort.M)))),\n  },",
    );
    text = edit(text, "    }), // the loop bites its tail\n", "    }),\n");

    expectDocument(text, "standard-fix");
  });

  it("reads options, trigger keys and edge entries in any order", () => {
    let text = edit(
      standard,
      '  dsl: "1.0",\n  trigger: {\n    on: "issue.queued",\n    when: (i) => i.effort.lte(effort.M),\n  },\n',
      '  trigger: {\n    when: (i) => i.effort.lte(effort.M),\n    on: "issue.queued",\n  },\n  dsl: "1.0",\n',
    );
    text = edit(
      text,
      '      require: ["build", "test", "review"],\n      branches: [\n        { to: "open-pr", when: (i) => i.checks.allPassed() },\n      ],\n      onFail: "implement",\n',
      '      onFail: "implement",\n      branches: [\n        { when: (i) => i.checks.allPassed(), to: "open-pr" },\n      ],\n      require: ["build", "test", "review"],\n',
    );
    text = edit(
      text,
      '      title: "Code the change",\n      description: "Writes the change described by the attack plan onto a fresh branch.",\n',
      '      description: "Writes the change described by the attack plan onto a fresh branch.",\n      title: "Code the change",\n',
    );
    text = edit(
      text,
      '      merge: "squash",\n      deleteBranch: true,\n',
      '      deleteBranch: true,\n      merge: "squash",\n',
    );

    expectDocument(text, "standard-fix");
  });

  it("reads a header in another order, with unused names or missing ones, or no header at all", () => {
    const [header] = standard.split("\n");

    expectDocument(
      edit(standard, header, 'import { needsReview, openPr, defineLoop } from "@ouroboros/sdk";'),
      "standard-fix",
    );
    expectDocument(edit(minimal, `${minimal.split("\n")[0]}\n\n`, ""), "minimal");
  });

  it('reads a one-member next list as next: "id"', () => {
    expectDocument(
      edit(standard, '      next: "analyze",', '      next: ["analyze"],'),
      "standard-fix",
    );
  });

  it("reads a list entry for a plain failure as the onFail shorthand", () => {
    expectDocument(
      edit(
        standard,
        '      onFail: "implement",',
        '      onFail: [{ to: "implement", when: (i) => i.checks.anyFailed() }],',
      ),
      "standard-fix",
    );
  });

  it("reads a when naming the checks a gate requires as require", () => {
    expectDocument(
      edit(
        standard,
        '      require: ["build", "test", "review"],',
        '      when: (i) => i.checks.allPassed(["build", "test", "review"]),',
      ),
      "standard-fix",
    );
  });

  it("reads strings in single quotes and backticks, and a prompt as a quoted string", () => {
    let text = edit(minimal, 'title: "Issue queued"', "title: 'Issue queued'");
    text = edit(text, 'title: "Needs review"', "title: `Needs review`");
    expectDocument(text, "minimal");

    expectDocument(
      edit(
        standard,
        "      prompt: `Write the attack plan.\n\nScope: {{analyze}}\n\nOrder the steps and name every file each one touches.`,",
        '      prompt: "Write the attack plan.\\n\\nScope: {{analyze}}\\n\\nOrder the steps and name every file each one touches.",',
      ),
      "standard-fix",
    );
  });

  it("reads the trigger's conditions in any order and grouping", () => {
    expectDocument(
      edit(
        kinds,
        'i.effort.lte(effort.L) && i.labels.all(["bug", "regression"]) && i.source.is("github")',
        'i.source.is("github") && (i.labels.all(["bug", "regression"]) && i.effort.lte(effort.L))',
      ),
      "predicate-kinds",
    );
  });

  it("reads a predicate whose parameter has another name or no parentheses, and (i) => true", () => {
    let text = edit(
      kinds,
      '{ to: "small", when: (i) => i.effort.lte(effort.S) }',
      '{ to: "small", when: ticket => ticket.effort.lte(effort.S) }',
    );
    text = edit(text, "      when: () => true,", "      when: (i) => true,");

    expectDocument(text, "predicate-kinds");
  });

  it("reads a trigger whose when is always true as a trigger with no conditions", () => {
    expectDocument(
      edit(
        minimal,
        '    on: "issue.queued",\n',
        '    on: "issue.queued",\n    when: () => true,\n',
      ),
      "minimal",
    );
  });

  it("reads numbers without separators, in hex, and with a trailing zero", () => {
    let text = edit(standard, "tokenBudget: 400_000,", "tokenBudget: 400000,");
    text = edit(text, "tokenBudget: 120_000,", "tokenBudget: 0x1d4c0,");
    text = edit(text, "retries: 2,", "retries: 2.0,");

    expectDocument(text, "standard-fix");
  });

  it("reads string-literal keys and a stray semicolon", () => {
    let text = edit(minimal, '      title: "Needs review",', '      "title": "Needs review",');
    text = edit(text, "});\n", "});;\n");

    expectDocument(text, "minimal");
  });

  it("reads \\r\\n and \\r line endings as line feeds, inside prompts too", () => {
    expectDocument(standard.replace(/\n/g, "\r\n"), "standard-fix");
    expectDocument(standard.replace(/\n/g, "\r"), "standard-fix");
  });

  it("keeps a raw line separator in a prompt, which only the printer escapes", () => {
    const expected = fixture("standard-fix");
    const plan = expected.nodes[3].config;
    plan.prompt_template = (plan.prompt_template as string).replace(
      "attack plan",
      `attack${LINE_SEPARATOR}plan`,
    );

    expectDocument(
      edit(standard, "Write the attack plan.", `Write the attack${LINE_SEPARATOR}plan.`),
      "standard-fix",
      expected,
    );
  });

  it("does not mistake a prompt line that reads like the layout marker for the layout block", () => {
    const expected = fixture("standard-fix");
    const plan = expected.nodes[3].config;
    plan.prompt_template = `${LAYOUT_MARKER}\n${plan.prompt_template as string}`;

    expectDocument(
      edit(
        standard,
        "      prompt: `Write the attack plan.",
        `      prompt: \`${LAYOUT_MARKER}\nWrite the attack plan.`,
      ),
      "standard-fix",
      expected,
    );
  });
});

describe("what the layout block's lines mean", () => {
  const standard = golden("standard-fix");
  const minimal = golden("minimal");

  it("reads its lines in any order, and ignores lines about nothing the code declares", () => {
    let text = edit(
      minimal,
      "// node start 0 0\n// node done 240 0\n",
      "// node done 240 0\n// node ghost 12 34\n// node start 0 0\n",
    );
    text = `${text}// edge ghost done "never drawn"\n`;

    expectDocument(text, "minimal");
  });

  it("drops the node line of a stage the code no longer calls", () => {
    let text = edit(
      standard,
      '    backToQueue("back-to-queue", {\n      title: "Back to queue",\n      description: "The split subtasks are queued and this run ends.",\n    }),\n',
      "",
    );
    text = edit(text, '      next: "back-to-queue",\n', "");
    const expected = fixture("standard-fix");
    expected.nodes.splice(5, 1);
    expected.edges.splice(4, 1);

    expectDocument(text, "standard-fix", expected);
  });

  it("drops the edge line of an edge the code no longer declares", () => {
    const expected = fixture("standard-fix");
    expected.edges.splice(7, 1);

    expectDocument(
      edit(standard, '      farm: "pool-a",\n      next: "test",\n', '      farm: "pool-a",\n'),
      "standard-fix",
      expected,
    );
  });

  it("places an edge with no line after every edge that has one, without a label", () => {
    const expected = fixture("standard-fix");
    const [unplaced] = expected.edges.splice(2, 1);
    delete unplaced.label;
    expected.edges.push(unplaced);

    expectDocument(
      edit(standard, '// edge effort-recheck plan "≤ M ↓"\n', ""),
      "standard-fix",
      expected,
    );
  });

  it("gives two stages that share an id the node lines naming it, in order", () => {
    let text = edit(
      minimal,
      '    needsReview("done", {\n      title: "Needs review",\n    }),\n',
      '    needsReview("done", {\n      title: "Needs review",\n    }),\n    needsReview("done", {\n      title: "Again",\n    }),\n',
    );
    text = edit(text, "// node done 240 0\n", "// node done 240 0\n// node done 480 0\n");
    const parsed = parseWorkflowCode(text);

    expect(parsed.errors).toEqual([]);
    expect(
      (parsed.document as unknown as FixtureDocument).nodes.map((node) => node.position),
    ).toStrictEqual([
      { x: 0, y: 0 },
      { x: 240, y: 0 },
      { x: 480, y: 0 },
    ]);
    expect(anchored(validateWorkflowDocument(parsed.document).errors)).toContain(
      "node.duplicate_id done",
    );
  });

  it("gives two edges that join one pair the edge lines naming it, in order", () => {
    let text = edit(minimal, '      next: "done",', '      next: ["done", "done"],');
    text = edit(
      text,
      "// edge start done\n",
      '// edge start done "first"\n// edge start done "second"\n',
    );
    const parsed = parseWorkflowCode(text);

    expect(parsed.errors).toEqual([]);
    expect((parsed.document as unknown as FixtureDocument).edges).toStrictEqual([
      { from: "start", to: "done", kind: "default", label: "first" },
      { from: "start", to: "done", kind: "default", label: "second" },
    ]);
  });
});

describe("a file that spells an invalid workflow: read, and left to the validator", () => {
  const standard = golden("standard-fix");
  const minimal = golden("minimal");
  const kinds = golden("predicate-kinds");

  it.each([
    {
      about: "a stage nothing reaches",
      text: () =>
        edit(
          edit(
            minimal,
            '    needsReview("done", {',
            '    infra("orphan", {\n      title: "Orphan",\n    }),\n    needsReview("done", {',
          ),
          "// node done 240 0\n",
          "// node done 240 0\n// node orphan 0 120\n",
        ),
      finding: "node.unreachable orphan",
    },
    {
      about: "a stage with no title",
      text: () => edit(minimal, '      title: "Needs review",\n', ""),
      finding: "schema.required done",
    },
    {
      about: "a branch with no when",
      text: () => edit(kinds, '{ to: "verified", when: () => true }', '{ to: "verified" }'),
      finding: "edge.branch_without_condition route→verified",
    },
    {
      about: "retries out of range",
      text: () => edit(standard, "retries: 1,", "retries: 99,"),
      finding: "schema.range split",
    },
    {
      about: "a merge method outside the vocabulary",
      text: () => edit(standard, 'merge: "squash"', 'merge: "fast-forward"'),
      finding: "schema.enum open-pr",
    },
    {
      about: "a model stage with no model",
      text: () => edit(standard, '      model: route.task("split"),\n', ""),
      finding: "config.routing_missing split",
    },
    {
      about: "an edge to a stage that does not exist",
      text: () => edit(minimal, 'next: "done"', 'next: "nowhere"'),
      finding: "edge.unknown_to start→nowhere",
    },
    {
      about: "a later language version",
      text: () => edit(minimal, 'dsl: "1.0"', 'dsl: "2.0"'),
      finding: "document.dsl_version_unsupported",
    },
    {
      about: "a source outside the vocabulary",
      text: () => edit(kinds, 'i.source.is("github")', 'i.source.is("svn")'),
      finding: "schema.enum",
    },
    {
      about: "a gate that requires no checks",
      text: () => edit(standard, 'require: ["build", "test", "review"]', "require: []"),
      finding: "schema.length checks-green",
    },
  ])("reads $about, and the validator reports it", ({ text, finding }) => {
    const parsed = parseWorkflowCode(text());

    expect(parsed.errors).toEqual([]);
    expect(anchored(validateWorkflowDocument(parsed.document).errors)).toContain(finding);
  });

  it("reads a slug the printer would refuse as written, for the endpoint to check", () => {
    const parsed = parseWorkflowCode(
      edit(minimal, 'defineLoop("minimal"', 'defineLoop("Not A Slug"'),
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.slug).toBe("Not A Slug");
  });
});
