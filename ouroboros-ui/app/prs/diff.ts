/**
 * A revision's stored diff sample, read into files, hunks and lines
 * ([#367](https://github.com/NobuData/ouroboros/issues/367)).
 *
 * ```
 * --- drivers/can/telemetry_buf.c          the host sync's shape (`diffExcerptOf`, #352)
 * @@ -41,3 +41,4 @@ static void can_isr_rx(const struct device *dev)
 *      struct tlm_frame *slot = tlm_slot_claim();
 * -    k_fifo_put(&telemetry_fifo, slot);
 * +    k_msgq_put(&telemetry_msgq, slot, K_NO_WAIT);
 *
 * @@ drivers/can/telemetry_buf.c:41 @@ static void can_isr_rx(…)     the mockup's shape, as seeded
 * ```
 *
 * **The sample is bounded, and may end mid-file.** The service stores at most
 * {@link MAX_DIFF_EXCERPT} characters, cut wherever that falls. Nothing here repairs the cut: a
 * sample that reaches the bound is reported as {@link ParsedExcerpt.bounded}, and the card says so.
 *
 * **Every line knows where it sits in the new file**, so a cited range
 * (`hunk.ts`) can be found: an added or unchanged line is at its own number, and a deleted line is
 * at the number of the line that took its place.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

/** The most characters the service stores of a diff — `pr_revisions.diff_excerpt`'s bound. */
export const MAX_DIFF_EXCERPT = 16_384;

/** What a line of a diff is: added, deleted or unchanged context. */
export type DiffLineKind = "add" | "del" | "ctx";

/** One line of a hunk. */
export interface DiffLine {
  readonly kind: DiffLineKind;
  /** The line as the sample holds it, marker included — `+    slot->seq = …`. */
  readonly text: string;
  /** Where it sits in the new file, from 1 — or `null` under a header that names no line. */
  readonly at: number | null;
}

/** One `@@` block. */
export interface DiffHunk {
  /** The header, as the sample holds it. */
  readonly header: string;
  /** The new file's line the block starts at, or `null` when the header names none. */
  readonly start: number | null;
  readonly lines: readonly DiffLine[];
}

/** One file's share of the sample. */
export interface DiffFile {
  /** The file's path. */
  readonly path: string;
  readonly hunks: readonly DiffHunk[];
}

/** The sample, read. */
export interface ParsedExcerpt {
  /** The files the sample holds, in its order — each once. */
  readonly files: readonly DiffFile[];
  /** Whether the sample reaches the service's bound, so its end may be a cut. */
  readonly bounded: boolean;
}

/** A host hunk header — `@@ -41,3 +41,4 @@ context`. */
const HOST_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** The mockup's hunk header — `@@ drivers/can/telemetry_buf.c:41 @@ context`. */
const NAMED_HEADER = /^@@ (.+):([1-9]\d{0,9}) @@/;

/** A file being read. */
interface OpenFile {
  readonly path: string;
  readonly hunks: { header: string; start: number | null; lines: DiffLine[] }[];
}

/**
 * Read a revision's diff sample.
 *
 * @param excerpt The stored sample, or `null` when the host gave no patch text.
 * @param paths The revision's changed paths. A `--- <path>` line starts a file only when it names
 *   one of them, so a deleted line that happens to begin `-- ` is not mistaken for a boundary —
 *   the service's own rule (`parseExcerpt`, #358).
 * @returns The files in sample order. A line that belongs to no `@@` block — text before the first
 *   header, `\ No newline at end of file` — is left out. `null` reads as no files.
 */
export function parseExcerpt(excerpt: string | null, paths: readonly string[]): ParsedExcerpt {
  if (excerpt === null) return { files: [], bounded: false };

  const known = new Set(paths);
  const files = new Map<string, OpenFile>();
  let file: OpenFile | undefined;
  let hunk: OpenFile["hunks"][number] | undefined;
  let at: number | null = null;

  /**
   * The file a boundary names — the one already open under that path, or a new one.
   *
   * @param path The path.
   * @returns The file.
   */
  function open(path: string): OpenFile {
    const held = files.get(path);
    if (held !== undefined) return held;

    const opened: OpenFile = { path, hunks: [] };
    files.set(path, opened);

    return opened;
  }

  for (const raw of excerpt.split("\n")) {
    if (raw.startsWith("--- ") && known.has(raw.slice(4))) {
      file = open(raw.slice(4));
      hunk = undefined;
      continue;
    }

    const host = HOST_HEADER.exec(raw);
    const named = host === null ? NAMED_HEADER.exec(raw) : null;

    if (named !== null) file = open(named[1] as string);

    if (host !== null || named !== null || raw.startsWith("@@")) {
      if (file === undefined) continue;

      at = host !== null ? Number(host[1]) : named !== null ? Number(named[2]) : null;
      hunk = { header: raw, start: at, lines: [] };
      file.hunks.push(hunk);
      continue;
    }

    if (hunk === undefined) continue;

    if (raw.startsWith("+")) {
      hunk.lines.push({ kind: "add", text: raw, at });
      if (at !== null) at += 1;
    } else if (raw.startsWith("-")) {
      hunk.lines.push({ kind: "del", text: raw, at });
    } else if (raw.startsWith(" ")) {
      hunk.lines.push({ kind: "ctx", text: raw, at });
      if (at !== null) at += 1;
    }
  }

  return {
    files: [...files.values()].filter((each) => each.hunks.length > 0),
    bounded: excerpt.length >= MAX_DIFF_EXCERPT,
  };
}

/**
 * Whether a line sits inside a range of the new file.
 *
 * @param line The line.
 * @param lineStart The range's first line.
 * @param lineEnd The range's last line.
 * @returns `true` when the line's place is known and within the range, both ends included.
 */
export function inRange(line: DiffLine, lineStart: number, lineEnd: number): boolean {
  return line.at !== null && line.at >= lineStart && line.at <= lineEnd;
}
