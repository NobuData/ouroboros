/**
 * Mockup 18's seeded findings, as the composer reads them (BV.4,
 * [#513](https://github.com/NobuData/ouroboros/issues/513)).
 *
 * A mirror of what `ouroboros-db/migrations/R__dev_seed_workspace_metrics_analyzer.sql` stores on
 * the page's run — the pattern findings `5eed0066-…-111` to `…-175` with the measured fields the
 * composer's formulas read, and their confidence bases — and of the repository's calibration
 * (V085: `workflow_outcome` 1.0682 and `cache_window` 0.6545, both `duration_delta`). The
 * integration suite composes over the real seed and compares with what the seed stores; this
 * mirror is what the unit suites compose the mockup's exact cards from.
 *
 * The window is the mockup's: ninety days to Aug 7, from May 10 — *"since May"*.
 */

import { calibrationKey } from "./composer.repository";
import type { ComposeContext, ComposerFinding } from "./composer.types";

/** A seeded finding id — `5eed0066-0000-4000-8000-000000000<n>`. */
export function seededId(n: number): string {
  return `5eed0066-0000-4000-8000-${n.toString().padStart(12, "0")}`;
}

/** The seeded runner pool and runner the queue finding names. */
export const POOL_A_ID = "5eed0024-0000-4000-8000-000000000001";
export const FORGE_02_ID = "5eed0025-0000-4000-8000-000000000002";

/**
 * One seeded finding.
 *
 * @param n - Its number.
 * @param analyzer - The analyzer (and finding type).
 * @param subjectKey - The subject key.
 * @param data - The stored data.
 * @param basis - `[sample_size, effect_size, stability]`.
 * @param confidence - The analyzer's confidence.
 * @returns The finding.
 */
function seeded(
  n: number,
  analyzer: string,
  subjectKey: string,
  data: Record<string, unknown>,
  [sampleSize, effectSize, stability]: [number, number, number],
  confidence: number,
): ComposerFinding {
  return {
    id: seededId(n),
    analyzer,
    analyzerVersion: 1,
    findingType: analyzer,
    subjectKey,
    identityKey: `${analyzer}@v1/${subjectKey}`,
    data,
    confidence,
    confidenceBasis: {
      method: `${analyzer} v1`,
      sample_size: sampleSize,
      effect_size: effectSize,
      stability,
    },
  };
}

/** The twelve options no build set; the first of each three drifted once. */
const DEAD_OPTIONS = [
  "CONFIG_HELIOS_LEGACY_UART_SHIM",
  "CONFIG_HELIOS_BLE_MESH_PROXY",
  "CONFIG_HELIOS_OTA_DELTA_V1",
  "CONFIG_HELIOS_CAN_FD_EXPERIMENTAL",
  "CONFIG_HELIOS_TELEMETRY_CBOR_V1",
  "CONFIG_HELIOS_MOTOR_SIM_STUB",
  "CONFIG_HELIOS_DEBUG_SHELL_EXT",
  "CONFIG_HELIOS_FLASH_WEAR_LOG",
  "CONFIG_HELIOS_LED_MATRIX",
  "CONFIG_HELIOS_BOOT_BANNER_ASCII",
  "CONFIG_HELIOS_I2C_BITBANG",
  "CONFIG_HELIOS_POWER_TRACE_UART",
] as const;

/** The page's run's pattern findings. */
export const SEEDED_FINDINGS: readonly ComposerFinding[] = [
  seeded(
    111,
    "log_signature",
    "7a11aed7e766b9ee",
    {
      template:
        "FAIL - ota.fixture.shared_setup: fixture 'ota_image_server' setup timed out after <*>s",
      signature_hash: "7a11aed7e766b9ee",
      count: 31,
      share: 0.072,
    },
    [430, 0.072, 0.86],
    90,
  ),
  seeded(
    112,
    "log_signature",
    "e9b0d720c5c9b7a3",
    {
      template: "ccache: warning: manifest hash miss for <*> (ccache#1412)",
      signature_hash: "e9b0d720c5c9b7a3",
      count: 118,
      share: 0.205,
      tool_version: "4.9",
    },
    [577, 0.205, 0.9],
    92,
  ),
  ...DEAD_OPTIONS.map((option, index) =>
    seeded(
      121 + index,
      "config_usage",
      option,
      {
        option,
        occurrences: 0,
        builds_considered: 1284,
        drift_warnings: index % 3 === 0 ? 1 : 0,
      },
      [1284, 0, 1],
      95,
    ),
  ),
  seeded(
    141,
    "cache_window",
    "deps-refresh merge",
    {
      trigger: "deps-refresh merge",
      hit_rate_before: 0.78,
      hit_rate_after: 0.31,
      window_hours: 6,
      occurrences: 14,
      share: 0.2,
      slowdown_seconds: 168,
      trigger_title: "deps: refresh west manifest",
      pool_id: POOL_A_ID,
    },
    [577, 0.47, 0.936],
    93,
  ),
  seeded(
    151,
    "queue_correlation",
    "pool-a@14:00-16:00",
    {
      window: { from: "14:00", to: "16:00" },
      metric: "queue_wait",
      threshold_seconds: 300,
      days_exceeded: 11,
      days_observed: 14,
      idle_share: 0.82,
      pool: "pool-a",
      idle_pool: "pool-b",
      queue_p95_seconds: 420,
      wait_reduction_seconds: 240,
      move_runner_id: FORGE_02_ID,
    },
    [14, 0.786, 0.895],
    84,
  ),
  seeded(
    161,
    "waiver_cite",
    "missing thermal coverage",
    {
      topic: "missing thermal coverage",
      window_days: 60,
      waiver_count: 3,
      rig: "helios-rig-02",
      capability: "thermal chamber",
    },
    [3, 1, 0.863],
    82,
  ),
  seeded(
    171,
    "workflow_outcome",
    "standard-fix/stage qemu_cortex_m3/unique_failures",
    {
      workflow: "standard-fix",
      scope: "stage qemu_cortex_m3",
      metric: "unique_failures",
      value: 0,
      unit: "count",
      sample: 214,
      at_merge_gate: 0,
      pr_seconds_per_commit: 158,
      co_stages: ["native_sim"],
    },
    [214, 0, 0.95],
    91,
  ),
  seeded(
    172,
    "workflow_outcome",
    "standard-fix/stage HIL/unique_failures",
    {
      workflow: "standard-fix",
      scope: "stage HIL",
      metric: "unique_failures",
      value: 9,
      unit: "count",
      sample: 62,
      at_merge_gate: 9,
      pr_seconds_per_commit: 48,
      co_stages: ["native_sim"],
    },
    [62, 0.145, 0.95],
    90,
  ),
  seeded(
    173,
    "workflow_outcome",
    "standard-fix/stage build→review/failed_builds_flagged_by_review",
    {
      workflow: "standard-fix",
      scope: "stage build → review",
      metric: "failed_builds_flagged_by_review",
      value: 0.34,
      unit: "share",
      sample: 50,
      build_stage: "build",
      review_stage: "self-review",
      attempt_seconds: 368,
    },
    [50, 0.34, 0.896],
    89,
  ),
  seeded(
    174,
    "workflow_outcome",
    "standard-fix/drivers-can/telemetry_flake_ratio_7d",
    {
      workflow: "standard-fix",
      scope: "merges touching drivers/can",
      metric: "telemetry_flake_ratio_7d",
      value: 3.1,
      unit: "ratio",
      sample: 21,
      suite: "telemetry",
      rate: 0.62,
      baseline: 0.2,
    },
    [21, 3.1, 0.878],
    77,
  ),
  seeded(
    175,
    "workflow_outcome",
    "zephyr build/step link/link_share",
    {
      workflow: "zephyr build",
      scope: "step link",
      metric: "link_share",
      value: 0.42,
      unit: "share",
      before: 0.18,
      sample: 525,
      step_seconds_delta: 110,
      artifact: "zephyr.elf",
      since: "v2.3 (LTO enabled)",
    },
    [525, 0.24, 0.751],
    72,
  ),
];

/** The seeded repository's calibration factors (V085). */
export const SEEDED_FACTORS: ReadonlyMap<string, number> = new Map([
  [calibrationKey("workflow_outcome", "duration_delta"), 1.0682],
  [calibrationKey("cache_window", "duration_delta"), 0.6545],
]);

/**
 * The seeded run's composition context.
 *
 * @param factors - Calibration factors; the seeded ones by default.
 * @returns The context.
 */
export function seededContext(
  factors: ReadonlyMap<string, number> = SEEDED_FACTORS,
): ComposeContext {
  return {
    window: { from: "2026-05-10", to: "2026-08-07", days: 90 },
    factor: (analyzer, impactClass) => factors.get(calibrationKey(analyzer, impactClass)) ?? 1,
    poolName: (id) => (id === POOL_A_ID ? "pool-a" : undefined),
    runnerName: (id) => (id === FORGE_02_ID ? "forge-02" : undefined),
  };
}

/** The seeded run's context with its real calibration. */
export const SEEDED_CONTEXT: ComposeContext = seededContext();
