/**
 * No evaluation and no module execution anywhere in the parser's path — U.2's fourth acceptance
 * criterion ([#166](https://github.com/NobuData/ouroboros/issues/166)), as a test.
 *
 * Decision **C2** reads a workflow file as syntax. Two halves hold the parser to that:
 *
 * * **Statically.** Starting at `code.parser.ts`, the compiler reads every module the parser is
 *   made of, following relative imports. None of them may import a package other than `typescript`
 *   and `zod` (so no `vm`, no `child_process`, no `module`), refer to `eval`, `Function` or
 *   `require`, import anything at run time, or reach for a compiler entry point that emits,
 *   transpiles or evaluates. The scan is run once on a snippet that does all of those, so a scan
 *   that found nothing because it looked for nothing fails too.
 * * **By behaviour.** A file whose every statement, value and predicate would leave a mark if it
 *   ran is parsed. The mark stays unset, and no file is read.
 */

import fs from "node:fs";
import { basename, dirname, resolve } from "node:path";

import ts from "typescript";

import { parseWorkflowCode } from "./code.parser";

/** Where the parser starts. */
const ENTRY = resolve(__dirname, "code.parser.ts");

/** Names that evaluate text, build functions from it, or load modules. */
const FORBIDDEN_NAMES = new Set(["eval", "Function", "require"]);

/** Compiler and `vm` methods that emit, transpile or run code. */
const FORBIDDEN_MEMBERS = new Set([
  "emit",
  "getEmitOutput",
  "transpile",
  "transpileModule",
  "transpileDeclaration",
  "runInContext",
  "runInNewContext",
  "runInThisContext",
  "compileFunction",
]);

/** The global a hostile file tries to set. */
const SENTINEL = "__ouroborosParserRanThis";

/**
 * Read a file into a syntax tree.
 *
 * @param path - Its path, for messages.
 * @param text - Its text.
 * @returns The tree, parents set.
 */
function sourceOf(path: string, text: string): ts.SourceFile {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/**
 * Every module specifier a file imports or re-exports from.
 *
 * @param source - The file.
 * @returns The specifiers, in file order.
 */
function importsOf(source: ts.SourceFile): string[] {
  return source.statements.flatMap((statement) => {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      return [statement.moduleSpecifier.text];
    }
    if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      ts.isStringLiteral(statement.moduleReference.expression)
    ) {
      return [statement.moduleReference.expression.text];
    }
    return [];
  });
}

/**
 * The parser's module graph: every file reachable from the entry through relative imports.
 *
 * @param entry - The first module.
 * @returns Each file's syntax tree, by absolute path.
 */
function moduleGraph(entry: string): Map<string, ts.SourceFile> {
  const files = new Map<string, ts.SourceFile>();
  const queue = [entry];

  while (queue.length > 0) {
    const path = queue.shift() as string;
    if (files.has(path)) continue;

    const source = sourceOf(path, fs.readFileSync(path, "utf8"));
    files.set(path, source);

    for (const specifier of importsOf(source)) {
      if (specifier.startsWith(".")) queue.push(resolve(dirname(path), `${specifier}.ts`));
    }
  }

  return files;
}

/**
 * Every use of something that evaluates, loads or emits code.
 *
 * @param source - The file.
 * @returns One `path:line what` entry per use.
 */
function forbiddenUses(source: ts.SourceFile): string[] {
  const found: string[] = [];
  const where = (node: ts.Node) =>
    `${basename(source.fileName)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && FORBIDDEN_NAMES.has(node.text) && !isMemberName(node)) {
      found.push(`${where(node)} ${node.text}`);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      found.push(`${where(node)} import()`);
    }
    if (ts.isPropertyAccessExpression(node) && FORBIDDEN_MEMBERS.has(node.name.text)) {
      found.push(`${where(node)} .${node.name.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

/**
 * Whether an identifier names a member rather than referring to a binding.
 *
 * @param node - The identifier.
 * @returns `true` for `x` in `a.x` and in `{ x: 1 }`.
 */
function isMemberName(node: ts.Identifier): boolean {
  const { parent } = node;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node)
  );
}

describe("the parser's module graph", () => {
  const graph = moduleGraph(ENTRY);

  it("is the modules the parser is made of", () => {
    expect([...graph.keys()].map((path) => basename(path)).sort()).toEqual([
      "code.errors.ts",
      "code.grammar.ts",
      "code.layout.ts",
      "code.literals.ts",
      "code.parser.predicates.ts",
      "code.parser.stages.ts",
      "code.parser.ts",
      "code.reader.ts",
      "dsl.schema.ts",
    ]);
  });

  it("imports no package but the TypeScript compiler and zod, and no Node built-in", () => {
    const packages = new Set(
      [...graph.values()].flatMap((source) =>
        importsOf(source).filter((specifier) => !specifier.startsWith(".")),
      ),
    );

    expect([...packages].sort()).toEqual(["typescript", "zod"]);
  });

  it("never evaluates text, builds a function, requires, imports at run time, or emits", () => {
    expect([...graph.values()].flatMap((source) => forbiddenUses(source))).toEqual([]);
  });
});

describe("the scan", () => {
  it("finds each forbidden use in a file that has them all", () => {
    const snippet = [
      'eval("1");',
      'new Function("return 1");',
      'require("node:vm");',
      'void import("node:vm");',
      'ts.transpileModule("", {});',
      "program.emit();",
    ].join("\n");

    expect(forbiddenUses(sourceOf("/snippet.ts", snippet))).toEqual([
      "snippet.ts:1 eval",
      "snippet.ts:2 Function",
      "snippet.ts:3 require",
      "snippet.ts:4 import()",
      "snippet.ts:5 .transpileModule",
      "snippet.ts:6 .emit",
    ]);
  });
});

describe("parsing a file that would leave a mark if it ran", () => {
  const hostile = [
    'import { defineLoop, trigger, needsReview } from "@ouroboros/sdk";',
    'import "node:child_process";',
    `globalThis.${SENTINEL} = "a statement";`,
    'export default defineLoop("hostile", {',
    `  dsl: (globalThis.${SENTINEL} = "a value"),`,
    "  trigger: {",
    '    on: "issue.queued",',
    `    when: (i) => { globalThis.${SENTINEL} = "a predicate"; return true; },`,
    "  },",
    `  stages: [(() => { globalThis.${SENTINEL} = "a stage"; })()],`,
    "});",
    "",
  ].join("\n");

  it("refuses every one of those constructs, and runs none of them", () => {
    const parsed = parseWorkflowCode(hostile);

    expect(parsed.document).toBeUndefined();
    expect(parsed.errors.length).toBeGreaterThanOrEqual(5);
    expect((globalThis as Record<string, unknown>)[SENTINEL]).toBeUndefined();
  });

  it("reads no file while it parses, not even the module the file imports", () => {
    const spies = [
      jest.spyOn(fs, "readFileSync"),
      jest.spyOn(fs, "existsSync"),
      jest.spyOn(fs, "statSync"),
      jest.spyOn(fs, "readdirSync"),
      jest.spyOn(fs, "openSync"),
    ];

    parseWorkflowCode(hostile);

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
