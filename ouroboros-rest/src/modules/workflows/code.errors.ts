/**
 * The parser's diagnostic vocabulary — U.2
 * ([#166](https://github.com/NobuData/ouroboros/issues/166)).
 *
 * `code.parser.ts` reads a `.loop.ts` file back into a canonical document, and everything that
 * stops it is one of three codes, anchored to a range an editor can underline:
 *
 * * **`code_syntax_error`** — the text is not TypeScript. The compiler's own message, at the
 *   compiler's own position.
 * * **`code_out_of_grammar`** — the text is TypeScript, and the closed grammar
 *   ([`docs/WORKFLOW_CODE_DSL.md`](../../../../docs/WORKFLOW_CODE_DSL.md)) has no spelling like
 *   it: a call the grammar does not know, an import beyond `@ouroboros/sdk`, a statement outside
 *   `defineLoop`, a predicate that is not one of the fixed forms. It always carries
 *   {@link FULL_SDK_HINT}. Decision **C2** closes the grammar, and whether general TypeScript
 *   comes later is the X.1 ADR's to decide (#180), so that is where the message points.
 * * **`code_layout_invalid`** — the layout block cannot say where a stage sits: the block is
 *   missing, one of its lines is unreadable, or a stage has no position line.
 *
 * **What is not here is anything the shared validator reports.** The parser answers *what
 * document does this text spell?* A document with an unreachable stage, or a title of two hundred
 * characters, is still a document, and `validateWorkflowDocument` reports those against the
 * result exactly as it does for the canvas. The parser's job is shape; semantics are #133's.
 *
 * **Positions count line feeds only.** Lines and columns are 1-based, a column counts UTF-16
 * code units, and a line is what `text.split("\n")` makes of the file. That is the rule the
 * printer's span map and the layout reader already count by. The TypeScript scanner also breaks
 * lines at U+2028 and U+2029, so its own line numbers are never used.
 */

/** Every code the parser reports. */
export const WorkflowCodeErrorCode = {
  /** The text is not syntactically valid TypeScript. */
  SYNTAX_ERROR: "code_syntax_error",
  /** Valid TypeScript that the closed grammar has no spelling for. */
  OUT_OF_GRAMMAR: "code_out_of_grammar",
  /** The layout block is missing, has a line it cannot read, or gives a stage no position. */
  LAYOUT_INVALID: "code_layout_invalid",
} as const;

/** One of {@link WorkflowCodeErrorCode}'s values. */
export type WorkflowCodeErrorCode =
  (typeof WorkflowCodeErrorCode)[keyof typeof WorkflowCodeErrorCode];

/** The pointer every `code_out_of_grammar` error carries: where more of TypeScript would come from. */
export const FULL_SDK_HINT =
  "Supported in the full SDK (v2) — see https://github.com/NobuData/ouroboros/issues/180";

/** Where something sits in a file, as an editor underlines it. */
export interface CodeRange {
  /** The 1-based line it starts on. */
  line: number;
  /** The 1-based column it starts at. */
  column: number;
  /** The 1-based line it ends on. */
  endLine: number;
  /** The 1-based column just past its last character. Equal to `column` for an empty range. */
  endColumn: number;
}

/** One thing that stops a file from being read, and where. */
export interface WorkflowCodeError extends CodeRange {
  /** Which kind of problem it is. */
  code: WorkflowCodeErrorCode;
  /** What a person should read: what is wrong, and what the grammar writes instead. */
  message: string;
  /** Where support for the construct would come from. Present on `code_out_of_grammar` only. */
  hint?: string;
}

/** An error before it has been placed on a line: a range of offsets into the text. */
export interface PendingCodeError {
  /** Which kind of problem it is. */
  code: WorkflowCodeErrorCode;
  /** What a person should read. */
  message: string;
  /** The offset of its first character. */
  start: number;
  /** The offset just past its last character. */
  end: number;
  /** Where support would come from, for `code_out_of_grammar`. */
  hint?: string;
}

/** A 1-based line and column. */
export interface LinePosition {
  /** The 1-based line. */
  line: number;
  /** The 1-based column, in UTF-16 code units. */
  column: number;
}

/** Offsets to lines and back, counting line feeds and nothing else. */
export class LineMap {
  /** The offset each line starts at; `starts[0]` is line 1. */
  private readonly starts: number[] = [0];

  /**
   * @param text - The text the offsets index into.
   */
  constructor(private readonly text: string) {
    for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
      this.starts.push(index + 1);
    }
  }

  /** How many lines the text has. A text ending in a line feed has an empty last line. */
  get lineCount(): number {
    return this.starts.length;
  }

  /**
   * Where an offset sits.
   *
   * @param offset - An offset into the text. Values outside it are clamped to its ends.
   * @returns Its 1-based line and column.
   */
  position(offset: number): LinePosition {
    const clamped = Math.max(0, Math.min(offset, this.text.length));
    let low = 0;
    let high = this.starts.length - 1;

    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.starts[middle] <= clamped) low = middle;
      else high = middle - 1;
    }

    return { line: low + 1, column: clamped - this.starts[low] + 1 };
  }

  /**
   * Where a line starts and ends.
   *
   * @param line - A 1-based line number within the text.
   * @returns The offsets of its first character and of the line feed that ends it (or the end of
   *   the text, for the last line).
   * @throws {RangeError} When the line is not in the text.
   */
  lineSpan(line: number): { start: number; end: number } {
    if (!Number.isInteger(line) || line < 1 || line > this.starts.length) {
      throw new RangeError(`The text has no line ${line}`);
    }

    const start = this.starts[line - 1];
    const end = line < this.starts.length ? this.starts[line] - 1 : this.text.length;
    return { start, end };
  }

  /**
   * Where a range of offsets sits.
   *
   * @param start - The offset of its first character.
   * @param end - The offset just past its last character.
   * @returns Its 1-based start and end, each clamped to the text as {@link position} clamps.
   */
  range(start: number, end: number): CodeRange {
    const from = this.position(start);
    const to = this.position(end);

    return { line: from.line, column: from.column, endLine: to.line, endColumn: to.column };
  }
}

/**
 * Place errors on lines and put them in the order a reader meets them.
 *
 * By start offset, then end offset, then code, then message: a total order, so two parses of one
 * text report the same list in the same order.
 *
 * @param pending - The errors, as offsets into `lines`' text.
 * @param lines - The text's line map.
 * @returns The errors, positioned and sorted. The input is left alone.
 */
export function placeErrors(
  pending: readonly PendingCodeError[],
  lines: LineMap,
): WorkflowCodeError[] {
  return [...pending]
    .sort(
      (a, b) =>
        a.start - b.start ||
        a.end - b.end ||
        compareText(a.code, b.code) ||
        compareText(a.message, b.message),
    )
    .map(({ code, message, start, end, hint }) => ({
      code,
      message,
      ...lines.range(start, end),
      ...(hint === undefined ? {} : { hint }),
    }));
}

/**
 * Compare two strings by code unit, as `Array.prototype.sort` wants.
 *
 * @param a - The first string.
 * @param b - The second string.
 * @returns A negative number, zero, or a positive number.
 */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
