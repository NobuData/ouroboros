/**
 * The `failing-HIL` scenario's reports, derived from mockup 11's own figures (AT.6,
 * [#334](https://github.com/NobuData/ouroboros/issues/334)).
 *
 * ```
 * suites card     unit · drivers 24 · telemetry integration 19 · motor control 12 · OTA update 6
 *                 PHYSICAL · HIL rig 2 (rig helios-rig-02)                          = 63 cases
 * build attempts  Build 1 a3f19c2  49/63 · 14 failed
 *                 Build 2 c81d4e7  61/63 · 2 failed      (telemetry 18/19, HIL 1/2 — overshoot 2.4% > 2.0%)
 *                 Build 3 f42b9a0  63/63                 (the correction round's build; "gated on 63/63")
 * ```
 *
 * The mockup leaves two figures open, and each is named where it is chosen: how Build 1's
 * fourteen failures split (twelve telemetry cases and both HIL cases — the CAN flood "was 37 in
 * build 1"), and Build 3's overshoot, which only has to be inside the 2.0% limit. Everything else
 * is the mockup's, so a drift from the design source is a failing test rather than a review note.
 *
 * Pure data and text builders: `failing-hil.fixture.spec.ts` pins the counts against the
 * mockup, and `failing-hil.scenario.fixture.ts` uploads what these build.
 */

/** The rig every physical case runs on — mockup 11's `rig:helios-rig-02`. */
export const RIG = "helios-rig-02";

/** The rig's bench, as the physical tests card prints it. */
export const BENCH = "CAN bus + motor + power-cycler";

/** The HIL suite's name on the suites card. */
export const HIL_SUITE = "PHYSICAL · HIL rig";

/** The HIL case the person classifies — the failure detail's `overshoot_under_load`. */
export const OVERSHOOT_CASE = "estop_release_overshoot";

/** The second HIL case — `CAN bus frame order under 90% load`. */
export const FLOOD_CASE = "bus_flood_frame_order";

/** The overshoot limit, `limit 2.0%`. */
export const OVERSHOOT_LIMIT_PCT = 2.0;

/** Mockup 11's correction note — the Mark & Route card's text, and the steer the executor gets. */
export const CORRECTION_NOTE =
  "Keep k_msgq, but move PID velocity sampling off the telemetry path.";

/** One simulated suite of the suites card. */
export interface SimSuite {
  /** As the card prints it. */
  readonly name: string;
  /** Its platform tag. */
  readonly platform: string;
  /** The JUnit `classname` its cases carry. */
  readonly classname: string;
  /** How many cases it has. */
  readonly cases: number;
}

/** The four simulated suites, in the card's order. */
export const SIM_SUITES: readonly SimSuite[] = [
  { name: "unit · drivers", platform: "native_sim", classname: "drivers", cases: 24 },
  { name: "telemetry integration", platform: "qemu_cortex_m3", classname: "telemetry", cases: 19 },
  { name: "motor control", platform: "qemu_cortex_m3", classname: "motor", cases: 12 },
  { name: "OTA update", platform: "native_sim", classname: "ota", cases: 6 },
];

/** Cases on the page: the four simulated suites plus the two HIL cases — `63`. */
export const TOTAL_CASES = SIM_SUITES.reduce((sum, suite) => sum + suite.cases, 0) + 2;

/** One build attempt's script. */
export interface BuildPlan {
  /** `Build 1` … `Build 3`. */
  readonly label: string;
  /** The attempt card's short commit. */
  readonly shortSha: string;
  /** How many of each simulated suite's cases fail, by suite name — the first N of the suite. */
  readonly failing: Readonly<Record<string, number>>;
  /** The overshoot the dyno measured, in percent. */
  readonly overshootPct: number;
  /** Reordered frames in 10⁶ under the CAN flood. */
  readonly reorderedFrames: number;
}

/** The three builds, oldest first. */
export const BUILDS: readonly [BuildPlan, BuildPlan, BuildPlan] = [
  {
    label: "Build 1",
    shortSha: "a3f19c2",
    // Chosen: the mockup says only "14 failed"; twelve telemetry cases plus both HIL cases.
    failing: { "telemetry integration": 12 },
    overshootPct: 2.4,
    reorderedFrames: 37,
  },
  {
    label: "Build 2",
    shortSha: "c81d4e7",
    failing: { "telemetry integration": 1 },
    overshootPct: 2.4,
    reorderedFrames: 0,
  },
  {
    label: "Build 3",
    shortSha: "f42b9a0",
    failing: {},
    // Chosen: the corrected build only has to land inside the limit.
    overshootPct: 1.6,
    reorderedFrames: 0,
  },
];

/** A file an agent uploads. */
export interface ReportFile {
  readonly name: string;
  readonly bytes: Buffer;
}

/**
 * A build's full commit, as the farm job records it: the short sha padded to forty hex digits.
 *
 * @param plan - The build.
 * @returns Forty lowercase hex digits beginning with the mockup's short sha.
 */
export function commitOf(plan: BuildPlan): string {
  return plan.shortSha.padEnd(40, "0");
}

/**
 * A simulated case's name — stable across builds, so its `case_key` is too.
 *
 * @param index - Its position in its suite, from 0.
 * @returns `case_01` … `case_24`.
 */
export function caseName(index: number): string {
  return `case_${String(index + 1).padStart(2, "0")}`;
}

/**
 * Escape text for an XML attribute.
 *
 * @param text - The text.
 * @returns It, safe between double quotes.
 */
function xmlAttribute(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The twister-style JUnit report of a build's simulated suites.
 *
 * @param plan - The build.
 * @returns The XML text.
 */
export function junitReport(plan: BuildPlan): string {
  const suites = SIM_SUITES.map((suite) => {
    const failing = plan.failing[suite.name] ?? 0;
    const cases = Array.from({ length: suite.cases }, (_, index) => {
      const name = caseName(index);
      const failure =
        index < failing
          ? `<failure message="${xmlAttribute(`${suite.classname}.${name} failed on ${plan.label}`)}"/>`
          : "";

      return `<testcase classname="${suite.classname}" name="${name}" time="0.1">${failure}</testcase>`;
    }).join("");

    return (
      `<testsuite name="${xmlAttribute(suite.name)}" tests="${String(suite.cases)}" ` +
      `failures="${String(failing)}"><properties>` +
      `<property name="platform" value="${suite.platform}"/></properties>${cases}</testsuite>`
    );
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>${suites}</testsuites>\n`;
}

/**
 * The `ouro-hil-results` document of a build's two physical cases.
 *
 * @param plan - The build.
 * @returns The JSON text.
 */
export function hilReport(plan: BuildPlan): string {
  return JSON.stringify({
    schema: "ouro-hil-results",
    schema_version: 1,
    rig: RIG,
    bench: BENCH,
    suites: [
      {
        name: HIL_SUITE,
        cases: [
          {
            classname: "hil.motor",
            name: OVERSHOOT_CASE,
            procedure: "dyno bench releases e-stop under 2 Nm load, 3 trials",
            measurements: [
              {
                metric: "overshoot_pct",
                value: plan.overshootPct,
                unit: "%",
                limit: OVERSHOOT_LIMIT_PCT,
                direction: "max",
              },
            ],
          },
          {
            classname: "hil.can",
            name: FLOOD_CASE,
            procedure: "traffic generator floods bus at 900 kbit/s for 60s",
            measurements: [
              {
                metric: "reordered_frames",
                value: plan.reorderedFrames,
                unit: "count",
                limit: 0,
                direction: "max",
              },
            ],
          },
        ],
      },
    ],
  });
}

/**
 * What a build's agent uploads: its JUnit report and its HIL document, under names the built-in
 * artifact globs collect.
 *
 * @param plan - The build.
 * @param index - Its position in {@link BUILDS}, from 0.
 * @returns The files.
 */
export function buildFiles(plan: BuildPlan, index: number): ReportFile[] {
  return [
    { name: `junit-build${String(index + 1)}.xml`, bytes: Buffer.from(junitReport(plan)) },
    { name: "ouro-hil-results.json", bytes: Buffer.from(hilReport(plan)) },
  ];
}

/**
 * The counts a build's attempt should show, from its plan alone.
 *
 * @param plan - The build.
 * @returns Total, passed and failed.
 */
export function expectedCounts(plan: BuildPlan): {
  total: number;
  passed: number;
  failed: number;
} {
  const simFailed = Object.values(plan.failing).reduce((sum, n) => sum + n, 0);
  const hilFailed =
    (plan.overshootPct > OVERSHOOT_LIMIT_PCT ? 1 : 0) + (plan.reorderedFrames > 0 ? 1 : 0);
  const failed = simFailed + hilFailed;

  return { total: TOTAL_CASES, passed: TOTAL_CASES - failed, failed };
}
