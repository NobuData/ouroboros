import { HighlightStyle, StreamLanguage, type StreamParser, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";

/**
 * The workflow DSL as a CodeMirror language — V.2
 * ([#170](https://github.com/NobuData/ouroboros/issues/170)).
 *
 * The grammar is U.1's (`docs/WORKFLOW_CODE_DSL.md`), a closed subset of TypeScript, and what a
 * highlighter needs from it is small: the five token classes mockup 05 colours — keywords,
 * strings, numbers, callees and comments (`c-kw`, `c-str`, `c-num`, `c-fn`, `c-cm`). Everything
 * else — option names, `effort.M`, punctuation — is ink, exactly as the mockup draws it.
 *
 * ### A stream parser, not a Lezer grammar
 *
 * A generated Lezer grammar would build a syntax tree nothing in the page reads: the parse that
 * matters is the service's (`PUT /code`, V.4), which is the one that can refuse a file. A stream
 * parser tokenises line by line with a few bytes of state — whether a template-literal prompt or a
 * block comment is still open — needs no build step and no generator dependency, and is re-run
 * only from the edited line onward, which is what keeps typing cheap.
 *
 * ### Classes, not colours
 *
 * {@link dslHighlightStyle} gives each token class a CSS class and no style of its own, so the
 * colours live in `code-editor.css` on tokens and both palettes are the token sheet's.
 */

/** The CSS class each highlighted token wears — the mockup's `c-*` classes, in this module's names. */
export const DSL_TOKEN_CLASSES = {
  /** `import`, `export`, `true` — mockup 05's `c-kw`. */
  keyword: "code-editor__keyword",
  /** A quoted string or a template-literal prompt — `c-str`. */
  string: "code-editor__string",
  /** `2`, `400_000` — `c-num`. */
  number: "code-editor__number",
  /** A name called: `defineLoop(`, `.lte(` — `c-fn`. */
  callee: "code-editor__callee",
  /** A line or block comment — `c-cm`. */
  comment: "code-editor__comment",
} as const;

/** One of the five token classes. */
export type DslTokenKind = keyof typeof DSL_TOKEN_CLASSES;

/**
 * The words the highlighter marks as keywords.
 *
 * What the printer writes (`import`, `from`, `export`, `default`, the booleans) and the few words
 * a reader is likely to type while editing a file of this shape. It is a highlighting list, not
 * the grammar: a word here that the grammar refuses is still refused by the service's parser.
 */
export const DSL_KEYWORDS: ReadonlySet<string> = new Set([
  "as",
  "const",
  "default",
  "export",
  "false",
  "from",
  "import",
  "null",
  "true",
  "undefined",
]);

/** What the tokenizer carries from one line to the next. */
export interface DslState {
  /** Inside a template literal that a previous line opened. */
  inTemplate: boolean;
  /** Inside a block comment that a previous line opened. */
  inBlockComment: boolean;
}

/** An identifier, as TypeScript spells one in this grammar. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*/;

/** A number: hex, or decimal with `_` separators, a fraction and an exponent. */
const NUMBER = /^(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/;

/**
 * Read the rest of a template literal on this line.
 *
 * @param stream The line.
 * @param state The tokenizer's state; `inTemplate` is cleared when the closing backtick is read.
 * @returns Always `"string"` — the characters consumed are the prompt's.
 */
function readTemplate(stream: { next(): string | void; eol(): boolean }, state: DslState): string {
  while (!stream.eol()) {
    const character = stream.next();
    if (character === "\\") {
      stream.next();
    } else if (character === "`") {
      state.inTemplate = false;
      break;
    }
  }
  return "string";
}

/**
 * Read the rest of a block comment on this line.
 *
 * @param stream The line.
 * @param state The tokenizer's state; `inBlockComment` is cleared when `*\/` is read.
 * @returns Always `"comment"`.
 */
function readBlockComment(stream: { match(pattern: RegExp): unknown; skipToEnd(): void }, state: DslState): string {
  if (stream.match(/^.*?\*\//)) {
    state.inBlockComment = false;
  } else {
    stream.skipToEnd();
  }
  return "comment";
}

/**
 * The tokenizer: one token per call, named by the {@link DSL_TOKEN_CLASSES} key it belongs to, or
 * `null` for ink.
 */
export const dslStreamParser: StreamParser<DslState> = {
  name: "ouroboros-dsl",

  startState: () => ({ inTemplate: false, inBlockComment: false }),

  copyState: (state) => ({ ...state }),

  token(stream, state) {
    if (state.inTemplate) return readTemplate(stream, state);
    if (state.inBlockComment) return readBlockComment(stream, state);

    if (stream.eatSpace()) return null;

    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      state.inBlockComment = true;
      return readBlockComment(stream, state);
    }

    const character = stream.peek();

    if (character === "`") {
      stream.next();
      state.inTemplate = true;
      return readTemplate(stream, state);
    }
    if (character === '"' || character === "'") {
      stream.next();
      // A quoted string cannot span lines; an unterminated one ends at the line's end.
      while (!stream.eol()) {
        const next = stream.next();
        if (next === "\\") stream.next();
        else if (next === character) break;
      }
      return "string";
    }

    if (stream.match(NUMBER)) return "number";

    const word = stream.match(IDENTIFIER);
    if (word) {
      const name = (word as RegExpMatchArray)[0];
      if (DSL_KEYWORDS.has(name)) return "keyword";
      // A callee is a name the next non-space character calls — without consuming it.
      return stream.match(/^\s*\(/, false) ? "callee" : null;
    }

    stream.next();
    return null;
  },

  languageData: { commentTokens: { line: "//", block: { open: "/*", close: "*/" } } },

  tokenTable: {
    keyword: tags.keyword,
    string: tags.string,
    number: tags.number,
    callee: tags.function(tags.variableName),
    comment: tags.comment,
  },
};

/** The DSL as a CodeMirror language. */
export const dslLanguage = StreamLanguage.define(dslStreamParser);

/**
 * The five token classes, as classes — no inline style, so every colour is the sheet's.
 *
 * `all` is left unset: text that is none of the five keeps the editor's own ink.
 */
export const dslHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, class: DSL_TOKEN_CLASSES.keyword },
  { tag: tags.string, class: DSL_TOKEN_CLASSES.string },
  { tag: tags.number, class: DSL_TOKEN_CLASSES.number },
  { tag: tags.function(tags.variableName), class: DSL_TOKEN_CLASSES.callee },
  { tag: tags.comment, class: DSL_TOKEN_CLASSES.comment },
]);

/**
 * The language and its highlighting, as one extension.
 *
 * @returns The extension: the DSL's parser, and the class-only highlighter over it.
 */
export function dslSyntax(): Extension {
  return [dslLanguage, syntaxHighlighting(dslHighlightStyle)];
}
