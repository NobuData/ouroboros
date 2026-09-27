/**
 * The composed mono line each evidence row stores beside its typed reference — AX.3
 * ([#359](https://github.com/NobuData/ouroboros/issues/359)), decision **V6**.
 *
 * ```
 * test_case        test_frame_order_under_load (10⁶ frames, 0 reordered)
 * hil_measurement  HIL overshoot 1.7% vs 2.0% limit (was 2.4% in build 3)
 * hunk             hunk telemetry_buf.c:41–66
 * analysis_note    static K_MSGQ_DEFINE · stack analysis clean
 * build_artifact   artifact rig-trace.pcap
 * ```
 *
 * **A rendering of the reference, never a substitute for one.** Each line is built from the row
 * the reference resolved to, so it cannot name a test that did not run or a figure that was not
 * measured. The caller's optional `note` is the one free-text part — a qualifier such as
 * `10⁶ frames, 0 reordered` — and it is appended in parentheses, never in place of the name.
 * An analysis note is the exception by nature: a reading of the code, whose text *is* the evidence
 * (V057's header), held to the revision it read.
 *
 * Stored rather than joined at read time, so the matrix renders without N joins. Every function
 * here is pure; the service resolves the rows and hands them in.
 */

import type { HilLimitKind, TestCaseStatus } from "../../db/schema";

/** `pr_criteria_evidence_display_text_bounded` — at most 512 characters. */
export const MAX_DISPLAY_TEXT = 512;

/** The fields of a test case the line is built from. */
export interface CaseForDisplay {
  readonly name: string;
  readonly status: TestCaseStatus;
}

/** The fields of a HIL measurement the line is built from. */
export interface MeasurementForDisplay {
  readonly metric: string;
  /** `numeric`, as the driver returns it — `1.7`. */
  readonly value: string;
  readonly unit: string;
  readonly limit_value: string;
  readonly limit_kind: HilLimitKind;
  /** V053's composed comparative — `was 2.4% in build 3` — or null. */
  readonly context: string | null;
}

/** The fields of a hunk the line is built from. */
export interface HunkForDisplay {
  readonly path: string;
  readonly lineStart: number;
  readonly lineEnd: number;
}

/**
 * A test case's line: its name, its status when it did not pass, then the qualifier.
 *
 * @param testCase - The case the reference resolved to.
 * @param note - The caller's qualifier, or null.
 * @returns `frame_order_under_load (10⁶ frames, 0 reordered)`, `boot_ok · flaky`.
 */
export function testCaseLine(testCase: CaseForDisplay, note: string | null): string {
  const status = testCase.status === "passed" ? "" : ` · ${testCase.status}`;

  return qualified(`${testCase.name}${status}`, note);
}

/**
 * A HIL measurement's line: the metric, the value against its limit, and V053's comparative.
 *
 * The unit is written the way V053 writes the comparative — glued to the number, and absent for a
 * `count` — so the two halves of the line read alike.
 *
 * @param measurement - The measurement the reference resolved to.
 * @param note - The caller's qualifier, or null. Printed after the comparative.
 * @returns `HIL overshoot 1.7% vs 2.0% limit (was 2.4% in build 3)`.
 */
export function measurementLine(measurement: MeasurementForDisplay, note: string | null): string {
  const unit = measurement.unit === "count" ? "" : measurement.unit;
  const bound = measurement.limit_kind === "max" ? "limit" : "minimum";
  const base =
    `HIL ${measurement.metric} ${measurement.value}${unit} ` +
    `vs ${measurement.limit_value}${unit} ${bound}`;

  return qualified(qualified(base, measurement.context), note);
}

/**
 * A hunk's line: the file's base name and the range, as the matrix prints a hunk ref.
 *
 * @param hunk - The path and range, already checked against the revision's snapshot.
 * @param note - The caller's qualifier, or null.
 * @returns `hunk telemetry_buf.c:41–66`, or `hunk main.c:7` for a one-line range.
 */
export function hunkLine(hunk: HunkForDisplay, note: string | null): string {
  const name = hunk.path.split("/").pop() ?? hunk.path;
  const range =
    hunk.lineStart === hunk.lineEnd
      ? String(hunk.lineStart)
      : `${String(hunk.lineStart)}–${String(hunk.lineEnd)}`;

  return qualified(`hunk ${name}:${range}`, note);
}

/**
 * An uploaded artifact's line.
 *
 * @param name - `test_artifacts.name`.
 * @param note - The caller's qualifier, or null.
 * @returns `artifact rig-trace.pcap`.
 */
export function artifactLine(name: string, note: string | null): string {
  return qualified(`artifact ${name}`, note);
}

/**
 * An analysis note's line — its text, which is the evidence.
 *
 * @param note - The reading, non-blank (the DTO holds it to that).
 * @returns The note, bounded.
 */
export function analysisNoteLine(note: string): string {
  return bounded(note.trim());
}

/**
 * A line with a parenthesised qualifier, when there is one.
 *
 * @param base - What the reference resolved to.
 * @param note - The qualifier, or null / blank for none.
 * @returns `base (note)`, bounded.
 */
function qualified(base: string, note: string | null): string {
  const extra = note?.trim() ?? "";

  return bounded(extra === "" ? base : `${base} (${extra})`);
}

/**
 * A line held to {@link MAX_DISPLAY_TEXT}, cut with an ellipsis rather than refused — the
 * reference is what the row is, and a long test name must not make it unciteable.
 *
 * @param line - The line.
 * @returns The line, at most 512 characters.
 */
function bounded(line: string): string {
  return line.length <= MAX_DISPLAY_TEXT ? line : `${line.slice(0, MAX_DISPLAY_TEXT - 1)}…`;
}
