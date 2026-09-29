/**
 * The failure-detail card, as data ([#339](https://github.com/NobuData/ouroboros/issues/339)) —
 * mockup 11's path line, log block, pager and triage section, decided here and drawn by
 * `failure-card.tsx`.
 *
 * **The card is bound by the page's two selections** ({@link failureScope}). A physical case
 * selected in the physical-tests card ([#338](https://github.com/NobuData/ouroboros/issues/338))
 * is the card's one failure — the mockup's `1 of 1`. With no case selected, the suite selected in
 * the suites card ([#337](https://github.com/NobuData/ouroboros/issues/337)) scopes it to that
 * suite's failures, and with nothing selected it holds every failure of the attempt. A *failure*
 * is a case that has a failure payload to read (`hasFailure`), in the payload's order.
 *
 * **The log is drawn as it came** ({@link logLines}): one row per line, whitespace kept, the
 * assertion in the err hue and a trial's percentage in the code block's figure hue. Nothing is
 * reworded, and a failure that carried only a message is that message.
 *
 * **The triage section is decided by the payload's `actor`, not by copy** ({@link triageView}).
 * This is the page's most consequential honesty rule: a confidence percentage and a model pill
 * both assert that a model was involved, and until AV.1
 * ([#343](https://github.com/NobuData/ouroboros/issues/343)) none is. So {@link TriageView} is a
 * union whose only variant *able to carry* a confidence or a model name is `model`, and that
 * variant is built only from an answer whose `provenance.actor` is `model`. A heuristic answer —
 * whatever else a malformed payload put beside it — becomes the hint with its rule stated and its
 * `heuristic` chip, above the designed slot that says the AI narrative arrives with the provider
 * stack.
 *
 * **The triage timestamp is not drawn.** The mockup's `triaged 14:44:52` is not a field of
 * `triage/v0`; it arrives with #343's payload, and the card prints nothing it was not told.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type {
  CaseHint,
  TestCaseFailureDetail,
  TestCaseResult,
  TestRunHints,
  TestSuiteResult,
} from "@/app/api/test-results";

import type { CaseScope } from "./physical";
import type { SuiteScope } from "./suites";

/** The card's title — the mockup's `FAILURE DETAIL`. */
export const FAILURE_TITLE = "Failure detail";

/** What the card says while the attempt's page has not been read. */
export const READING_FAILURES = "Reading the failures…";

/** What the card says while the bound case's failure has not been read. */
export const READING_FAILURE = "Reading the failure…";

/** What the card says when the attempt has no failure. */
export const NO_FAILURES = "This build has no failures.";

/** What the card says when the failure carried neither a log nor a message. */
export const NO_LOG = "This failure carried no log.";

/** The headline over a failure that could not be refreshed. */
export const FAILURE_STALE_HEADLINE = "The failure could not be refreshed";

/** The headline over a failure that could not be read at all. */
export const FAILURE_UNREAD_HEADLINE = "The failure could not be read";

/** The path line's accessible name. */
export const PATH_LABEL = "Test path";

/** The log block's accessible name. */
export const LOG_LABEL = "Failure log";

/** The pager's accessible name. */
export const PAGER_LABEL = "Failures in scope";

/** The pager's two buttons. */
export const PREVIOUS_FAILURE = "Previous failure";
export const NEXT_FAILURE = "Next failure";

/** What separates a path from the case's name — pytest's node id, as the mockup draws it. */
export const PATH_SEPARATOR = "::";

/** The triage section's eyebrow while no model is involved. */
export const TRIAGE_EYEBROW = "Triage";

/** The triage section's eyebrow over a model's narrative — the mockup's `AI Triage`. */
export const AI_TRIAGE_EYEBROW = "AI Triage";

/** The chip a heuristic hint carries. */
export const HEURISTIC_CHIP = "heuristic";

/** What goes before a hint's rule. */
export const RULE_PREFIX = "rule:";

/** What the triage section says while the hints have not been read. */
export const READING_HINT = "Reading the triage hint…";

/** What the triage section says when no rule fired for the failure. */
export const NO_HINT = "No heuristic rule fired for this failure.";

/** The designed slot's headline. */
export const AI_SLOT_TITLE = "AI triage arrives with the provider stack";

/** The designed slot's sentence. */
export const AI_SLOT_BODY =
  "A model's narrative of this failure — with the model that wrote it and its confidence — will appear here once a provider is connected.";

/** What goes before a model's confidence. */
export const CONFIDENCE_PREFIX = "confidence";

/** The arrow between a rule's condition and the class it suggests. */
const SUGGESTS = "→";

/** What each heuristic rule tests, as the card states it (`triage.rules.ts`, #332). */
const RULE_CONDITION: Readonly<Record<string, string>> = {
  "flake.pass_on_retry": "passed on a sanctioned retry",
  "infra.rig_error": "job, runner or failure text names infrastructure",
  "product.new_failure_in_diff": "new failure ∩ diff-path overlap",
};

/** What each class is called — the Mark & Route card's four radios, in the hint's lower case. */
const CLASS_LABEL: Readonly<Record<string, string>> = {
  product_bug: "product bug",
  test_update: "test needs update",
  flake_retry: "flake — retry",
  infra_rig: "infra — rig issue",
};

/** The actor a triage answer must state for a model's fields to be drawn. */
const MODEL_ACTOR = "model";

/** The actor a heuristic answer states. */
const HEURISTIC_ACTOR = "heuristic";

/** pytest's marker before an error line — `E   AssertionError: …`. */
const ERROR_MARKER = /^E\s/;

/** A figure with its percent sign — a trial's `2.4%`. */
const PERCENTAGE = /\d+(?:\.\d+)?%/g;

// --- the scope ----------------------------------------------------------------------------------

/** One failure the card can be bound to. */
export interface FailureEntry {
  /** The case's id *in the attempt on screen*. */
  readonly caseId: string;
  readonly name: string;
  /** The name of the suite it ran in. */
  readonly suite: string;
  readonly platform: string;
  readonly status: TestCaseResult["status"];
}

/** The failures the page's selections leave on the card. */
export interface FailureScope {
  /** The failures, in the payload's order. */
  readonly entries: readonly FailureEntry[];
  /** What the card says in place of a failure, or `null` when it has some. */
  readonly note: string | null;
}

/**
 * What the card says when the selected case has no failure to show.
 *
 * @param name The selected case.
 * @param attemptSeq The attempt on screen.
 * @returns `power_loss_recovery did not fail in Build 3.`
 */
export function didNotFail(name: string, attemptSeq: number): string {
  return `${name} did not fail in Build ${attemptSeq}.`;
}

/**
 * What the card says when the selected suite has no failure.
 *
 * @param suite The selected suite's name.
 * @param attemptSeq The attempt on screen.
 * @returns `unit · drivers has no failures in Build 3.`
 */
export function noFailuresIn(suite: string, attemptSeq: number): string {
  return `${suite} has no failures in Build ${attemptSeq}.`;
}

/**
 * The failures the page's selections leave on the card.
 *
 * @param suites The attempt's suites.
 * @param suiteScope The suite selected in the suites card, or `null`.
 * @param caseScope The case selected in the physical-tests card, or `null`.
 * @param attemptSeq The attempt on screen — for the note.
 * @returns The selected case alone when one is selected — or the note that it did not fail;
 *   otherwise every case with a failure payload in the selected suite, or in the whole attempt
 *   when no suite is selected. Never a case outside the selection.
 */
export function failureScope(
  suites: readonly TestSuiteResult[],
  suiteScope: SuiteScope | null,
  caseScope: CaseScope | null,
  attemptSeq: number,
): FailureScope {
  const entries = suites
    .filter((suite) => suiteScope === null || suite.id === suiteScope.id)
    .flatMap((suite) =>
      suite.cases
        .filter((each) => each.hasFailure && (caseScope === null || each.id === caseScope.caseId))
        .map(
          (each): FailureEntry => ({
            caseId: each.id,
            name: each.name,
            suite: suite.name,
            platform: suite.platform,
            status: each.status,
          }),
        ),
    );

  if (entries.length > 0) return { entries, note: null };

  return {
    entries,
    note:
      caseScope !== null
        ? didNotFail(caseScope.name, attemptSeq)
        : suiteScope !== null
          ? noFailuresIn(suiteScope.name, attemptSeq)
          : NO_FAILURES,
  };
}

// --- the pager ----------------------------------------------------------------------------------

/** The `1 of N` pill and what its buttons lead to. */
export interface PagerView {
  /** `1 of 3`. */
  readonly text: string;
  /** What a screen reader hears — `Failure 1 of 3`. */
  readonly label: string;
  /** Whether there is more than one failure to page through. */
  readonly paged: boolean;
  /** The failure before the one on the card, or `null` at the first. */
  readonly previous: string | null;
  /** The failure after the one on the card, or `null` at the last. */
  readonly next: string | null;
}

/**
 * Which failure the card is bound to.
 *
 * @param entries The failures in scope.
 * @param position The case the pager was moved to, or `null` when it has not been moved.
 * @returns The index of that case — or `0`, the first, when the pager has not been moved or the
 *   case is no longer in scope; `-1` when there is no failure at all.
 */
export function boundIndex(entries: readonly FailureEntry[], position: string | null): number {
  if (entries.length === 0) return -1;

  const at = entries.findIndex((each) => each.caseId === position);

  return at < 0 ? 0 : at;
}

/**
 * The pager over the failures in scope.
 *
 * @param entries The failures in scope.
 * @param index The bound failure's index, from {@link boundIndex}.
 * @returns The pager, or `null` when there is no failure to count.
 */
export function pagerView(entries: readonly FailureEntry[], index: number): PagerView | null {
  if (index < 0 || index >= entries.length) return null;

  const count = `${index + 1} of ${entries.length}`;

  return {
    text: count,
    label: `Failure ${count}`,
    paged: entries.length > 1,
    previous: entries[index - 1]?.caseId ?? null,
    next: entries[index + 1]?.caseId ?? null,
  };
}

/**
 * Which failure a key moves the pager to.
 *
 * @param key The key pressed — `KeyboardEvent.key`.
 * @param index The bound failure's index.
 * @param count How many failures are in scope.
 * @returns The index to bind — `ArrowRight`/`ArrowLeft` step and stop at the ends, `Home`/`End`
 *   jump — or `null` for any other key, or when there is nowhere to go.
 */
export function pagerStep(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;

  const target =
    key === "ArrowRight"
      ? Math.min(count - 1, index + 1)
      : key === "ArrowLeft"
        ? Math.max(0, index - 1)
        : key === "Home"
          ? 0
          : key === "End"
            ? count - 1
            : null;

  return target === null || target === index ? null : target;
}

// --- the path and the log -----------------------------------------------------------------------

/**
 * The card's path line.
 *
 * @param failure The failure payload.
 * @returns `tests/hil/test_estop_release.py::overshoot_under_load` — the path, or the classname
 *   when the failure names no path, before the case's name; the name alone when it has neither.
 */
export function pathLine(
  failure: Pick<TestCaseFailureDetail, "path" | "classname" | "name">,
): string {
  const path = failure.path?.trim() ?? "";
  const classname = failure.classname?.trim() ?? "";
  const container = path !== "" ? path : classname;

  return container === "" ? failure.name : `${container}${PATH_SEPARATOR}${failure.name}`;
}

/** A run of a log line's characters. */
export interface LogSegmentView {
  readonly text: string;
  /** Whether the run is a figure — a trial's percentage, drawn in the figure hue. */
  readonly figure: boolean;
}

/** One line of the log block. */
export interface LogLineView {
  /** The line's position, which keys it. */
  readonly index: number;
  /** `err` for the assertion, `plain` for everything else. */
  readonly tone: "plain" | "err";
  /** The line's characters, in order. Joined, they are the line exactly as it came. */
  readonly segments: readonly LogSegmentView[];
}

/**
 * Whether a log line is the failure's assertion.
 *
 * @param line The line.
 * @param message The failure's message, trimmed, or `""` when it has none.
 * @returns `true` for a line carrying pytest's `E` marker, or one that states the message.
 */
export function isErrorLine(line: string, message: string): boolean {
  return ERROR_MARKER.test(line) || (message !== "" && line.includes(message));
}

/**
 * A line's characters, with its percentages marked.
 *
 * @param line The line.
 * @returns The runs, in order — never empty, so an empty line still takes its row.
 */
export function figureSegments(line: string): LogSegmentView[] {
  const segments: LogSegmentView[] = [];
  let from = 0;

  for (const match of line.matchAll(PERCENTAGE)) {
    if (match.index > from) segments.push({ text: line.slice(from, match.index), figure: false });

    segments.push({ text: match[0], figure: true });
    from = match.index + match[0].length;
  }

  if (from < line.length || segments.length === 0) {
    segments.push({ text: line.slice(from), figure: false });
  }

  return segments;
}

/**
 * The log block's lines.
 *
 * @param failure The failure payload.
 * @returns The log excerpt, line by line and character for character, the assertion in the err
 *   tone. A failure whose excerpt does not state its message has the message as a last line, and
 *   one with no excerpt is its message alone. Empty when the failure carried neither.
 */
export function logLines(
  failure: Pick<TestCaseFailureDetail, "logExcerpt" | "message">,
): LogLineView[] {
  const message = failure.message?.trim() ?? "";
  const excerpt = failure.logExcerpt ?? "";
  const lines = excerpt.trim() === "" ? [] : excerpt.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");

  if (message !== "" && !lines.some((line) => line.includes(message))) lines.push(message);

  return lines.map((line, index) => {
    const failed = isErrorLine(line, message);

    return {
      index,
      tone: failed ? "err" : "plain",
      segments: failed ? [{ text: line, figure: false }] : figureSegments(line),
    };
  });
}

// --- the triage section -------------------------------------------------------------------------

/**
 * The triage section.
 *
 * Only `model` has a confidence or a model's name to draw, and only {@link triageView} builds
 * one — from an answer whose actor is `model`.
 */
export type TriageView =
  /** The hints have not been read. */
  | { readonly kind: "reading" }
  /** The hints could not be read, and none are held. */
  | { readonly kind: "unread"; readonly reason: string }
  /** No rule fired for the failure. */
  | { readonly kind: "none" }
  /** A heuristic hint: its rule, stated, and why it fired. */
  | {
      readonly kind: "heuristic";
      /** `new failure ∩ diff-path overlap → product bug`. */
      readonly rule: string;
      /** The rule's id — `product.new_failure_in_diff` — or `null` when the answer names none. */
      readonly ruleId: string | null;
      /** Why the rule fired, in the service's sentence, or `null` when it gave none. */
      readonly reason: string | null;
    }
  /** A model's answer (#343). */
  | {
      readonly kind: "model";
      readonly narrative: string;
      /** The model that wrote it, or `null` when the answer names none. */
      readonly model: string | null;
      /** `84%`, or `null` when the answer carries no confidence that can be read as one. */
      readonly confidence: string | null;
    };

/**
 * A field of something that may not be an object.
 *
 * @param value Anything.
 * @param key The field.
 * @returns The field's value, or `undefined`.
 */
function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/**
 * A field as text.
 *
 * @param value Anything.
 * @param key The field.
 * @returns The field trimmed, or `null` when it is absent, not a string, or blank.
 */
function text(value: unknown, key: string): string | null {
  const found = field(value, key);

  return typeof found === "string" && found.trim() !== "" ? found.trim() : null;
}

/**
 * What a rule tests, as the page states it — the failure card's hint and the Mark & Route card's
 * `heuristic` affix ([#340](https://github.com/NobuData/ouroboros/issues/340)) say it in the same
 * words.
 *
 * @param ruleId The rule's id, or `null`.
 * @returns `new failure ∩ diff-path overlap`; a rule this client does not know is its id, and
 *   `null` is `null`.
 */
export function ruleCondition(ruleId: string | null): string | null {
  return ruleId === null ? null : (RULE_CONDITION[ruleId] ?? ruleId);
}

/**
 * A rule, stated.
 *
 * @param ruleId The rule's id, or `null`.
 * @param suggestedClass The class it suggests, or `null`.
 * @returns `new failure ∩ diff-path overlap → product bug`. A rule or a class this client does
 *   not know is printed as it came.
 */
export function ruleText(ruleId: string | null, suggestedClass: string | null): string {
  const condition = ruleCondition(ruleId);
  const suggested = suggestedClass === null ? null : (CLASS_LABEL[suggestedClass] ?? suggestedClass);

  return [condition, suggested].filter((part) => part !== null).join(` ${SUGGESTS} `);
}

/**
 * A model's confidence, as a percentage.
 *
 * @param confidence The answer's `confidence`.
 * @returns `84%` for a number from 0 to 100, else `null`.
 */
export function confidenceText(confidence: unknown): string | null {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  if (confidence < 0 || confidence > 100) return null;

  return `${Math.round(confidence)}%`;
}

/**
 * Who answered a case's triage.
 *
 * @param entry The case's hint entry.
 * @returns `model` only for an answer whose `provenance.actor` says so; `heuristic` for one that
 *   says that, or whose hint does; `null` when nothing answered.
 */
export function triageActor(entry: CaseHint): "model" | "heuristic" | null {
  const stated = field(field(entry.triage, "provenance"), "actor");

  if (stated === MODEL_ACTOR) return MODEL_ACTOR;
  if (stated === HEURISTIC_ACTOR || entry.hint !== null) return HEURISTIC_ACTOR;

  return null;
}

/**
 * One case's triage, from its hint entry.
 *
 * @param entry The case's hint entry.
 * @returns The model's narrative when the answer's actor is `model` and it wrote one; otherwise
 *   the heuristic hint — also the fallback when a model answered nothing readable — or `none`.
 *   **A confidence and a model's name are read only on the `model` path.**
 */
export function caseTriage(entry: CaseHint): TriageView {
  const actor = triageActor(entry);
  const narrative = text(entry.triage, "narrative");

  if (actor === MODEL_ACTOR && narrative !== null) {
    return {
      kind: "model",
      narrative,
      model: text(field(entry.triage, "provenance"), "model"),
      confidence: confidenceText(field(entry.triage, "confidence")),
    };
  }

  // The model path ends above. From here nothing reads `confidence` or `provenance.model`.
  const stated = actor === MODEL_ACTOR ? null : field(entry.triage, "provenance");
  const ruleId = text(entry.hint, "ruleId") ?? text(stated, "rule_id");
  const suggested =
    text(entry.hint, "suggestedClass") ?? (stated === null ? null : text(entry.triage, "class"));

  if (ruleId === null && suggested === null) return { kind: "none" };

  return {
    kind: "heuristic",
    rule: ruleText(ruleId, suggested),
    ruleId,
    reason: text(entry.hint, "reason"),
  };
}

/**
 * The triage section for the bound failure.
 *
 * @param hints The attempt's hints, or `null` when they have not been read.
 * @param caseId The bound case's id.
 * @param error Why the hints could not be read, or `null`.
 * @returns The section. Hints that are held are drawn even when a refresh failed; with none
 *   held, the section says why, or that it is reading.
 */
export function triageView(
  hints: TestRunHints | null,
  caseId: string,
  error: string | null,
): TriageView {
  if (hints === null) return error === null ? { kind: "reading" } : { kind: "unread", reason: error };

  const entry = hints.cases.find((each) => each.caseId === caseId);

  return entry === undefined ? { kind: "none" } : caseTriage(entry);
}

/**
 * The tag that names the attempt — the mockup's `build 3`.
 *
 * @param attemptSeq The attempt on screen.
 * @returns `build 3`.
 */
export function buildTag(attemptSeq: number): string {
  return `build ${attemptSeq}`;
}
