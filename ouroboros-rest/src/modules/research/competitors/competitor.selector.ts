/**
 * The CSS selectors a watch scopes its diff with — a deliberately small subset, parsed and
 * matched here (CL.3, [#616](https://github.com/NobuData/ouroboros/issues/616)).
 *
 * A watch's selector exists to keep navigation, banners and dated footers out of the diff, so
 * what it needs is the part of CSS that names a region of a page:
 *
 * ```
 * main .release-list        descendant          article.release        type and class
 * #changelog > section      child               [data-section=notes]  attribute (= ~= ^= $= *=)
 * main, aside.notes         a list — every region, in document order
 * ```
 *
 * Pseudo-classes (`:nth-child`), sibling combinators and XPath are refused when the watch is
 * saved, with a sentence saying so, rather than accepted and matched wrongly. Matching is over a
 * {@link SelectorNode}, so this file knows nothing about how the page was parsed.
 */

/** One attribute test. */
export interface AttributeTest {
  readonly name: string;
  /** `=` exact, `~=` one of the words, `^=` prefix, `$=` suffix, `*=` substring; null for presence. */
  readonly operator: "=" | "~=" | "^=" | "$=" | "*=" | null;
  readonly value: string;
}

/** A compound selector — `article.release[data-kind=notes]`. */
export interface CompoundSelector {
  /** The element name, lower-cased; null for any (`*` or omitted). */
  readonly tag: string | null;
  readonly ids: readonly string[];
  readonly classes: readonly string[];
  readonly attributes: readonly AttributeTest[];
}

/** A complex selector: compounds joined by combinators, left to right. */
export interface ComplexSelector {
  readonly compounds: readonly CompoundSelector[];
  /** `combinators[i]` joins `compounds[i]` and `compounds[i + 1]`: `" "` descendant, `">"` child. */
  readonly combinators: readonly (" " | ">")[];
}

/** A parsed selector list. */
export type SelectorList = readonly ComplexSelector[];

/** A selector the tracker does not accept, with the sentence that says why. */
export class SelectorError extends Error {
  /** @param message - What is wrong, for a person. */
  constructor(message: string) {
    super(message);
    this.name = "SelectorError";
  }
}

/** What matching needs to know about an element. */
export interface SelectorNode {
  /** Its name, lower-cased. */
  readonly tag: string;
  /** An attribute's value, or null when it has none. */
  attribute(name: string): string | null;
  /** Its parent element, or null at the top. */
  readonly parent: SelectorNode | null;
}

/** The longest selector a watch may carry — V112's `competitor_watches_selector_present`. */
export const MAX_SELECTOR_LENGTH = 500;

const IDENT = /^-?[_a-zA-Z][_a-zA-Z0-9-]*/;

/**
 * Parse a watch's selector.
 *
 * @param text - The selector, as the administrator typed it.
 * @returns The selector list.
 * @throws {SelectorError} For anything outside the subset, naming what was found.
 */
export function parseSelector(text: string): SelectorList {
  const source = text.trim();

  if (source === "") throw new SelectorError("the selector is blank");
  if (source.length > MAX_SELECTOR_LENGTH) {
    throw new SelectorError(
      `the selector is longer than ${String(MAX_SELECTOR_LENGTH)} characters`,
    );
  }
  if (source.startsWith("/") || source.startsWith("(")) {
    throw new SelectorError("XPath is not supported — write the region as a CSS selector");
  }

  return splitTopLevel(source).map((part) => parseComplex(part.trim()));
}

/**
 * Whether an element matches a selector list.
 *
 * @param selector - The parsed list.
 * @param node - The element.
 * @returns `true` when any complex selector in the list matches it.
 */
export function matchesSelector(selector: SelectorList, node: SelectorNode): boolean {
  return selector.some((complex) => matchesComplex(complex, complex.compounds.length - 1, node));
}

function splitTopLevel(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(source.slice(start));

  if (parts.some((part) => part.trim() === "")) {
    throw new SelectorError("the selector list has an empty entry");
  }
  return parts;
}

function parseComplex(source: string): ComplexSelector {
  const compounds: CompoundSelector[] = [];
  const combinators: (" " | ">")[] = [];
  let rest = source;
  let pending: " " | ">" | null = null;

  while (rest !== "") {
    const whitespace = /^\s+/.exec(rest);

    if (whitespace !== null) {
      rest = rest.slice(whitespace[0].length);
      if (pending === null && compounds.length > 0) pending = " ";
      continue;
    }

    if (rest.startsWith(">")) {
      if (compounds.length === 0 || pending === ">") {
        throw new SelectorError("a `>` must sit between two parts of the selector");
      }
      pending = ">";
      rest = rest.slice(1);
      continue;
    }

    if (rest.startsWith("+") || rest.startsWith("~")) {
      throw new SelectorError("sibling combinators (`+`, `~`) are not supported");
    }

    const [compound, after] = parseCompound(rest);

    if (compounds.length > 0) combinators.push(pending ?? " ");
    compounds.push(compound);
    pending = null;
    rest = after;
  }

  if (pending === ">") throw new SelectorError("the selector ends with `>`");
  if (compounds.length === 0) throw new SelectorError("the selector names nothing");

  return { compounds, combinators };
}

function parseCompound(source: string): [CompoundSelector, string] {
  let rest = source;
  let tag: string | null = null;
  const ids: string[] = [];
  const classes: string[] = [];
  const attributes: AttributeTest[] = [];

  if (rest.startsWith("*")) {
    rest = rest.slice(1);
  } else {
    const name = IDENT.exec(rest);
    if (name !== null) {
      tag = name[0].toLowerCase();
      rest = rest.slice(name[0].length);
    }
  }

  for (;;) {
    if (rest.startsWith("#") || rest.startsWith(".")) {
      const name = IDENT.exec(rest.slice(1));
      if (name === null) throw new SelectorError(`\`${rest[0]}\` must be followed by a name`);
      (rest.startsWith("#") ? ids : classes).push(name[0]);
      rest = rest.slice(1 + name[0].length);
      continue;
    }
    if (rest.startsWith("[")) {
      const [test, after] = parseAttribute(rest);
      attributes.push(test);
      rest = after;
      continue;
    }
    if (rest.startsWith(":")) {
      throw new SelectorError("pseudo-classes such as `:nth-child` are not supported");
    }
    break;
  }

  if (tag === null && ids.length === 0 && classes.length === 0 && attributes.length === 0) {
    if (source.startsWith("*")) return [{ tag: null, ids, classes, attributes }, rest];
    throw new SelectorError(`unexpected \`${source[0]}\` in the selector`);
  }
  if (rest !== "" && !/^[\s>+~]/.test(rest)) {
    throw new SelectorError(`unexpected \`${rest[0]}\` in the selector`);
  }

  return [{ tag, ids, classes, attributes }, rest];
}

function parseAttribute(source: string): [AttributeTest, string] {
  const match =
    /^\[\s*([_a-zA-Z][_a-zA-Z0-9:-]*)\s*(?:(=|~=|\^=|\$=|\*=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]"']+)))?\s*\]/.exec(
      source,
    );

  if (match === null)
    throw new SelectorError("an attribute test must read like `[name]` or `[name=value]`");

  const [whole, name, operator, doubleQuoted, singleQuoted, bare] = match;

  return [
    {
      name: name.toLowerCase(),
      operator: (operator as AttributeTest["operator"] | undefined) ?? null,
      value: doubleQuoted ?? singleQuoted ?? bare ?? "",
    },
    source.slice(whole.length),
  ];
}

function matchesComplex(complex: ComplexSelector, index: number, node: SelectorNode): boolean {
  if (!matchesCompound(complex.compounds[index], node)) return false;
  if (index === 0) return true;

  const combinator = complex.combinators[index - 1];

  if (combinator === ">") {
    return node.parent !== null && matchesComplex(complex, index - 1, node.parent);
  }

  for (let ancestor = node.parent; ancestor !== null; ancestor = ancestor.parent) {
    if (matchesComplex(complex, index - 1, ancestor)) return true;
  }
  return false;
}

function matchesCompound(compound: CompoundSelector, node: SelectorNode): boolean {
  if (compound.tag !== null && compound.tag !== node.tag) return false;

  const id = node.attribute("id");
  if (compound.ids.some((wanted) => id !== wanted)) return false;

  const classes = (node.attribute("class") ?? "").split(/\s+/).filter((name) => name !== "");
  if (compound.classes.some((wanted) => !classes.includes(wanted))) return false;

  return compound.attributes.every((test) => matchesAttribute(test, node.attribute(test.name)));
}

function matchesAttribute(test: AttributeTest, actual: string | null): boolean {
  if (actual === null) return false;

  switch (test.operator) {
    case null:
      return true;
    case "=":
      return actual === test.value;
    case "~=":
      return actual.split(/\s+/).includes(test.value);
    case "^=":
      return test.value !== "" && actual.startsWith(test.value);
    case "$=":
      return test.value !== "" && actual.endsWith(test.value);
    case "*=":
      return test.value !== "" && actual.includes(test.value);
  }
}
