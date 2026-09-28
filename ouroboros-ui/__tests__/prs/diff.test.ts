import { describe, expect, it } from "vitest";

import { MAX_DIFF_EXCERPT, inRange, parseExcerpt } from "@/app/prs/diff";

import {
  HOST_EXCERPT,
  ISR_PATH,
  MOCKUP_EXCERPT,
  TELEMETRY_PATH,
} from "../helpers/pull-requests";

/**
 * The stored diff sample, read (#367): both shapes it arrives in, where each line sits in the new
 * file, what is left out, and the bound.
 */

const PATHS = [TELEMETRY_PATH, ISR_PATH];

describe("parseExcerpt", () => {
  it("reads no sample as no files", () => {
    expect(parseExcerpt(null, PATHS)).toEqual({ files: [], bounded: false });
    expect(parseExcerpt("", PATHS)).toEqual({ files: [], bounded: false });
  });

  it("reads the mockup's shape: the header names the path and the line", () => {
    const { files, bounded } = parseExcerpt(MOCKUP_EXCERPT, PATHS);

    expect(bounded).toBe(false);
    expect(files.map((file) => file.path)).toEqual([TELEMETRY_PATH]);
    expect(files[0]!.hunks).toHaveLength(1);

    const [hunk] = files[0]!.hunks;

    expect(hunk!.header).toBe(
      `@@ ${TELEMETRY_PATH}:41 @@ static void can_isr_rx(const struct device *dev)`,
    );
    expect(hunk!.start).toBe(41);
    expect(hunk!.lines.map((line) => [line.kind, line.at])).toEqual([
      ["ctx", 41],
      ["del", 42],
      ["del", 42],
      ["add", 42],
      ["add", 43],
      ["add", 44],
    ]);
    expect(hunk!.lines[1]!.text).toBe("-    slot->ts = k_cycle_get_32();");
  });

  it("reads the host sync's shape: a boundary per file, then its hunks", () => {
    const { files } = parseExcerpt(HOST_EXCERPT, PATHS);

    expect(files.map((file) => file.path)).toEqual([TELEMETRY_PATH, ISR_PATH]);
    expect(files[0]!.hunks[0]!.start).toBe(41);
    expect(files[0]!.hunks[0]!.lines.map((line) => [line.kind, line.at])).toEqual([
      ["ctx", 41],
      ["del", 42],
      ["add", 42],
      ["add", 43],
      ["ctx", 44],
    ]);
    expect(files[1]!.hunks[0]!.header).toBe("@@ -7 +7,2 @@");
    expect(files[1]!.hunks[0]!.lines.map((line) => line.at)).toEqual([7, 7, 8]);
  });

  it("takes a `--- ` line for a boundary only when it names a changed path", () => {
    const { files } = parseExcerpt(
      [`--- ${TELEMETRY_PATH}`, "@@ -1,2 +1 @@", "--- a comment, deleted", " kept"].join("\n"),
      PATHS,
    );

    expect(files).toHaveLength(1);
    expect(files[0]!.hunks[0]!.lines).toEqual([
      { kind: "del", text: "--- a comment, deleted", at: 1 },
      { kind: "ctx", text: " kept", at: 1 },
    ]);
  });

  it("gathers a file named twice under one entry, in the order it first appeared", () => {
    const { files } = parseExcerpt(
      [
        `@@ ${TELEMETRY_PATH}:1 @@`,
        "+a",
        `@@ ${ISR_PATH}:5 @@`,
        "+b",
        `@@ ${TELEMETRY_PATH}:90 @@`,
        "+c",
      ].join("\n"),
      PATHS,
    );

    expect(files.map((file) => [file.path, file.hunks.length])).toEqual([
      [TELEMETRY_PATH, 2],
      [ISR_PATH, 1],
    ]);
  });

  it("leaves out what belongs to no hunk, and a file that has none", () => {
    const { files } = parseExcerpt(
      [
        "+before any file",
        `--- ${ISR_PATH}`,
        "+before any header",
        `--- ${TELEMETRY_PATH}`,
        "@@ -1 +1 @@",
        "-x",
        "+y",
        "\\ No newline at end of file",
      ].join("\n"),
      PATHS,
    );

    expect(files.map((file) => file.path)).toEqual([TELEMETRY_PATH]);
    expect(files[0]!.hunks[0]!.lines.map((line) => line.text)).toEqual(["-x", "+y"]);
  });

  it("drops a header that comes before any file", () => {
    expect(parseExcerpt("@@ -1 +1 @@\n+y", PATHS).files).toEqual([]);
  });

  it("keeps a header it cannot read a line from, with lines of no known place", () => {
    const { files } = parseExcerpt(`--- ${ISR_PATH}\n@@@ -1 -1 +1 @@@\n+y`, PATHS);

    expect(files[0]!.hunks[0]!.start).toBeNull();
    expect(files[0]!.hunks[0]!.lines).toEqual([{ kind: "add", text: "+y", at: null }]);
  });

  it("says when the sample reaches the service's bound", () => {
    const head = `--- ${ISR_PATH}\n@@ -1 +1 @@\n+`;
    const full = head + "x".repeat(MAX_DIFF_EXCERPT - head.length);

    expect(parseExcerpt(full, PATHS).bounded).toBe(true);
    expect(parseExcerpt(full.slice(1), PATHS).bounded).toBe(false);
  });
});

describe("inRange", () => {
  it("includes both ends, and nothing of unknown place", () => {
    expect(inRange({ kind: "add", text: "+", at: 41 }, 41, 66)).toBe(true);
    expect(inRange({ kind: "ctx", text: " ", at: 66 }, 41, 66)).toBe(true);
    expect(inRange({ kind: "del", text: "-", at: 40 }, 41, 66)).toBe(false);
    expect(inRange({ kind: "add", text: "+", at: 67 }, 41, 66)).toBe(false);
    expect(inRange({ kind: "add", text: "+", at: null }, 41, 66)).toBe(false);
  });
});
