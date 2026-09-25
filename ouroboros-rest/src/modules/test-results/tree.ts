/**
 * Assembling one attempt's tree from every file's parse (AT.1,
 * [#329](https://github.com/NobuData/ouroboros/issues/329)) — the pure half of the orchestration,
 * with no database in it.
 *
 * ## Suites merge by (name, platform)
 *
 * Two outputs describing the same suite on the same platform are one suite. JUnit and HIL meet
 * here: a rig's JUnit suite and its `ouro-hil-results.json` suite of the same name become one
 * `results_format = 'hil'` suite whose cases keep **JUnit's retry truth and failure** and gain
 * **HIL's procedure and measurements**. A HIL case matches its JUnit case by classname and name,
 * or by name alone when the HIL case gives no classname and exactly one JUnit case has that name.
 * Two JUnit reports of one suite (a harness that writes each rerun as its own file) contribute
 * successive attempts, in manifest order.
 *
 * ## Then the flake policy
 *
 * Every case's raw attempts go through `applyFlakePolicy` once, here — so a pass-on-retry is
 * `flaky` only when sanctioned, whatever format reported it.
 */

import type {
  TestCaseFailure,
  TestCaseStatus,
  TestAttemptOutcome,
  TestSuiteKind,
} from "../db/schema";
import { applyFlakePolicy, type FlakePolicy } from "./flake-policy";
import { mergeAttempts } from "./junit.parser";
import type { NormalizedCase, NormalizedHil, NormalizedSuite } from "./parser.spi";

/** A case ready for `test_cases`. */
export interface PreparedCase {
  readonly name: string;
  readonly classname: string | null;
  readonly status: TestCaseStatus;
  readonly retries: number;
  readonly outcomes: readonly TestAttemptOutcome[];
  readonly durationMs: number | null;
  readonly failure: TestCaseFailure | null;
  readonly meta: Readonly<Record<string, unknown>>;
  /** Present only on a case of a `hil` suite that a HIL document described. */
  readonly hil?: NormalizedHil;
}

/** A suite ready for `test_suites`. */
export interface PreparedSuite {
  readonly name: string;
  readonly platform: string;
  readonly kind: TestSuiteKind;
  readonly format: "junit" | "hil";
  readonly durationMs: number | null;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly cases: readonly PreparedCase[];
}

/** The attempt's wall-time split — all null, or all set with wall = sim + physical (V051). */
export interface DurationSplit {
  readonly wallMs: number | null;
  readonly simMs: number | null;
  readonly physicalMs: number | null;
}

/**
 * Merge every file's suites into one tree and apply the flake policy.
 *
 * @param suites - Every suite every parser produced, in manifest order.
 * @param policy - The sanctioned retry budget.
 * @returns One suite per (name, platform), in first-seen order.
 */
export function assembleTree(
  suites: readonly NormalizedSuite[],
  policy: FlakePolicy,
): PreparedSuite[] {
  const merged = new Map<string, NormalizedSuite>();

  for (const suite of suites) {
    const key = `${suite.name}\u001f${suite.platform}`;
    const seen = merged.get(key);

    merged.set(key, seen === undefined ? suite : mergeSuites(seen, suite));
  }

  return [...merged.values()].map((suite) => ({
    name: suite.name,
    platform: suite.platform,
    kind: suite.kind,
    format: suite.format,
    durationMs: suite.durationMs,
    meta: suite.meta,
    cases: suite.cases.map((kase) => prepareCase(kase, policy)),
  }));
}

/**
 * The wall-time split: sim and physical are their suites' summed durations.
 *
 * @param suites - The assembled tree.
 * @returns All null when no suite has a duration; otherwise all set, unknown suites counting 0.
 */
export function durationSplit(suites: readonly PreparedSuite[]): DurationSplit {
  if (suites.every((suite) => suite.durationMs === null)) {
    return { wallMs: null, simMs: null, physicalMs: null };
  }

  const sum = (kind: TestSuiteKind): number =>
    suites
      .filter((suite) => suite.kind === kind)
      .reduce((total, suite) => total + (suite.durationMs ?? 0), 0);
  const simMs = sum("sim");
  const physicalMs = sum("physical");

  return { wallMs: simMs + physicalMs, simMs, physicalMs };
}

/**
 * Two outputs of one suite as one.
 *
 * @param a - The one seen first.
 * @param b - The later one.
 * @returns The merged suite — `hil` when either is.
 */
function mergeSuites(a: NormalizedSuite, b: NormalizedSuite): NormalizedSuite {
  const junitCases = [...a.cases, ...b.cases].filter((kase) => kase.hil === undefined);
  const hilCases = [...a.cases, ...b.cases].filter((kase) => kase.hil !== undefined);
  const junit = a.format === "junit" ? a : b;

  return {
    name: a.name,
    platform: a.platform,
    kind: a.kind,
    format: a.format === "hil" || b.format === "hil" ? "hil" : "junit",
    durationMs:
      a.format === b.format
        ? a.durationMs === null && b.durationMs === null
          ? null
          : (a.durationMs ?? 0) + (b.durationMs ?? 0)
        : (junit.durationMs ?? (a === junit ? b : a).durationMs),
    meta: { ...a.meta, ...b.meta },
    cases: attachHil(mergeAttempts(junitCases), hilCases),
  };
}

/**
 * Attach each HIL case to its JUnit case, or add it when JUnit has none.
 *
 * @param junitCases - The suite's JUnit cases, attempts merged.
 * @param hilCases - Its HIL cases.
 * @returns The cases, JUnit's order first.
 */
function attachHil(
  junitCases: readonly NormalizedCase[],
  hilCases: readonly NormalizedCase[],
): NormalizedCase[] {
  const cases = [...junitCases];
  const identity = (kase: NormalizedCase): string => `${kase.classname ?? ""}\u001f${kase.name}`;

  for (const hil of hilCases) {
    let at = cases.findIndex((kase) => identity(kase) === identity(hil));

    if (at === -1 && hil.classname === null) {
      const byName = cases
        .map((kase, index) => ({ kase, index }))
        .filter(({ kase }) => kase.name === hil.name);

      at = byName.length === 1 ? byName[0].index : -1;
    }

    if (at === -1) {
      cases.push(hil);
    } else if (cases[at].hil === undefined) {
      cases[at] = { ...cases[at], hil: hil.hil };
    }
  }

  return cases;
}

/**
 * One case with its retry truth.
 *
 * @param kase - The case, attempts raw.
 * @param policy - The sanctioned budget.
 * @returns It, ready for `test_cases`.
 */
function prepareCase(kase: NormalizedCase, policy: FlakePolicy): PreparedCase {
  const truth = applyFlakePolicy(kase.outcomes, policy);
  const meta =
    truth.unsanctioned.length === 0
      ? kase.meta
      : { ...kase.meta, unsanctioned_outcomes: [...truth.unsanctioned] };

  return {
    name: kase.name,
    classname: kase.classname,
    status: truth.status,
    retries: truth.retries,
    outcomes: truth.outcomes,
    durationMs: kase.durationMs,
    failure: truth.status === "passed" || truth.status === "skipped" ? null : kase.failure,
    meta,
    ...(kase.hil === undefined ? {} : { hil: kase.hil }),
  };
}
