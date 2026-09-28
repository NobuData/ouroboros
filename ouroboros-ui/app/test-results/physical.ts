/**
 * The physical-tests card, as data ([#338](https://github.com/NobuData/ouroboros/issues/338)) —
 * mockup 11's rig header and `ptest` rows, decided here and drawn by `physical-card.tsx`.
 *
 * **The measured line is composed, never quoted** ({@link measuredLine}). A measurement arrives
 * as a metric, a value, a unit, a limit and the limit's direction (#325), and the line is built
 * from those by one rule for every row:
 *
 * ```
 * <metric> <value><unit> vs limit <limit><unit> (<comparative>)
 * overshoot 2.4% vs limit 2.0%
 * reordered frames 0 vs limit 0 (was 37 in build 1)
 * ```
 *
 * The mockup's `in 10⁶` is a sample size the payload does not serve, so it is not printed.
 *
 * **A breach is a comparison, not a flag** ({@link breaches}): the value is drawn in the err hue
 * because it is past its limit in the limit's own direction — above a `max`, below a `min`.
 *
 * **The `rig online` pill is telemetry or it is nothing** ({@link rigOnline}): it is drawn only
 * when the farm holds a runner of the rig's name that is connected. A rig that is only a platform
 * tag has no presence signal, and its pill is omitted rather than defaulted.
 *
 * **A suite without measurements degrades** — a rig that emitted only JUnit. Its cases are plain
 * pass/fail rows under {@link HIL_SCHEMA_HINT}, with no limit invented and no measured line.
 *
 * **Selection is a name**, for `suites.ts`'s reason: `?case=` carries the case's name, and
 * {@link resolveCase} finds it again in whichever attempt — and whichever suite scope — is on
 * screen.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type { FarmRunner } from "@/app/api/farm";
import type { TestCaseResult, TestRunPage, TestSuiteResult } from "@/app/api/test-results";
import type { ChipTone } from "@/app/ui";

import { type SuiteScope, nameParam } from "./suites";

/** One measured case of the attempt's page. */
export type PhysicalCase = TestRunPage["physical"][number];

/** One measurement of a measured case. */
export type Measurement = PhysicalCase["measurements"][number];

/** The card's title — the mockup's `PHYSICAL TESTS`. */
export const PHYSICAL_TITLE = "Physical tests";

/** What goes before a rig's name in its group's heading — the mockup's `RIG HELIOS-RIG-02`. */
export const RIG_PREFIX = "Rig";

/** The presence pill. */
export const RIG_ONLINE = "rig online";

/** What goes before a bench description — the mockup's `bench: CAN bus + motor + power-cycler`. */
export const BENCH_PREFIX = "bench:";

/** What goes before a measured line. */
export const MEASURED_PREFIX = "measured:";

/** What a suite without measurements says above its plain rows. */
export const HIL_SCHEMA_HINT =
  "This rig reported pass/fail only — structured measurements need the HIL schema.";

/** What the card says while the attempt's page has not been read. */
export const READING_PHYSICAL = "Reading the physical tests…";

/** What the card says when the attempt ran nothing on a rig. */
export const NO_PHYSICAL = "This build ran no physical tests.";

/** What a rig group says when its suite holds no case. */
export const NO_PHYSICAL_CASES = "This rig reported no cases.";

/** The longest case name `?case=` is read as — the HIL schema's own bound on a name. */
export const CASE_NAME_LIMIT = 500;

/** The unit a bare count carries; it is printed as no unit at all, as V053's comparative does. */
const COUNT_UNIT = "count";

/** The most decimals a figure is printed to. */
const MAX_DECIMALS = 6;

/** The runner states that are a connected machine — the farm's own `runnersOnline`. */
const CONNECTED: readonly FarmRunner["status"][] = ["online", "building", "draining"];

/** The physical case the page has selected, as it is remembered between attempts. */
export interface CaseSelection {
  /** The case's name — what `?case=` carries. */
  readonly name: string;
  /**
   * The platform of the suite it was selected in, or `null` when only the address named it. Used
   * to choose between two rigs' cases of one name; never required to match.
   */
  readonly platform: string | null;
}

/** The selected case as the failure-detail card reads it (#339). */
export interface CaseScope {
  /** The case's id *in the attempt on screen*. */
  readonly caseId: string;
  readonly name: string;
  /** The id of the suite it ran in. */
  readonly suiteId: string;
  readonly status: TestCaseResult["status"];
  /** Whether the case has a failure payload to read. */
  readonly hasFailure: boolean;
}

/** One measured line. */
export interface MeasuredLineView {
  /** The metric, which keys the line within its row. */
  readonly metric: string;
  /** `overshoot`, `reordered frames`. */
  readonly label: string;
  /** `2.4%`, `0`, `412ms`. */
  readonly value: string;
  /** `vs limit 2.0%`. */
  readonly limit: string;
  /** Whether the value is past its limit — the err hue. */
  readonly breached: boolean;
  /** `(was 37 in build 1)`, or `null` when no comparative is stored. */
  readonly comparative: string | null;
  /** The whole line as one string — `overshoot 2.4% vs limit 2.0%`. */
  readonly text: string;
}

/** A row's pass/FAIL pill. */
export interface VerdictPillView {
  readonly text: string;
  readonly tone: ChipTone;
}

/** One `ptest` row. */
export interface PhysicalRowView {
  /** The case's id. */
  readonly id: string;
  readonly name: string;
  readonly pill: VerdictPillView;
  /** Whether the case did not pass — the selected row's err treatment. */
  readonly failing: boolean;
  /** The what-it-did line, or `null` for a case that carries no measurements. */
  readonly procedure: string | null;
  /** The measured lines; empty for a plain case. */
  readonly measured: readonly MeasuredLineView[];
  readonly selected: boolean;
}

/** One rig's group. */
export interface RigGroupView {
  /** The suite's id. */
  readonly id: string;
  /** The suite's name. */
  readonly suite: string;
  /** The suite's platform — what selecting one of its rows remembers. */
  readonly platform: string;
  /** The rig's name — `helios-rig-02`. */
  readonly rig: string;
  /** `Rig helios-rig-02`. */
  readonly heading: string;
  /** Whether the rig maps to a connected farm runner. `false` omits the pill. */
  readonly online: boolean;
  /** `bench: CAN bus + motor + power-cycler`, or `null` when the suite names no bench. */
  readonly bench: string | null;
  /** Whether the suite carries no measurement at all — plain rows under the HIL-schema hint. */
  readonly degraded: boolean;
  readonly rows: readonly PhysicalRowView[];
}

/** The physical-tests card. */
export interface PhysicalView {
  readonly groups: readonly RigGroupView[];
  /** What the card says in place of groups, or `null` when it has some. */
  readonly note: string | null;
  /** The selected case, for the failure-detail card, or `null` when none is. */
  readonly scope: CaseScope | null;
}

// --- the measured line ------------------------------------------------------------------------

/**
 * How many decimals a number is written with.
 *
 * @param value The number.
 * @returns Its fraction digits, at most {@link MAX_DECIMALS}; `0` for one that is not finite.
 */
export function decimalsOf(value: number): number {
  if (!Number.isFinite(value)) return 0;

  for (let digits = 0; digits < MAX_DECIMALS; digits += 1) {
    if (Number(value.toFixed(digits)) === value) return digits;
  }

  return MAX_DECIMALS;
}

/**
 * A figure with its unit.
 *
 * @param value The number.
 * @param unit Its unit — `%`, `ms`, `count`.
 * @param decimals How many decimals to print.
 * @returns `2.0%`, `412ms` — the unit appended with no space, and a `count` printed bare.
 */
export function figure(value: number, unit: string, decimals: number): string {
  const digits = Number.isFinite(value) ? value.toFixed(decimals) : String(value);

  return unit === COUNT_UNIT ? digits : `${digits}${unit}`;
}

/**
 * What a metric is called on the card.
 *
 * @param metric The stored identifier — `overshoot_pct`, `reordered_frames`.
 * @param unit The measurement's unit.
 * @returns The identifier with its underscores as spaces, and a trailing word that only repeats
 *   the unit dropped (`_pct` beside `%`, `_ms` beside `ms`) — `overshoot`, `reordered frames`.
 */
export function metricLabel(metric: string, unit: string): string {
  const words = metric.split("_").filter((word) => word !== "");
  const last = words.at(-1)?.toLowerCase();
  const repeatsUnit = last === unit.toLowerCase() || (last === "pct" && unit === "%");

  if (repeatsUnit && words.length > 1) words.pop();

  return words.join(" ");
}

/**
 * Whether a value is past its limit.
 *
 * @param measurement The measurement.
 * @returns `true` above a `max` limit or below a `min` one — both limits are inclusive (V053).
 *   A direction this client does not know falls back to the stored verdict.
 */
export function breaches(
  measurement: Pick<Measurement, "value" | "limit" | "limitKind" | "verdict">,
): boolean {
  const { value, limit, limitKind } = measurement;

  if (limitKind === "max") return value > limit;
  if (limitKind === "min") return value < limit;

  return measurement.verdict === "fail";
}

/**
 * One measured line, composed from the stored fields.
 *
 * @param measurement The measurement.
 * @returns The line. The value and its limit are printed to the same number of decimals — the
 *   more precise of the two — so `2.4` against `2` reads `2.4% vs limit 2.0%`. The comparative is
 *   the stored `context`, in brackets, and absent when none is stored.
 */
export function measuredLine(measurement: Measurement): MeasuredLineView {
  const decimals = Math.max(decimalsOf(measurement.value), decimalsOf(measurement.limit));
  const label = metricLabel(measurement.metric, measurement.unit);
  const value = figure(measurement.value, measurement.unit, decimals);
  const limit = `vs limit ${figure(measurement.limit, measurement.unit, decimals)}`;
  const context = measurement.comparative?.trim() ?? "";
  const comparative = context === "" ? null : `(${context})`;

  return {
    metric: measurement.metric,
    label,
    value,
    limit,
    breached: breaches(measurement),
    comparative,
    text: [label, value, limit, comparative].filter((part) => part !== null).join(" "),
  };
}

// --- a row --------------------------------------------------------------------------------------

/** The pill each case status takes — the mockup's `pass` and `FAIL`. */
const PILL: Readonly<Record<TestCaseResult["status"], VerdictPillView>> = {
  passed: { text: "pass", tone: "ok" },
  failed: { text: "FAIL", tone: "err" },
  error: { text: "ERROR", tone: "err" },
  flaky: { text: "flaky", tone: "warn" },
  skipped: { text: "skipped", tone: "neutral" },
};

/**
 * A case's pass/FAIL pill.
 *
 * @param status The case's status.
 * @returns The pill; a status this client does not know is printed as it came, neutral.
 */
export function verdictPill(status: TestCaseResult["status"]): VerdictPillView {
  return PILL[status] ?? { text: String(status), tone: "neutral" };
}

// --- the rig ------------------------------------------------------------------------------------

/**
 * Whether a rig maps to a farm runner the product can see, and that runner is connected.
 *
 * @param rig The rig's name.
 * @param runners The farm's runners, or `null` when the farm has not been — or could not be —
 *   read.
 * @returns `true` only for a runner of exactly the rig's name that is `online`, `building` or
 *   `draining`. No runners, no such runner, an offline or a removed one are all `false`: the pill
 *   is omitted.
 */
export function rigOnline(rig: string, runners: readonly FarmRunner[] | null): boolean {
  if (runners === null) return false;

  return runners.some((runner) => runner.name === rig && CONNECTED.includes(runner.status));
}

// --- the selection ------------------------------------------------------------------------------

/**
 * Read the `?case=` parameter.
 *
 * @param value The raw parameter as Next.js hands it over, or as `URLSearchParams` reads it.
 * @returns The case's name, trimmed — or `null` for an absent, blank or over-long one, which
 *   means *nothing selected*.
 */
export function caseParam(value: string | readonly string[] | null | undefined): string | null {
  return nameParam(value, CASE_NAME_LIMIT);
}

/**
 * The physical suites a scope leaves on the card.
 *
 * @param suites The attempt's suites.
 * @param scope The suite selected in the suites card, or `null`.
 * @returns Every physical suite when nothing is selected; the selected suite alone when it is a
 *   physical one; none when it is a simulated one.
 */
export function physicalSuites(
  suites: readonly TestSuiteResult[],
  scope: SuiteScope | null,
): TestSuiteResult[] {
  return suites.filter(
    (suite) => suite.kind === "physical" && (scope === null || suite.id === scope.id),
  );
}

/**
 * Find the selected case among suites.
 *
 * @param suites The suites to look in — the attempt's physical ones, or those a scope leaves.
 * @param selection What is selected, or `null`.
 * @returns The case of that name and the suite it ran in — on the platform it was selected on
 *   when several share the name, else the first — or `null` when nothing is selected or no suite
 *   holds such a case. Never another case.
 */
export function resolveCase(
  suites: readonly TestSuiteResult[],
  selection: CaseSelection | null,
): { readonly suite: TestSuiteResult; readonly found: TestCaseResult } | null {
  if (selection === null) return null;

  const named = suites.flatMap((suite) =>
    suite.cases.filter((each) => each.name === selection.name).map((found) => ({ suite, found })),
  );

  return named.find((each) => each.suite.platform === selection.platform) ?? named[0] ?? null;
}

/**
 * What the card says when a selected case did not survive an attempt switch.
 *
 * @param name The case that was selected.
 * @param attemptSeq The attempt now on screen.
 * @returns `estop_release_overshoot did not run on a rig in Build 1 — selection cleared.`
 */
export function caseCleared(name: string, attemptSeq: number): string {
  return `${name} did not run on a rig in Build ${attemptSeq} — selection cleared.`;
}

/**
 * What the card says when a selected case is outside the suite now selected.
 *
 * @param name The case that was selected.
 * @param suite The suite the page is scoped to.
 * @returns `estop_release_overshoot is not in telemetry integration — selection cleared.`
 */
export function caseOutOfScope(name: string, suite: string): string {
  return `${name} is not in ${suite} — selection cleared.`;
}

/**
 * What the card says when the selected suite is a simulated one.
 *
 * @param suite The suite's name.
 * @returns `telemetry integration is a simulated suite — it has no physical tests.`
 */
export function simulatedScope(suite: string): string {
  return `${suite} is a simulated suite — it has no physical tests.`;
}

// --- the card -----------------------------------------------------------------------------------

/**
 * The physical-tests card for one attempt.
 *
 * @param page The attempt's suites and its measured cases.
 * @param scope The suite selected in the suites card, or `null` — the card is filtered to it.
 * @param selection The selected case, or `null`.
 * @param runners The farm's runners, or `null` when they have not been read.
 * @returns One group per physical suite in scope — its rows in the suite's own order, measured
 *   where the case has measurements and plain where it has none — or the note that stands in for
 *   them, and the selected case for the failure-detail card.
 */
export function physicalView(
  page: Pick<TestRunPage, "suites" | "physical">,
  scope: SuiteScope | null,
  selection: CaseSelection | null,
  runners: readonly FarmRunner[] | null,
): PhysicalView {
  const suites = physicalSuites(page.suites, scope);
  const selected = resolveCase(suites, selection);
  const measuredById = new Map(page.physical.map((each) => [each.caseId, each]));

  const groups = suites.map((suite): RigGroupView => {
    const rig = suite.rig ?? suite.platform;

    return {
      id: suite.id,
      suite: suite.name,
      platform: suite.platform,
      rig,
      heading: `${RIG_PREFIX} ${rig}`,
      online: rigOnline(rig, runners),
      bench: suite.bench === null || suite.bench.trim() === "" ? null : `${BENCH_PREFIX} ${suite.bench}`,
      degraded: !suite.cases.some((each) => (measuredById.get(each.id)?.measurements.length ?? 0) > 0),
      rows: suite.cases.map((each) => {
        const measured = measuredById.get(each.id);

        return {
          id: each.id,
          name: each.name,
          pill: verdictPill(each.status),
          failing: each.status === "failed" || each.status === "error",
          procedure:
            measured === undefined || measured.measurements.length === 0 ? null : measured.procedure,
          measured: (measured?.measurements ?? []).map(measuredLine),
          selected: each.id === selected?.found.id,
        };
      }),
    };
  });

  return {
    groups,
    note:
      groups.length > 0
        ? null
        : scope !== null && scope.kind !== "physical"
          ? simulatedScope(scope.name)
          : NO_PHYSICAL,
    scope:
      selected === null
        ? null
        : {
            caseId: selected.found.id,
            name: selected.found.name,
            suiteId: selected.suite.id,
            status: selected.found.status,
            hasFailure: selected.found.hasFailure,
          },
  };
}
