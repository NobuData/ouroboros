/**
 * The parser, refusing files — U.2 ([#166](https://github.com/NobuData/ouroboros/issues/166)).
 *
 * The issue's acceptance criteria about errors:
 *
 * * **Error fixtures.** Each file under `schemas/workflow-dsl/fixtures/code-invalid/` reports
 *   exactly the errors its `expected.json` records: an unknown stage call, a malformed predicate,
 *   a stray statement, a stage with no position, and three mistakes at once. Code and range are
 *   the contract; the message is presentation.
 * * **Multiple errors from one parse**, and a syntax error that does not echo as grammar errors.
 * * **Anchored, with the documented code.** Every construct the closed grammar refuses, one per
 *   test, with the exact text its range covers and the pointer to #180.
 *
 * Positions are 1-based, count line feeds only, and do not change with `\r\n` line endings.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { FULL_SDK_HINT, type WorkflowCodeError, WorkflowCodeErrorCode } from "./code.errors";
import { LAYOUT_MARKER } from "./code.grammar";
import { parseWorkflowCode } from "./code.parser";
import { edit, golden } from "./code.parser.fixture";
import { FIXTURES_DIR } from "./dsl.golden.fixture";

/** The part of an error the fixtures record. */
type ErrorRange = Pick<WorkflowCodeError, "code" | "line" | "column" | "endLine" | "endColumn">;

/** One recorded case. */
interface ExpectedCodeCase {
  /** The case's name. */
  name: string;
  /** Why the file is in the set. */
  about: string;
  /** The file's path under `fixtures/`. */
  file: string;
  /** Every error the parser must report, in order. */
  errors: ErrorRange[];
}

/** The fixture directory, under `fixtures/`. */
const CODE_INVALID = "code-invalid";

/** Every recorded case. */
const CASES = (
  JSON.parse(readFileSync(join(FIXTURES_DIR, CODE_INVALID, "expected.json"), "utf8")) as {
    cases: ExpectedCodeCase[];
  }
).cases;

const { OUT_OF_GRAMMAR, SYNTAX_ERROR, LAYOUT_INVALID } = WorkflowCodeErrorCode;

/** U+2028, built from its code point so this file never holds it raw. */
const LINE_SEPARATOR = String.fromCharCode(0x2028);

/** The minimal fixture's header line. */
const HEADER = 'import { defineLoop, trigger, needsReview } from "@ouroboros/sdk";';

/** The minimal fixture's whole layout block. */
const MINIMAL_LAYOUT = `${LAYOUT_MARKER}\n// node start 0 0\n// node done 240 0\n// edge start done\n`;

/** The committed projections an edit starts from. */
type Base = "minimal" | "standard-fix" | "predicate-kinds";

/** One refused construct: an edit to a valid file, and the exact text its one error covers. */
interface Refusal {
  /** What the edit introduces. */
  about: string;
  /** The file edited. */
  base: Base;
  /** The text replaced. */
  from: string;
  /** Its replacement. */
  to: string;
  /** The text the error's range covers. */
  covers: string;
}

/**
 * The text an error's range covers.
 *
 * @param text - The file, with `\n` line endings.
 * @param error - The error.
 * @returns The covered text.
 */
function covered(text: string, error: WorkflowCodeError): string {
  const lines = text.split("\n");
  const offset = (line: number, column: number) =>
    lines.slice(0, line - 1).reduce((sum, content) => sum + content.length + 1, 0) + column - 1;

  return text.slice(offset(error.line, error.column), offset(error.endLine, error.endColumn));
}

/**
 * Every error a file reports, as `[code, covered text]`.
 *
 * @param text - The file.
 * @returns The pairs, in the parser's order.
 */
function reported(text: string): [string, string][] {
  return parseWorkflowCode(text).errors.map((error) => [error.code, covered(text, error)]);
}

/**
 * Assert an edit produces exactly one out-of-grammar error, covering the expected text.
 *
 * @param refusal - The edit.
 */
function expectRefusal({ base, from, to, covers }: Refusal): void {
  const text = edit(golden(base), from, to);
  const parsed = parseWorkflowCode(text);

  expect(parsed.errors.map((error) => [error.code, covered(text, error)])).toStrictEqual([
    [OUT_OF_GRAMMAR, covers],
  ]);
  expect(parsed.errors[0].hint).toBe(FULL_SDK_HINT);
  expect(parsed.errors[0].message).not.toBe("");
  expect(parsed.document).toBeUndefined();
  expect(parsed.slug).toBeUndefined();
}

/**
 * A refusal made by editing the minimal fixture.
 *
 * @param about - What the edit introduces.
 * @param from - The text replaced.
 * @param to - Its replacement.
 * @param covers - The text the error covers.
 * @returns The refusal.
 */
function minimal(about: string, from: string, to: string, covers: string): Refusal {
  return { about, base: "minimal", from, to, covers };
}

/**
 * A refusal made by editing the standard-fix fixture.
 *
 * @param about - What the edit introduces.
 * @param from - The text replaced.
 * @param to - Its replacement.
 * @param covers - The text the error covers.
 * @returns The refusal.
 */
function standard(about: string, from: string, to: string, covers: string): Refusal {
  return { about, base: "standard-fix", from, to, covers };
}

/**
 * A refusal made by inserting a statement after the minimal fixture's header.
 *
 * @param about - What the statement is.
 * @param statement - The statement.
 * @returns The refusal.
 */
function statement(about: string, statement: string): Refusal {
  return minimal(about, `${HEADER}\n`, `${HEADER}\n${statement}\n`, statement);
}

/**
 * A refusal made by giving the minimal fixture's trigger a `when`.
 *
 * @param about - What the `when` does wrong.
 * @param when - The `when`.
 * @param covers - The text the error covers.
 * @returns The refusal.
 */
function triggerWhen(about: string, when: string, covers: string): Refusal {
  return minimal(
    about,
    '    on: "issue.queued",\n',
    `    on: "issue.queued",\n    when: ${when},\n`,
    covers,
  );
}

/**
 * A refusal made by respelling the condition of standard-fix's `effort-recheck → plan` branch.
 *
 * @param about - What the predicate does wrong.
 * @param predicate - The predicate.
 * @param covers - The text the error covers.
 * @returns The refusal.
 */
function branchWhen(about: string, predicate: string, covers: string): Refusal {
  return standard(
    about,
    '{ to: "plan", when: (i) => i.effort.lte(effort.M) }',
    `{ to: "plan", when: ${predicate} }`,
    covers,
  );
}

describe("the error fixtures", () => {
  it("record a case for every file on disk, and a file for every case", () => {
    const onDisk = readdirSync(join(FIXTURES_DIR, CODE_INVALID))
      .filter((file) => file.endsWith(".loop.ts"))
      .map((file) => `${CODE_INVALID}/${file}`);

    expect(onDisk.sort()).toEqual(CASES.map((entry) => entry.file).sort());
  });

  it("name every case once", () => {
    const names = CASES.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("cover every code the parser reports", () => {
    const codes = new Set(CASES.flatMap((entry) => entry.errors.map((error) => error.code)));
    expect([...codes].sort()).toEqual(Object.values(WorkflowCodeErrorCode).sort());
  });

  describe.each(CASES)("$name — $about", ({ file, errors }) => {
    const text = readFileSync(join(FIXTURES_DIR, file), "utf8");
    const parsed = parseWorkflowCode(text);

    it("reports exactly the recorded errors, each at its recorded range", () => {
      expect(
        parsed.errors.map(({ code, line, column, endLine, endColumn }) => ({
          code,
          line,
          column,
          endLine,
          endColumn,
        })),
      ).toStrictEqual(errors);
    });

    it("returns neither a slug nor a document", () => {
      expect(parsed).toStrictEqual({ errors: parsed.errors });
    });

    it("explains every error, and points exactly the out-of-grammar ones at the full SDK", () => {
      for (const error of parsed.errors) {
        expect(error.message).not.toBe("");
        expect(error.hint).toBe(error.code === OUT_OF_GRAMMAR ? FULL_SDK_HINT : undefined);
      }
    });

    it("reports the same errors when the file has \\r\\n line endings", () => {
      expect(parseWorkflowCode(text.replace(/\n/g, "\r\n")).errors).toStrictEqual(parsed.errors);
    });
  });
});

describe("out of grammar: the header", () => {
  it.each([
    minimal("an import from another module", 'from "@ouroboros/sdk";', 'from "./sdk";', '"./sdk"'),
    minimal("a side-effect import", HEADER, 'import "@ouroboros/sdk";', 'import "@ouroboros/sdk";'),
    minimal(
      "a second import",
      HEADER,
      `${HEADER}\nimport { effort } from "@ouroboros/sdk";`,
      'import { effort } from "@ouroboros/sdk";',
    ),
    minimal(
      "a namespace import",
      "import { defineLoop, trigger, needsReview }",
      "import * as sdk",
      "* as sdk",
    ),
    minimal("a default import", "import { defineLoop", "import sdk, { defineLoop", "sdk"),
    minimal(
      "a renamed import",
      "trigger, needsReview }",
      "trigger as start, needsReview }",
      "trigger as start",
    ),
    minimal(
      "a type-only header",
      "import { defineLoop",
      "import type { defineLoop",
      "type { defineLoop, trigger, needsReview }",
    ),
    minimal("a type-only name", "{ defineLoop,", "{ type defineLoop,", "type defineLoop"),
    minimal("a name the SDK does not export", "needsReview }", "needsReview, stage }", "stage"),
    minimal(
      "import attributes",
      'from "@ouroboros/sdk";',
      'from "@ouroboros/sdk" with { type: "json" };',
      'with { type: "json" }',
    ),
  ])("refuses $about", expectRefusal);
});

describe("out of grammar: statements", () => {
  it.each([
    statement("a variable", "const retries = 3;"),
    statement("a function", "function helper() { return 1; }"),
    statement("a named export", "export const loop = 1;"),
    statement("an expression that would run", 'console.log("ran");'),
    statement("a class", "class Stage {}"),
    statement("an enum", "enum Kind { A }"),
    statement("a type alias", "type Ticket = { effort: string };"),
    minimal(
      "a second default export",
      "});\n",
      '});\nexport default defineLoop("again", {});\n',
      'export default defineLoop("again", {});',
    ),
  ])("refuses $about", expectRefusal);

  it("refuses a default export that is not defineLoop", () => {
    const text = edit(golden("minimal"), "export default defineLoop(", "export default makeLoop(");
    const call = text.slice(text.indexOf("makeLoop("), text.indexOf("});") + 2);

    expect(reported(text)).toStrictEqual([[OUT_OF_GRAMMAR, call]]);
  });

  it("refuses a file that calls defineLoop without exporting it, twice over", () => {
    const text = edit(golden("minimal"), "export default defineLoop(", "defineLoop(");
    const call = text.slice(text.indexOf("defineLoop("), text.indexOf("});") + 3);

    expect(reported(text)).toStrictEqual([
      [OUT_OF_GRAMMAR, ""],
      [OUT_OF_GRAMMAR, call],
    ]);
    expect(parseWorkflowCode(text).errors[0]).toMatchObject({ line: 1, column: 1 });
  });

  it("refuses defineLoop with only its options", () => {
    const text = edit(golden("minimal"), 'defineLoop("minimal", {', "defineLoop({");
    const call = text.slice(text.indexOf("defineLoop({"), text.indexOf("});") + 2);

    expect(reported(text)).toStrictEqual([[OUT_OF_GRAMMAR, call]]);
  });
});

describe("out of grammar: defineLoop and its trigger", () => {
  it.each([
    minimal("a slug that is not a string", 'defineLoop("minimal"', "defineLoop(minimal", "minimal"),
    minimal(
      "an option defineLoop does not take",
      '  dsl: "1.0",\n',
      '  dsl: "1.0",\n  version: 15,\n',
      "version",
    ),
    minimal("a dsl that is not a string", 'dsl: "1.0"', "dsl: 1.0", "1.0"),
    minimal(
      "a trigger that is not an object",
      'trigger: {\n    on: "issue.queued",\n  },',
      'trigger: "issue.queued",',
      '"issue.queued"',
    ),
    minimal(
      "a trigger key the grammar lacks",
      '    on: "issue.queued",\n',
      '    on: "issue.queued",\n    cron: "0 * * * *",\n',
      "cron",
    ),
    minimal(
      "an event the grammar lacks",
      'on: "issue.queued"',
      'on: "issue.closed"',
      '"issue.closed"',
    ),
    triggerWhen(
      "a condition the trigger cannot hold",
      '(i) => i.labels.any(["bug"])',
      'i.labels.any(["bug"])',
    ),
    triggerWhen(
      "a condition stated twice",
      "(i) => i.effort.lte(effort.M) && i.effort.lte(effort.S)",
      "i.effort.lte(effort.S)",
    ),
    triggerWhen(
      "conditions joined with ||",
      '(i) => i.effort.lte(effort.M) || i.labels.all(["bug"])',
      "||",
    ),
    triggerWhen("a when that is not an arrow function", "true", "true"),
    triggerWhen(
      "a when that reads a ticket it does not declare",
      "() => i.effort.lte(effort.M)",
      "i.effort.lte(effort.M)",
    ),
    triggerWhen("a source that is not a string", '(i) => i.source.is(["github"])', '["github"]'),
    triggerWhen(
      "a condition with two arguments",
      '(i) => i.labels.all(["bug"], ["p0"])',
      'i.labels.all(["bug"], ["p0"])',
    ),
  ])("refuses $about", expectRefusal);
});

describe("out of grammar: stage calls", () => {
  const terminal = '    needsReview("done", {\n      title: "Needs review",\n    }),\n';

  it.each([
    minimal("a stage call the grammar lacks", 'needsReview("done"', 'review("done"', "review"),
    minimal("an entry that is not a call", terminal, '    "done",\n', '"done"'),
    minimal("a spread entry", terminal, "    ...others,\n", "...others"),
    minimal(
      "a stage called on an object",
      'needsReview("done"',
      'sdk.needsReview("done"',
      'sdk.needsReview("done", {\n      title: "Needs review",\n    })',
    ),
    minimal(
      "a stage with no options",
      'needsReview("done", {\n      title: "Needs review",\n    })',
      'needsReview("done")',
      'needsReview("done")',
    ),
    minimal("a stage id that is not a string", 'needsReview("done"', "needsReview(done", "done"),
    minimal(
      "options that are not an object",
      'trigger("start", {\n      title: "Issue queued",\n      next: "done",\n    })',
      'trigger("start", "done")',
      '"done"',
    ),
  ])("refuses $about", expectRefusal);
});

describe("out of grammar: stage options", () => {
  const title = '      title: "Issue queued",\n';

  it.each([
    minimal(
      "an option the callee does not take: an edge out of a terminal",
      '      title: "Needs review",\n',
      '      title: "Needs review",\n      next: "start",\n',
      "next",
    ),
    minimal("an option written twice", title, `${title}      title: "Again",\n`, "title"),
    minimal("a shorthand property", title, "      title,\n", "title"),
    minimal("a spread property", title, `${title}      ...defaults,\n`, "...defaults"),
    minimal(
      "a method",
      title,
      '      title() { return "Issue queued"; },\n',
      'title() { return "Issue queued"; }',
    ),
    minimal(
      "a computed key",
      title,
      '      ["title"]: "Issue queued",\n',
      '["title"]: "Issue queued"',
    ),
    minimal("a title that is not a string", 'title: "Issue queued"', "title: 42", "42"),
    minimal(
      "a title with a substitution",
      'title: "Issue queued"',
      'title: `Issue ${"queued"}`',
      '`Issue ${"queued"}`',
    ),
    minimal(
      "a title that names a variable",
      'title: "Issue queued"',
      "title: issueTitle",
      "issueTitle",
    ),
    minimal(
      "a value with a type assertion",
      'next: "done"',
      'next: "done" as const',
      '"done" as const',
    ),
    minimal("a next that is not a string", 'next: "done"', "next: 7", "7"),
    minimal("a next list holding a number", 'next: "done"', 'next: ["done", 7]', "7"),
    minimal(
      "a hole in a next list, an empty range",
      'next: "done"',
      'next: ["done", , "done"]',
      "",
    ),
    standard(
      "a model that is not a route",
      'model: route.task("split")',
      'model: "claude-fable-5"',
      '"claude-fable-5"',
    ),
    standard("a route the grammar lacks", 'route.task("split")', 'route.pool("split")', "pool"),
    standard(
      "a route with two names",
      'route.task("split")',
      'route.task("split", "fallback")',
      'route.task("split", "fallback")',
    ),
    standard("a route to a variable", 'route.task("split")', "route.task(split)", "split"),
    standard("a permission the grammar lacks", "touchCi: false }", "touchCI: false }", "touchCI"),
    standard("a permission that is not a boolean", "pushFixup: false,", 'pushFixup: "no",', '"no"'),
    standard(
      "permissions that are not an object",
      "permissions: { pushFixup: false, touchCi: false }",
      'permissions: "read-only"',
      '"read-only"',
    ),
    standard("retries that are not a number", "retries: 1,", 'retries: "1",', '"1"'),
    standard(
      "an infra option the grammar lacks: mockup 05's cache",
      '      farm: "pool-a",\n      next: "test",\n',
      '      farm: "pool-a",\n      cache: "ccache",\n      next: "test",\n',
      "cache",
    ),
    standard(
      "a gate with both require and when",
      '      require: ["build", "test", "review"],\n',
      '      require: ["build", "test", "review"],\n      when: (i) => i.checks.allPassed(),\n',
      "when: (i) => i.checks.allPassed()",
    ),
    standard(
      "a require that is not a list",
      'require: ["build", "test", "review"]',
      'require: "build"',
      '"build"',
    ),
    standard(
      "a deleteBranch that is not a boolean",
      "deleteBranch: true",
      'deleteBranch: "yes"',
      '"yes"',
    ),
    standard(
      "a branches entry that is not an object",
      '{ to: "open-pr", when: (i) => i.checks.allPassed() }',
      '"open-pr"',
      '"open-pr"',
    ),
    standard(
      "a branches entry key the grammar lacks",
      '{ to: "open-pr", when: (i) => i.checks.allPassed() }',
      '{ to: "open-pr", when: (i) => i.checks.allPassed(), label: "pass →" }',
      "label",
    ),
    standard(
      "branches that are not a list",
      'branches: [\n        { to: "open-pr", when: (i) => i.checks.allPassed() },\n      ],',
      'branches: { to: "open-pr", when: (i) => i.checks.allPassed() },',
      '{ to: "open-pr", when: (i) => i.checks.allPassed() }',
    ),
    standard("an onFail that is neither an id nor a list", 'onFail: "implement"', "onFail: 3", "3"),
    standard(
      "an onFail entry that is only an id",
      'onFail: "implement"',
      'onFail: ["implement"]',
      '"implement"',
    ),
    standard(
      "an edge target that is not a string",
      '{ to: "open-pr", when:',
      "{ to: openPr, when:",
      "openPr",
    ),
  ])("refuses $about", expectRefusal);
});

describe("out of grammar: predicates", () => {
  it.each([
    branchWhen(
      "two tests joined with &&",
      '(i) => i.effort.lte(effort.M) && i.labels.any(["bug"])',
      "&&",
    ),
    branchWhen("a comparison operator", "(i) => i.effort <= effort.M", "<="),
    branchWhen(
      "a block body",
      "(i) => { return i.effort.lte(effort.M); }",
      "{ return i.effort.lte(effort.M); }",
    ),
    branchWhen("a bare test", "i.effort.lte(effort.M)", "i.effort.lte(effort.M)"),
    branchWhen(
      "a function expression",
      "function (i) { return true; }",
      "function (i) { return true; }",
    ),
    branchWhen("two parameters", "(i, run) => i.effort.lte(effort.M)", "run"),
    branchWhen("a typed parameter", "(i: Issue) => i.effort.lte(effort.M)", "i: Issue"),
    branchWhen("a destructured parameter", "({ effort }) => effort.lte(effort.M)", "{ effort }"),
    branchWhen(
      "an async arrow",
      "async (i) => i.effort.lte(effort.M)",
      "async (i) => i.effort.lte(effort.M)",
    ),
    branchWhen(
      "a return type",
      "(i): boolean => i.effort.lte(effort.M)",
      "(i): boolean => i.effort.lte(effort.M)",
    ),
    branchWhen("a field the ticket does not have", "(i) => i.priority.lte(effort.M)", "priority"),
    branchWhen("a test effort does not have", "(i) => i.effort.within(effort.M)", "within"),
    branchWhen("a test with no argument", "(i) => i.effort.lte()", "i.effort.lte()"),
    branchWhen(
      "an effort constant the grammar lacks",
      "(i) => i.effort.lte(effort.XXL)",
      "effort.XXL",
    ),
    branchWhen("an effort spelled as a string", '(i) => i.effort.lte("m")', '"m"'),
    branchWhen(
      "an effort constant read by index",
      '(i) => i.effort.lte(effort["M"])',
      'effort["M"]',
    ),
    branchWhen("an optional call", "(i) => i.effort?.lte(effort.M)", "i.effort?.lte(effort.M)"),
    branchWhen(
      "a test on something other than the ticket",
      "(i) => ticket.effort.lte(effort.M)",
      "ticket.effort.lte(effort.M)",
    ),
    branchWhen("no parameter, and not true", "() => false", "false"),
    branchWhen("a negated test", "(i) => !i.effort.lte(effort.M)", "!i.effort.lte(effort.M)"),
    branchWhen("labels that are not a list", '(i) => i.labels.any("bug")', '"bug"'),
    branchWhen(
      "checks named in two lists",
      '(i) => i.checks.anyFailed(["build"], ["test"])',
      'i.checks.anyFailed(["build"], ["test"])',
    ),
  ])("refuses $about", expectRefusal);
});

describe("the layout block", () => {
  it("refuses a file with no layout block once, at its end, with no hint", () => {
    const text = edit(golden("minimal"), MINIMAL_LAYOUT, "");
    const lines = text.split("\n").length;

    expect(parseWorkflowCode(text).errors).toStrictEqual([
      {
        code: LAYOUT_INVALID,
        message: expect.stringContaining(LAYOUT_MARKER) as string,
        line: lines,
        column: 1,
        endLine: lines,
        endColumn: 1,
      },
    ]);
  });

  it("refuses an unreadable line, and the stage it no longer places", () => {
    const text = edit(golden("minimal"), "// node done 240 0", "// node done 240");

    expect(reported(text)).toStrictEqual([
      [LAYOUT_INVALID, '"done"'],
      [LAYOUT_INVALID, "// node done 240"],
    ]);
  });

  it("refuses a line of a kind the block does not have", () => {
    const text = `${golden("minimal")}// arrow start done\n`;
    expect(reported(text)).toStrictEqual([[LAYOUT_INVALID, "// arrow start done"]]);
  });

  it("refuses a stage with no node line, at the stage's id", () => {
    const text = edit(golden("standard-fix"), "// node open-pr 588 630\n", "");
    expect(reported(text)).toStrictEqual([[LAYOUT_INVALID, '"open-pr"']]);
  });
});

describe("every problem, from one parse", () => {
  it("reports mistakes in a statement, a predicate and a stage call together, in file order", () => {
    const base = golden("standard-fix");
    const [header] = base.split("\n");
    let text = edit(base, `${header}\n`, `${header}\nlet draft;\n`);
    text = edit(text, "effort.M) }", "effort.MM) }");
    text = edit(text, 'llm("review", {', 'critic("review", {');

    expect(reported(text)).toStrictEqual([
      [OUT_OF_GRAMMAR, "let draft;"],
      [OUT_OF_GRAMMAR, "effort.MM"],
      [OUT_OF_GRAMMAR, "critic"],
    ]);
  });

  it("reports every wrong option of one stage", () => {
    const text = edit(
      golden("standard-fix"),
      '      farm: "pool-a",\n      next: "test",\n',
      "      farm: 1,\n      cmd: false,\n      next: 2,\n",
    );

    expect(reported(text)).toStrictEqual([
      [OUT_OF_GRAMMAR, "1"],
      [OUT_OF_GRAMMAR, "false"],
      [OUT_OF_GRAMMAR, "2"],
    ]);
  });

  it("reports a wrong id and a wrong option of the same stage", () => {
    const text = edit(
      golden("minimal"),
      '    trigger("start", {\n      title: "Issue queued",',
      "    trigger(start, {\n      title: 42,",
    );

    expect(reported(text)).toStrictEqual([
      [OUT_OF_GRAMMAR, "start"],
      [OUT_OF_GRAMMAR, "42"],
    ]);
  });

  it("reports a syntax error alone, not the grammar error the compiler's recovery would cause", () => {
    const text = edit(golden("minimal"), 'title: "Issue queued",', "title: ,");
    const { errors } = parseWorkflowCode(text);

    expect(errors.map((error) => error.code)).toStrictEqual([SYNTAX_ERROR]);
    expect(errors[0]).toMatchObject({ line: 10, column: 14 });
    expect(errors[0].hint).toBeUndefined();
  });

  it("reports only syntax errors for an unterminated string", () => {
    const text = edit(golden("minimal"), 'title: "Issue queued",', 'title: "Issue queued,');
    const { errors } = parseWorkflowCode(text);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((error) => error.code === SYNTAX_ERROR)).toBe(true);
  });

  it("does not report a missing layout block when a syntax error leaves the code's end uncertain", () => {
    let text = edit(golden("minimal"), MINIMAL_LAYOUT, "");
    text = edit(text, 'title: "Issue queued",', "title: ,");

    expect(parseWorkflowCode(text).errors.map((error) => error.code)).toStrictEqual([SYNTAX_ERROR]);
  });

  it.each([
    "",
    "}",
    "{{{",
    "export default",
    "defineLoop(",
    "not a workflow at all",
    `${String.fromCharCode(0)}${String.fromCharCode(0xd800)}`,
    readFileSync(join(FIXTURES_DIR, "valid", "minimal.json"), "utf8"),
  ])("never throws, and returns no document, for %j", (text) => {
    const parsed = parseWorkflowCode(text);

    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.document).toBeUndefined();
  });
});

describe("files built to break a parser", () => {
  it("answers a file nested too deeply for the compiler with one syntax error, not an exception", () => {
    const depth = 20_000;
    const text = edit(
      golden("minimal"),
      'title: "Issue queued"',
      `title: ${"(".repeat(depth)}"Issue queued"${")".repeat(depth)}`,
    );

    expect(parseWorkflowCode(text)).toStrictEqual({
      errors: [
        {
          code: SYNTAX_ERROR,
          message: expect.stringContaining("too deeply") as string,
          line: 1,
          column: 1,
          endLine: 1,
          endColumn: 1,
        },
      ],
    });
  });

  it("reads a trigger of twenty thousand conjuncts without overflowing, reporting each repeat", () => {
    const conjuncts = Array.from({ length: 20_000 }, () => "i.effort.lte(effort.M)").join(" && ");
    const text = edit(
      golden("minimal"),
      '    on: "issue.queued",\n',
      `    on: "issue.queued",\n    when: (i) => ${conjuncts},\n`,
    );
    const { errors } = parseWorkflowCode(text);

    expect(errors).toHaveLength(19_999);
    expect(errors.every((error) => error.code === OUT_OF_GRAMMAR)).toBe(true);
  });
});

describe("positions", () => {
  it("count lines by line feeds only, so a raw line separator in a prompt moves nothing", () => {
    let text = edit(
      golden("standard-fix"),
      "Write the attack plan.",
      `Write the attack${LINE_SEPARATOR}plan.`,
    );
    text = edit(
      text,
      '      farm: "pool-a",\n      next: "test",\n',
      '      farm: "pool-a",\n      cache: "ccache",\n      next: "test",\n',
    );
    const [error] = parseWorkflowCode(text).errors;

    expect(error.line).toBe(text.split("\n").findIndex((line) => line.includes("cache:")) + 1);
    expect(covered(text, error)).toBe("cache");
  });

  it("are listed in the order a reader meets them", () => {
    const { errors } = parseWorkflowCode(
      readFileSync(join(FIXTURES_DIR, CODE_INVALID, "three-mistakes.loop.ts"), "utf8"),
    );
    const order = errors.map((error) => error.line * 10_000 + error.column);

    expect(order).toStrictEqual([...order].sort((a, b) => a - b));
  });
});
