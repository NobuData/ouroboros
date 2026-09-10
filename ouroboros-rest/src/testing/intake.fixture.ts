/**
 * The population every Epic M suite reads — mockup 03, as rows.
 *
 * `dashboard.fixture.ts`'s argument, one screen along: the development seed
 * (`R__dev_seed_intake.sql`, [#103](https://github.com/NobuData/ouroboros/issues/103)) is
 * deliberately **not** applied to the integration database — `flyway.toml` leaves the dev-seed
 * placeholder false, and {@link ApiHarness.truncate} would take it with everything else between
 * tests — so this reproduces that seed's *arithmetic* with the same nine issues, the same nine
 * estimates and the same construction. Where a number here disagrees with that file, one of the
 * two is wrong, and that is the point.
 *
 * ## What makes these nine the right nine
 *
 * They are the ones the seed's own header argues for, and three of its choices are load-bearing
 * for M.1 ([#110](https://github.com/NobuData/ouroboros/issues/110)) specifically:
 *
 *   * **The sort is total.** No two issues share an `(effort, confidence)` pair, so
 *     `sort=effort` puts them in exactly one order — {@link MOCKUP_03.effortOrder} — and a
 *     parity test cannot flake on a tie the planner broke differently on two machines.
 *   * **`#487` carries two versions.** Against a fixture where every issue has one estimate, a
 *     latest-wins lateral, a `min(version)` join and a join that takes an arbitrary row are
 *     indistinguishable: all three pass. One issue with two versions is the smallest fixture
 *     that tells them apart, and every visible field differs between the two.
 *   * **`#483` has no estimate row at all**, which is what `estimating` means, and `#490` is
 *     `needs_human` *with* an estimate. Together they are the two ways a row's status and its
 *     estimate can disagree, which is what stops either being derived from the other.
 *
 * The page head's figures follow from the rows rather than being stored beside them:
 * **"9 open issues. 7 already sized."**, which is the ticket's own acceptance criterion and the
 * seed's own count — not the mockup's 42 and 38, which are design copy over a backlog of nine.
 *
 * ```ts
 * const owner = await api.signIn();
 * const workspace = await workspaceWithRepo(api, owner, PRIMARY_REPO);
 * await seedIntake(api, workspace);
 * ```
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import { SCHEMA_NAME } from "../modules/db/schema";
import type { SeededWorkspace } from "./dashboard.fixture";
import type { ApiHarness } from "./harness.fixture";

/** One mirrored issue, with the columns the seed writes. */
export interface IntakeIssue {
  /** GitHub's number, unique within the repository. */
  readonly number: number;
  readonly title: string;
  /** GitHub's label names — the detail panel's set, which is the one an issue has. */
  readonly labels: readonly string[];
  /** GitHub's login, `renovate[bot]` included: V028 widened the column for exactly that. */
  readonly author: string;
  /** How long ago GitHub says it was opened. The ages ascend with the number, as a counter does. */
  readonly openedHoursAgo: number;
  /** How long ago GitHub last touched it. Never before it was opened. */
  readonly updatedHoursAgo: number;
  /** Where it is in the sizing pipeline — the one column this product owns. */
  readonly sizingStatus: "unsized" | "estimating" | "sized" | "needs_human";
  /** The description in full, or `null` for an issue opened without one. */
  readonly body: string | null;
}

/** One estimate, as `issue_estimates` holds it. */
export interface IntakeEstimate {
  /** The issue it sizes. */
  readonly number: number;
  /** Which estimate of that issue this is. `#487` is the only one with two. */
  readonly version: number;
  readonly effort: "xs" | "s" | "m" | "l" | "xl";
  readonly confidence: number;
  readonly suggestedWorkflow: string;
  readonly routedModel: string;
  /** Paths the work is believed to touch. `[]` on `#488` is a real answer, not a gap. */
  readonly files: readonly string[];
  readonly estTokens: number;
  readonly cycleMin: number;
  readonly cycleMax: number;
  readonly estMinutes: number;
  readonly risk: "low" | "medium" | "high";
  readonly riskNote: string;
  /** How long ago it was produced — `#485`'s two minutes is the mockup's *2m ago*. */
  readonly sizedMinutesAgo: number;
}

/** Mockup 03's nine, `#483`–`#491`, all open and all in one repository. */
export const INTAKE_ISSUES: readonly IntakeIssue[] = [
  {
    number: 483,
    title: "Telemetry frame drops when BLE and CAN both saturated",
    labels: ["bug", "telemetry"],
    author: "jorge-reyes",
    openedHoursAgo: 120,
    updatedHoursAgo: 1,
    sizingStatus: "estimating",
    body: "Under a full telemetry load the BLE notify queue and the CAN receive path contend for the same DMA channel.",
  },
  {
    number: 484,
    title: "Motor PID integral windup on wheel stall",
    labels: ["bug", "motor-control"],
    author: "field-support",
    openedHoursAgo: 72,
    updatedHoursAgo: 26,
    sizingStatus: "sized",
    body: "When a wheel stalls against an obstacle the PID integral term keeps accumulating.",
  },
  {
    number: 485,
    title: "Watchdog reset on I²C bus lockup",
    labels: ["bug", "i2c", "watchdog", "priority-high"],
    author: "field-support",
    openedHoursAgo: 48,
    updatedHoursAgo: 3,
    sizingStatus: "sized",
    body: "Unit 07 in the Fremont pilot rebooted 14 times overnight. The IMU holds SDA low after a burst read.",
  },
  {
    number: 486,
    title: "Expose battery health over BLE GATT service",
    labels: ["enhancement", "ble"],
    author: "maya-chen",
    openedHoursAgo: 44,
    updatedHoursAgo: 20,
    sizingStatus: "sized",
    body: "The pack reports state of health over the internal bus but nothing publishes it.",
  },
  {
    number: 487,
    title: "Delta OTA updates for images larger than 1 MB",
    labels: ["enhancement", "ota"],
    author: "maya-chen",
    openedHoursAgo: 36,
    updatedHoursAgo: 12,
    sizingStatus: "sized",
    body: "Full-image OTA over cellular costs more than the update is worth once the firmware passes 1 MB.",
  },
  {
    number: 488,
    title: "Typo sweep in operator manual + pairing guide",
    labels: ["docs", "good-first-issue"],
    author: "kensuenobu",
    openedHoursAgo: 30,
    updatedHoursAgo: 30,
    sizingStatus: "sized",
    body: null,
  },
  {
    number: 489,
    title: "CAN arbitration-lost storm under full telemetry load",
    labels: ["bug", "can-bus"],
    author: "jorge-reyes",
    openedHoursAgo: 22,
    updatedHoursAgo: 4,
    sizingStatus: "sized",
    body: "With telemetry at full rate the CAN controller loses arbitration repeatedly.",
  },
  {
    number: 490,
    title: "Migrate build system to Zephyr RTOS 4.2",
    labels: ["tech-debt", "zephyr"],
    author: "renovate[bot]",
    openedHoursAgo: 14,
    updatedHoursAgo: 2,
    sizingStatus: "needs_human",
    body: "Zephyr 3.7 leaves support this year, and 4.2 moves the device-tree bindings and the west manifest.",
  },
  {
    number: 491,
    title: "Add CRC32 to config persistence layer",
    labels: ["bug", "tech-debt"],
    author: "kensuenobu",
    openedHoursAgo: 6,
    updatedHoursAgo: 5,
    sizingStatus: "sized",
    body: "A partial write to the config partition currently reads back as a valid record.",
  },
];

/**
 * The nine estimates, **superseded first**.
 *
 * The order is the fixture's rather than the planner's, for the seed's own reason:
 * `issue_estimates_version_monotonic` refuses a version that is not above every version the
 * issue already has, so `#487`'s version 1 has to be written while version 1 is the highest
 * there is. Every visible field differs between the two, so a reader that returns the
 * superseded row is wrong in a way an assertion can see.
 */
export const INTAKE_ESTIMATES: readonly IntakeEstimate[] = [
  {
    number: 487,
    version: 1,
    effort: "s",
    confidence: 55,
    suggestedWorkflow: "standard-fix",
    routedModel: "ollama/qwen3-coder",
    files: ["src/ota/transport.c"],
    estTokens: 60_000,
    cycleMin: 6,
    cycleMax: 10,
    estMinutes: 20,
    risk: "low",
    riskNote: "One transport-layer flag with a documented fallback to the full image.",
    sizedMinutesAgo: 2100,
  },
  {
    number: 484,
    version: 1,
    effort: "m",
    confidence: 88,
    suggestedWorkflow: "standard-fix",
    routedModel: "cursor/composer-2",
    files: ["drivers/motor_pid.c", "tests/unit/test_motor_pid.c"],
    estTokens: 150_000,
    cycleMin: 10,
    cycleMax: 16,
    estMinutes: 50,
    risk: "medium",
    riskNote: "Touches the shared PID loop every drive mode runs through.",
    sizedMinutesAgo: 1500,
  },
  {
    number: 485,
    version: 1,
    effort: "m",
    confidence: 92,
    suggestedWorkflow: "standard-fix",
    routedModel: "claude-fable-5",
    files: ["drivers/i2c_recovery.c", "drivers/imu_bmi270.c", "tests/unit/test_i2c_lockup.c"],
    estTokens: 180_000,
    cycleMin: 12,
    cycleMax: 18,
    estMinutes: 45,
    risk: "low",
    riskNote: "Isolated to the I²C driver path; full HIL coverage exists for bus recovery.",
    sizedMinutesAgo: 2,
  },
  {
    number: 486,
    version: 1,
    effort: "l",
    confidence: 84,
    suggestedWorkflow: "feature-loop",
    routedModel: "claude-sonnet-5",
    files: ["src/ble/gatt_battery.c", "src/ble/gatt_table.c", "include/battery_health.h"],
    estTokens: 320_000,
    cycleMin: 25,
    cycleMax: 40,
    estMinutes: 90,
    risk: "medium",
    riskNote:
      "Adds a characteristic to a live GATT table; every existing pairing has to keep working.",
    sizedMinutesAgo: 1140,
  },
  {
    number: 487,
    version: 2,
    effort: "l",
    confidence: 71,
    suggestedWorkflow: "feature-loop",
    routedModel: "claude-fable-5",
    files: ["src/ota/delta.c", "src/ota/transport.c", "src/ota/manifest.c"],
    estTokens: 410_000,
    cycleMin: 30,
    cycleMax: 50,
    estMinutes: 110,
    risk: "high",
    riskNote: "Rewrites the update path the field app and the factory line both depend on.",
    sizedMinutesAgo: 660,
  },
  {
    number: 488,
    version: 1,
    effort: "xs",
    confidence: 98,
    suggestedWorkflow: "docs-loop",
    routedModel: "ollama/qwen3-coder",
    files: [],
    estTokens: 25_000,
    cycleMin: 3,
    cycleMax: 6,
    estMinutes: 15,
    risk: "low",
    riskNote: "Documentation only; no code path changes and nothing to regress.",
    sizedMinutesAgo: 1740,
  },
  {
    number: 489,
    version: 1,
    effort: "m",
    confidence: 78,
    suggestedWorkflow: "standard-fix",
    routedModel: "claude-sonnet-5",
    files: ["drivers/can_arbitration.c", "src/telemetry/scheduler.c"],
    estTokens: 210_000,
    cycleMin: 15,
    cycleMax: 25,
    estMinutes: 60,
    risk: "medium",
    riskNote: "Arbitration handling sits under both the telemetry and the motor-control paths.",
    sizedMinutesAgo: 180,
  },
  {
    number: 490,
    version: 1,
    effort: "xl",
    confidence: 61,
    suggestedWorkflow: "deps-refresh",
    routedModel: "claude-fable-5",
    files: ["west.yml", "boards/helios_rev_c.dts", "CMakeLists.txt"],
    estTokens: 900_000,
    cycleMin: 90,
    cycleMax: 150,
    estMinutes: 180,
    risk: "high",
    riskNote: "Moves every board file and the CI images at once.",
    sizedMinutesAgo: 90,
  },
  {
    number: 491,
    version: 1,
    effort: "s",
    confidence: 95,
    suggestedWorkflow: "standard-fix",
    routedModel: "copilot/gpt-5-codex",
    files: ["src/config/persist.c", "tests/unit/test_config_crc.c"],
    estTokens: 90_000,
    cycleMin: 8,
    cycleMax: 14,
    estMinutes: 30,
    risk: "low",
    riskNote: "Confined to the config record reader and writer.",
    sizedMinutesAgo: 240,
  },
];

/**
 * What {@link seedIntake} is supposed to produce, read the way the API answers it.
 *
 * Derived from the rows above and from `R__dev_seed_intake.sql` — see this file's header on why
 * it is a shared constant, and `dashboard.fixture.ts` on why the suite whose subject *is* the
 * arithmetic still spells its figures out as literals.
 */
export const MOCKUP_03 = {
  /** How many issues the fixture mirrors. All nine are `open`. */
  issues: 9,
  /** The page head's first figure — *"9 open issues"*. */
  openCount: 9,
  /** Its second — *"7 already sized"*: nine less `#483` (`estimating`) and `#490` (`needs_human`). */
  sizedCount: 7,
  /**
   * The rows under `sort=effort`, in the only order they can take.
   *
   * XS, S, then the three M's by confidence, the two L's, the XL, and the one issue with no
   * estimate last. The seed's header derives the same list.
   */
  effortOrder: [488, 491, 485, 484, 489, 486, 487, 490, 483],
  /** Every distinct label across the nine, ascending — the chip set the filter bar renders. */
  labelFacets: [
    "ble",
    "bug",
    "can-bus",
    "docs",
    "enhancement",
    "good-first-issue",
    "i2c",
    "motor-control",
    "ota",
    "priority-high",
    "tech-debt",
    "telemetry",
    "watchdog",
    "zephyr",
  ],
  /** The issues carrying `bug`, in effort order — the mockup's own `bug ✓` chip. */
  bugIssues: [491, 485, 484, 489, 483],
} as const;

/**
 * Mockup 03, as rows.
 *
 * Two statements' worth of writes, in the order the seed's own file makes them: the nine issues,
 * then the estimates superseded-first. Written through the harness's connection rather than
 * through an API, because nothing in this service writes a mirrored issue except the sync.
 *
 * Every instant is relative to `now()` in the database, so *"opened 2d ago"* stays true however
 * long after this file was written the suite runs — a literal date would be right on the day it
 * was typed and wrong on every day after it.
 *
 * @param api - The started harness, whose connection writes the rows.
 * @param workspace - Where to put them, from `workspaceWithRepo`.
 * @param repoId - Which repository, for a suite that seeded a second one. Defaults to the
 *   workspace's own.
 * @returns When every row exists.
 */
export async function seedIntake(
  api: ApiHarness,
  workspace: SeededWorkspace,
  repoId: string = workspace.repoId,
): Promise<void> {
  for (const issue of INTAKE_ISSUES) {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.github_issues
              (organization_id, github_repo_id, number, title, body, state, labels,
               author_login, gh_created_at, gh_updated_at, gh_url, synced_at, sizing_status)
       values ($1, $2, $3::int, $4, $5, 'open', $6::jsonb, $7,
               now() - make_interval(hours => $8::int),
               now() - make_interval(hours => $9::int),
               'https://github.com/acme-robotics/helios-firmware/issues/' || $3::int::text,
               now() - interval '40 seconds', $10)`,
      [
        workspace.id,
        repoId,
        issue.number,
        issue.title,
        issue.body,
        JSON.stringify(issue.labels),
        issue.author,
        issue.openedHoursAgo,
        issue.updatedHoursAgo,
        issue.sizingStatus,
      ],
    );
  }

  for (const estimate of INTAKE_ESTIMATES) {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.issue_estimates
              (github_issue_id, version, effort, confidence, suggested_workflow, routed_model,
               breakdown, risk, risk_note, trace, created_at)
       select issues.id, $3::int, $4, $5::int, $6, $7,
              jsonb_build_object('files', $8::jsonb, 'est_tokens', $9::int,
                                 'cycle_min', $10::int, 'cycle_max', $11::int,
                                 'est_minutes', $12::int),
              $13, $14,
              jsonb_build_object('estimator', 'heuristic-v0',
                                 'sized_at', to_char((now() - make_interval(mins => $15::int))
                                                       at time zone 'UTC',
                                                     'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                 'tokens_used', 0, 'signals', '[]'::jsonb),
              now() - make_interval(mins => $15::int)
         from ${SCHEMA_NAME}.github_issues issues
        where issues.organization_id = $1 and issues.github_repo_id = $2
          and issues.number = $16::int`,
      [
        workspace.id,
        repoId,
        estimate.version,
        estimate.effort,
        estimate.confidence,
        estimate.suggestedWorkflow,
        estimate.routedModel,
        JSON.stringify(estimate.files),
        estimate.estTokens,
        estimate.cycleMin,
        estimate.cycleMax,
        estimate.estMinutes,
        estimate.risk,
        estimate.riskNote,
        estimate.sizedMinutesAgo,
        estimate.number,
      ],
    );
  }
}
