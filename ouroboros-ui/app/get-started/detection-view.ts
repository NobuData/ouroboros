/**
 * The detection card's words and pure rules (BC.2,
 * [#391](https://github.com/NobuData/ouroboros/issues/391), mockup 13's *"We already figured this
 * out"*).
 *
 * **The card shows its work.** Every row's line is the service's (BB.1, #384); this module decides
 * how a row is drawn — its mark, its label, the dim parenthetical split off its value
 * ({@link splitValue}), and the probe hits behind it ({@link evidenceLines}). A row the scan could
 * not determine is drawn as *undetermined*, never hidden.
 *
 * **Nothing here measures.** The `detected` / `measured` chip is the service's label, verbatim:
 * the devcontainer row says what a probe found and parsed, never how fast an environment would
 * build (decision **O2** — nothing in the MVP builds it).
 *
 * Framework-free and pure.
 */

import type { RepoDetection, RepoDetectionProgress, RepoDetectionRow } from "@/app/api/detection";
import { globChip } from "@/app/globs/glob";

/** The card's title, as the mockup sets it. */
export const DETECTION_TITLE = "We already figured this out";

/** The step tag, when step 2 is done. */
export const STEP_DONE_TAG = "✓ step 2 done";

/** The row labels, by the service's row key — the mockup's left column. */
export const ROW_LABELS: Readonly<Record<string, string>> = {
  language: "Language",
  build: "Build",
  devcontainer: "Devcontainer",
  tests: "Tests",
  protected_paths: "Protected paths",
  conventions: "Conventions",
};

/** How a row is marked. `undetermined` is a row the scan could not settle. */
export type RowMark = "ok" | "warn" | "missing" | "undetermined";

/** The glyph each mark draws — the mockup's ✓ and !, plus the two states it does not show. */
export const ROW_GLYPHS: Readonly<Record<RowMark, string>> = {
  ok: "✓",
  warn: "!",
  missing: "✗",
  undetermined: "?",
};

/** How a screen reader hears each mark. */
export const ROW_MARK_NAMES: Readonly<Record<RowMark, string>> = {
  ok: "found",
  warn: "needs attention",
  missing: "not found",
  undetermined: "undetermined",
};

/** The tag an undetermined row carries beside its label. */
export const UNDETERMINED_TAG = "undetermined";

/** The evidence control's text, and its accessible name for a row. */
export const EVIDENCE_LABEL = "evidence";

/**
 * The evidence control's accessible name.
 *
 * @param label The row's label.
 * @returns `Evidence for Build`.
 */
export function evidenceName(label: string): string {
  return `Evidence for ${label}`;
}

/** The re-scan control and its states. */
export const RESCAN_LABEL = "Re-scan";
export const RESCANNING = "Scanning…";
export const SCAN_LABEL = "Scan this repository";
export const RETRY_SCAN_LABEL = "Retry the scan";
export const RESCAN_VIEWER_REASON =
  "Viewers can read the scan but not run one — ask an owner, admin or member.";

/** How long the service refuses a second scan after one starts, in seconds (its debounce). */
export const RESCAN_INTERVAL_SECONDS = 30;

/** What the card says when the repository was never scanned. */
export const NEVER_SCANNED_TITLE = "Not scanned yet";
export const NEVER_SCANNED_LINE =
  "Ouroboros reads this repository's languages, file tree and a handful of files — it never clones — and lists what it found here, each with its evidence.";

/** What a partial scan says above its rows. */
export const PARTIAL_LINE =
  "Part of this scan could not finish, so some rows are marked undetermined rather than guessed. Re-scan to try them again.";

/** What a failed scan says, when the service gave no reason. */
export const SCAN_FAILED_FALLBACK = "The scan failed.";

/** What the card says when it could not be read at all. */
export const UNREACHABLE_DETECTION =
  "The detection card could not be reached. It will try again shortly.";
export const UNREADABLE_DETECTION = "The detection card answered with something it could not read.";

/** What a write says when the service failed rather than refused. */
export const DETECTION_WRITE_FAILED = "That did not go through. Try again.";

/** The protected-paths row's editor. */
export const PROTECTED_EDIT_LABEL = "edit";
export const PROTECTED_LIST_LABEL = "Protected path patterns";
export const PROTECTED_CONSEQUENCE = "These paths are refused by run guardrails";
export const PROTECTED_CONSEQUENCE_DETAIL =
  "— a loop whose change touches one fails its allowed-paths check. Saving makes this list yours: later scans stop suggesting.";
export const PROTECTED_SAVE_LABEL = "Save protected paths";
export const PROTECTED_SAVING = "Saving…";
export const PROTECTED_CANCEL_LABEL = "Cancel";
export const PROTECTED_SAVED = "Saved. Run guardrails refuse these paths from the next run.";
export const PROTECTED_UNCHANGED_REASON = "Nothing changed yet.";
export const PROTECTED_ADMIN_REASON =
  "Only an owner or admin can change what run guardrails refuse.";
export const PROTECTED_NONE = "none";

/**
 * The conventions line the scan printed before #391 — *"we'll learn your conventions from merged
 * PRs instead"* — which described the knowledge roadmap (mockup 14) as if it were built. A scan
 * stored before the pack's 1.1.0 still carries it, so the card says it the honest way instead.
 */
export const LEGACY_CONVENTIONS_LINE =
  "No CONTRIBUTING.md — we'll learn your conventions from merged PRs instead.";

/** The conventions line, phrased as the future capability it is — the pack's own 1.1.0 line. */
export const CONVENTIONS_LINE =
  "No CONTRIBUTING.md — a coming knowledge release will learn your conventions from merged PRs.";

/** The link the conventions row points at — where that knowledge will live. */
export const CONVENTIONS_ROADMAP_LABEL = "knowledge roadmap";

/**
 * What the card draws: its state, and the rows the person reads.
 *
 * - `never` — no scan stored and none running.
 * - `first` — no scan stored, the first one running.
 * - `ready` — a scan stored (re-scans run beside it: its rows stay until the new one lands).
 */
export type CardState = "never" | "first" | "ready";

/**
 * The card's state.
 *
 * @param detection The detection.
 * @returns Its state.
 */
export function cardState(detection: RepoDetection): CardState {
  if (detection.scan !== null) return "ready";

  return detection.progress?.state === "running" ? "first" : "never";
}

/**
 * Whether a scan is running for the repository.
 *
 * @param progress The service's progress, or null.
 * @returns True while it runs.
 */
export function isScanning(progress: RepoDetectionProgress | null): boolean {
  return progress?.state === "running";
}

/**
 * Why the last scan failed, when it did — shown with a retry. A failure older than the stored scan
 * is not news: the stored scan is newer and stands.
 *
 * @param detection The detection.
 * @returns The sentence, or null when the last scan did not fail.
 */
export function scanFailure(detection: RepoDetection): string | null {
  const { progress, scan } = detection;

  if (progress?.state !== "failed") return null;
  if (scan !== null && Date.parse(scan.scannedAt) > Date.parse(progress.startedAt)) return null;

  return progress.error === null || progress.error === ""
    ? SCAN_FAILED_FALLBACK
    : `The scan failed: ${progress.error}`;
}

/**
 * Whether a stored scan is partial: some row could not be determined.
 *
 * @param rows The rows.
 * @returns True when any row is undetermined.
 */
export function isPartial(rows: readonly RepoDetectionRow[]): boolean {
  return rows.some((row) => !row.determined);
}

/**
 * A row's mark.
 *
 * @param row The row.
 * @returns `undetermined` for a row the scan could not settle, else its verdict.
 */
export function rowMark(row: RepoDetectionRow): RowMark {
  return row.determined ? row.verdict : "undetermined";
}

/**
 * A row's label — the mockup's for the six core rows, the name after `custom:` for a pack's own.
 *
 * @param rowKey The row key.
 * @returns The label.
 */
export function rowLabel(rowKey: string): string {
  const known = ROW_LABELS[rowKey];
  if (known !== undefined) return known;

  const name = rowKey.startsWith("custom:") ? rowKey.slice("custom:".length) : rowKey;
  const words = name.replace(/[_-]+/g, " ").trim();

  return words === "" ? rowKey : words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A row's value, split into its claim and the dim parenthetical that shows its work —
 * `west + twister` and `(found west.yml)`.
 *
 * @param value The service's line.
 * @returns The claim and the affix (empty when the line ends in none).
 */
export function splitValue(value: string): {
  readonly claim: string;
  readonly affix: string;
} {
  const match = /^(.*\S)\s+(\([^()]*\))$/.exec(value);

  return match === null ? { claim: value, affix: "" } : { claim: match[1]!, affix: match[2]! };
}

/**
 * The line a row prints — the service's, except a conventions line stored before #391, which is
 * re-phrased in the future tense ({@link LEGACY_CONVENTIONS_LINE}).
 *
 * @param row The row.
 * @returns The line.
 */
export function rowValue(row: RepoDetectionRow): string {
  return row.rowKey === "conventions" && row.value === LEGACY_CONVENTIONS_LINE
    ? CONVENTIONS_LINE
    : row.value;
}

/**
 * Whether a row is the conventions warn row — the one that points at the knowledge roadmap.
 *
 * @param row The row.
 * @returns True for it.
 */
export function pointsAtRoadmap(row: RepoDetectionRow): boolean {
  return row.rowKey === "conventions" && row.verdict === "warn" && row.determined;
}

/**
 * `scanned in 38s` — from the scan's real duration, never a constant.
 *
 * @param durationMs How long the scan took.
 * @returns The tag's text.
 */
export function scannedIn(durationMs: number): string {
  const seconds = Math.max(1, Math.round(durationMs / 1000));

  if (seconds < 60) return `scanned in ${String(seconds)}s`;

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;

  return rest === 0
    ? `scanned in ${String(minutes)}m`
    : `scanned in ${String(minutes)}m ${String(rest)}s`;
}

/**
 * The progress line while a scan runs.
 *
 * @param progress The running scan's progress.
 * @returns `Scanning — 4 of 9 probes settled`, or `Scanning — planning probes` before any is planned.
 */
export function progressLine(progress: RepoDetectionProgress): string {
  if (progress.probesPlanned === 0) return "Scanning — planning probes…";

  return `Scanning — ${String(progress.probesSettled)} of ${String(progress.probesPlanned)} probes settled…`;
}

/**
 * The share of the running scan's probes that settled, for a meter.
 *
 * @param progress The progress.
 * @returns 0–1; 0 before any probe is planned.
 */
export function progressFraction(progress: RepoDetectionProgress): number {
  if (progress.probesPlanned === 0) return 0;

  return Math.min(1, progress.probesSettled / progress.probesPlanned);
}

/** The progress meter's accessible name. */
export const PROGRESS_LABEL = "Scan progress";

/**
 * How long until the service would take another scan — its debounce, stated so the button can
 * say so instead of being refused.
 *
 * @param progress The last scan's progress, or null.
 * @param now The clock, in epoch milliseconds.
 * @returns Whole seconds to wait, or 0 when a scan may start.
 */
export function rescanWait(progress: RepoDetectionProgress | null, now: number): number {
  if (progress === null) return 0;

  const elapsed = (now - Date.parse(progress.startedAt)) / 1000;

  return elapsed >= RESCAN_INTERVAL_SECONDS || Number.isNaN(elapsed)
    ? 0
    : Math.ceil(RESCAN_INTERVAL_SECONDS - elapsed);
}

/**
 * The re-scan button's reason for being held, in the debounce window.
 *
 * @param seconds Seconds to wait.
 * @returns The sentence.
 */
export function rescanWaitReason(seconds: number): string {
  return `Scanned a moment ago — re-scan in ${String(seconds)}s.`;
}

/**
 * One probe a row read, as a person reads it.
 *
 * @param probe The service's probe key — `languages`, `tree`, `file:<path>`.
 * @returns The line.
 */
export function probeLine(probe: string): string {
  if (probe === "languages") return "Read the repository's language breakdown";
  if (probe === "tree") return "Listed the repository's file tree";
  if (probe.startsWith("file:")) return `Read ${probe.slice("file:".length)}`;

  return probe;
}

/** A row's evidence, as the popover lists it. */
export interface EvidenceView {
  /** The probe hits — what was read to conclude the row. */
  readonly probes: readonly string[];
  /** What was found, when the row names one file. */
  readonly found: string | null;
  /** Probes that did not finish, for an undetermined row. */
  readonly unfinished: readonly string[];
  /** The rule pack and version that concluded it — `build 1.0.0`. */
  readonly pack: string | null;
  /** The confidence the pack gave, when it gave one. */
  readonly confidence: string | null;
}

/**
 * A row's evidence, read defensively — its shape is the pack's, so anything missing is left out
 * rather than guessed.
 *
 * @param row The row.
 * @returns What the popover lists.
 */
export function evidenceLines(row: RepoDetectionRow): EvidenceView {
  const evidence = row.evidence;
  const probes = Array.isArray(evidence.probes)
    ? evidence.probes.filter((probe): probe is string => typeof probe === "string").map(probeLine)
    : [];
  const unfinished = Array.isArray(evidence.unfinished)
    ? evidence.unfinished.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) return [];

        const { probe, status, reason } = entry as {
          probe?: unknown;
          status?: unknown;
          reason?: unknown;
        };
        if (typeof probe !== "string") return [];

        const why = [status, reason].filter(
          (part): part is string => typeof part === "string" && part !== "",
        );

        return [`${probeLine(probe)} — ${why.length === 0 ? "did not finish" : why.join(", ")}`];
      })
    : [];
  const pack = typeof evidence.pack === "string" ? evidence.pack : null;
  const version =
    typeof evidence.packVersion === "string"
      ? evidence.packVersion
      : typeof evidence.version === "string"
        ? evidence.version
        : null;

  return {
    probes,
    found: typeof evidence.hit === "string" ? evidence.hit : null,
    unfinished,
    pack: pack === null ? null : version === null ? pack : `${pack} ${version}`,
    confidence: row.confidence,
  };
}

/**
 * The protected-paths row's summary — the mockup's `boot/, keys/` and its provenance.
 *
 * @param paths The stored policies.
 * @returns The globs as chips print them, and `suggested`, `edited` or both.
 */
export function protectedSummary(paths: RepoDetection["protectedPaths"]): {
  readonly globs: string;
  readonly provenance: string;
} {
  if (paths.length === 0) return { globs: PROTECTED_NONE, provenance: "" };

  const sources = new Set(paths.map((path) => path.source));
  const provenance = sources.size === 2 ? "suggested and edited" : [...sources][0]!;

  return {
    globs: paths.map((path) => globChip(path.glob)).join(", "),
    provenance,
  };
}

/**
 * Whether two glob lists differ, order aside.
 *
 * @param a One list.
 * @param b The other.
 * @returns True when they hold different globs.
 */
export function globsChanged(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return true;

  const sorted = [...b].sort();

  return [...a].sort().some((glob, index) => glob !== sorted[index]);
}
