/**
 * What the evidence picker offers ([#366](https://github.com/NobuData/ouroboros/issues/366)) —
 * decided here, drawn by `evidence-dialog.tsx`.
 *
 * ```
 * What to cite   ( Test · Measurement · Hunk )
 * Test           telemetry integration · native_sim · test_frame_order_under_load
 * Qualifier      10⁶ frames, 0 reordered
 * ```
 *
 * **The picker only offers things that exist**, so a dangling reference cannot be constructed:
 * tests and measurements are the rows of the attempt the latest revision was judged on, and
 * hunks are ranges of the paths in the latest revision's files snapshot. The service resolves
 * every reference again before it stores one (#359) — the picker is what makes the honest
 * choice the easy one, not what enforces it.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type { AttachEvidenceRequest, PrFiles, PullRequestPage } from "@/app/api/pull-requests";
import type { TestAttempt, TestRunPage } from "@/app/api/test-results";

import { type Hunk, isHunk } from "./hunk";

/** The kinds the picker cites. */
export type PickerKind = "test_case" | "hil_measurement" | "hunk";

/** The kinds, in the picker's order, with what each is called. */
export const PICKER_KINDS: readonly { readonly kind: PickerKind; readonly label: string }[] = [
  { kind: "test_case", label: "Test" },
  { kind: "hil_measurement", label: "Measurement" },
  { kind: "hunk", label: "Hunk" },
];

/** The longest qualifier a citation carries — the service's `MAX_EVIDENCE_NOTE_LENGTH`. */
export const MAX_QUALIFIER_LENGTH = 512;

/** A case key as the service accepts one — 64 lowercase hex digits. */
export const CASE_KEY_PATTERN = /^[0-9a-f]{64}$/;

/** Why no test or measurement is offered for a PR no loop opened. */
export const NO_RUN_TO_CITE = "No loop opened this PR, so it has no test results to cite.";

/** Why no test or measurement is offered for a run that has not been tested. */
export const NO_ATTEMPT_TO_CITE = "This PR's run has no test attempt to cite yet.";

/** Why no test is offered. */
export const NO_TESTS_TO_CITE = "The attempt ran no test case that can be cited.";

/** Why no measurement is offered. */
export const NO_MEASUREMENTS_TO_CITE = "The attempt recorded no rig measurement.";

/** Why no hunk is offered. */
export const NO_FILES_TO_CITE = "The latest revision has no changed file to cite.";

/** One test the picker offers. */
export interface TestOption {
  /** The case's id in the attempt — the option's own key. */
  readonly id: string;
  /** The case's durable key — what the citation names. */
  readonly caseKey: string;
  /** `telemetry integration · native_sim · test_frame_order_under_load`. */
  readonly label: string;
}

/** One measurement the picker offers. */
export interface MeasurementOption {
  /** The measurement's id — what the citation names. */
  readonly id: string;
  /** `overshoot_under_load · overshoot_pct 1.7 % (limit 2 %)`. */
  readonly label: string;
}

/** The tests and measurements the picker offers. */
export interface EvidenceOptions {
  /** The attempt they are rows of, or `null` when there is none. */
  readonly attempt: { readonly id: string; readonly seq: number } | null;
  readonly tests: readonly TestOption[];
  readonly measurements: readonly MeasurementOption[];
  /** Why there is nothing to offer at all, or `null`. */
  readonly reason: string | null;
}

/**
 * Options for a PR with nothing to cite.
 *
 * @param reason Why.
 * @returns No attempt, no test, no measurement.
 */
export function noOptions(reason: string): EvidenceOptions {
  return { attempt: null, tests: [], measurements: [], reason };
}

/**
 * The attempt the picker reads.
 *
 * @param page The PR page.
 * @param attempts The run's attempts, oldest first.
 * @returns The attempt the latest revision was judged on, when the run has it — otherwise the
 *   run's latest attempt; `null` for a run that has none.
 */
export function pickerAttempt(
  page: PullRequestPage,
  attempts: readonly Pick<TestAttempt, "id" | "attemptSeq">[],
): { readonly id: string; readonly seq: number } | null {
  const judged = page.revisions.at(-1)?.testAttempt ?? null;
  const chosen =
    attempts.find((attempt) => attempt.id === judged?.id) ?? attempts.at(-1) ?? null;

  return chosen === null ? null : { id: chosen.id, seq: chosen.attemptSeq };
}

/**
 * The rows of an attempt the picker offers.
 *
 * @param attempt The attempt, from {@link pickerAttempt}.
 * @param results The attempt's page.
 * @returns Every case that ran — a `skipped` one did not, and the service refuses it — and every
 *   rig measurement, each named by where it sits.
 */
export function attemptOptions(
  attempt: { readonly id: string; readonly seq: number },
  results: Pick<TestRunPage, "suites" | "physical">,
): EvidenceOptions {
  const tests = results.suites.flatMap((suite) =>
    suite.cases
      .filter((each) => each.status !== "skipped" && CASE_KEY_PATTERN.test(each.caseKey))
      .map((each) => ({
        id: each.id,
        caseKey: each.caseKey,
        label: `${suite.name} · ${suite.platform} · ${each.name}`,
      })),
  );

  const measurements = results.physical.flatMap((physical) =>
    physical.measurements.map((each) => ({
      id: each.id,
      label:
        `${physical.name} · ${each.metric} ${each.value} ${each.unit} ` +
        `(${each.limitKind === "max" ? "limit" : "minimum"} ${each.limit} ${each.unit})`,
    })),
  );

  return { attempt, tests, measurements, reason: null };
}

/**
 * The paths a hunk can be cited in.
 *
 * @param files The latest revision's files snapshot, or `null`.
 * @returns Its paths, in the snapshot's order.
 */
export function hunkPaths(files: PrFiles | null): readonly string[] {
  return files === null ? [] : files.rows.map((row) => row.path);
}

/**
 * Why a kind has nothing to offer.
 *
 * @param kind The kind.
 * @param options The tests and measurements read, or `null` while they are being read.
 * @param paths The paths a hunk can be cited in.
 * @returns The reason, or `null` when the kind has something to offer or is still being read.
 */
export function emptyReason(
  kind: PickerKind,
  options: EvidenceOptions | null,
  paths: readonly string[],
): string | null {
  if (kind === "hunk") return paths.length === 0 ? NO_FILES_TO_CITE : null;
  if (options === null) return null;
  if (options.reason !== null) return options.reason;
  if (kind === "test_case") return options.tests.length === 0 ? NO_TESTS_TO_CITE : null;

  return options.measurements.length === 0 ? NO_MEASUREMENTS_TO_CITE : null;
}

/** What the picker's form holds. */
export interface PickerDraft {
  readonly kind: PickerKind;
  /** The chosen test's id among the options, or empty. */
  readonly testId: string;
  /** The chosen measurement's id, or empty. */
  readonly measurementId: string;
  /** The chosen path, or empty. */
  readonly path: string;
  /** The first line, as typed. */
  readonly lineStart: string;
  /** The last line, as typed. */
  readonly lineEnd: string;
  /** The qualifier, as typed. */
  readonly qualifier: string;
}

/** What a draft is checked against. */
export interface PickerOffer {
  readonly options: EvidenceOptions | null;
  readonly paths: readonly string[];
  /** The revision the paths are the snapshot of, or `null`. */
  readonly revisionId: string | null;
}

/** A draft, read: the reference to send, or why it cannot be sent yet. */
export type PickerReading =
  | { readonly ok: true; readonly request: AttachEvidenceRequest }
  | { readonly ok: false; readonly reason: string };

/** Why the picker's button waits before a test is chosen. */
export const CHOOSE_TEST = "Choose the test to cite.";

/** Why the picker's button waits before a measurement is chosen. */
export const CHOOSE_MEASUREMENT = "Choose the measurement to cite.";

/** Why the picker's button waits before a path is chosen. */
export const CHOOSE_PATH = "Choose the changed file the hunk is in.";

/** Why the picker's button waits while the range is not one. */
export const RANGE_INVALID =
  "Give the hunk's first and last line — whole numbers from 1, the last not before the first.";

/** Why the picker's button waits while the qualifier is too long. */
export const QUALIFIER_TOO_LONG = `A qualifier is at most ${MAX_QUALIFIER_LENGTH} characters.`;

/**
 * A line as typed.
 *
 * @param typed The field's text.
 * @returns The line, or `null` for anything but digits naming a whole number from 1.
 */
export function typedLine(typed: string): number | null {
  const text = typed.trim();

  return /^[1-9]\d{0,9}$/.test(text) ? Number(text) : null;
}

/**
 * Read the picker's form.
 *
 * @param draft What the form holds.
 * @param offer What the picker offers — a choice is honoured only when it is one of these.
 * @returns The reference to send, or the reason the button waits. The qualifier is sent trimmed,
 *   and left out when blank. A hunk is pinned to the revision its paths were read from.
 */
export function readDraft(draft: PickerDraft, offer: PickerOffer): PickerReading {
  const qualifier = draft.qualifier.trim();
  if (qualifier.length > MAX_QUALIFIER_LENGTH) return { ok: false, reason: QUALIFIER_TOO_LONG };

  const note = qualifier === "" ? {} : { note: qualifier };

  if (draft.kind === "test_case") {
    const test = offer.options?.tests.find((each) => each.id === draft.testId);
    const attempt = offer.options?.attempt ?? null;
    if (test === undefined || attempt === null) return { ok: false, reason: CHOOSE_TEST };

    return {
      ok: true,
      request: { kind: "test_case", caseKey: test.caseKey, testRunId: attempt.id, ...note },
    };
  }

  if (draft.kind === "hil_measurement") {
    const measurement = offer.options?.measurements.find(
      (each) => each.id === draft.measurementId,
    );
    if (measurement === undefined) return { ok: false, reason: CHOOSE_MEASUREMENT };

    return {
      ok: true,
      request: { kind: "hil_measurement", hilMeasurementId: measurement.id, ...note },
    };
  }

  if (!offer.paths.includes(draft.path)) return { ok: false, reason: CHOOSE_PATH };

  const hunk: Partial<Hunk> = {
    path: draft.path,
    lineStart: typedLine(draft.lineStart) ?? undefined,
    lineEnd: typedLine(draft.lineEnd) ?? undefined,
  };
  if (!isHunk(hunk)) return { ok: false, reason: RANGE_INVALID };

  return {
    ok: true,
    request: {
      kind: "hunk",
      path: hunk.path,
      lineStart: hunk.lineStart,
      lineEnd: hunk.lineEnd,
      ...(offer.revisionId === null ? {} : { revisionId: offer.revisionId }),
      ...note,
    },
  };
}
