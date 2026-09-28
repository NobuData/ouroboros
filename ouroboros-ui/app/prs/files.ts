/**
 * The Changed files card, as data ([#367](https://github.com/NobuData/ouroboros/issues/367)) —
 * mockup 12's file rows and diff excerpt, decided here and drawn by `files-card.tsx`.
 *
 * ```
 * CHANGED FILES   +68 −15                                   Full diff on the host ↗
 * drivers/can/telemetry_buf.c          +38 −12   [▮▮▮▮▮▮▮▯▯░]
 * drivers/can/isr_fastpath.c           +9 −3     [▮▮░░░░░░░░]   outside the planned file list
 * Excerpt — the full diff is on the host
 * ▾ drivers/can/telemetry_buf.c
 *   @@ drivers/can/telemetry_buf.c:41 @@ static void can_isr_rx(…)
 *   -    k_fifo_put(&telemetry_fifo, slot);
 *   +    k_msgq_put(&telemetry_msgq, slot, K_NO_WAIT);
 * ```
 *
 * **A meter is a comparison, so it is scaled against the set.** Each row's additions and
 * deletions are drawn against the largest file of the snapshot: `+38 −12` fills its track and
 * `+2 −1` barely marks it. A bar that filled the same for every row would claim a comparison it
 * is not making.
 *
 * **The excerpt says that it is one.** The stored sample is bounded (`diff.ts`), so the card
 * labels it, says how many of the changed files it holds, and says when it reaches the bound.
 *
 * **Out-of-scope rows are the gate's, not a guess.** While diff-vs-plan is red on the revision
 * the snapshot belongs to, the paths its evidence line names are flagged. The line is bounded too
 * (`… +3 more`), and what it had no room to name is stated rather than inferred.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type { PrFiles, PullRequestPage } from "@/app/api/pull-requests";

import { FILES_ID } from "./criteria";
import { type DiffLineKind, inRange, parseExcerpt } from "./diff";
import { type Hunk, hunkRange } from "./hunk";
import { httpUrl } from "./view";

/** The card's title — the mockup's `CHANGED FILES`. */
export const FILES_TITLE = "Changed files";

/** The card's link to the whole diff — the mockup's `Full diff on GitHub ↗`, for any host. */
export const FULL_DIFF_LINK = "Full diff on the host";

/** What the card says for a PR with no revision. */
export const NO_FILES_SNAPSHOT = "No revision has been pushed, so there is no changed file to show.";

/** What the card says for a revision that changed nothing. */
export const NO_CHANGED_FILES = "This revision changed no file.";

/** The excerpt's label — it is a sample, and says so. */
export const EXCERPT_LABEL = "Excerpt — the full diff is on the host";

/** What the card says when the revision has no sample. */
export const NO_EXCERPT =
  "No diff excerpt is stored for this revision — the full diff is on the host.";

/** What the card says when the sample reaches the service's bound. */
export const EXCERPT_BOUNDED =
  "The stored excerpt ends at its bound, so its last line may be cut short.";

/** What the card says when the latest revision's snapshot does not hold the cited path. */
export const HUNK_NOT_IN_SNAPSHOT =
  "The latest revision's snapshot does not hold this path — the hunk was cited on a revision that changed it.";

/** What the card says when the sample does not reach the cited range. */
export const HUNK_NOT_IN_EXCERPT =
  "The stored excerpt does not reach this range — the full diff is on the host.";

/** The gate whose red verdict flags rows. */
export const DIFF_VS_PLAN_KEY = "diff_vs_plan";

/** What a flagged row says beside its counts. */
export const OUT_OF_SCOPE_TAG = "outside the planned file list";

/** The gates card's link to the flagged rows. */
export const FLAGGED_LINK = { label: "changed files →", href: `#${FILES_ID}` } as const;

/** The unit a meter's segments are stated in: a hundredth of the track. */
export const METER_TRACK = 100;

// --- the meters ----------------------------------------------------------------------------

/** One row's meter, in hundredths of the track. */
export interface FileMeter {
  /** The additions' segment. */
  readonly add: number;
  /** The deletions' segment, drawn after the additions'. */
  readonly del: number;
}

/**
 * A count as the card can draw it.
 *
 * @param value What the payload states.
 * @returns The count, or `0` for anything that is not a finite, positive number.
 */
function counted(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * What the meters of a snapshot are scaled against.
 *
 * @param rows The snapshot's rows.
 * @returns The most lines any one file changed — additions and deletions together; `0` for no
 *   rows, or rows that changed no line.
 */
export function meterScale(rows: PrFiles["rows"]): number {
  return rows.reduce(
    (most, row) => Math.max(most, counted(row.additions) + counted(row.deletions)),
    0,
  );
}

/**
 * One row's meter.
 *
 * @param row The row's counts.
 * @param scale {@link meterScale} of the snapshot the row is in.
 * @returns The two segments in hundredths of the track, to a tenth; the remainder of the track is
 *   the unchanged rest. Both are `0` against a scale of `0`, and together they never pass the
 *   track.
 */
export function fileMeter(
  row: { readonly additions: number; readonly deletions: number },
  scale: number,
): FileMeter {
  if (!(scale > 0)) return { add: 0, del: 0 };

  /**
   * A count's share of the track.
   *
   * @param value The count.
   * @returns Hundredths, to a tenth.
   */
  const share = (value: number): number =>
    Math.round((counted(value) / scale) * METER_TRACK * 10) / 10;

  const add = Math.min(METER_TRACK, share(row.additions));

  return { add, del: Math.min(METER_TRACK - add, share(row.deletions)) };
}

// --- out of scope --------------------------------------------------------------------------

/** What a red diff-vs-plan gate says about the snapshot. */
export interface OutOfScope {
  /** The snapshot's paths the gate's line names. */
  readonly paths: ReadonlySet<string>;
  /** The explanation, naming the plan. */
  readonly explanation: string;
}

/** The gate's line — `2 out-of-scope edits: boards/x.dts, west.yml +3 more`. */
const OUT_OF_SCOPE_LINE = /^(\d+) out-of-scope edits?: ?(.*?)(?: \+(\d+) more)?$/;

/** What separates the paths of the gate's line. */
const SEPARATOR = ", ";

/**
 * The snapshot's paths a list names.
 *
 * @param list The gate's list — `boards/x.dts, west.yml`.
 * @param paths The snapshot's paths.
 * @returns The paths named, in the list's order. The list is read from its start, and at each
 *   place the longest path that fits whole — up to a separator or the end — is taken, so a path
 *   that holds a separator is one path and not two. What names no path of the snapshot is passed
 *   over.
 */
export function namedPaths(list: string, paths: readonly string[]): string[] {
  const longestFirst = [...paths].sort((a, b) => b.length - a.length);
  const named: string[] = [];
  let rest = list;

  while (rest !== "") {
    const path = longestFirst.find(
      (each) => each !== "" && (rest === each || rest.startsWith(`${each}${SEPARATOR}`)),
    );
    const taken = path === undefined ? rest.indexOf(SEPARATOR) : path.length;

    if (path !== undefined && !named.includes(path)) named.push(path);
    if (taken === -1) break;

    rest = rest.slice(taken).startsWith(SEPARATOR)
      ? rest.slice(taken + SEPARATOR.length)
      : rest.slice(taken);
  }

  return named;
}

/**
 * The plan a flagged file falls outside, in words.
 *
 * @param page The PR page.
 * @returns `the plan of issue #482` for a PR with a ticket, otherwise `the plan`.
 */
export function planName(page: PullRequestPage): string {
  const { ticket } = page.pullRequest;

  return ticket === null ? "the plan" : `the plan of issue ${ticket.key}`;
}

/**
 * The rows a red diff-vs-plan gate flags.
 *
 * @param page The PR page.
 * @returns `null` unless the latest revision's gates are the snapshot's own and diff-vs-plan is
 *   red among them. Otherwise the snapshot's paths the gate's line names ({@link namedPaths})
 *   and the explanation. A line that names nothing the snapshot holds flags no row, and the
 *   explanation quotes it.
 */
export function outOfScope(page: PullRequestPage): OutOfScope | null {
  const { files, gates } = page;

  if (files === null || gates === null || gates.revisionId !== files.revisionId) return null;

  const gate = gates.rows.find((row) => row.key === DIFF_VS_PLAN_KEY);
  if (gate === undefined || gate.verdict !== "red") return null;

  const plan = planName(page);
  const match = gate.evidence === null ? null : OUT_OF_SCOPE_LINE.exec(gate.evidence);
  const paths = new Set(
    match === null
      ? []
      : namedPaths(
          (match[2] as string).trim(),
          files.rows.map((row) => row.path),
        ),
  );

  if (match === null || paths.size === 0) {
    return {
      paths,
      explanation:
        gate.evidence === null
          ? `${gate.label} is red on this revision, and the gate recorded no line naming the files outside ${plan}.`
          : `${gate.label} is red on this revision — ${gate.evidence} — and its line names no file of this snapshot.`,
    };
  }

  const unnamed = Math.max(0, Number(match[1]) - paths.size);
  const flagged =
    paths.size === 1
      ? `1 changed file falls outside the planned file list of ${plan}.`
      : `${paths.size} changed files fall outside the planned file list of ${plan}.`;

  return {
    paths,
    explanation:
      unnamed === 0
        ? `${gate.label} is red on this revision: ${flagged}`
        : `${gate.label} is red on this revision: ${flagged} The gate flags ${unnamed} more that its line had no room to name.`,
  };
}

// --- the card ------------------------------------------------------------------------------

/** One file row, ready to draw. */
export interface FileRowView {
  /** `drivers/can/telemetry_buf.c`. */
  readonly path: string;
  /** `+38`. */
  readonly additions: string;
  /** `−12`. */
  readonly deletions: string;
  readonly meter: FileMeter;
  /** Whether the diff-vs-plan gate names the file as outside the plan. */
  readonly flagged: boolean;
}

/** One line of the excerpt, ready to draw. */
export interface ExcerptLineView {
  readonly kind: DiffLineKind;
  /** The line as stored, marker included. */
  readonly text: string;
  /** Whether the line is inside the cited range. */
  readonly cited: boolean;
  /** Whether it is the first line of the cited range — where the reader is brought. */
  readonly anchor: boolean;
}

/** One file of the excerpt, ready to draw. */
export interface ExcerptFileView {
  readonly path: string;
  /** Whether the file is drawn open before the reader has chosen. */
  readonly open: boolean;
  readonly hunks: readonly {
    /** The `@@` header, as stored. */
    readonly header: string;
    readonly lines: readonly ExcerptLineView[];
  }[];
}

/** The cited hunk, as the card states it. */
export interface CitedView {
  /** The cited file's path. */
  readonly path: string;
  /** `Cited: drivers/can/telemetry_buf.c · lines 41–66`. */
  readonly line: string;
  /** Why the range is not on screen, or `null` when it is. */
  readonly note: string | null;
}

/** The card, ready to draw. */
export interface FilesCardView {
  /** `+68 −15`, or `null` without a snapshot. */
  readonly totals: string | null;
  /** The whole diff on the host, or `null` without a snapshot or an `http(s)` address. */
  readonly fullDiffUrl: string | null;
  /** Why there are no rows, or `null` when there are. */
  readonly empty: string | null;
  readonly rows: readonly FileRowView[];
  /** The out-of-scope explanation, or `null` while diff-vs-plan is not red. */
  readonly explanation: string | null;
  /** The excerpt's files, in its order. */
  readonly excerpt: readonly ExcerptFileView[];
  /** What is said beneath the excerpt's label — its reach, its bound — or why there is none. */
  readonly excerptNotes: readonly string[];
  /** The cited hunk, or `null`. */
  readonly cited: CitedView | null;
}

/**
 * What the card says about a cited hunk.
 *
 * @param hunk The hunk.
 * @returns `Cited: drivers/can/telemetry_buf.c · lines 41–66`.
 */
export function citedLine(hunk: Hunk): string {
  return `Cited: ${hunk.path} · ${hunkRange(hunk)}`;
}

/**
 * How many of the changed files the excerpt holds.
 *
 * @param sampled The files in the excerpt.
 * @param changed The files in the snapshot.
 * @returns `1 of 3 changed files is in the excerpt.`
 */
export function excerptReach(sampled: number, changed: number): string {
  return `${sampled} of ${changed} changed ${changed === 1 ? "file" : "files"} ${
    sampled === 1 ? "is" : "are"
  } in the excerpt.`;
}

/**
 * A count with its sign.
 *
 * @param sign `+` or `−`.
 * @param value The count.
 * @returns `+38`.
 */
function signed(sign: "+" | "−", value: number): string {
  return `${sign}${counted(value)}`;
}

/**
 * The card.
 *
 * @param page The PR page.
 * @param hunk The hunk the address cites, or `null`.
 * @returns The card: the latest revision's rows with their meters and flags, the excerpt with the
 *   cited range marked, and what is honestly said about each. The excerpt's first file is drawn
 *   open, and so is the cited one.
 */
export function filesCard(page: PullRequestPage, hunk: Hunk | null): FilesCardView {
  const { files } = page;

  if (files === null) {
    return {
      totals: null,
      fullDiffUrl: null,
      empty: NO_FILES_SNAPSHOT,
      rows: [],
      explanation: null,
      excerpt: [],
      excerptNotes: [],
      cited:
        hunk === null
          ? null
          : { path: hunk.path, line: citedLine(hunk), note: HUNK_NOT_IN_SNAPSHOT },
    };
  }

  const scale = meterScale(files.rows);
  const scope = outOfScope(page);
  const paths = files.rows.map((row) => row.path);
  const parsed = parseExcerpt(files.diffExcerpt, paths);
  let anchored = false;

  const excerpt = parsed.files.map((file, index) => ({
    path: file.path,
    open: index === 0 || file.path === hunk?.path,
    hunks: file.hunks.map((block) => ({
      header: block.header,
      lines: block.lines.map((line) => {
        const cited =
          hunk !== null &&
          file.path === hunk.path &&
          inRange(line, hunk.lineStart, hunk.lineEnd);
        const anchor = cited && !anchored;
        if (anchor) anchored = true;

        return { kind: line.kind, text: line.text, cited, anchor };
      }),
    })),
  }));

  const excerptNotes: string[] = [];
  if (excerpt.length === 0) {
    excerptNotes.push(NO_EXCERPT);
  } else {
    if (excerpt.length < files.rows.length) {
      excerptNotes.push(excerptReach(excerpt.length, files.rows.length));
    }
    if (parsed.bounded) excerptNotes.push(EXCERPT_BOUNDED);
  }

  /**
   * Why the cited range is not on screen.
   *
   * @param cited The hunk.
   * @returns The reason, or `null` when the range is drawn.
   */
  function citedNote(cited: Hunk): string | null {
    if (!paths.includes(cited.path)) return HUNK_NOT_IN_SNAPSHOT;

    return anchored ? null : HUNK_NOT_IN_EXCERPT;
  }

  return {
    totals: `${signed("+", files.additions)} ${signed("−", files.deletions)}`,
    fullDiffUrl: httpUrl(files.fullDiffUrl),
    empty: files.rows.length === 0 ? NO_CHANGED_FILES : null,
    rows: files.rows.map((row) => ({
      path: row.path,
      additions: signed("+", row.additions),
      deletions: signed("−", row.deletions),
      meter: fileMeter(row, scale),
      flagged: scope?.paths.has(row.path) ?? false,
    })),
    explanation: scope?.explanation ?? null,
    excerpt,
    excerptNotes,
    cited:
      hunk === null ? null : { path: hunk.path, line: citedLine(hunk), note: citedNote(hunk) },
  };
}
