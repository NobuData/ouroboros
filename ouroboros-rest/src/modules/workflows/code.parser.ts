/**
 * The parser: mockup 05's TypeScript, read back into a canonical workflow document — U.2
 * ([#166](https://github.com/NobuData/ouroboros/issues/166)).
 *
 * ```ts
 * const { slug, document, errors } = parseWorkflowCode(text);
 * // slug:     "standard-fix"
 * // document: { dsl_version: "1.0", trigger: {…}, nodes: […], edges: […] }
 * // errors:   []  — or, for a file it cannot read:
 * //           [{ code: "code_out_of_grammar", line: 42, column: 5, endLine: 42, endColumn: 11,
 * //              message: "`review` is not a stage call. …", hint: "Supported in the full SDK (v2) — …" }]
 * ```
 *
 * The language is [`docs/WORKFLOW_CODE_DSL.md`](../../../../docs/WORKFLOW_CODE_DSL.md), and this is
 * `code.printer.ts` run backwards: `parse(print(doc))` is `doc`. Four properties shape it:
 *
 * * **Nothing is evaluated.** `ts.createSourceFile` builds a syntax tree, and the parser walks it.
 *   Nothing is emitted, executed, resolved or imported, and the arrow functions are read as
 *   syntax, never called (decision **C2**). `code.parser.static.spec.ts` scans the parser's own
 *   module graph for `eval`, `Function`, `require`, dynamic `import()` and any package beyond
 *   `typescript` and `zod`.
 * * **The grammar is closed.** Every construct is one `code.grammar.ts` names; anything else is
 *   `code_out_of_grammar`, anchored where it is written, with the pointer to #180.
 * * **Shape, not semantics.** The result is a *candidate* document. A graph with an unreachable
 *   stage parses fine and fails `validateWorkflowDocument`, which is the division of labour the
 *   issue asks for: the parser says what the text spells, and the shared validators (#133, #144)
 *   say whether that is a workflow.
 * * **Every problem in one pass.** The compiler recovers from syntax errors and reports each one.
 *   The grammar walk records each problem and carries on with the next sibling. A grammar error
 *   whose range holds a syntax error is dropped, since it is the syntax error seen again.
 *
 * **The layout block** gives each stage its position and each edge its label and its place in the
 * document's edge list. Stale lines are ignored: a node line for a stage the code no longer calls,
 * or an edge line for an edge the code no longer declares, describes nothing in the document. A
 * stage with no node line is `code_layout_invalid`, because a position has no default that would
 * not be invented. An edge with no edge line has no label, and is placed after every edge that
 * does, in the order the stages declare them.
 */

import ts from "typescript";

import {
  type CodeRange,
  LineMap,
  placeErrors,
  type PendingCodeError,
  type WorkflowCodeError,
  WorkflowCodeErrorCode,
} from "./code.errors";
import {
  DEFINE_LOOP,
  DEFINE_LOOP_OPTIONS,
  LAYOUT_MARKER,
  LAYOUT_NODE_PREFIX,
  SDK_IMPORTS,
  SDK_MODULE,
  TRIGGER_EVENTS,
  TRIGGER_OPTIONS,
} from "./code.grammar";
import { type LayoutEdge, readLayout } from "./code.layout";
import { readTriggerConditions, type ReadValue } from "./code.parser.predicates";
import { type DeclaredEdge, readStage, type ReadStage } from "./code.parser.stages";
import { CodeReader, code, compact, list, unwrap } from "./code.reader";

/** What the parser produces. */
export interface ParsedWorkflowCode {
  /**
   * `defineLoop`'s first argument. Present exactly when `errors` is empty. It names the workflow
   * entity, not the definition, so it is not part of the document; #167 checks it against the
   * workflow being saved.
   */
  slug?: string;
  /**
   * The canonical document the text spells, not yet validated. Present exactly when `errors` is
   * empty. Run it through `validateWorkflowDocument` before treating it as a workflow.
   */
  document?: ReadValue;
  /** Every problem, in the order a reader meets them. Empty when the text was read. */
  errors: WorkflowCodeError[];
}

/** The name the compiler is told the text lives under. Never read from or written to disk. */
const FILE_NAME = "/workflow.loop.ts";

/** The parts of `defineLoop(…)` read so far. */
interface LoopParts {
  /** The slug, when readable. */
  slug?: string;
  /** The `dsl` option. */
  dslVersion?: string;
  /** The `trigger` option, as the document structures it. */
  trigger?: ReadValue;
  /** Every readable stage call, or `undefined` when there is no `stages` option. */
  stages?: ReadStage[];
}

/**
 * Read a workflow file back into its document.
 *
 * @param text - The file. Line endings may be `\n`, `\r\n` or `\r`; each reads as `\n`, so a
 *   prompt means the same thing whichever editor saved it.
 * @returns The slug and the document, or every error that stopped the reading. Whatever the text,
 *   the answer is a result rather than an exception: even a file nested too deeply for the
 *   compiler's recursive parser comes back as one `code_syntax_error`.
 */
export function parseWorkflowCode(text: string): ParsedWorkflowCode {
  const normalised = text.replace(/\r\n?/g, "\n");

  try {
    return parseNormalised(normalised);
  } catch (error) {
    // The compiler parses recursively, so a few thousand nested brackets exhaust the stack. That
    // is the one failure a text can cause; anything else is a bug here and stays an exception.
    if (!(error instanceof RangeError) || !/call stack/i.test(error.message)) throw error;

    return {
      errors: [
        {
          code: WorkflowCodeErrorCode.SYNTAX_ERROR,
          message: "This file nests brackets or parentheses too deeply to be read.",
          line: 1,
          column: 1,
          endLine: 1,
          endColumn: 1,
        },
      ],
    };
  }
}

/**
 * Where a file writes its workflow's slug: the first argument of `defineLoop`.
 *
 * For the save endpoint (#167), which refuses a file whose slug is not the workflow being saved
 * and anchors that refusal at the slug. It is not part of {@link ParsedWorkflowCode} because that
 * one refusal is its only reader, so the text is read a second time only when there is a refusal to
 * make.
 *
 * @param text - A file {@link parseWorkflowCode} read without errors. Anything else may nest too
 *   deeply for the compiler, which is the one text that call guards against and this does not.
 * @returns The range of the slug's string literal, or `undefined` when the text has no
 *   `export default defineLoop("…", …)` to find it in.
 */
export function slugRangeOf(text: string): CodeRange | undefined {
  const normalised = text.replace(/\r\n?/g, "\n");
  const source = ts.createSourceFile(
    FILE_NAME,
    normalised,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const loop = source.statements.find(
    (statement): statement is ts.ExportAssignment =>
      ts.isExportAssignment(statement) && !statement.isExportEquals,
  );
  const call = loop === undefined ? undefined : unwrap(loop.expression);

  if (call === undefined || !ts.isCallExpression(call) || call.arguments.length === 0) {
    return undefined;
  }

  const slug = unwrap(call.arguments[0]);
  return new LineMap(normalised).range(slug.getStart(source), slug.getEnd());
}

/**
 * Read a workflow file whose line endings are already line feeds.
 *
 * @param normalised - The file.
 * @returns What {@link parseWorkflowCode} returns.
 */
function parseNormalised(normalised: string): ParsedWorkflowCode {
  const source = ts.createSourceFile(
    FILE_NAME,
    normalised,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const lines = new LineMap(normalised);
  const reader = new CodeReader(source);
  const syntax = syntaxErrors(source);
  const { slug, document } = readFile(reader, lines, syntax.length > 0);
  const errors = placeErrors(
    [...syntax, ...withoutCascades(reader.errors, syntax, normalised)],
    lines,
  );

  if (errors.length > 0 || slug === undefined || document === undefined) return { errors };
  return { slug, document, errors };
}

/**
 * Every syntax error the compiler reports.
 *
 * A one-file program over an in-memory host, with no default library and no module resolution,
 * so the answer is TypeScript's grammar and nothing else: whether `@ouroboros/sdk` exists is never
 * asked, and no file is read.
 *
 * @param source - The syntax tree.
 * @returns The errors, as offsets.
 */
function syntaxErrors(source: ts.SourceFile): PendingCodeError[] {
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === FILE_NAME ? source : undefined),
    getDefaultLibFileName: () => "/lib.d.ts",
    writeFile: () => undefined,
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (name) => name === FILE_NAME,
    readFile: () => undefined,
  };
  const program = ts.createProgram({
    rootNames: [FILE_NAME],
    options: { noLib: true, noResolve: true, types: [] },
    host,
  });

  return program.getSyntacticDiagnostics(source).map((diagnostic) => {
    const start = diagnostic.start ?? 0;
    return {
      code: WorkflowCodeErrorCode.SYNTAX_ERROR,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      start,
      end: start + (diagnostic.length ?? 0),
    };
  });
}

/**
 * Drop the grammar errors a syntax error explains.
 *
 * When the compiler recovers from a typo it fills the gap with what it expected, and the walk then
 * finds that filler out of grammar. Reporting both would say one thing twice, so a grammar error is
 * dropped when a syntax error starts inside its range. A filler node is empty and sits *before* the
 * whitespace that precedes the typo, so an empty range reaches over that whitespace as well.
 *
 * @param grammar - The walk's errors.
 * @param syntax - The compiler's.
 * @param text - The text both index into.
 * @returns The grammar errors no syntax error explains.
 */
function withoutCascades(
  grammar: readonly PendingCodeError[],
  syntax: readonly PendingCodeError[],
  text: string,
): PendingCodeError[] {
  const starts = syntax.map((cause) => cause.start).sort((a, b) => a - b);

  return grammar.filter((error) => {
    const reach =
      error.end > error.start ? error.end - 1 : error.start + leadingSpace(text, error.start);
    const first = firstAtOrAfter(starts, error.start);
    return !(first < starts.length && starts[first] <= reach);
  });
}

/** A run of whitespace at `lastIndex`, and nowhere else. */
const WHITESPACE = /\s*/y;

/**
 * How many whitespace characters begin at an offset.
 *
 * @param text - The text.
 * @param offset - Where to look.
 * @returns The length of the whitespace run there; `0` when there is none.
 */
function leadingSpace(text: string, offset: number): number {
  WHITESPACE.lastIndex = offset;
  WHITESPACE.exec(text);
  return WHITESPACE.lastIndex - offset;
}

/**
 * The index of the first value not below a given one, by binary search.
 *
 * @param sorted - Numbers in ascending order.
 * @param value - The value.
 * @returns That index, or `sorted.length` when every value is below it.
 */
function firstAtOrAfter(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sorted[middle] < value) low = middle + 1;
    else high = middle;
  }

  return low;
}

/**
 * Read the file's statements: the header, then `defineLoop`, then the layout block.
 *
 * @param reader - The walk's reader.
 * @param lines - The text's line map.
 * @param syntaxBroken - Whether the compiler reported a syntax error, in which case the tree cannot
 *   say where the code ends and a missing layout block is not reported.
 * @returns The slug and the candidate document, as far as they could be read.
 */
function readFile(
  reader: CodeReader,
  lines: LineMap,
  syntaxBroken: boolean,
): { slug?: string; document?: ReadValue } {
  let header = false;
  let loop: ts.ExportAssignment | undefined;

  for (const statement of reader.source.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (header) {
        reader.outOfGrammar(
          statement,
          `A workflow file has one import: its header from "${SDK_MODULE}".`,
        );
      } else {
        readHeader(reader, statement);
      }
      header = true;
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      if (loop === undefined) loop = statement;
      else
        reader.outOfGrammar(
          statement,
          "A workflow file defines one loop, so it has one `export default`.",
        );
    } else if (!ts.isEmptyStatement(statement)) {
      reader.outOfGrammar(
        statement,
        `A workflow file holds its import from "${SDK_MODULE}" and \`export default ${DEFINE_LOOP}(…)\`, and no other statement.`,
      );
    }
  }

  if (loop === undefined) {
    reader.outOfGrammar(
      { start: 0, end: 0 },
      `A workflow file exports its loop: \`export default ${DEFINE_LOOP}("slug", { dsl, trigger, stages })\`.`,
    );
    return {};
  }

  const parts = readDefineLoop(reader, loop.expression);
  if (parts === undefined) return {};

  const { slug, dslVersion, trigger, stages } = parts;
  if (stages === undefined)
    return { slug, document: compact({ dsl_version: dslVersion, trigger }) };

  const { positions, edges } = placeStages(reader, lines, stages, syntaxBroken);
  const nodes = stages.map((stage, index) =>
    compact({
      id: stage.id,
      type: stage.type,
      title: stage.title,
      description: stage.description,
      position: positions[index],
      config: stage.config,
    }),
  );

  return { slug, document: compact({ dsl_version: dslVersion, trigger, nodes, edges }) };
}

/**
 * Check the header: one named import from the SDK, of names the SDK has.
 *
 * Which names it imports, and in what order, do not change the document, so an unused name or a
 * missing one is accepted and the next print writes exactly the names the file uses.
 *
 * @param reader - The walk's reader.
 * @param statement - The import declaration.
 */
function readHeader(reader: CodeReader, statement: ts.ImportDeclaration): void {
  const { moduleSpecifier: specifier, importClause: clause } = statement;
  const usage = `import { ${DEFINE_LOOP}, … } from "${SDK_MODULE}"`;

  if (!ts.isStringLiteral(specifier) || specifier.text !== SDK_MODULE) {
    reader.outOfGrammar(
      specifier,
      `A workflow file imports from "${SDK_MODULE}" and nowhere else.`,
    );
    return;
  }
  if (statement.attributes !== undefined) {
    reader.outOfGrammar(statement.attributes, "The header carries no import attributes.");
  }
  if (clause === undefined) {
    reader.outOfGrammar(statement, `The header names what it imports: ${usage}.`);
    return;
  }
  if (clause.isTypeOnly) {
    reader.outOfGrammar(clause, `The header imports the SDK's values, not its types: ${usage}.`);
    return;
  }
  if (clause.name !== undefined) {
    reader.outOfGrammar(
      clause.name,
      `The SDK has no default export. The header names what it imports: ${usage}.`,
    );
  }

  const bindings = clause.namedBindings;
  if (bindings === undefined) return;
  if (ts.isNamespaceImport(bindings)) {
    reader.outOfGrammar(bindings, `The header names each import in braces: ${usage}.`);
    return;
  }

  for (const element of bindings.elements) {
    const name = element.name.text;

    if (element.propertyName !== undefined) {
      reader.outOfGrammar(
        element,
        `The header imports each name as itself, so \`as\` is not part of the grammar.`,
      );
    } else if (element.isTypeOnly) {
      reader.outOfGrammar(element, "The header imports the SDK's values, not its types.");
    } else if (!(SDK_IMPORTS as readonly string[]).includes(name)) {
      reader.outOfGrammar(
        element.name,
        `\`${name}\` is not a name the SDK exports. The header imports from ${list(SDK_IMPORTS.map(code))}.`,
      );
    }
  }
}

/**
 * Read `defineLoop("slug", { dsl, trigger, stages })`.
 *
 * A missing option is left out of the document rather than reported, so the validator names it
 * with a JSON Pointer as it would for the canvas.
 *
 * @param reader - The walk's reader.
 * @param expression - The default export.
 * @returns The parts it holds, or `undefined` when it is not a `defineLoop` call at all.
 */
function readDefineLoop(reader: CodeReader, expression: ts.Expression): LoopParts | undefined {
  const call = unwrap(expression);
  const usage = `${DEFINE_LOOP}("slug", { dsl, trigger, stages })`;

  if (
    !ts.isCallExpression(call) ||
    !ts.isIdentifier(call.expression) ||
    call.expression.text !== DEFINE_LOOP ||
    call.questionDotToken !== undefined ||
    call.typeArguments !== undefined
  ) {
    reader.outOfGrammar(call, `The default export is \`${usage}\`.`);
    return undefined;
  }
  if (call.arguments.length !== 2) {
    reader.outOfGrammar(
      call,
      `\`${DEFINE_LOOP}\` takes the workflow's slug and its options: \`${usage}\`.`,
    );
    return undefined;
  }

  const [slugNode, optionsNode] = call.arguments;
  const slug = reader.string(slugNode, "the workflow's slug");
  const options = reader.object(optionsNode, `\`${DEFINE_LOOP}\`'s options`, DEFINE_LOOP_OPTIONS);
  if (options === undefined) return { slug };

  const dsl = options.get("dsl");
  const trigger = options.get("trigger");
  const stages = options.get("stages");

  return {
    slug,
    dslVersion: dsl === undefined ? undefined : reader.string(dsl, "`dsl`"),
    trigger: trigger === undefined ? undefined : readTrigger(reader, trigger),
    stages: stages === undefined ? undefined : readStages(reader, stages),
  };
}

/**
 * Read `trigger: { on, when }` into the document's `trigger`.
 *
 * @param reader - The walk's reader.
 * @param node - The option's value.
 * @returns The trigger, or `undefined` when it is not an object literal.
 */
function readTrigger(reader: CodeReader, node: ts.Expression): ReadValue | undefined {
  const options = reader.object(node, "`trigger`", TRIGGER_OPTIONS);
  if (options === undefined) return undefined;

  const on = options.get("on");
  const when = options.get("when");
  const spelling = on === undefined ? undefined : reader.string(on, "the trigger's `on`");
  const event =
    on === undefined || spelling === undefined
      ? undefined
      : reader.name(TRIGGER_EVENTS, spelling, on, "an event a loop starts on", (text) =>
          JSON.stringify(text),
        );

  return compact({
    event,
    conditions: when === undefined ? {} : readTriggerConditions(reader, when),
  });
}

/**
 * Read `stages: [ … ]`.
 *
 * @param reader - The walk's reader.
 * @param node - The option's value.
 * @returns Every stage call that could be read, in order.
 */
function readStages(reader: CodeReader, node: ts.Expression): ReadStage[] {
  return (reader.array(node, "`stages`") ?? []).flatMap((element) => {
    const stage = readStage(reader, element);
    return stage === undefined ? [] : [stage];
  });
}

/**
 * Join the stages with the layout block: each stage's position, and the document's edge list.
 *
 * The block is looked for after the last statement only, so a prompt that happens to contain the
 * marker line cannot be mistaken for it.
 *
 * @param reader - The walk's reader.
 * @param lines - The text's line map.
 * @param stages - The stage calls, in order.
 * @param syntaxBroken - Whether a syntax error makes the end of the code uncertain.
 * @returns One position per stage (`undefined` where none is recorded), and every declared edge in
 *   document order with its label.
 */
function placeStages(
  reader: CodeReader,
  lines: LineMap,
  stages: readonly ReadStage[],
  syntaxBroken: boolean,
): { positions: ({ x: number; y: number } | undefined)[]; edges: ReadValue[] } {
  const { source } = reader;
  const last = source.statements[source.statements.length - 1];
  const tailStart = last === undefined ? 0 : last.getEnd();
  const tailLine = lines.position(tailStart).line;
  const layout = readLayout(source.text.slice(tailStart));

  if (!layout.found && !syntaxBroken) {
    reader.report(
      { start: source.text.length, end: source.text.length },
      WorkflowCodeErrorCode.LAYOUT_INVALID,
      `This file has no layout block, so its stages have no positions. The block opens with the line \`${LAYOUT_MARKER}\`.`,
    );
  }

  for (const malformed of layout.malformed) {
    reader.report(
      lines.lineSpan(tailLine + malformed.line - 1),
      WorkflowCodeErrorCode.LAYOUT_INVALID,
      'This line of the layout block is neither `// node <id> <x> <y>` nor `// edge <from> <to>`, with an optional "label" after an edge.',
    );
  }

  const nodeLines = new KeyedQueue(layout.nodes, (node) => node.id);
  const positions = stages.map((stage) => {
    const placed = nodeLines.take(stage.id);
    if (placed !== undefined) return { x: placed.x, y: placed.y };

    if (layout.found) {
      reader.report(
        stage.idNode,
        WorkflowCodeErrorCode.LAYOUT_INVALID,
        `Stage ${JSON.stringify(stage.id)} has no position. Add \`${LAYOUT_NODE_PREFIX}${stage.id} <x> <y>\` to the layout block.`,
      );
    }
    return undefined;
  });

  return {
    positions,
    edges: orderEdges(
      stages.flatMap((stage) => stage.edges),
      layout.edges,
    ),
  };
}

/**
 * Items grouped by a key and handed out in order: the k-th `take` of a key gets the k-th item that
 * has it.
 *
 * Two stages with one id, or two edges joining one pair, are each a validation error, but the
 * parser still has to give each of them *a* line. Every operation is constant time, so a file of
 * any size is placed in time proportional to its length.
 */
class KeyedQueue<T> {
  /** The items with each key, in their original order. */
  private readonly items = new Map<string, T[]>();
  /** How many items of each key have been taken. */
  private readonly taken = new Map<string, number>();

  /**
   * @param items - The items, in order.
   * @param keyOf - Each item's key.
   */
  constructor(items: readonly T[], keyOf: (item: T) => string) {
    for (const item of items) {
      const key = keyOf(item);
      const group = this.items.get(key);
      if (group === undefined) this.items.set(key, [item]);
      else group.push(item);
    }
  }

  /**
   * Take the next item with a key.
   *
   * @param key - The key.
   * @returns The first item with that key not yet taken, or `undefined` when none is left.
   */
  take(key: string): T | undefined {
    const group = this.items.get(key);
    const index = this.taken.get(key) ?? 0;
    if (group === undefined || index >= group.length) return undefined;

    this.taken.set(key, index + 1);
    return group[index];
  }
}

/**
 * Put the declared edges in document order, with their labels.
 *
 * Each edge line takes the first declared edge with its endpoints that no earlier line took. An
 * edge line nothing matches is stale and ignored. The edges no line took follow, in the order the
 * stages declare them, without labels.
 *
 * @param declared - Every edge the stages declare, in declaration order.
 * @param placed - The layout block's edge lines, in file order.
 * @returns The edges, as the document lists them.
 */
function orderEdges(declared: readonly DeclaredEdge[], placed: readonly LayoutEdge[]): ReadValue[] {
  const byPair = new KeyedQueue(
    declared.map((edge, index) => ({ edge, index })),
    ({ edge }) => pairKey(edge.from, edge.to),
  );
  const taken = declared.map(() => false);
  const ordered: ReadValue[] = [];

  for (const line of placed) {
    const match = byPair.take(pairKey(line.from, line.to));
    if (match === undefined) continue;

    taken[match.index] = true;
    ordered.push(edgeOf(match.edge, line.label));
  }

  declared.forEach((edge, index) => {
    if (!taken[index]) ordered.push(edgeOf(edge));
  });

  return ordered;
}

/**
 * One key per pair of endpoints, whatever characters the ids hold.
 *
 * @param from - The edge's source id.
 * @param to - Its target id, which a declared edge may lack.
 * @returns The key.
 */
function pairKey(from: string, to: string | undefined): string {
  return JSON.stringify([from, to ?? null]);
}

/**
 * One document edge.
 *
 * @param edge - The declared edge.
 * @param label - Its label from the layout block, when it has one.
 * @returns The edge, with its members in the schema's order.
 */
function edgeOf(edge: DeclaredEdge, label?: string): ReadValue {
  return compact({
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    label,
    condition: edge.condition,
  });
}
