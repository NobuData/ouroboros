/**
 * The suites card, as data ([#337](https://github.com/NobuData/ouroboros/issues/337)) — mockup
 * 11's suite rows, their selection and the case drill, decided here and drawn by
 * `suites-card.tsx`.
 *
 * **Selection is a name.** A suite's id belongs to one attempt; its name is what Build 2 and
 * Build 3 have in common. So the page holds — and `?suite=` carries — the suite's *name*, and
 * {@link resolveSuite} finds it again in whichever attempt is on screen. A name the attempt does
 * not have resolves to nothing: the selection is cleared and said to be, never handed to another
 * suite.
 *
 * **A row's hue is its status, not its ratio** ({@link suiteTone}). The payload states no status
 * for a suite, so it is read from what the payload does state — its counts and its kind — by the
 * rule decided on #337: a suite with nothing failing is `ok`; one with something failing is `err`
 * when simulated and `warn` when it ran on a rig. `1/2` on the rig is `warn` and `18/19` in the
 * simulator is `err`, which a scale proportional to the ratio would draw the other way round.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type { TestCaseResult, TestSuiteResult } from "@/app/api/test-results";
import { spanOfMs } from "@/app/format";
import type { ChipTone, MeterTone } from "@/app/ui";

/** The card's title — the mockup's `SUITES`. */
export const SUITES_TITLE = "Suites";

/** The rows' accessible name. */
export const SUITES_LIST_LABEL = "Suites, select one to scope the page";

/** What the card says while the attempt's page has not been read. */
export const READING_SUITES = "Reading the suites…";

/** What the card says when the attempt reported no suite. */
export const NO_SUITES = "This build reported no suites.";

/** The headline over suites that could not be refreshed. */
export const SUITES_STALE_HEADLINE = "The suites could not be refreshed";

/** The headline over suites that could not be read at all. */
export const SUITES_UNREAD_HEADLINE = "The suites could not be read";

/** What a suite's drill says when it holds no case. */
export const NO_CASES = "This suite reported no cases.";

/** What goes before a rig suite's name — the mockup's `PHYSICAL · HIL rig`. */
export const PHYSICAL_PREFIX = "PHYSICAL";

/** The longest suite name `?suite=` is read as; anything longer is nobody's suite. */
export const SUITE_NAME_LIMIT = 200;

/** A millisecond count below which a case's duration is drawn in milliseconds. */
const ONE_SECOND_MS = 1000;

/** How a suite went: nothing failing, failing on a rig, failing in simulation, or nothing ran. */
export type SuiteTone = "ok" | "warn" | "err" | "neutral";

/** The suite the page has selected, as it is remembered between attempts. */
export interface SuiteSelection {
  /** The suite's name — what `?suite=` carries. */
  readonly name: string;
  /**
   * The platform it was selected on, or `null` when only the address named it. Used to choose
   * between two suites of one name; never required to match.
   */
  readonly platform: string | null;
}

/** The selected suite as the cards it scopes read it (#338, #339). */
export interface SuiteScope {
  /** The suite's id *in the attempt on screen*. */
  readonly id: string;
  readonly name: string;
  readonly platform: string;
  /** `sim` or `physical`. */
  readonly kind: TestSuiteResult["kind"];
}

/** A case's retry chip. */
export interface RetryChipView {
  /** `retry 2/3`. */
  readonly text: string;
  /** What the chip says in full — `Passed on retry 2 of 3 runs`. */
  readonly title: string;
}

/** One row of a suite's case drill. */
export interface CaseRowView {
  readonly id: string;
  readonly name: string;
  /** `passed`, `failed`, `flaky`, `skipped` or `error`. */
  readonly status: TestCaseResult["status"];
  /** The status chip's hue. */
  readonly tone: ChipTone;
  /** `3s`, `412ms`, or `null` when the case reported no duration. */
  readonly duration: string | null;
  /** The retry chip, or `null` for a case that ran once. */
  readonly retry: RetryChipView | null;
}

/** One row of the suites card. */
export interface SuiteRowView {
  readonly id: string;
  /** The suite's own name — what selecting the row remembers. */
  readonly name: string;
  /** What the row prints: the name, with the `PHYSICAL` prefix on a rig suite. */
  readonly label: string;
  /** The platform tag — `native_sim`, `rig:helios-rig-02`. Plain text: there is no platform page. */
  readonly platform: string;
  readonly tone: SuiteTone;
  /** The meter's hue, or `null` for a suite nothing ran in — its track is drawn empty. */
  readonly meterTone: MeterTone | null;
  /** How full the meter is, `0`–`1`. */
  readonly ratio: number;
  /** `18/19`. */
  readonly count: string;
  /** What a screen reader hears for the count — `18 of 19 passed`. */
  readonly countLabel: string;
  readonly selected: boolean;
  readonly cases: readonly CaseRowView[];
}

/** The suites card. */
export interface SuitesView {
  readonly rows: readonly SuiteRowView[];
  /** The selected suite, for the cards it scopes, or `null` when none is. */
  readonly scope: SuiteScope | null;
}

// --- the selection ------------------------------------------------------------------------

/**
 * Read the `?suite=` parameter.
 *
 * @param value The raw parameter as Next.js hands it over, or as `URLSearchParams` reads it.
 * @returns The suite's name, trimmed — or `null` for an absent, blank or over-long one, which
 *   means *nothing selected*.
 */
export function suiteParam(value: string | readonly string[] | null | undefined): string | null {
  const first = typeof value === "string" ? value : value?.[0];
  const name = first?.trim() ?? "";

  return name === "" || name.length > SUITE_NAME_LIMIT ? null : name;
}

/**
 * Find the selected suite in the attempt on screen.
 *
 * @param suites The attempt's suites.
 * @param selection What is selected, or `null`.
 * @returns The suite of that name — on the platform it was selected on when several share the
 *   name, else the first — or `null` when nothing is selected or the attempt has no such suite.
 *   Never another suite.
 */
export function resolveSuite(
  suites: readonly TestSuiteResult[],
  selection: SuiteSelection | null,
): TestSuiteResult | null {
  if (selection === null) return null;

  const named = suites.filter((suite) => suite.name === selection.name);

  return named.find((suite) => suite.platform === selection.platform) ?? named[0] ?? null;
}

/**
 * What the card says when a selection did not survive an attempt switch.
 *
 * @param name The suite that was selected.
 * @param attemptSeq The attempt now on screen.
 * @returns `telemetry integration did not run in Build 1 — selection cleared.`
 */
export function selectionCleared(name: string, attemptSeq: number): string {
  return `${name} did not run in Build ${attemptSeq} — selection cleared.`;
}

// --- a suite --------------------------------------------------------------------------------

/**
 * How a suite went — the hue of its meter and its count.
 *
 * @param suite The suite.
 * @returns `neutral` when nothing ran; `ok` when every case passed or was skipped; otherwise
 *   `warn` for a rig suite and `err` for a simulated one.
 */
export function suiteTone(suite: Pick<TestSuiteResult, "kind" | "counts">): SuiteTone {
  const { total, passed, skipped } = suite.counts;

  if (total <= 0) return "neutral";
  if (passed + skipped >= total) return "ok";

  return suite.kind === "physical" ? "warn" : "err";
}

/**
 * What a suite's row prints for its name.
 *
 * @param suite The suite.
 * @returns The name; a rig suite's is prefixed `PHYSICAL · ` unless it already says so.
 */
export function suiteLabel(suite: Pick<TestSuiteResult, "kind" | "name">): string {
  if (suite.kind !== "physical") return suite.name;
  if (suite.name.toUpperCase().startsWith(PHYSICAL_PREFIX)) return suite.name;

  return `${PHYSICAL_PREFIX} · ${suite.name}`;
}

// --- a case ---------------------------------------------------------------------------------

/** The hue each case status takes. */
const CASE_TONE: Readonly<Record<TestCaseResult["status"], ChipTone>> = {
  passed: "ok",
  failed: "err",
  error: "err",
  flaky: "warn",
  skipped: "neutral",
};

/**
 * A case's duration.
 *
 * @param durationMs How long it ran, or `null`.
 * @returns `412ms` under a second, `3s` and up from `spanOfMs`, `null` for none or a bad one.
 */
export function caseDuration(durationMs: number | null): string | null {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return null;

  return durationMs < ONE_SECOND_MS ? `${Math.round(durationMs)}ms` : spanOfMs(durationMs);
}

/**
 * A case's retry chip, from its `retry_outcomes` (#324).
 *
 * The strip's own arithmetic (`passed on retry 2/3`, AT.5): the retry is the index of the first
 * pass, the first run being 0, over every run the case took. A case that never passed is on its
 * last retry.
 *
 * @param outcomes Each run's outcome, in order.
 * @returns The chip, or `null` for a case that ran once — or not at all.
 */
export function retryChip(outcomes: TestCaseResult["retryOutcomes"]): RetryChipView | null {
  if (outcomes.length < 2) return null;

  const firstPass = outcomes.indexOf("passed");
  const retry = firstPass < 0 ? outcomes.length - 1 : firstPass;
  const runs = `${outcomes.length} runs`;

  return {
    text: `retry ${retry}/${outcomes.length}`,
    title:
      firstPass < 0
        ? `Did not pass in ${runs}`
        : firstPass === 0
          ? `Passed first time, of ${runs}`
          : `Passed on retry ${retry} of ${runs}`,
  };
}

/**
 * One case, as its row in the drill.
 *
 * @param each The case.
 * @returns The row.
 */
export function caseView(each: TestCaseResult): CaseRowView {
  return {
    id: each.id,
    name: each.name,
    status: each.status,
    tone: CASE_TONE[each.status] ?? "neutral",
    duration: caseDuration(each.durationMs),
    retry: retryChip(each.retryOutcomes),
  };
}

// --- the card -------------------------------------------------------------------------------

/**
 * The suites card for one attempt.
 *
 * @param suites The attempt's suites, in the payload's order.
 * @param selection What is selected, or `null`.
 * @returns The rows, and the selected suite for the cards it scopes.
 */
export function suitesView(
  suites: readonly TestSuiteResult[],
  selection: SuiteSelection | null,
): SuitesView {
  const selected = resolveSuite(suites, selection);

  return {
    rows: suites.map((suite) => {
      const tone = suiteTone(suite);
      const { passed, total } = suite.counts;

      return {
        id: suite.id,
        name: suite.name,
        label: suiteLabel(suite),
        platform: suite.platform,
        tone,
        meterTone: tone === "neutral" ? null : tone,
        ratio: total > 0 ? passed / total : 0,
        count: `${passed}/${total}`,
        countLabel: `${passed} of ${total} passed`,
        selected: suite.id === selected?.id,
        cases: suite.cases.map(caseView),
      };
    }),
    scope:
      selected === null
        ? null
        : {
            id: selected.id,
            name: selected.name,
            platform: selected.platform,
            kind: selected.kind,
          },
  };
}

// --- the keyboard ---------------------------------------------------------------------------

/**
 * Which row a key moves focus to.
 *
 * @param key The key pressed — `KeyboardEvent.key`.
 * @param index The row that has focus.
 * @param count How many rows there are.
 * @returns The row to focus — `ArrowDown`/`ArrowUp` step and stop at the ends, `Home`/`End` jump
 *   — or `null` for any other key, or when there is nowhere to go.
 */
export function nextRowIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;

  const target =
    key === "ArrowDown"
      ? Math.min(count - 1, index + 1)
      : key === "ArrowUp"
        ? Math.max(0, index - 1)
        : key === "Home"
          ? 0
          : key === "End"
            ? count - 1
            : null;

  return target === null || target === index ? null : target;
}
