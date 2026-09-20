import { describe, expect, it } from "vitest";

import { compactCarriage, isHighSurrogate, resolveCarriage, safeCut, sanitize } from "@/app/farm/log-text";

/**
 * What a build printed, made safe to draw (#261): every escape sequence and control character a
 * terminal would *interpret* is gone, and everything it would *print* is kept.
 *
 * Every control character here is built from its code, for the reason the module gives — a raw
 * `ESC` in a source file is invisible in review.
 */

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const CSI_8BIT = String.fromCharCode(0x9b);
const NUL = String.fromCharCode(0x00);
const BACKSPACE = String.fromCharCode(0x08);
const DEL = String.fromCharCode(0x7f);
const NEXT_LINE = String.fromCharCode(0x85);

describe("sanitize", () => {
  it("leaves plain output exactly as it was printed", () => {
    const line = "[4/7] Building C object zephyr/CMakeFiles/ota_rollback.c.obj";

    expect(sanitize(line)).toBe(line);
  });

  it("removes colour and cursor sequences and keeps the words between them", () => {
    expect(sanitize(`${ESC}[1;31merror:${ESC}[0m undefined reference`)).toBe("error: undefined reference");
    expect(sanitize(`progress${ESC}[K`)).toBe("progress");
    expect(sanitize(`${ESC}[2J${ESC}[Hcleared`)).toBe("cleared");
  });

  it("removes a private-mode sequence with its intermediates", () => {
    expect(sanitize(`${ESC}[?25lhidden${ESC}[?25h`)).toBe("hidden");
  });

  it("reads the 8-bit CSI as the introducer it is, so its parameters are not printed", () => {
    expect(sanitize(`${CSI_8BIT}31mred`)).toBe("red");
  });

  it("removes a title or a hyperlink with its payload, ended by BEL or by ST", () => {
    expect(sanitize(`${ESC}]0;build #479${BEL}$ west build`)).toBe("$ west build");
    expect(sanitize(`${ESC}]8;;https://example.test${ESC}\\link${ESC}]8;;${ESC}\\`)).toBe("link");
  });

  it("removes the other string sequences — DCS, SOS, PM and APC — the same way", () => {
    for (const introducer of ["P", "X", "^", "_"]) {
      expect(sanitize(`a${ESC}${introducer}payload${ESC}\\b`)).toBe("ab");
    }
  });

  it("ends an unterminated string sequence at the next escape, so it cannot swallow what follows it", () => {
    expect(sanitize(`${ESC}]0;title${ESC}[31mred`)).toBe("red");
  });

  it("lets an unterminated string sequence cost the rest of its line and nothing more", () => {
    expect(sanitize(`before${ESC}]0;never ended`)).toBe("before");
  });

  it("removes the two-character escapes — charset selection, a reset", () => {
    expect(sanitize(`${ESC}(Btext${ESC}c`)).toBe("text");
  });

  it("removes an escape cut short by the end of the text, so half a sequence is never printed", () => {
    expect(sanitize(`compiling${ESC}[3`)).toBe("compiling");
    expect(sanitize(`compiling${ESC}[`)).toBe("compiling");
    expect(sanitize(`compiling${ESC}`)).toBe("compiling");
  });

  it("removes the controls that print nothing, and keeps the tab", () => {
    expect(sanitize(`a${NUL}b${BACKSPACE}c${DEL}d${NEXT_LINE}e`)).toBe("abcde");
    expect(sanitize("FLASH:\t412 KB")).toBe("FLASH:\t412 KB");
  });

  it("draws markup in a log as the text it is — there is nothing to unescape and nothing is", () => {
    const line = '<img src=x onerror="alert(1)"> &amp; <script>';

    expect(sanitize(line)).toBe(line);
  });

  it("keeps everything that is not ASCII: a log is UTF-8", () => {
    expect(sanitize("Linking zephyr.elf … ✓ é 𝄞")).toBe("Linking zephyr.elf … ✓ é 𝄞");
  });
});

describe("resolveCarriage", () => {
  it("shows the last rewrite of a line that was rewritten", () => {
    expect(resolveCarriage("10%\r50%\r100%")).toBe("100%");
  });

  it("drops the carriage return of a CRLF line ending", () => {
    expect(resolveCarriage("built\r")).toBe("built");
    expect(resolveCarriage("10%\r100%\r\r")).toBe("100%");
  });

  it("leaves a line with none alone", () => {
    expect(resolveCarriage("plain")).toBe("plain");
  });
});

describe("compactCarriage", () => {
  it("keeps only what still shows, so a spinner cannot grow the open line for an hour", () => {
    expect(compactCarriage("|\r/\r-\r\\")).toBe("\\");
  });

  it("keeps a trailing return, because what it means is not known until the next character", () => {
    // `\r` then `\n` is a line ending and the text stands; `\r` then text is a rewrite.
    expect(compactCarriage("built\r")).toBe("built\r");
    expect(compactCarriage("10%\r50%\r")).toBe("50%\r");
    expect(resolveCarriage(`${compactCarriage("built\r")}`)).toBe("built");
    expect(resolveCarriage(`${compactCarriage("10%\r")}20%`)).toBe("20%");
  });

  it("returns a line with no returns as it is", () => {
    expect(compactCarriage("plain")).toBe("plain");
  });
});

describe("safeCut", () => {
  it("cuts where it was asked when nothing is in the way", () => {
    expect(safeCut("abcdefghij", 4)).toBe(4);
  });

  it("cuts in front of an escape sequence the cut would split", () => {
    const text = `abc${ESC}[31mred`;

    // Anywhere inside `ESC [ 3 1 m` moves back to the ESC.
    for (const at of [4, 5, 6, 7]) expect(safeCut(text, at)).toBe(3);
  });

  it("leaves a whole sequence that ends at or before the cut where it is", () => {
    const text = `abc${ESC}[31mred`;

    expect(safeCut(text, 8)).toBe(8);
    expect(safeCut(text, 10)).toBe(10);
  });

  it("never splits a surrogate pair", () => {
    const text = "ab𝄞cd";

    expect(isHighSurrogate(text.charCodeAt(2))).toBe(true);
    expect(safeCut(text, 3)).toBe(2);
  });

  it("always makes progress: an escape at the very start is cut where asked", () => {
    expect(safeCut(`${ESC}]0;${"t".repeat(40)}`, 10)).toBe(10);
  });

  it("cuts nothing off a text the position is not inside", () => {
    expect(safeCut("abc", 0)).toBe(3);
    expect(safeCut("abc", 3)).toBe(3);
    expect(safeCut("abc", 9)).toBe(3);
  });

  it("makes each half of a cut line sanitize cleanly on its own", () => {
    const text = `${"x".repeat(10)}${ESC}[1;31merror${ESC}[0m`;
    const cut = safeCut(text, 13);

    expect(sanitize(text.slice(0, cut)) + sanitize(text.slice(cut))).toBe(`${"x".repeat(10)}error`);
  });
});
