/**
 * Predicates as arrow functions — U.1
 * ([#165](https://github.com/NobuData/ouroboros/issues/165)).
 *
 * Decision **P8** made predicates structured data, never free code, and mockup 05 writes them as
 * code anyway: `when: (i) => i.effort.lte(effort.M)`. The two are reconciled by making the
 * rendering a **bijection** rather than a conversion — every structured predicate has exactly
 * one spelling, and every spelling the grammar admits names exactly one structure — so the
 * parser (#166) recovers `{kind: "effort", op: "lte", value: "m"}` rather than a guess at it.
 *
 * | Structure | Spelling |
 * |---|---|
 * | `{kind: "always"}` | `() => true` |
 * | `{kind: "effort", op, value}` | `(i) => i.effort.<op>(effort.<VALUE>)` |
 * | `{kind: "labels", op, values}` | `(i) => i.labels.<op>([...])` |
 * | `{kind: "source", op, values}` | `(i) => i.source.<in \| notIn>([...])` |
 * | `{kind: "checks", op, names?}` | `(i) => i.checks.<allPassed \| anyFailed>([...]?)` |
 *
 * The arrow is a *spelling*, not a function anybody calls: nothing in the code-view path
 * evaluates it (decision C2), and the parser reads it as syntax.
 */

import {
  EFFORT_CONSTANTS,
  PREDICATE_METHODS,
  PREDICATE_PARAMETER,
  TRIGGER_CONDITION_METHODS,
} from "./code.grammar";
import { quoteString, stringArray } from "./code.literals";
import type { Effort, Predicate, TriggerSpec } from "./dsl.schema";

/** The arrow-function head every predicate that reads the ticket starts with. */
const ARROW = `(${PREDICATE_PARAMETER}) => `;

/**
 * Spell an effort value as its constant: `effort.M`.
 *
 * @param value - The DSL's effort value.
 * @returns The constant expression.
 */
export function effortConstant(value: Effort): string {
  return `effort.${EFFORT_CONSTANTS[value]}`;
}

/**
 * Spell a flow node's predicate or an edge's condition.
 *
 * @param predicate - A predicate the validator accepted.
 * @returns The arrow-function expression.
 */
export function printPredicate(predicate: Predicate): string {
  const subject = `${PREDICATE_PARAMETER}.${predicate.kind}`;

  switch (predicate.kind) {
    case "always":
      return "() => true";
    case "effort":
      return `${ARROW}${subject}.${PREDICATE_METHODS.effort[predicate.op]}(${effortConstant(predicate.value)})`;
    case "labels":
      return `${ARROW}${subject}.${PREDICATE_METHODS.labels[predicate.op]}(${stringArray(predicate.values)})`;
    case "source":
      return `${ARROW}${subject}.${PREDICATE_METHODS.source[predicate.op]}(${stringArray(predicate.values)})`;
    case "checks": {
      const names = predicate.names === undefined ? "" : stringArray(predicate.names);
      return `${ARROW}${subject}.${PREDICATE_METHODS.checks[predicate.op]}(${names})`;
    }
  }
}

/**
 * Spell a trigger's conditions as its `when`, or say there is none.
 *
 * The conditions are conjuncts in {@link TRIGGER_CONDITION_METHODS}' fixed order, joined with
 * `&&`: `(i) => i.effort.lte(effort.S) && i.labels.all(["docs"])`. An empty `conditions` has no
 * spelling, and `when` is then left out of the trigger entirely — the DSL's *every occurrence of
 * the event*, said by saying nothing rather than by `() => true`, which would be a second
 * spelling of the same document.
 *
 * @param conditions - The trigger's conditions.
 * @returns The arrow-function expression, or `undefined` when there are no conditions.
 */
export function printTriggerWhen(conditions: TriggerSpec["conditions"]): string | undefined {
  const conjuncts: string[] = [];

  for (const [condition, subject, method] of TRIGGER_CONDITION_METHODS) {
    const call = `${PREDICATE_PARAMETER}.${subject}.${method}`;

    if (condition === "effort_lte" && conditions.effort_lte !== undefined) {
      conjuncts.push(`${call}(${effortConstant(conditions.effort_lte)})`);
    } else if (condition === "labels" && conditions.labels !== undefined) {
      conjuncts.push(`${call}(${stringArray(conditions.labels)})`);
    } else if (condition === "source" && conditions.source !== undefined) {
      conjuncts.push(`${call}(${quoteString(conditions.source)})`);
    }
  }

  return conjuncts.length === 0 ? undefined : `${ARROW}${conjuncts.join(" && ")}`;
}

/**
 * Whether a predicate uses an `effort.X` constant, which decides whether the header imports
 * `effort`.
 *
 * @param predicate - A predicate, or `undefined` for an edge that carries none.
 * @returns `true` for an effort comparison.
 */
export function usesEffort(predicate: Predicate | undefined): boolean {
  return predicate?.kind === "effort";
}
