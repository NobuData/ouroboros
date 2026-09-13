/**
 * Predicates, read back from their arrow functions — U.2
 * ([#166](https://github.com/NobuData/ouroboros/issues/166)).
 *
 * `code.predicates.ts` spells every structured predicate (decision **P8**) as exactly one arrow
 * function, and this file reads that table backwards:
 *
 * | Spelling | Structure |
 * |---|---|
 * | `() => true` | `{kind: "always"}` |
 * | `(i) => i.effort.<op>(effort.<VALUE>)` | `{kind: "effort", op, value}` |
 * | `(i) => i.labels.<op>([...])` | `{kind: "labels", op, values}` |
 * | `(i) => i.source.<in \| notIn>([...])` | `{kind: "source", op, values}` |
 * | `(i) => i.checks.<allPassed \| anyFailed>([...]?)` | `{kind: "checks", op, names?}` |
 *
 * A trigger's `when` is the same reading applied to each side of `&&`.
 *
 * **The arrow is read as syntax.** Nothing calls it, and no identifier in it is resolved: `i` is
 * the parameter's *name*, and `effort.M` is two words the grammar knows. So the arrow's body must
 * be exactly one of these shapes. `&&` and `||` inside a predicate, a block body, a second
 * parameter or a type annotation are `code_out_of_grammar`, because the structures are flat
 * (docs/WORKFLOW_DSL.md §5) and a spelling with no structure behind it cannot be read back.
 *
 * **Accepted and normalised.** Parentheses anywhere, a parameter under another name, `i =>` without
 * parentheses, and `(i) => true` for `always`: each spells the same structure as the canonical
 * form, and the next print writes the canonical form.
 */

import ts from "typescript";

import { EFFORT_CONSTANTS, PREDICATE_METHODS, TRIGGER_CONDITION_METHODS } from "./code.grammar";
import { type CodeReader, code, list, sentence, unwrap } from "./code.reader";

/** A predicate or a trigger's conditions, as read: JSON-shaped, not yet validated. */
export type ReadValue = Record<string, unknown>;

/** The object every effort constant is a property of. */
const EFFORT = "effort";

/** The canonical example the messages point at. */
const EXAMPLE = "(i) => i.effort.lte(effort.M)";

/** What a predicate may read off the ticket, as a table `reader.name` can look up. */
const SUBJECTS = Object.fromEntries(
  Object.keys(PREDICATE_METHODS).map((subject) => [subject, subject]),
) as Record<keyof typeof PREDICATE_METHODS, string>;

/** How each predicate kind's test is called, for the arity message. */
const PREDICATE_USAGE = {
  effort: "one effort constant, like i.effort.lte(effort.M)",
  labels: 'one list of labels, like i.labels.any(["regression"])',
  source: 'one list of sources, like i.source.in(["github"])',
  checks: 'no argument, or one list of check names, like i.checks.allPassed(["build"])',
} as const satisfies Record<keyof typeof PREDICATE_METHODS, string>;

/** How each trigger condition is called, for the arity message. */
const CONDITION_USAGE = {
  effort_lte: "one effort constant, like i.effort.lte(effort.M)",
  labels: 'one list of labels, like i.labels.all(["bug"])',
  source: 'one source, like i.source.is("github")',
} as const;

/** An arrow function the grammar can read: its parameter's name, if any, and its body. */
interface ReadArrow {
  /** The parameter's name, or `undefined` for `() => …`. */
  parameter?: string;
  /** The body, parentheses stripped. */
  body: ts.Expression;
}

/** One `i.<subject>.<method>(…)` call. */
interface TicketCall {
  /** The whole call. */
  call: ts.CallExpression;
  /** What it reads — `effort`, `labels`, … */
  subject: string;
  /** The subject's name node, for errors. */
  subjectName: ts.Identifier;
  /** The test it calls — `lte`, `any`, … */
  method: string;
  /** The method's name node, for errors. */
  methodName: ts.Identifier;
  /** The call's arguments. */
  args: readonly ts.Expression[];
  /** `i.effort.lte`, for messages. */
  path: string;
}

/**
 * Read a flow node's predicate, or an edge's condition.
 *
 * @param reader - The walk's reader, which collects any error.
 * @param node - The arrow function.
 * @returns The structured predicate, or `undefined` having reported why.
 */
export function readPredicate(reader: CodeReader, node: ts.Expression): ReadValue | undefined {
  const arrow = readArrow(reader, node, "a predicate");
  if (arrow === undefined) return undefined;
  if (arrow.body.kind === ts.SyntaxKind.TrueKeyword) return { kind: "always" };

  const { parameter } = arrow;
  if (parameter === undefined) {
    reader.outOfGrammar(
      arrow.body,
      `A predicate with no parameter is \`() => true\`. Any other test reads the ticket, like ${EXAMPLE}.`,
    );
    return undefined;
  }

  const call = readTicketCall(reader, arrow.body, parameter, "a predicate");
  if (call === undefined) return undefined;

  const kind = reader.name(
    SUBJECTS,
    call.subject,
    call.subjectName,
    "something a predicate reads",
    (subject) => code(`${parameter}.${subject}`),
  );
  if (kind === undefined) return undefined;

  const op = reader.name<string>(
    PREDICATE_METHODS[kind],
    call.method,
    call.methodName,
    `a test on \`${parameter}.${kind}\``,
    (method) => code(`.${method}()`),
  );
  const fits = hasArity(reader, call, kind === "checks" ? [0, 1] : [1], PREDICATE_USAGE[kind]);
  if (op === undefined || !fits) return undefined;

  switch (kind) {
    case "effort": {
      const value = readEffort(reader, call.args[0]);
      return value === undefined ? undefined : { kind, op, value };
    }
    case "labels":
    case "source": {
      const values = reader.strings(
        call.args[0],
        `the ${kind === "labels" ? "labels" : "sources"} \`${call.path}\` tests`,
      );
      return values === undefined ? undefined : { kind, op, values };
    }
    case "checks": {
      if (call.args.length === 0) return { kind, op };
      const names = reader.strings(call.args[0], `the checks \`${call.path}\` names`);
      return names === undefined ? undefined : { kind, op, names };
    }
  }
}

/**
 * Read a trigger's `when` into its conditions.
 *
 * The conjuncts may come in any order, and are returned in the grammar's order. Each condition may
 * appear once, because a document holds each condition once.
 *
 * @param reader - The walk's reader, which collects any error.
 * @param node - The arrow function.
 * @returns The conditions, or `undefined` having reported why. `(i) => true` reads as no
 *   conditions, which the printer writes by leaving `when` out.
 */
export function readTriggerConditions(
  reader: CodeReader,
  node: ts.Expression,
): ReadValue | undefined {
  const arrow = readArrow(reader, node, "the trigger's `when`");
  if (arrow === undefined) return undefined;
  if (arrow.body.kind === ts.SyntaxKind.TrueKeyword) return {};

  const { parameter } = arrow;
  if (parameter === undefined) {
    reader.outOfGrammar(
      arrow.body,
      `The trigger's \`when\` reads the ticket, like ${EXAMPLE}. A trigger with no conditions leaves \`when\` out.`,
    );
    return undefined;
  }

  const read = new Map<string, unknown>();
  let complete = true;

  for (const conjunct of conjunctsOf(arrow.body)) {
    const value = readCondition(reader, conjunct, parameter, read);
    if (value === undefined) complete = false;
    else read.set(value.condition, value.value);
  }

  if (!complete) return undefined;

  const conditions: ReadValue = {};
  for (const [condition] of TRIGGER_CONDITION_METHODS) {
    if (read.has(condition)) conditions[condition] = read.get(condition);
  }
  return conditions;
}

/**
 * Read one conjunct of a trigger's `when`.
 *
 * @param reader - The walk's reader.
 * @param conjunct - The conjunct.
 * @param parameter - The arrow's parameter name.
 * @param read - The conditions read so far, to catch a repeat.
 * @returns The condition's name and value, or `undefined` having reported why.
 */
function readCondition(
  reader: CodeReader,
  conjunct: ts.Expression,
  parameter: string,
  read: ReadonlyMap<string, unknown>,
): { condition: string; value: unknown } | undefined {
  const call = readTicketCall(
    reader,
    conjunct,
    parameter,
    "each condition of the trigger's `when`",
  );
  if (call === undefined) return undefined;

  const row = TRIGGER_CONDITION_METHODS.find(
    ([, subject, method]) => subject === call.subject && method === call.method,
  );
  if (row === undefined) {
    const known = TRIGGER_CONDITION_METHODS.map(([, subject, method]) =>
      code(`${parameter}.${subject}.${method}(…)`),
    );
    reader.outOfGrammar(
      call.call,
      `\`${call.path}(…)\` is not a trigger condition. A trigger's \`when\` joins ${list(known, "and")} with \`&&\`.`,
    );
    return undefined;
  }

  const [condition] = row;
  if (read.has(condition)) {
    reader.outOfGrammar(
      call.call,
      `The trigger's \`when\` states its ${condition} condition twice.`,
    );
    return undefined;
  }
  if (!hasArity(reader, call, [1], CONDITION_USAGE[condition])) return undefined;

  const [argument] = call.args;
  const value =
    condition === "effort_lte"
      ? readEffort(reader, argument)
      : condition === "labels"
        ? reader.strings(argument, "the labels a trigger requires")
        : reader.string(argument, "the source a trigger requires");

  return value === undefined ? undefined : { condition, value };
}

/**
 * Read an arrow function's head, refusing everything but `() => …` and `(name) => …`.
 *
 * @param reader - The walk's reader.
 * @param node - The expression.
 * @param what - What the arrow is, for the message.
 * @returns The parameter's name and the body, or `undefined` having reported why.
 */
function readArrow(reader: CodeReader, node: ts.Expression, what: string): ReadArrow | undefined {
  const value = unwrap(node);
  const opening = sentence(what);

  if (!ts.isArrowFunction(value)) {
    reader.outOfGrammar(value, `${opening} is an arrow function, like ${EXAMPLE}.`);
    return undefined;
  }
  if (
    (value.modifiers?.length ?? 0) > 0 ||
    value.typeParameters !== undefined ||
    value.type !== undefined
  ) {
    reader.outOfGrammar(
      value,
      `${opening} is a plain arrow function: no \`async\`, type parameters or return type.`,
    );
    return undefined;
  }
  if (value.parameters.length > 1) {
    reader.outOfGrammar(
      value.parameters[1],
      `${opening} reads one ticket, so it has one parameter at most.`,
    );
    return undefined;
  }

  const [declared] = value.parameters;
  if (
    declared !== undefined &&
    (!ts.isIdentifier(declared.name) ||
      declared.type !== undefined ||
      declared.initializer !== undefined ||
      declared.dotDotDotToken !== undefined ||
      declared.questionToken !== undefined ||
      (declared.modifiers?.length ?? 0) > 0)
  ) {
    reader.outOfGrammar(declared, `${opening}'s parameter is a plain name, like \`(i)\`.`);
    return undefined;
  }
  if (ts.isBlock(value.body)) {
    reader.outOfGrammar(
      value.body,
      `${opening}'s body is one expression, not a block of statements.`,
    );
    return undefined;
  }

  const parameter =
    declared !== undefined && ts.isIdentifier(declared.name) ? declared.name.text : undefined;
  return { parameter, body: unwrap(value.body) };
}

/**
 * Read `<parameter>.<subject>.<method>(…)`.
 *
 * @param reader - The walk's reader.
 * @param node - The expression, parentheses stripped.
 * @param parameter - The name the arrow gave the ticket.
 * @param what - What the expression is, for the message.
 * @returns The call's parts, or `undefined` having reported why.
 */
function readTicketCall(
  reader: CodeReader,
  node: ts.Expression,
  parameter: string,
  what: string,
): TicketCall | undefined {
  const opening = sentence(what);

  if (ts.isBinaryExpression(node)) {
    reader.outOfGrammar(
      node.operatorToken,
      `${opening} is one test on the ticket, and \`${node.operatorToken.getText(reader.source)}\` is not part of the grammar here.`,
    );
    return undefined;
  }

  if (
    ts.isCallExpression(node) &&
    node.questionDotToken === undefined &&
    node.typeArguments === undefined &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.questionDotToken === undefined &&
    ts.isIdentifier(node.expression.name)
  ) {
    const target = node.expression.expression;

    if (
      ts.isPropertyAccessExpression(target) &&
      target.questionDotToken === undefined &&
      ts.isIdentifier(target.name) &&
      ts.isIdentifier(target.expression) &&
      target.expression.text === parameter
    ) {
      return {
        call: node,
        subject: target.name.text,
        subjectName: target.name,
        method: node.expression.name.text,
        methodName: node.expression.name,
        args: node.arguments,
        path: `${parameter}.${target.name.text}.${node.expression.name.text}`,
      };
    }
  }

  reader.outOfGrammar(
    node,
    `${opening} reads the ticket as \`${parameter}.<field>.<test>(…)\`, like ${EXAMPLE}.`,
  );
  return undefined;
}

/**
 * Check a ticket call's argument count.
 *
 * @param reader - The walk's reader.
 * @param call - The call.
 * @param counts - The argument counts the test takes.
 * @param usage - How it is called, for the message.
 * @returns `true` when the count is one of `counts`.
 */
function hasArity(
  reader: CodeReader,
  call: TicketCall,
  counts: readonly number[],
  usage: string,
): boolean {
  if (counts.includes(call.args.length)) return true;

  reader.outOfGrammar(call.call, `\`${call.path}\` takes ${usage}.`);
  return false;
}

/**
 * Read `effort.<CONSTANT>`.
 *
 * @param reader - The walk's reader.
 * @param node - The argument.
 * @returns The DSL's effort value, or `undefined` having reported why.
 */
function readEffort(reader: CodeReader, node: ts.Expression): string | undefined {
  const value = unwrap(node);
  const show = (constant: string) => code(`${EFFORT}.${constant}`);

  if (
    ts.isPropertyAccessExpression(value) &&
    value.questionDotToken === undefined &&
    ts.isIdentifier(value.expression) &&
    value.expression.text === EFFORT &&
    ts.isIdentifier(value.name)
  ) {
    return reader.name(EFFORT_CONSTANTS, value.name.text, value, "an effort constant", show);
  }

  const constants = list(Object.values<string>(EFFORT_CONSTANTS).map(show), "or");
  reader.outOfGrammar(value, `An effort is compared with a constant: ${constants}.`);
  return undefined;
}

/**
 * Split `a && b && c` into its conjuncts, however it is parenthesised.
 *
 * A loop rather than recursion: `&&` nests to the left, so a trigger of thousands of conjuncts is a
 * tree thousands of levels deep, and reading it must not exhaust the stack.
 *
 * @param node - The expression.
 * @returns The conjuncts, left to right, parentheses stripped.
 */
function conjunctsOf(node: ts.Expression): ts.Expression[] {
  const conjuncts: ts.Expression[] = [];
  const pending = [node];

  while (pending.length > 0) {
    const value = unwrap(pending.pop() as ts.Expression);

    if (
      ts.isBinaryExpression(value) &&
      value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      pending.push(value.right, value.left);
    } else {
      conjuncts.push(value);
    }
  }

  return conjuncts;
}
