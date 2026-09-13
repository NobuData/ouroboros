/**
 * Reading a printed workflow back with the TypeScript compiler — test support for U.1
 * ([#165](https://github.com/NobuData/ouroboros/issues/165)).
 *
 * The printer's two promises are that its output is TypeScript and that nothing is lost on the
 * way into it. Neither can be asserted by comparing strings the printer itself produced, so
 * this file asks the **compiler**: `ts.createSourceFile` builds the syntax tree — statically,
 * nothing is emitted and nothing is run — and the helpers below walk it to recover what the
 * text says about the graph.
 *
 * * {@link syntaxErrors} — every syntactic diagnostic the compiler reports.
 * * {@link recoverWorkflowCode} — the slug, the trigger, each stage's callee, id, option keys,
 *   strings and predicate, and every edge with its kind and condition.
 * * {@link recoverGraph} — that, joined with the layout block, as the node positions and the
 *   edges in document order, to hold against {@link graphOf} a document.
 *
 * **This is not the parser.** It reads what the grammar's printer writes and throws at the
 * first thing it does not recognise; it reports nothing anchored, accepts nothing
 * non-canonical, and recovers a model stage's strings but not the rest of its config. The
 * closed-grammar parser with anchored errors is U.2
 * ([#166](https://github.com/NobuData/ouroboros/issues/166)), whose suite supersedes this one's
 * use of it. `*.fixture.ts` is left out of the build, so none of this ships.
 */

import ts from "typescript";

import {
  DEFINE_LOOP,
  EDGE_OPTIONS,
  EFFORT_CONSTANTS,
  PREDICATE_METHODS,
  PREDICATE_PARAMETER,
  SDK_IMPORTS,
  SDK_MODULE,
  TRIGGER_EVENTS,
} from "./code.grammar";
import { readLayout } from "./code.layout";
import { calleeFor } from "./code.printer";
import type {
  EdgeKind,
  Effort,
  Predicate,
  SourceKind,
  TriggerSpec,
  WorkflowDocument,
  WorkflowEdge,
} from "./dsl.schema";
import { validateWorkflowDocument } from "./dsl.validator";

/** The name the compiler is told the text lives under. */
const FILE_NAME = "/workflow.loop.ts";

/** One stage call, as the compiler reads it. */
export interface RecoveredStage {
  /** The callee — `llm`, `gate`, `openPr`, … */
  callee: string;
  /** The node id, the call's first argument. */
  id: string;
  /** Every option key, in the order the text writes them. */
  optionKeys: string[];
  /** The `title` string. */
  title: string;
  /** The `description` string, when there is one. */
  description?: string;
  /** The `prompt` string, when there is one. */
  prompt?: string;
  /** A flow node's predicate, from its `require` or its `when`. */
  predicate?: Predicate;
}

/** One edge, as the stage that declares it reads. */
export interface RecoveredEdge {
  /** The declaring stage's id. */
  from: string;
  /** The target id. */
  to: string;
  /** Which option declared it. */
  kind: EdgeKind;
  /** Its condition, when it has one. */
  condition?: Predicate;
}

/** Everything {@link recoverWorkflowCode} reads out of a file. */
export interface RecoveredWorkflow {
  /** The names the header imports, in order. */
  imports: string[];
  /** `defineLoop`'s first argument. */
  slug: string;
  /** The `dsl` option. */
  dslVersion: string;
  /** The trigger, as the DSL structures it. */
  trigger: TriggerSpec;
  /** Every stage call, in order. */
  stages: RecoveredStage[];
  /** Every edge, in the order the stages declare them. */
  edges: RecoveredEdge[];
}

/** The part of a document the graph assertions compare: positions, callees and edges. */
export interface WorkflowGraph {
  /** Every node, in node order. */
  nodes: { id: string; callee: string; x: number; y: number }[];
  /** Every edge, in document order. */
  edges: WorkflowEdge[];
}

/**
 * Validate a value and return its typed document — the precondition every print in the suite
 * honours, so a constructed case that is not a valid workflow fails here and not in the
 * printer.
 *
 * @param value - The candidate document.
 * @returns The typed document.
 * @throws {Error} Naming the validator's errors, when the value is not a valid workflow.
 */
export function validDocument(value: unknown): WorkflowDocument {
  const verdict = validateWorkflowDocument(value);
  if (verdict.document === undefined) {
    throw new Error(`The constructed document is invalid: ${JSON.stringify(verdict.errors)}`);
  }

  return verdict.document;
}

/**
 * Parse text into a syntax tree, parents set.
 *
 * @param text - The source.
 * @returns The tree.
 */
export function parseSource(text: string): ts.SourceFile {
  return ts.createSourceFile(FILE_NAME, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/**
 * Every syntactic diagnostic the compiler reports for a file, as `line:column message`.
 *
 * A one-file program over an in-memory host with no lib and no resolution, so what comes back
 * is the grammar of TypeScript and nothing about whether `@ouroboros/sdk` exists.
 *
 * @param text - The source.
 * @returns The diagnostics; empty when the text is syntactically valid TypeScript.
 */
export function syntaxErrors(text: string): string[] {
  const source = parseSource(text);
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
  const program = ts.createProgram([FILE_NAME], { noLib: true, noResolve: true }, host);

  return program.getSyntacticDiagnostics(source).map((diagnostic) => {
    const { line, character } = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    return `${line + 1}:${character + 1} ${message}`;
  });
}

/**
 * How many lines the compiler counts in a file — which includes every character it treats as
 * a line break, not only line feeds.
 *
 * @param text - The source.
 * @returns The line count.
 */
export function compilerLineCount(text: string): number {
  return parseSource(text).getLineStarts().length;
}

/**
 * Parse one expression.
 *
 * @param text - The expression's source.
 * @returns Its syntax node.
 * @throws {Error} When the text is not a single expression.
 */
export function expressionOf(text: string): ts.Expression {
  const [statement] = parseSource(`const expression = ${text};`).statements;
  const initializer =
    statement !== undefined && ts.isVariableStatement(statement)
      ? statement.declarationList.declarations[0]?.initializer
      : undefined;

  if (initializer === undefined) throw new Error(`Not an expression: ${text}`);
  return initializer;
}

/**
 * The SDK names a file actually refers to — every identifier outside the header that is not a
 * property name or a parameter.
 *
 * @param text - The source.
 * @returns The referenced names, in `SDK_IMPORTS`' order.
 */
export function sdkReferences(text: string): string[] {
  const names = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && !isMemberOrParameterName(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(parseSource(text));

  return SDK_IMPORTS.filter((name) => names.has(name));
}

/**
 * Read a printed workflow's structure back out of its text.
 *
 * @param text - A file the printer wrote.
 * @returns What the file says.
 * @throws {Error} At the first construct the printer does not write, naming its line.
 */
export function recoverWorkflowCode(text: string): RecoveredWorkflow {
  const source = parseSource(text);
  let imports: string[] | undefined;
  let call: ts.CallExpression | undefined;

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (stringValue(statement.moduleSpecifier) !== SDK_MODULE) {
        fail(statement, "imports from a module other than the SDK");
      }
      const bindings = statement.importClause?.namedBindings;
      if (bindings === undefined || !ts.isNamedImports(bindings)) fail(statement, "is not named");
      imports = bindings.elements.map((element) => element.name.text);
    } else if (ts.isExportAssignment(statement) && ts.isCallExpression(statement.expression)) {
      call = statement.expression;
    } else {
      fail(statement, "is neither the header nor defineLoop");
    }
  }

  if (imports === undefined || call === undefined) throw new Error("No header or no defineLoop");
  if (!ts.isIdentifier(call.expression) || call.expression.text !== DEFINE_LOOP) {
    fail(call, `is not ${DEFINE_LOOP}`);
  }

  const [slugArgument, optionsArgument] = call.arguments;
  const options = propertiesOf(optionsArgument);
  const edges: RecoveredEdge[] = [];
  const stages = arrayOf(required(options, "stages", call)).map((element) =>
    recoverStage(element, edges),
  );

  return {
    imports,
    slug: stringValue(slugArgument),
    dslVersion: stringValue(required(options, "dsl", call)),
    trigger: recoverTrigger(required(options, "trigger", call)),
    stages,
    edges,
  };
}

/**
 * Recover a file's graph: the stage calls joined with the layout block.
 *
 * @param text - A file the printer wrote.
 * @returns The positions and the edges, in document order, with their labels.
 * @throws {Error} When the layout block is missing or malformed, or disagrees with the stage
 *   calls about which nodes and edges exist.
 */
export function recoverGraph(text: string): WorkflowGraph {
  const recovered = recoverWorkflowCode(text);
  const layout = readLayout(text);

  if (!layout.found || layout.malformed.length > 0) {
    throw new Error(`The layout block is missing or malformed: ${JSON.stringify(layout)}`);
  }
  if (layout.nodes.length !== recovered.stages.length) {
    throw new Error("The layout block and the stage calls disagree about the node count");
  }
  if (layout.edges.length !== recovered.edges.length) {
    throw new Error("The layout block and the stage calls disagree about the edge count");
  }

  const nodes = recovered.stages.map((stage, index) => {
    const position = layout.nodes[index];
    if (position.id !== stage.id) {
      throw new Error(`Layout line ${index + 1} names ${position.id}, the stage is ${stage.id}`);
    }
    return { id: stage.id, callee: stage.callee, x: position.x, y: position.y };
  });

  const edges = layout.edges.map((placed): WorkflowEdge => {
    const edge = recovered.edges.find(
      (candidate) => candidate.from === placed.from && candidate.to === placed.to,
    );
    if (edge === undefined) {
      throw new Error(`The layout names ${placed.from} → ${placed.to}, which no stage declares`);
    }
    return {
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      ...(placed.label === undefined ? {} : { label: placed.label }),
      ...(edge.condition === undefined ? {} : { condition: edge.condition }),
    };
  });

  return { nodes, edges };
}

/**
 * The same shape as {@link recoverGraph}, taken from a document.
 *
 * @param document - The document.
 * @returns Its positions, callees and edges.
 */
export function graphOf(document: WorkflowDocument): WorkflowGraph {
  return {
    nodes: document.nodes.map((node) => ({
      id: node.id,
      callee: calleeFor(node),
      x: node.position.x,
      y: node.position.y,
    })),
    edges: document.edges,
  };
}

/**
 * Read a predicate's arrow function back into its structure.
 *
 * @param node - The arrow function.
 * @returns The predicate.
 * @throws {Error} When the expression is not one of the grammar's predicate spellings.
 */
export function predicateFrom(node: ts.Expression): Predicate {
  if (!ts.isArrowFunction(node)) fail(node, "is not an arrow function");

  if (node.parameters.length === 0) {
    if (node.body.kind === ts.SyntaxKind.TrueKeyword) return { kind: "always" };
    fail(node, "has no parameter and is not () => true");
  }
  if (ts.isBlock(node.body)) fail(node, "has a block body");

  const { subject, method, args } = ticketCall(node.body);

  switch (subject) {
    case "effort":
      return {
        kind: "effort",
        op: inverse(PREDICATE_METHODS.effort, method, node),
        value: effortFrom(args[0], node),
      };
    case "labels":
      return {
        kind: "labels",
        op: inverse(PREDICATE_METHODS.labels, method, node),
        values: stringList(args[0]),
      };
    case "source":
      return {
        kind: "source",
        op: inverse(PREDICATE_METHODS.source, method, node),
        values: stringList(args[0]) as SourceKind[],
      };
    case "checks": {
      const op = inverse(PREDICATE_METHODS.checks, method, node);
      return args.length === 0
        ? { kind: "checks", op }
        : { kind: "checks", op, names: stringList(args[0]) };
    }
    default:
      return fail(node, `reads ${subject}, which is not a predicate kind`);
  }
}

/**
 * Read a trigger's `when` back into its conditions.
 *
 * @param node - The arrow function.
 * @returns The conditions.
 * @throws {Error} When a conjunct is not one of the three trigger conditions.
 */
export function triggerConditionsFrom(node: ts.Expression): TriggerSpec["conditions"] {
  if (!ts.isArrowFunction(node) || node.parameters.length !== 1 || ts.isBlock(node.body)) {
    fail(node, "is not a one-parameter arrow function");
  }

  const conditions: TriggerSpec["conditions"] = {};
  for (const conjunct of conjunctsOf(node.body)) {
    const { subject, method, args } = ticketCall(conjunct);

    if (subject === "effort" && method === "lte") conditions.effort_lte = effortFrom(args[0], node);
    else if (subject === "labels" && method === "all") conditions.labels = stringList(args[0]);
    else if (subject === "source" && method === "is") {
      conditions.source = stringValue(args[0]) as SourceKind;
    } else fail(conjunct, "is not a trigger condition");
  }

  return conditions;
}

/**
 * Recover one stage call, appending the edges it declares.
 *
 * @param element - The array element.
 * @param edges - The edges recovered so far, appended to in place.
 * @returns The stage.
 */
function recoverStage(element: ts.Expression, edges: RecoveredEdge[]): RecoveredStage {
  if (!ts.isCallExpression(element) || !ts.isIdentifier(element.expression)) {
    fail(element, "is not a stage call");
  }

  const [idArgument, optionsArgument] = element.arguments;
  const id = stringValue(idArgument);
  const options = propertiesOf(optionsArgument);
  const stage: RecoveredStage = {
    callee: element.expression.text,
    id,
    optionKeys: [...options.keys()],
    title: stringValue(required(options, "title", element)),
  };

  const description = options.get("description");
  if (description !== undefined) stage.description = stringValue(description);
  const prompt = options.get("prompt");
  if (prompt !== undefined) stage.prompt = stringValue(prompt);
  const requirement = options.get("require");
  if (requirement !== undefined) {
    stage.predicate = { kind: "checks", op: "all_passed", names: stringList(requirement) };
  }
  const when = options.get("when");
  if (when !== undefined) stage.predicate = predicateFrom(when);

  const next = options.get(EDGE_OPTIONS.default);
  if (next !== undefined) {
    const targets = ts.isArrayLiteralExpression(next) ? stringList(next) : [stringValue(next)];
    for (const to of targets) edges.push({ from: id, to, kind: "default" });
  }

  const branches = options.get(EDGE_OPTIONS.branch);
  for (const entry of branches === undefined ? [] : arrayOf(branches)) {
    const properties = propertiesOf(entry);
    edges.push({
      from: id,
      to: stringValue(required(properties, "to", entry)),
      kind: "branch",
      condition: predicateFrom(required(properties, "when", entry)),
    });
  }

  const loops = options.get(EDGE_OPTIONS.loop);
  if (loops !== undefined && !ts.isArrayLiteralExpression(loops)) {
    edges.push({
      from: id,
      to: stringValue(loops),
      kind: "loop",
      condition: { kind: "checks", op: "any_failed" },
    });
  } else if (loops !== undefined) {
    for (const entry of loops.elements) {
      const properties = propertiesOf(entry);
      const edge: RecoveredEdge = {
        from: id,
        to: stringValue(required(properties, "to", entry)),
        kind: "loop",
      };
      const condition = properties.get("when");
      if (condition !== undefined) edge.condition = predicateFrom(condition);
      edges.push(edge);
    }
  }

  return stage;
}

/**
 * Recover `defineLoop`'s `trigger` option.
 *
 * @param node - The option's value.
 * @returns The trigger, as the DSL structures it.
 */
function recoverTrigger(node: ts.Expression): TriggerSpec {
  const options = propertiesOf(node);
  const event = inverse(TRIGGER_EVENTS, stringValue(required(options, "on", node)), node);
  const when = options.get("when");

  return { event, conditions: when === undefined ? {} : triggerConditionsFrom(when) };
}

/**
 * Read `i.<subject>.<method>(…)`.
 *
 * @param node - The call.
 * @returns Its subject, method and arguments.
 */
function ticketCall(node: ts.Expression): {
  subject: string;
  method: string;
  args: readonly ts.Expression[];
} {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    fail(node, "is not a method call");
  }

  const target = node.expression.expression;
  if (
    !ts.isPropertyAccessExpression(target) ||
    !ts.isIdentifier(target.expression) ||
    target.expression.text !== PREDICATE_PARAMETER
  ) {
    fail(node, `is not a call on ${PREDICATE_PARAMETER}`);
  }

  return { subject: target.name.text, method: node.expression.name.text, args: node.arguments };
}

/**
 * Read `effort.<CONSTANT>`.
 *
 * @param node - The argument.
 * @param context - The enclosing node, for the error.
 * @returns The effort value.
 */
function effortFrom(node: ts.Expression | undefined, context: ts.Node): Effort {
  if (
    node === undefined ||
    !ts.isPropertyAccessExpression(node) ||
    !ts.isIdentifier(node.expression) ||
    node.expression.text !== "effort"
  ) {
    return fail(context, "does not compare with an effort constant");
  }

  return inverse(EFFORT_CONSTANTS, node.name.text, node);
}

/**
 * Split `a && b && c` into its conjuncts.
 *
 * @param node - The expression.
 * @returns The conjuncts, left to right.
 */
function conjunctsOf(node: ts.Expression): ts.Expression[] {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return [...conjunctsOf(node.left), node.right];
  }

  return [node];
}

/**
 * Look a spelling up in a grammar table, backwards.
 *
 * @param table - The table: DSL value → spelling.
 * @param spelling - The spelling found in the text.
 * @param node - The node, for the error.
 * @returns The DSL value.
 */
function inverse<K extends string>(
  table: Readonly<Record<K, string>>,
  spelling: string,
  node: ts.Node,
): K {
  const entry = (Object.entries(table) as [K, string][]).find(([, value]) => value === spelling);
  if (entry === undefined) fail(node, `spells ${spelling}, which the grammar does not`);

  return entry[0];
}

/**
 * An object literal's properties, in order.
 *
 * @param node - The object literal.
 * @returns Its `key: value` pairs.
 */
function propertiesOf(node: ts.Node | undefined): Map<string, ts.Expression> {
  if (node === undefined || !ts.isObjectLiteralExpression(node)) {
    return fail(node, "is not an object literal");
  }

  const properties = new Map<string, ts.Expression>();
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
      fail(property, "is not a plain key: value property");
    }
    properties.set(property.name.text, property.initializer);
  }

  return properties;
}

/**
 * A required property's value.
 *
 * @param properties - The object's properties.
 * @param key - The key.
 * @param context - The object's node, for the error.
 * @returns The value.
 */
function required(
  properties: Map<string, ts.Expression>,
  key: string,
  context: ts.Node,
): ts.Expression {
  const value = properties.get(key);
  if (value === undefined) fail(context, `has no ${key}`);

  return value;
}

/**
 * An array literal's elements.
 *
 * @param node - The array literal.
 * @returns Its elements.
 */
function arrayOf(node: ts.Expression): readonly ts.Expression[] {
  if (!ts.isArrayLiteralExpression(node)) fail(node, "is not an array literal");

  return node.elements;
}

/**
 * A string or no-substitution template literal's value.
 *
 * @param node - The literal.
 * @returns Its cooked value.
 */
function stringValue(node: ts.Node | undefined): string {
  if (
    node === undefined ||
    !(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  ) {
    return fail(node, "is not a string literal");
  }

  return node.text;
}

/**
 * An array literal of strings.
 *
 * @param node - The array literal.
 * @returns The strings.
 */
function stringList(node: ts.Node | undefined): string[] {
  if (node === undefined || !ts.isArrayLiteralExpression(node)) {
    return fail(node, "is not an array literal");
  }

  return node.elements.map((element) => stringValue(element));
}

/**
 * Whether an identifier is a property name or a parameter rather than a reference.
 *
 * @param node - The identifier.
 * @returns `true` for `x` in `a.x`, `x: 1` and `(x) => …`.
 */
function isMemberOrParameterName(node: ts.Identifier): boolean {
  const parent = node.parent;

  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node)
  );
}

/**
 * Throw, naming the line a node is on.
 *
 * @param node - The offending node, or `undefined` when the element is missing altogether.
 * @param message - What is wrong with it.
 * @returns Never.
 */
function fail(node: ts.Node | undefined, message: string): never {
  if (node === undefined) throw new Error(`A required element is missing: it ${message}`);

  const { line } = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart());
  throw new Error(`Line ${line + 1}: \`${node.getText()}\` ${message}`);
}
