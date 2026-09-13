/**
 * Reading the grammar's literals out of a TypeScript syntax tree — U.2
 * ([#166](https://github.com/NobuData/ouroboros/issues/166)).
 *
 * The parser is a walk over the tree `ts.createSourceFile` builds, and most of what it reads at
 * each step is one of a handful of spellings: a string, a list of strings, a number, a boolean, an
 * object literal with a fixed set of keys, a name from one of `code.grammar.ts`'s tables. This file
 * is those readings, each written once and each with the same contract:
 *
 * * **It returns the value, or `undefined` having reported why.** Nothing throws. A file with
 *   three mistakes has to report all three, so a failed reading records its error and the walk
 *   carries on with the next sibling.
 * * **It reads syntax and never runs it.** A literal's value is the one the scanner cooked.
 *   Nothing here evaluates an expression, resolves an identifier or loads a module (decision
 *   **C2**), and `code.parser.static.spec.ts` holds the whole parser to that.
 * * **Shape, not semantics.** A reading checks that a value is *spelled* the way the grammar spells
 *   it, a string literal where the grammar writes a string, and not whether the value is allowed.
 *   `retries: 99` reads as `99`, and the shared validator says it is out of range.
 *
 * Every `what` below is a lower-case phrase naming the value — `` `title` ``, `a stage's id` —
 * that the reader places into its messages.
 */

import ts from "typescript";

import { FULL_SDK_HINT, type PendingCodeError, WorkflowCodeErrorCode } from "./code.errors";

/** Something an error can be anchored to: a syntax node, or a range of offsets. */
export type Anchor = ts.Node | { start: number; end: number };

/** Collects errors while a walk reads one file. */
export class CodeReader {
  /** Every error reported so far, in the order it was reported. */
  readonly errors: PendingCodeError[] = [];

  /**
   * @param source - The syntax tree being read, built with parent pointers set.
   */
  constructor(readonly source: ts.SourceFile) {}

  /**
   * Record an error.
   *
   * @param anchor - What it is about.
   * @param code - Which kind of problem it is.
   * @param message - What a person should read.
   * @param hint - Where support would come from, when there is somewhere.
   */
  report(anchor: Anchor, code: WorkflowCodeErrorCode, message: string, hint?: string): void {
    this.errors.push({
      code,
      message,
      ...this.span(anchor),
      ...(hint === undefined ? {} : { hint }),
    });
  }

  /**
   * Record a construct the closed grammar has no spelling for.
   *
   * @param anchor - The construct.
   * @param message - What is unsupported, and what the grammar writes instead.
   */
  outOfGrammar(anchor: Anchor, message: string): void {
    this.report(anchor, WorkflowCodeErrorCode.OUT_OF_GRAMMAR, message, FULL_SDK_HINT);
  }

  /**
   * The offsets an anchor covers, leading trivia excluded.
   *
   * @param anchor - A syntax node or a range.
   * @returns Its start and end offsets.
   */
  span(anchor: Anchor): { start: number; end: number } {
    if (!("kind" in anchor)) return { start: anchor.start, end: anchor.end };

    // A node the compiler invented to recover from a syntax error is empty, and its end can sit
    // before the start `getStart` finds by skipping trivia. An error on it is an empty range.
    const start = anchor.getStart(this.source);
    return { start, end: Math.max(start, anchor.getEnd()) };
  }

  /**
   * Read a string: a double- or single-quoted literal, or a template literal with no `${…}`.
   *
   * @param node - The value.
   * @param what - What the value is, for the message.
   * @returns The string, or `undefined` when it is spelled some other way.
   */
  string(node: ts.Expression, what: string): string | undefined {
    const value = unwrap(node);

    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;

    this.outOfGrammar(
      value,
      ts.isTemplateExpression(value)
        ? `${sentence(what)} is plain text: a \`\${…}\` substitution is code, and nothing here runs.`
        : `${sentence(what)} is written as a string literal, like "text".`,
    );
    return undefined;
  }

  /**
   * Read a list of strings: `["build", "test"]`.
   *
   * Every element is read, so each one spelled wrongly is reported.
   *
   * @param node - The value.
   * @param what - What the list is, for the message.
   * @returns The strings, or `undefined` when the value or any element is spelled some other way.
   */
  strings(node: ts.Expression, what: string): string[] | undefined {
    const elements = this.array(node, what);
    if (elements === undefined) return undefined;

    const values = elements.map((element) => this.string(element, `each entry of ${what}`));
    return values.every((value) => value !== undefined) ? values : undefined;
  }

  /**
   * Read a number: a numeric literal, optionally negated.
   *
   * The scanner's own value, so `400_000`, `0x10` and `1e3` all read as the numbers they spell.
   *
   * @param node - The value.
   * @param what - What the number is, for the message.
   * @returns The number, or `undefined` when it is spelled some other way.
   */
  number(node: ts.Expression, what: string): number | undefined {
    const value = unwrap(node);

    if (ts.isNumericLiteral(value)) return Number(value.text);
    if (
      ts.isPrefixUnaryExpression(value) &&
      value.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(value.operand)
    ) {
      return -Number(value.operand.text);
    }

    this.outOfGrammar(value, `${sentence(what)} is written as a number literal, like 2.`);
    return undefined;
  }

  /**
   * Read a boolean: `true` or `false`.
   *
   * @param node - The value.
   * @param what - What the flag is, for the message.
   * @returns The boolean, or `undefined` when it is spelled some other way.
   */
  boolean(node: ts.Expression, what: string): boolean | undefined {
    const value = unwrap(node);

    if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (value.kind === ts.SyntaxKind.FalseKeyword) return false;

    this.outOfGrammar(value, `${sentence(what)} is written as true or false.`);
    return undefined;
  }

  /**
   * Read an array literal's elements.
   *
   * @param node - The value.
   * @param what - What the list is, for the message.
   * @returns The elements, or `undefined` when the value is not an array literal.
   */
  array(node: ts.Expression, what: string): readonly ts.Expression[] | undefined {
    const value = unwrap(node);
    if (ts.isArrayLiteralExpression(value)) return value.elements;

    this.outOfGrammar(value, `${sentence(what)} is written as a list in square brackets.`);
    return undefined;
  }

  /**
   * Read an object literal whose keys come from a fixed set.
   *
   * Every property is checked. A key outside the set, a key written twice, and anything that is
   * not a plain `key: value` pair (a shorthand, a spread, a method, a computed key) are each
   * reported, and the remaining properties are still returned so their values can be read too.
   *
   * @param node - The value.
   * @param what - What the object is, for the message — `` `llm("plan", …)` ``.
   * @param keys - The keys it may carry, in the order the grammar writes them.
   * @returns Its valid properties in source order, or `undefined` when it is not an object
   *   literal.
   */
  object(
    node: ts.Expression,
    what: string,
    keys: readonly string[],
  ): Map<string, ts.Expression> | undefined {
    const value = unwrap(node);

    if (!ts.isObjectLiteralExpression(value)) {
      this.outOfGrammar(
        value,
        `${sentence(what)} is written as an object literal: { key: value, … }.`,
      );
      return undefined;
    }

    const properties = new Map<string, ts.Expression>();

    for (const property of value.properties) {
      const key = ts.isPropertyAssignment(property) ? propertyName(property.name) : undefined;

      if (!ts.isPropertyAssignment(property) || key === undefined) {
        this.outOfGrammar(
          property,
          `${sentence(what)} holds only plain \`key: value\` properties.`,
        );
      } else if (!keys.includes(key)) {
        this.outOfGrammar(
          property.name,
          `\`${key}\` is not an option of ${what}. It takes ${list(keys.map(code))}.`,
        );
      } else if (properties.has(key)) {
        this.outOfGrammar(property.name, `\`${key}\` is written twice in ${what}.`);
      } else {
        properties.set(key, property.initializer);
      }
    }

    return properties;
  }

  /**
   * Look a spelling up in one of the grammar's tables, backwards.
   *
   * @param table - The table: the document's value → the code's spelling.
   * @param spelling - The spelling found in the text.
   * @param anchor - What to report on when the spelling is not in the table.
   * @param what - What the spelling should name, for the message — `an effort constant`.
   * @param show - How to show a spelling in the message.
   * @returns The document's value, or `undefined` when the table has no such spelling.
   */
  name<K extends string>(
    table: Readonly<Record<K, string>>,
    spelling: string,
    anchor: Anchor,
    what: string,
    show: (spelling: string) => string = code,
  ): K | undefined {
    for (const [value, candidate] of Object.entries(table) as [K, string][]) {
      if (candidate === spelling) return value;
    }

    const known = Object.values<string>(table).map(show);
    this.outOfGrammar(
      anchor,
      `${show(spelling)} is not ${what}. The grammar has ${list(known, "or")}.`,
    );
    return undefined;
  }
}

/**
 * Strip the parentheses around an expression, however many there are.
 *
 * `(x)` spells the same value as `x`, so reformatting a file never changes what it means.
 *
 * @param node - The expression.
 * @returns The expression inside every layer of parentheses.
 */
export function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

/**
 * A property's key, when it is one the grammar can read.
 *
 * @param name - The property name.
 * @returns The key for an identifier or a string-literal key (`title` or `"title"`), or
 *   `undefined` for a computed, numeric or private name.
 */
export function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/**
 * A copy of an object without its absent members.
 *
 * A reading that found nothing leaves `undefined`, and a JSON document has no such value:
 * `{ description: undefined }` and `{}` compare unequal, and only the second is the document.
 *
 * @param value - The object.
 * @returns A new object holding every member whose value is not `undefined`, in the same order.
 */
export function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, member]) => member !== undefined));
}

/**
 * Join words for a message: `a`, `a and b`, `a, b and c`.
 *
 * @param words - The words, already formatted.
 * @param conjunction - The last separator's word.
 * @returns The phrase.
 */
export function list(words: readonly string[], conjunction = "and"): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} ${conjunction} ${words[words.length - 1]}`;
}

/**
 * Show a name as inline code: `` `title` ``.
 *
 * @param text - The name.
 * @returns It, in backticks.
 */
export function code(text: string): string {
  return `\`${text}\``;
}

/**
 * Upper-case the first letter of a phrase, so it can open a message.
 *
 * @param phrase - The phrase. One starting with punctuation, such as a backtick, is unchanged.
 * @returns The phrase as the start of a sentence.
 */
export function sentence(phrase: string): string {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}
