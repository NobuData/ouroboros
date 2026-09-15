/**
 * A line diff between two texts — what the code view shows a person who kept their own text over a
 * draft that changed underneath it (V.4, [#172](https://github.com/NobuData/ouroboros/issues/172)).
 *
 * *Keep mine* keeps the buffer, and a buffer kept over a draft that moved is only useful if the
 * person can see what moved. So this answers the classic question — which of their lines are not in
 * mine, and which of mine are not in theirs — as one list in file order, each line marked `same`,
 * `removed` (theirs only) or `added` (mine only).
 *
 * ### Exact where it is cheap, honest where it is not
 *
 * The lines both texts start and end with are matched first, so an edit in one place costs a table
 * over that place only. What is left is a longest-common-subsequence table, which is exact. Past
 * {@link DIFF_CELL_LIMIT} cells — two very different large files — the table is not built, and the
 * middle is shown as all of theirs removed and all of mine added: never wrong, just less minimal.
 *
 * **Framework-free and pure.**
 */

/** What a line of the diff is. */
export type DiffKind = "same" | "removed" | "added";

/** One line of the diff. */
export interface DiffLine {
  /** `same` in both; `removed` only in theirs; `added` only in mine. */
  readonly kind: DiffKind;
  /** The line, without its line feed. */
  readonly text: string;
}

/** The largest table the diff builds — rows times columns of the part the two texts do not share. */
export const DIFF_CELL_LIMIT = 250_000;

/**
 * A text's lines.
 *
 * @param text The text. A file ends in a line feed, which starts no further line.
 * @returns Its lines, without their line feeds; none for an empty text.
 */
export function splitLines(text: string): string[] {
  if (text === "") return [];

  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Diff two texts by line.
 *
 * @param theirs The draft as it is stored now.
 * @param mine The person's text.
 * @returns Every line of both, in file order, each marked by where it is found.
 */
export function lineDiff(theirs: string, mine: string): DiffLine[] {
  const a = splitLines(theirs);
  const b = splitLines(mine);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  return [
    ...a.slice(0, start).map((text) => line("same", text)),
    ...middle(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA).map((text) => line("same", text)),
  ];
}

/**
 * How many lines of a diff differ.
 *
 * @param diff The diff.
 * @returns The lines that are only in theirs or only in mine.
 */
export function changedLines(diff: readonly DiffLine[]): number {
  return diff.filter((entry) => entry.kind !== "same").length;
}

/**
 * The mark a diff line is printed after, so the kind is never carried by hue alone.
 *
 * @param kind The line's kind.
 * @returns `+ ` for mine, `- ` for theirs, two spaces for both.
 */
export function diffMarker(kind: DiffKind): string {
  switch (kind) {
    case "added":
      return "+ ";
    case "removed":
      return "- ";
    case "same":
      return "  ";
  }
}

/**
 * One diff line.
 *
 * @param kind Its kind.
 * @param text Its text.
 * @returns The line.
 */
function line(kind: DiffKind, text: string): DiffLine {
  return { kind, text };
}

/**
 * Diff the part two texts do not share, by longest common subsequence.
 *
 * @param a Theirs, between the shared head and tail.
 * @param b Mine, between the same.
 * @returns The lines, in order.
 */
function middle(a: readonly string[], b: readonly string[]): DiffLine[] {
  if (a.length * b.length > DIFF_CELL_LIMIT) {
    return [...a.map((text) => line("removed", text)), ...b.map((text) => line("added", text))];
  }

  // `lengths[i * width + j]` is the longest common subsequence of `a[i…]` and `b[j…]`.
  const width = b.length + 1;
  const lengths = new Uint32Array((a.length + 1) * width);
  const at = (i: number, j: number): number => lengths[i * width + j] ?? 0;

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i * width + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const left = a[i] ?? "";
    const right = b[j] ?? "";

    if (left === right) {
      out.push(line("same", left));
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      out.push(line("removed", left));
      i += 1;
    } else {
      out.push(line("added", right));
      j += 1;
    }
  }
  for (; i < a.length; i += 1) out.push(line("removed", a[i] ?? ""));
  for (; j < b.length; j += 1) out.push(line("added", b[j] ?? ""));

  return out;
}
