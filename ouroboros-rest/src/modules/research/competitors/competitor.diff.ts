/**
 * The scoped text a snapshot archives, and the diff between two of them (CL.3,
 * [#616](https://github.com/NobuData/ouroboros/issues/616)).
 *
 * A diff is the citable thing (decision V9): `+ 6.2 — Gust-adaptive final approach` is what a
 * brief's `[12]` points at, so it is written for a person to read — added lines `+ `, removed
 * lines `- `, in document order, with no context lines to wade through. It is line-based because
 * release notes, changelogs and feeds change by the line, and because a line is what a reader
 * quotes.
 *
 * Text is normalised before it is hashed, so a re-indented page or a trailing space is not a
 * change: each line is trimmed with its inner runs of whitespace collapsed, and empty lines go.
 */

/** V112's `competitor_snapshots_diff_bounded`: a diff is at most 64 KiB. */
export const MAX_DIFF_BYTES = 65536;

/** V117's `competitor_snapshot_contents_bounded`: archived text is at most 1 MiB. */
export const MAX_CONTENT_BYTES = 1048576;

/** Above this many cells the exact alignment is not worth its memory; see {@link lineDiff}. */
const MAX_ALIGNMENT_CELLS = 4_000_000;

/** A line diff. */
export interface LineDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  /** The rendered diff — `+ `/`- ` lines in document order, bounded by {@link MAX_DIFF_BYTES}. */
  readonly text: string;
}

/**
 * Normalise scoped text for hashing and diffing.
 *
 * @param text - The region's text, as extracted.
 * @returns One trimmed line per non-empty line, whitespace runs collapsed, bounded by
 *   {@link MAX_CONTENT_BYTES} (whole lines only).
 */
export function normaliseContent(text: string): string {
  const lines: string[] = [];
  let bytes = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line === "") continue;

    const size = Buffer.byteLength(line, "utf8") + 1;
    if (bytes + size > MAX_CONTENT_BYTES) break;
    lines.push(line);
    bytes += size;
  }
  return lines.join("\n");
}

/**
 * The lines added and removed between two normalised texts.
 *
 * The common head and tail are set aside first, so a release-notes page that gained an entry at
 * the top costs one comparison per line. What remains is aligned exactly (longest common
 * subsequence) unless it is too large to be worth it — then a line counts as added when the old
 * text does not have it and removed when the new one does not, which reads the same for the
 * append-and-edit way these pages change.
 *
 * @param before - The previous snapshot's text.
 * @param after - This snapshot's text.
 * @returns The diff; `text` is empty exactly when nothing was added or removed.
 */
export function lineDiff(before: string, after: string): LineDiff {
  const old = before === "" ? [] : before.split("\n");
  const now = after === "" ? [] : after.split("\n");

  let head = 0;
  while (head < old.length && head < now.length && old[head] === now[head]) head += 1;

  let tail = 0;
  while (
    tail < old.length - head &&
    tail < now.length - head &&
    old[old.length - 1 - tail] === now[now.length - 1 - tail]
  ) {
    tail += 1;
  }

  const oldMiddle = old.slice(head, old.length - tail);
  const newMiddle = now.slice(head, now.length - tail);
  const operations =
    oldMiddle.length * newMiddle.length <= MAX_ALIGNMENT_CELLS
      ? aligned(oldMiddle, newMiddle)
      : unaligned(oldMiddle, newMiddle);

  return {
    added: operations.filter((op) => op.sign === "+").map((op) => op.line),
    removed: operations.filter((op) => op.sign === "-").map((op) => op.line),
    text: render(operations),
  };
}

interface Operation {
  readonly sign: "+" | "-";
  readonly line: string;
}

function aligned(old: readonly string[], now: readonly string[]): Operation[] {
  const rows = old.length + 1;
  const cols = now.length + 1;
  const lcs = new Uint32Array(rows * cols);

  for (let i = old.length - 1; i >= 0; i -= 1) {
    for (let j = now.length - 1; j >= 0; j -= 1) {
      lcs[i * cols + j] =
        old[i] === now[j]
          ? lcs[(i + 1) * cols + j + 1] + 1
          : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + j + 1]);
    }
  }

  const operations: Operation[] = [];
  let i = 0;
  let j = 0;

  while (i < old.length || j < now.length) {
    if (i < old.length && j < now.length && old[i] === now[j]) {
      i += 1;
      j += 1;
    } else if (
      i < old.length &&
      (j === now.length || lcs[(i + 1) * cols + j] >= lcs[i * cols + j + 1])
    ) {
      // On a tie the removal goes first, so a reworded line reads `- old` then `+ new`.
      operations.push({ sign: "-", line: old[i] });
      i += 1;
    } else {
      operations.push({ sign: "+", line: now[j] });
      j += 1;
    }
  }
  return operations;
}

function unaligned(old: readonly string[], now: readonly string[]): Operation[] {
  const had = new Set(old);
  const has = new Set(now);

  return [
    ...old.filter((line) => !has.has(line)).map((line): Operation => ({ sign: "-", line })),
    ...now.filter((line) => !had.has(line)).map((line): Operation => ({ sign: "+", line })),
  ];
}

function render(operations: readonly Operation[]): string {
  const lines: string[] = [];
  let bytes = 0;

  for (const [index, op] of operations.entries()) {
    const line = `${op.sign} ${op.line}`;
    const size = Buffer.byteLength(line, "utf8") + 1;
    const remaining = operations.length - index;
    const marker = `… ${String(remaining)} more changed lines`;

    if (bytes + size + Buffer.byteLength(marker, "utf8") + 1 > MAX_DIFF_BYTES && remaining > 1) {
      lines.push(marker);
      break;
    }
    if (bytes + size > MAX_DIFF_BYTES) {
      lines.push(marker);
      break;
    }
    lines.push(line);
    bytes += size;
  }
  return lines.join("\n");
}
