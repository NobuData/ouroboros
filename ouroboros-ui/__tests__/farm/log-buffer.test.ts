import { describe, expect, it } from "vitest";

import type { BuildLog } from "@/app/api/farm";
import {
  EARLIER_KEY,
  EMPTY_LOG_BUFFER,
  type LogBuffer,
  type LogLimits,
  TAIL_KEY,
  appendPage,
  elisionLabel,
  logRows,
  tailLabel,
  textIndexes,
} from "@/app/farm/log-buffer";

import { buildLog } from "../helpers/farm";

/**
 * The fold from pages to rows (#261): appended and never rebuilt, bounded, and a hole in the log
 * drawn where it happened. The stream's half — that a page continues the last — is
 * `log-stream.test.ts`'s.
 */

const ESC = String.fromCharCode(0x1b);
const REPLACEMENT = String.fromCharCode(0xfffd);

/** Roomy limits, for the cases that are not about them. */
const ROOMY: LogLimits = { maxLines: 1000, maxColumns: 200 };

/**
 * Fold pages of text, one after another, each continuing the last.
 *
 * @param texts The pages' text.
 * @param limits How much may be held.
 * @returns The buffer after the last.
 */
function fold(texts: readonly string[], limits: LogLimits = ROOMY): LogBuffer {
  let buffer = EMPTY_LOG_BUFFER;
  let offset = 0;

  for (const text of texts) {
    const page = buildLog(text, { offset });
    buffer = appendPage(buffer, page, limits).buffer;
    offset = page.nextOffset;
  }

  return buffer;
}

/** @returns What each held row says. */
function texts(buffer: LogBuffer): string[] {
  return buffer.lines.map((row) => row.text);
}

describe("appending", () => {
  it("turns a page into one row per line, and ends on no empty row", () => {
    const buffer = fold(["$ west build\nccache: hit 78.4%\n"]);

    expect(texts(buffer)).toEqual(["$ west build", "ccache: hit 78.4%"]);
    expect(buffer.open).toBeNull();
  });

  it("keeps a blank line the build printed", () => {
    expect(texts(fold(["a\n\nb\n"]))).toEqual(["a", "", "b"]);
  });

  it("extends the line that was still being written, under the key it already had", () => {
    const first = fold(["[6/7] Linking"]);
    const second = appendPage(first, buildLog(" zephyr.elf …", { offset: 13 }), ROOMY).buffer;

    expect(texts(first)).toEqual(["[6/7] Linking"]);
    expect(texts(second)).toEqual(["[6/7] Linking zephyr.elf …"]);
    expect(second.lines[0]!.key).toBe(first.lines[0]!.key);
  });

  it("never changes a row that is complete: a new page reuses every earlier row by identity", () => {
    const first = fold(["one\ntwo\nthr"]);
    const second = appendPage(first, buildLog("ee\nfour\n", { offset: 11 }), ROOMY).buffer;

    expect(texts(second)).toEqual(["one", "two", "three", "four"]);
    expect(second.lines[0]).toBe(first.lines[0]);
    expect(second.lines[1]).toBe(first.lines[1]);
  });

  it("gives every row a key that ascends and is never reused", () => {
    const keys = fold(["a\nb\n", "c\nd\n"]).lines.map((row) => row.key);

    expect(keys).toEqual([0, 1, 2, 3]);
  });

  it("leaves the buffer it was given exactly as it was", () => {
    const first = fold(["one\ntw"]);
    const snapshot = JSON.stringify(first);

    appendPage(first, buildLog("o\nthree\n", { offset: 6 }), ROOMY);

    expect(JSON.stringify(first)).toBe(snapshot);
    expect(Object.isFrozen(first.lines)).toBe(true);
  });

  it("reassembles pages cut at every byte of a log to the same rows", () => {
    const log = "$ west build\n[1/3] a.c\n[2/3] b.c\n\n[3/3] Linking …\ndone";
    const whole = texts(fold([log]));

    for (let cut = 0; cut <= log.length; cut += 1) {
      expect(texts(fold([log.slice(0, cut), log.slice(cut)])), `cut at ${String(cut)}`).toEqual(whole);
    }
  });

  it("tracks the widest row, for the pane's sideways scroll", () => {
    expect(fold(["ab\nabcdef\nabc\n"]).columns).toBe(6);
  });
});

describe("sanitizing across pages", () => {
  it("completes an escape sequence split between two pages rather than printing its second half", () => {
    const buffer = fold([`compiling${ESC}[3`, `1m red${ESC}[0m\n`]);

    expect(texts(buffer)).toEqual(["compiling red"]);
  });

  it("draws the open line without the half sequence while waiting for the rest", () => {
    expect(texts(fold([`compiling${ESC}[3`]))).toEqual(["compiling"]);
  });

  it("reads a CRLF split between two pages as one line ending", () => {
    expect(texts(fold(["built\r", "\nnext\n"]))).toEqual(["built", "next"]);
  });

  it("shows a rewritten progress line as its last rewrite, across pages", () => {
    const buffer = fold(["10%\r50%", "\r100%\n"]);

    expect(texts(buffer)).toEqual(["100%"]);
  });

  it("does not let a spinner grow the open line", () => {
    const buffer = fold(["|\r/\r-\r", "\\\r|\r/"]);

    expect(buffer.open).toBe("/");
    expect(texts(buffer)).toEqual(["/"]);
  });
});

describe("bounds", () => {
  it("holds at most maxLines rows, dropping from the head and counting what left", () => {
    const lines = Array.from({ length: 25 }, (_, index) => `line ${String(index)}`).join("\n");
    const buffer = fold([`${lines}\n`], { maxLines: 10, maxColumns: 200 });

    expect(buffer.lines).toHaveLength(10);
    expect(buffer.dropped).toBe(15);
    expect(buffer.lines[0]).toMatchObject({ key: 15, text: "line 15" });
    expect(buffer.lines.at(-1)).toMatchObject({ key: 24, text: "line 24" });
  });

  it("stays bounded across a forty-thousand-line build", () => {
    const limits = { maxLines: 500, maxColumns: 200 };
    let buffer = EMPTY_LOG_BUFFER;
    let offset = 0;

    for (let page = 0; page < 40; page += 1) {
      const text = Array.from({ length: 1000 }, (_, index) => `[${String(page * 1000 + index)}] cc\n`).join("");
      const next = buildLog(text, { offset });
      buffer = appendPage(buffer, next, limits).buffer;
      offset = next.nextOffset;

      expect(buffer.lines.length).toBeLessThanOrEqual(500);
    }

    expect(buffer.dropped).toBe(39_500);
    expect(buffer.lines.at(-1)!.text).toBe("[39999] cc");
  });

  it("breaks a line longer than maxColumns into rows, so one row is never a megabyte wide", () => {
    const buffer = fold([`${"x".repeat(25)}\n`], { maxLines: 100, maxColumns: 10 });

    expect(texts(buffer)).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
  });

  it("breaks an unterminated line as it grows, keeping the rest open", () => {
    const limits = { maxLines: 100, maxColumns: 10 };
    const buffer = fold(["x".repeat(8), "y".repeat(8)], limits);

    expect(texts(buffer)).toEqual([`${"x".repeat(8)}yy`, "y".repeat(6)]);
    expect(buffer.open).toBe("y".repeat(6));
  });

  it("breaks in front of an escape sequence rather than through it", () => {
    const buffer = fold([`${"x".repeat(8)}${ESC}[31mred\n`], { maxLines: 100, maxColumns: 10 });

    expect(texts(buffer).join("")).toBe(`${"x".repeat(8)}red`);
  });
});

describe("holes", () => {
  it("draws an elision as a row of its own kind, where it happened", () => {
    const page = buildLog("before\nafter\n", { elisions: [{ offset: 7, bytes: 2_481_392, missingChunks: 0 }] });
    const { buffer } = appendPage(EMPTY_LOG_BUFFER, page, ROOMY);

    expect(buffer.lines.map((row) => [row.kind, row.text])).toEqual([
      ["text", "before"],
      ["gap", "[… 2,481,392 bytes elided]"],
      ["text", "after"],
    ]);
  });

  it("breaks the line a hole falls inside: the text either side was never one line", () => {
    const page = buildLog("[4/7] Buil[6/7] Linking\n", { elisions: [{ offset: 10, bytes: 512, missingChunks: 0 }] });
    const { buffer } = appendPage(EMPTY_LOG_BUFFER, page, ROOMY);

    expect(texts(buffer)).toEqual(["[4/7] Buil", "[… 512 bytes elided]", "[6/7] Linking"]);
  });

  it("closes a line left open by the page before when the next page opens on a hole", () => {
    const first = fold(["[4/7] Buil"]);
    const page = buildLog("[6/7] Linking\n", { offset: 10, elisions: [{ offset: 10, bytes: 0, missingChunks: 2 }] });
    const { buffer } = appendPage(first, page, ROOMY);

    expect(texts(buffer)).toEqual(["[4/7] Buil", "[… 2 chunks lost]", "[6/7] Linking"]);
    expect(buffer.lines[0]!.key).toBe(first.lines[0]!.key);
  });

  it("places a hole by bytes, not by characters, in a page of multi-byte text", () => {
    // `✓ é 𝄞 — ` is 3+1+2+1+4+1+3+1 = 16 bytes and 9 UTF-16 units.
    const page = buildLog("✓ é 𝄞 — after\n", { elisions: [{ offset: 16, bytes: 9, missingChunks: 0 }] });
    const { buffer } = appendPage(EMPTY_LOG_BUFFER, page, ROOMY);

    expect(texts(buffer)).toEqual(["✓ é 𝄞 — ", "[… 9 bytes elided]", "after"]);
  });

  it("draws several holes in one page, each once, in order — whatever order they arrived in", () => {
    const page = buildLog("a\nb\nc\n", {
      elisions: [
        { offset: 4, bytes: 20, missingChunks: 0 },
        { offset: 2, bytes: 10, missingChunks: 0 },
      ],
    });

    expect(texts(appendPage(EMPTY_LOG_BUFFER, page, ROOMY).buffer)).toEqual([
      "a",
      "[… 10 bytes elided]",
      "b",
      "[… 20 bytes elided]",
      "c",
    ]);
  });

  it("counts a hole against the bound like any row", () => {
    const page = buildLog("a\nb\n", { elisions: [{ offset: 2, bytes: 1, missingChunks: 0 }] });
    const { buffer } = appendPage(EMPTY_LOG_BUFFER, page, { maxLines: 2, maxColumns: 200 });

    expect(texts(buffer)).toEqual(["[… 1 byte elided]", "b"]);
  });
});

describe("textIndexes", () => {
  it("is the identity for ASCII", () => {
    expect(textIndexes("abcdef", 6, [0, 3, 6])).toEqual([0, 3, 6]);
  });

  it("weighs two-, three- and four-byte characters as UTF-8 does", () => {
    // é = 2 bytes / 1 unit, ✓ = 3 / 1, 𝄞 = 4 / 2.
    expect(textIndexes("é✓𝄞x", 10, [2, 5, 9, 10])).toEqual([1, 2, 4, 5]);
  });

  it("reads U+FFFD as one byte when the page's length says the bytes were invalid", () => {
    // `a`, a stray 0x80, `b`: three bytes, three characters.
    expect(textIndexes(`a${REPLACEMENT}b`, 3, [2])).toEqual([2]);
  });

  it("reads U+FFFD as three bytes when the page's length says it is genuine", () => {
    expect(textIndexes(`a${REPLACEMENT}b`, 5, [4])).toEqual([2]);
  });

  it("clamps a position past the text to its end, so a marker is never lost", () => {
    expect(textIndexes("abc", 3, [99])).toEqual([3]);
  });

  it("walks nothing when there is nothing to place", () => {
    expect(textIndexes("abc", 3, [])).toEqual([]);
  });
});

describe("what a marker says", () => {
  it("says bytes, chunks, or both — each in the singular when there is one", () => {
    expect(elisionLabel(2_481_392, 0)).toBe("[… 2,481,392 bytes elided]");
    expect(elisionLabel(1, 0)).toBe("[… 1 byte elided]");
    expect(elisionLabel(0, 1)).toBe("[… 1 chunk lost]");
    expect(elisionLabel(1024, 3)).toBe("[… 1,024 bytes elided · 3 chunks lost]");
  });

  it("still says something for a marker that counted nothing", () => {
    expect(elisionLabel(0, 0)).toBe("[… output elided]");
  });

  it("says why the log stops where it does when the cap was reached", () => {
    expect(tailLabel({ bytes: 12_345_678, missingChunks: 0, capped: true })).toBe(
      "[… 12,345,678 bytes elided — log cap reached]",
    );
    expect(tailLabel({ bytes: 40, missingChunks: 0, capped: false })).toBe("[… 40 bytes elided]");
  });
});

describe("joining a log part-way", () => {
  /** A page that lands inside a line, as a jump to the tail does. */
  const landed: Pick<BuildLog, "bytes" | "offset" | "nextOffset" | "elisions"> = buildLog(
    "lf of a line\nwhole line\n",
    { offset: 5000 },
  );

  it("leaves out the rest of the line it landed in", () => {
    const appended = appendPage(EMPTY_LOG_BUFFER, landed, ROOMY, true);

    expect(texts(appended.buffer)).toEqual(["whole line"]);
    expect(appended.skipping).toBe(false);
  });

  it("keeps skipping through a page with no line ending at all", () => {
    const first = appendPage(EMPTY_LOG_BUFFER, buildLog("no newline here", { offset: 5000 }), ROOMY, true);
    const second = appendPage(first.buffer, buildLog(" still\nshown\n", { offset: 5015 }), ROOMY, first.skipping);

    expect(first.skipping).toBe(true);
    expect(texts(first.buffer)).toEqual([]);
    expect(texts(second.buffer)).toEqual(["shown"]);
  });

  it("leaves out a hole inside the part that is not shown, and keeps one after it", () => {
    const page = buildLog("tail of line\nshown\nmore\n", {
      offset: 5000,
      elisions: [
        { offset: 5004, bytes: 7, missingChunks: 0 },
        { offset: 5019, bytes: 9, missingChunks: 0 },
      ],
    });

    expect(texts(appendPage(EMPTY_LOG_BUFFER, page, ROOMY, true).buffer)).toEqual([
      "shown",
      "[… 9 bytes elided]",
      "more",
    ]);
  });
});

describe("logRows", () => {
  const buffer = fold(["a\nb\n"]);

  it("is the buffer's own rows when there is nothing to add", () => {
    expect(logRows(buffer, { earlier: null, tail: null })).toBe(buffer.lines);
  });

  it("puts the note about earlier output above the first row and the tail under the last", () => {
    const rows = logRows(buffer, {
      earlier: "[… earlier output]",
      tail: { bytes: 99, missingChunks: 0, capped: true },
    });

    expect(rows.map((row) => [row.key, row.kind, row.text])).toEqual([
      [EARLIER_KEY, "note", "[… earlier output]"],
      [0, "text", "a"],
      [1, "text", "b"],
      [TAIL_KEY, "gap", "[… 99 bytes elided — log cap reached]"],
    ]);
  });

  it("draws a full log's worth of rows without exhausting the call stack", () => {
    const many: LogBuffer = {
      ...EMPTY_LOG_BUFFER,
      lines: Array.from({ length: 200_000 }, (_, key) => ({ key, kind: "text" as const, text: "" })),
    };

    expect(logRows(many, { earlier: "note", tail: null })).toHaveLength(200_001);
  });
});
