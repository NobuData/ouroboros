import { describe, expect, it } from "vitest";

import type { CodeDiagnostic } from "@/app/api/workflows";
import {
  anchoredSpan,
  diagnosticPlace,
  diagnosticsSummary,
  editorDiagnostics,
  lineStarts,
  mapOffset,
  rangeSpan,
  readDiagnostics,
  textChange,
} from "@/app/workflows/code/code-diagnostics";

import { STANDARD_FIX_TEXT } from "../../helpers/workflow-code";

/**
 * A refused save's diagnostics, read and placed (V.4, #172): the ticket's **anchored diagnostics on parse
 * failure**, as data — every range lands on the characters it names, in the text that was sent and in the
 * text typed since.
 */

/** `dsl` on line 4 written as a number. */
const TYPO = STANDARD_FIX_TEXT.replace('  dsl: "1.0",', "  dsl: 1.0,");

/** Line 4, columns 8 to 11: `1.0`. */
const RANGE = { line: 4, column: 8, endLine: 4, endColumn: 11 };

/** The contract's `422 workflow_code_invalid` details, for {@link TYPO}. */
const DETAILS = {
  errors: [{ code: "code_out_of_grammar", message: "`dsl` is written as a string literal.", ...RANGE }],
  diagnostics: [
    {
      severity: "error",
      range: RANGE,
      code: "code_out_of_grammar",
      message: "`dsl` is written as a string literal.",
      note: "Supported in the full SDK (v2)",
    },
  ],
};

/**
 * A diagnostic.
 *
 * @param over What this case is about.
 * @returns The diagnostic.
 */
function diagnostic(over: Partial<CodeDiagnostic> = {}): CodeDiagnostic {
  return { severity: "error", range: RANGE, code: "code_syntax_error", message: "Expected a value.", ...over };
}

describe("reading a refusal's details", () => {
  it("reads the contract's diagnostics, the note included", () => {
    expect(readDiagnostics(DETAILS)).toEqual(DETAILS.diagnostics);
  });

  it("reads nothing from details that are not an object or carry no list", () => {
    expect(readDiagnostics(null)).toEqual([]);
    expect(readDiagnostics("oops")).toEqual([]);
    expect(readDiagnostics({})).toEqual([]);
    expect(readDiagnostics({ diagnostics: "not a list" })).toEqual([]);
  });

  it("skips an entry with no message or no whole range, rather than drawing it at a guessed place", () => {
    const read = readDiagnostics({
      diagnostics: [
        { severity: "error", range: RANGE },
        { severity: "error", message: "no range" },
        { severity: "error", message: "zero line", range: { ...RANGE, line: 0 } },
        { severity: "error", message: "fractional", range: { ...RANGE, column: 1.5 } },
        { severity: "error", message: "text", range: { ...RANGE, endLine: "4" } },
        "not an entry",
        { severity: "error", message: "kept", range: RANGE },
      ],
    });

    expect(read.map((entry) => entry.message)).toEqual(["kept"]);
  });

  it("reads an unknown severity as an error, keeps a warning, and a missing code as none", () => {
    const read = readDiagnostics({
      diagnostics: [
        { severity: "fatal", message: "a", range: RANGE },
        { severity: "warning", message: "b", range: RANGE, node: "analyze" },
      ],
    });

    expect(read).toEqual([
      { severity: "error", range: RANGE, code: "", message: "a" },
      { severity: "warning", range: RANGE, code: "", message: "b", node: "analyze" },
    ]);
  });
});

describe("placing a range in the text it was counted in", () => {
  it("finds where each line starts, counting line feeds only", () => {
    expect(lineStarts("a\nbc\n")).toEqual([0, 2, 5]);
    expect(lineStarts("")).toEqual([0]);
    expect(lineStarts("a\r\nb")).toEqual([0, 3]);
  });

  it("puts a 1-based line and column range on the characters it names", () => {
    const span = rangeSpan(TYPO, RANGE);

    expect(TYPO.slice(span.from, span.to)).toBe("1.0");
  });

  it("counts columns in UTF-16 code units, as the service does", () => {
    const text = "a😀b\n";
    const span = rangeSpan(text, { line: 1, column: 4, endLine: 1, endColumn: 5 });

    expect(text.slice(span.from, span.to)).toBe("b");
  });

  it("clamps what it cannot trust: a line past the end, a column past a line's end, an end before the start", () => {
    const text = "ab\ncd\n";

    expect(rangeSpan(text, { line: 9, column: 1, endLine: 9, endColumn: 2 })).toEqual({ from: 6, to: 6 });
    expect(rangeSpan(text, { line: 1, column: 1, endLine: 1, endColumn: 40 })).toEqual({ from: 0, to: 2 });
    expect(rangeSpan(text, { line: 2, column: 2, endLine: 1, endColumn: 1 })).toEqual({ from: 4, to: 4 });
  });
});

describe("carrying a range into the text typed since", () => {
  it("finds the one region two texts differ in", () => {
    expect(textChange("abcdef", "abXYdef")).toEqual({ prefix: 2, suffix: 3, before: 6, delta: 1 });
    expect(textChange("same", "same")).toEqual({ prefix: 4, suffix: 0, before: 4, delta: 0 });
    // A repeated character never counts twice: the tail stops where the head ends.
    expect(textChange("aa", "aaa")).toEqual({ prefix: 2, suffix: 0, before: 2, delta: 1 });
  });

  it("leaves an offset before the change, moves one after it, and clamps one inside it to the chosen edge", () => {
    const change = textChange("abcdef", "abXYZdef");

    expect(mapOffset(change, 1, -1)).toBe(1);
    expect(mapOffset(change, 4, 1)).toBe(6);
    expect(mapOffset(textChange("abcdef", "aXf"), 3, -1)).toBe(1);
    expect(mapOffset(textChange("abcdef", "aXf"), 3, 1)).toBe(2);
  });

  it("follows a line typed above the range, and ignores one typed below it", () => {
    const above = `// note\n${TYPO}`;
    const below = `${TYPO}// note\n`;
    const spanAbove = anchoredSpan(TYPO, above, RANGE);
    const spanBelow = anchoredSpan(TYPO, below, RANGE);

    expect(above.slice(spanAbove.from, spanAbove.to)).toBe("1.0");
    expect(below.slice(spanBelow.from, spanBelow.to)).toBe("1.0");
  });

  it("shrinks a range the person deleted inside to the part that still stands", () => {
    const fixing = TYPO.replace("dsl: 1.0,", "dsl: 1,");
    const span = anchoredSpan(TYPO, fixing, RANGE);

    expect(fixing.slice(span.from, span.to)).toBe("1");
  });

  it("grows a range to take in what is typed at its very start — the quote a fix begins with", () => {
    const fixing = TYPO.replace("dsl: 1.0,", 'dsl: "1.0,');
    const span = anchoredSpan(TYPO, fixing, RANGE);

    expect(fixing.slice(span.from, span.to)).toBe('"1.0');
  });

  it("collapses a range whose every character was replaced to the edge of the change, never inverted", () => {
    const replaced = TYPO.replace("dsl: 1.0,", 'dsl: "x",');
    const span = anchoredSpan(TYPO, replaced, RANGE);

    expect(span.from).toBeLessThanOrEqual(span.to);
    expect(replaced.slice(span.from, span.to)).toBe('"x"');
  });
});

describe("the diagnostics as CodeMirror draws them", () => {
  it("carries each one's range, severity, message and note, and its rule as the source", () => {
    const [drawn] = editorDiagnostics({ anchor: TYPO, items: readDiagnostics(DETAILS) }, TYPO);

    expect(drawn).toEqual({
      from: TYPO.indexOf("1.0,"),
      to: TYPO.indexOf("1.0,") + 3,
      severity: "error",
      message: "`dsl` is written as a string literal.\nSupported in the full SDK (v2)",
      source: "code_out_of_grammar",
    });
  });

  it("names no source for a diagnostic with no rule, and places every one in the text on screen", () => {
    const drawn = editorDiagnostics(
      { anchor: TYPO, items: [diagnostic({ code: "", severity: "warning" }), diagnostic()] },
      `x${TYPO}`,
    );

    expect(drawn[0]).not.toHaveProperty("source");
    expect(drawn[0]?.severity).toBe("warning");
    expect(drawn.map((entry) => entry.from)).toEqual([TYPO.indexOf("1.0,") + 1, TYPO.indexOf("1.0,") + 1]);
  });
});

describe("the strip's words", () => {
  it("says where a range starts", () => {
    expect(diagnosticPlace(RANGE)).toBe("Line 4, column 8");
  });

  it("counts errors and warnings in words", () => {
    expect(diagnosticsSummary([diagnostic()])).toBe("1 error");
    expect(diagnosticsSummary([diagnostic(), diagnostic()])).toBe("2 errors");
    expect(diagnosticsSummary([diagnostic(), diagnostic(), diagnostic({ severity: "warning" })])).toBe(
      "2 errors, 1 warning",
    );
    expect(diagnosticsSummary([diagnostic({ severity: "warning" }), diagnostic({ severity: "warning" })])).toBe(
      "2 warnings",
    );
    expect(diagnosticsSummary([])).toBe("No problems found");
  });
});
