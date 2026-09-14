/**
 * The parser, fuzzed — U.4 ([#168](https://github.com/NobuData/ouroboros/issues/168)).
 *
 * The code editor sends whatever is in its buffer, which is usually a file halfway through an edit,
 * and `PUT /code` hands it to `parseWorkflowCode` inside the served process. Two promises make that
 * safe, and this suite holds the parser to both over thousands of texts it has never been shown:
 *
 * * **It never crashes.** Every text gets a result, never an exception.
 * * **Every rejection is anchored.** A result with errors carries no slug and no document. Each
 *   error has one of the three documented codes, a message, and the #180 pointer exactly when it is
 *   out of grammar. Its 1-based range lies inside the text, ends at or after where it starts, and
 *   starts at or after the error before it.
 *
 * A text the parser *does* read is held to the round trip from the other side. When it spells a
 * valid document under a slug the printer accepts, printing that document and parsing the print
 * gives the same document back.
 *
 * **The corpus** is every committed projection (`fixtures/code/`), every refused file
 * (`fixtures/code-invalid/`) and prints of generated documents. Each is mutated the way an editor
 * buffer is: characters deleted, grammar tokens inserted or substituted, slices duplicated, lines
 * swapped, the file cut short. Token soup and arbitrary code points cover texts with no workflow in
 * them at all. The seed is fixed, as in `code.roundtrip.spec.ts`, so a failure replays.
 *
 * Nesting deep enough to exhaust the compiler's stack is `code.parser.errors.spec.ts`'s case. No text
 * here is long enough to reach it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import fc from "fast-check";

import { WORKFLOW_CASE } from "./code.arbitrary.fixture";
import { FULL_SDK_HINT, type WorkflowCodeError, WorkflowCodeErrorCode } from "./code.errors";
import {
  DEFINE_LOOP_OPTIONS,
  LAYOUT_EDGE_PREFIX,
  LAYOUT_MARKER,
  LAYOUT_NODE_PREFIX,
  SDK_IMPORTS,
  SDK_MODULE,
  STAGE_OPTIONS,
} from "./code.grammar";
import { type ParsedWorkflowCode, parseWorkflowCode } from "./code.parser";
import { printWorkflowCode } from "./code.printer";
import { FIXTURES_DIR } from "./dsl.golden.fixture";
import { validateWorkflowDocument } from "./dsl.validator";
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from "./slug";

/** The committed seed. */
const SEED = 168;

/** Thousands of parses take seconds, which Jest's default five-second timeout isn't for. */
const TIMEOUT_MS = 60_000;

/** One committed file. */
interface CorpusFile {
  /** Its path under `fixtures/`. */
  path: string;
  /** Its text. */
  text: string;
}

/** Every committed workflow file, read and refused alike, that mutations start from. */
const CORPUS: CorpusFile[] = ["code", "code-invalid"].flatMap((directory) =>
  readdirSync(join(FIXTURES_DIR, directory))
    .filter((name) => name.endsWith(".loop.ts"))
    .sort()
    .map((name) => ({
      path: `${directory}/${name}`,
      text: readFileSync(join(FIXTURES_DIR, directory, name), "utf8"),
    })),
);

/**
 * Pieces of workflow files and of TypeScript around them, for a mutation to insert: the grammar's
 * words, punctuation, quotes and escapes, every line break the scanner knows, comments and layout
 * lines, predicates the grammar has and ones it doesn't, and literals the grammar refuses. The
 * characters no source file should hold raw are built from their code points.
 */
const TOKENS: readonly string[] = [
  ...SDK_IMPORTS,
  ...DEFINE_LOOP_OPTIONS,
  ...new Set(Object.values(STAGE_OPTIONS).flat()),
  `"${SDK_MODULE}"`,
  "import",
  "export default",
  "from",
  "{",
  "}",
  "(",
  ")",
  "[",
  "]",
  ",",
  ";",
  ":",
  ".",
  "=>",
  "&&",
  "||",
  "!",
  "?.",
  "...",
  "=",
  "+",
  " as ",
  "async ",
  "function",
  "new ",
  "eval",
  "require",
  "import(",
  '"',
  "'",
  "`",
  "${",
  "\\",
  "\n",
  "\r\n",
  "\r",
  "\t",
  " ",
  String.fromCharCode(0x2028),
  String.fromCharCode(0xd800),
  "//",
  "/*",
  "*/",
  LAYOUT_MARKER,
  LAYOUT_NODE_PREFIX,
  LAYOUT_EDGE_PREFIX,
  `${LAYOUT_NODE_PREFIX}start 0 0`,
  `${LAYOUT_EDGE_PREFIX}start done "label"`,
  "(i) => ",
  "() => true",
  "i.effort.lte(effort.M)",
  "effort.XXL",
  'route.task("implement")',
  'route.pool("a")',
  "i.checks.allPassed()",
  'i.source.in(["github"])',
  "i.labels.all([])",
  '"issue.queued"',
  '"1.0"',
  "0",
  "-0",
  "1_000",
  "0x1f",
  "1e309",
  "NaN",
  "true",
  "null",
  "undefined",
];

/** One edit to a text, as generated data so a failing run reports what was done. */
type Mutation =
  | { op: "delete"; at: number; length: number }
  | { op: "insert"; at: number; token: string }
  | { op: "replace"; at: number; length: number; token: string }
  | { op: "duplicate"; at: number; length: number }
  | { op: "swap-lines"; at: number; other: number }
  | { op: "truncate"; at: number };

const AT = fc.nat();
const LENGTH = fc.integer({ min: 1, max: 48 });
const TOKEN = fc.constantFrom(...TOKENS);

/** Any one mutation. Offsets are taken modulo the text, so every generated value applies. */
const MUTATION: fc.Arbitrary<Mutation> = fc.oneof(
  fc.record({ op: fc.constant("delete" as const), at: AT, length: LENGTH }),
  fc.record({ op: fc.constant("insert" as const), at: AT, token: TOKEN }),
  fc.record({ op: fc.constant("replace" as const), at: AT, length: LENGTH, token: TOKEN }),
  fc.record({ op: fc.constant("duplicate" as const), at: AT, length: LENGTH }),
  fc.record({ op: fc.constant("swap-lines" as const), at: AT, other: AT }),
  fc.record({ op: fc.constant("truncate" as const), at: AT }),
);

/** One to four mutations, applied in order. */
const MUTATIONS = fc.array(MUTATION, { minLength: 1, maxLength: 4 });

/**
 * Apply a mutation.
 *
 * @param text - The text.
 * @param mutation - The edit. A slice may cut a surrogate pair in half, which is a text an editor can
 *   send too.
 * @returns The edited text.
 */
function mutate(text: string, mutation: Mutation): string {
  const at = mutation.at % (text.length + 1);

  switch (mutation.op) {
    case "delete":
      return text.slice(0, at) + text.slice(at + mutation.length);
    case "insert":
      return text.slice(0, at) + mutation.token + text.slice(at);
    case "replace":
      return text.slice(0, at) + mutation.token + text.slice(at + mutation.length);
    case "duplicate":
      return text.slice(0, at) + text.slice(at, at + mutation.length) + text.slice(at);
    case "swap-lines": {
      const lines = text.split("\n");
      const first = mutation.at % lines.length;
      const second = mutation.other % lines.length;
      [lines[first], lines[second]] = [lines[second], lines[first]];
      return lines.join("\n");
    }
    case "truncate":
      return text.slice(0, at);
  }
}

/** A committed file, mutated. */
const MUTATED_CORPUS = fc
  .record({ file: fc.constantFrom(...CORPUS), mutations: MUTATIONS })
  .map(({ file, mutations }) => mutations.reduce(mutate, file.text));

/** A generated document's print, mutated. */
const MUTATED_PRINT = fc
  .record({ workflow: WORKFLOW_CASE, mutations: MUTATIONS })
  .map(({ workflow, mutations }) =>
    mutations.reduce(mutate, printWorkflowCode(workflow.slug, workflow.document).text),
  );

/** Grammar tokens in any order, with no workflow in them. */
const TOKEN_SOUP = fc
  .array(fc.oneof(TOKEN, fc.constantFrom(" ", "\n")), { maxLength: 80 })
  .map((tokens) => tokens.join(""));

/** Any code points at all. */
const NOISE = fc.string({ unit: "binary", maxLength: 400 });

/** What the parser made of one text. */
type Outcome = "read" | "refused";

/**
 * Parse a text and hold the result to the parser's promises.
 *
 * @param text - Any text. An exception from the parser fails the run, which is the first promise.
 * @returns Whether the text was read or refused.
 */
function expectAnchoredResult(text: string): Outcome {
  const result = parseWorkflowCode(text);

  if (result.errors.length === 0) {
    expectFaithfulReading(result);
    return "read";
  }

  // No slug and no document beside the errors, not even as `undefined`.
  expect(result).toStrictEqual({ errors: result.errors });

  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  result.errors.forEach((error, index) => {
    expectAnchored(error, lines);
    if (index > 0) expect(compare(error, result.errors[index - 1])).toBeGreaterThanOrEqual(0);
  });

  return "refused";
}

/**
 * Hold one error to the anchoring rules.
 *
 * @param error - The error.
 * @param lines - The text's lines, counting line feeds only, as the parser does.
 */
function expectAnchored(error: WorkflowCodeError, lines: readonly string[]): void {
  expect(Object.values(WorkflowCodeErrorCode)).toContain(error.code);
  expect(error.message).toMatch(/\S/);

  if (error.code === WorkflowCodeErrorCode.OUT_OF_GRAMMAR) expect(error.hint).toBe(FULL_SDK_HINT);
  else expect(error).not.toHaveProperty("hint");

  for (const [line, column] of [
    [error.line, error.column],
    [error.endLine, error.endColumn],
  ]) {
    expect(Number.isInteger(line) && Number.isInteger(column)).toBe(true);
    expect(line).toBeGreaterThanOrEqual(1);
    expect(line).toBeLessThanOrEqual(lines.length);
    expect(column).toBeGreaterThanOrEqual(1);
    expect(column).toBeLessThanOrEqual(lines[line - 1].length + 1);
  }

  expect(compare({ line: error.endLine, column: error.endColumn }, error)).toBeGreaterThanOrEqual(
    0,
  );
}

/**
 * A text the parser read, held to the round trip: a valid document under a printable slug prints to
 * a file that reads back as the same document.
 *
 * @param result - A result with no errors.
 */
function expectFaithfulReading({ slug, document }: ParsedWorkflowCode): void {
  expect(typeof slug).toBe("string");
  expect(document).toBeDefined();

  const valid = validateWorkflowDocument(document).document;
  if (valid === undefined || slug === undefined) return;
  if (!SLUG_PATTERN.test(slug) || slug.length > SLUG_MAX_LENGTH) return;

  expect(parseWorkflowCode(printWorkflowCode(slug, valid).text)).toStrictEqual({
    slug,
    document,
    errors: [],
  });
}

/**
 * Order two positions.
 *
 * @param a - A 1-based line and column.
 * @param b - Another.
 * @returns Negative when `a` comes first, zero when they are one place, positive otherwise.
 */
function compare(a: { line: number; column: number }, b: { line: number; column: number }): number {
  return a.line - b.line || a.column - b.column;
}

describe("the parser, fuzzed", () => {
  it("starts from every committed file, read and refused", () => {
    const paths = CORPUS.map((file) => file.path);

    expect(paths).toEqual(expect.arrayContaining(["code/standard-fix.loop.ts"]));
    expect(paths).toEqual(expect.arrayContaining(["code-invalid/three-mistakes.loop.ts"]));
  });

  it(
    "never crashes, and anchors every rejection, over 1500 mutations of the committed files",
    () => {
      const outcomes = new Set<Outcome>();

      fc.assert(
        fc.property(MUTATED_CORPUS, (text) => {
          outcomes.add(expectAnchoredResult(text));
        }),
        { seed: SEED, numRuns: 1500 },
      );

      // Mutations that leave a file readable are the ones that test the round trip, so the run must
      // have had some.
      expect([...outcomes].sort()).toEqual(["read", "refused"]);
    },
    TIMEOUT_MS,
  );

  it.each([
    ["500 mutations of generated documents' prints", MUTATED_PRINT, 500],
    ["500 texts of grammar tokens in any order", TOKEN_SOUP, 500],
    ["300 texts of arbitrary code points", NOISE, 300],
  ] as const)(
    "never crashes, and anchors every rejection, over %s",
    (_, texts, numRuns) => {
      fc.assert(
        fc.property(texts, (text) => {
          expectAnchoredResult(text);
        }),
        { seed: SEED, numRuns },
      );
    },
    TIMEOUT_MS,
  );
});
