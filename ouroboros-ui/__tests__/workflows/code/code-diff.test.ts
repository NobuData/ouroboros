import { describe, expect, it } from "vitest";

import {
  DIFF_CELL_LIMIT,
  changedLines,
  diffMarker,
  lineDiff,
  splitLines,
} from "@/app/workflows/code/code-diff";

/**
 * The line diff *Keep mine* shows (V.4, #172): every line of both texts, in file order, each marked by
 * where it is found — so a person keeping their text over a draft that moved can see what moved.
 */

/**
 * The diff as `mark text` strings, which read the way the panel prints them.
 *
 * @param theirs The draft.
 * @param mine The tab's text.
 * @returns One string per line.
 */
function printed(theirs: string, mine: string): string[] {
  return lineDiff(theirs, mine).map((entry) => `${diffMarker(entry.kind)}${entry.text}`);
}

describe("splitLines", () => {
  it("splits on line feeds, and a file's final line feed starts no further line", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
    expect(splitLines("a\n\nb\n")).toEqual(["a", "", "b"]);
    expect(splitLines("")).toEqual([]);
    expect(splitLines("\n")).toEqual([""]);
  });
});

describe("lineDiff", () => {
  it("marks every line the same for two equal texts, and has nothing for two empty ones", () => {
    expect(printed("a\nb\n", "a\nb\n")).toEqual(["  a", "  b"]);
    expect(lineDiff("", "")).toEqual([]);
  });

  it("marks a line only in mine as added, in its place", () => {
    expect(printed("a\nc\n", "a\nb\nc\n")).toEqual(["  a", "+ b", "  c"]);
  });

  it("marks a line only in theirs as removed, in its place", () => {
    expect(printed("a\nb\nc\n", "a\nc\n")).toEqual(["  a", "- b", "  c"]);
  });

  it("marks a changed line as theirs removed, then mine added", () => {
    expect(printed("a\nold\nc\n", "a\nnew\nc\n")).toEqual(["  a", "- old", "+ new", "  c"]);
  });

  it("marks all of mine added over an empty draft, and all of theirs removed from an empty text", () => {
    expect(printed("", "a\nb\n")).toEqual(["+ a", "+ b"]);
    expect(printed("a\nb\n", "")).toEqual(["- a", "- b"]);
  });

  it("finds the longest run the texts share, so repeated lines are not all marked changed", () => {
    const diff = lineDiff("a\nb\na\n", "b\na\nb\n");

    expect(changedLines(diff)).toBe(2);
    expect(diff.filter((entry) => entry.kind === "same").map((entry) => entry.text)).toEqual(["b", "a"]);
  });

  it("keeps every line of both texts, in order", () => {
    const theirs = "one\ntwo\nthree\nfour\n";
    const mine = "zero\none\nthree\nfour\nfive\n";
    const diff = lineDiff(theirs, mine);

    expect(diff.filter((entry) => entry.kind !== "added").map((entry) => entry.text)).toEqual(splitLines(theirs));
    expect(diff.filter((entry) => entry.kind !== "removed").map((entry) => entry.text)).toEqual(splitLines(mine));
  });

  it("does not build a table past the limit: the differing middle is theirs removed, then mine added", () => {
    const size = Math.ceil(Math.sqrt(DIFF_CELL_LIMIT)) + 10;
    const theirs = ["head", ...Array.from({ length: size }, (_, index) => `theirs ${index}`), "tail"].join("\n");
    const mine = ["head", ...Array.from({ length: size }, (_, index) => `mine ${index}`), "tail"].join("\n");
    const diff = lineDiff(theirs, mine);

    expect(diff[0]).toEqual({ kind: "same", text: "head" });
    expect(diff.at(-1)).toEqual({ kind: "same", text: "tail" });
    expect(diff[1]).toEqual({ kind: "removed", text: "theirs 0" });
    expect(diff[size + 1]).toEqual({ kind: "added", text: "mine 0" });
    expect(changedLines(diff)).toBe(size * 2);
  });
});

describe("changedLines and diffMarker", () => {
  it("counts the lines only in one text", () => {
    expect(changedLines(lineDiff("a\nb\n", "a\nc\nd\n"))).toBe(3);
    expect(changedLines([])).toBe(0);
  });

  it("marks each kind in words-free text, so the kind never rests on hue alone", () => {
    expect(diffMarker("added")).toBe("+ ");
    expect(diffMarker("removed")).toBe("- ");
    expect(diffMarker("same")).toBe("  ");
  });
});
