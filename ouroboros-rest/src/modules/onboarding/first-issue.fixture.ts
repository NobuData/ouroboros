/**
 * The seeded `helios-firmware` backlog as the picker reads it
 * ([#387](https://github.com/NobuData/ouroboros/issues/387)) — `R__dev_seed_intake.sql`'s sized
 * issues and their estimates in force, row for row, so the specs pick against the same backlog
 * the dev stack serves.
 *
 * `#486` and `#487` (L) are here because the seed sizes them; `#483` (estimating) and `#490`
 * (needs human) are not, because the candidate read only returns `sized` issues.
 */

import type { BacklogCounts, CandidateRow } from "./first-issue.repository";

/** The instant the specs measure freshness from. */
export const NOW = new Date("2026-09-29T12:00:00.000Z");

/**
 * An instant some hours before {@link NOW}.
 *
 * @param hours - How long ago.
 * @returns The instant.
 */
export function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

/**
 * A candidate row, with whatever a test changes.
 *
 * @param overrides - The fields to change.
 * @returns The row.
 */
export function candidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    issueId: "issue-488",
    number: 488,
    title: "Typo sweep in operator manual + pairing guide",
    url: "https://github.com/acme-robotics/helios-firmware/issues/488",
    updatedAt: hoursAgo(30),
    version: 1,
    effort: "xs",
    suggestedWorkflow: "docs-loop",
    routedModel: "ollama/qwen3-coder",
    files: [],
    cycleMin: 3,
    cycleMax: 6,
    estTokens: 25000,
    price: null,
    ...overrides,
  };
}

/** The seed's sized open issues in `helios-firmware`, by number. */
export const SEEDED_CANDIDATES: readonly CandidateRow[] = [
  candidate({
    issueId: "issue-484",
    number: 484,
    title: "Motor PID integral windup on wheel stall",
    updatedAt: hoursAgo(26),
    effort: "m",
    suggestedWorkflow: "standard-fix",
    routedModel: "cursor/composer-2",
    files: ["drivers/motor_pid.c", "tests/unit/test_motor_pid.c"],
    cycleMin: 10,
    cycleMax: 16,
    estTokens: 150000,
  }),
  candidate({
    issueId: "issue-485",
    number: 485,
    title: "Watchdog reset on I²C bus lockup",
    updatedAt: hoursAgo(3),
    effort: "m",
    suggestedWorkflow: "standard-fix",
    routedModel: "claude-fable-5",
    files: ["drivers/i2c_recovery.c", "drivers/imu_bmi270.c", "tests/unit/test_i2c_lockup.c"],
    cycleMin: 12,
    cycleMax: 18,
    estTokens: 180000,
  }),
  candidate({
    issueId: "issue-486",
    number: 486,
    title: "Expose battery health over BLE GATT service",
    updatedAt: hoursAgo(20),
    effort: "l",
    suggestedWorkflow: "feature-loop",
    routedModel: "claude-sonnet-5",
    files: ["src/ble/gatt_battery.c", "src/ble/gatt_table.c"],
    cycleMin: 25,
    cycleMax: 40,
    estTokens: 320000,
  }),
  candidate({
    issueId: "issue-487",
    number: 487,
    title: "Delta OTA updates for images larger than 1 MB",
    updatedAt: hoursAgo(12),
    version: 2,
    effort: "l",
    suggestedWorkflow: "feature-loop",
    routedModel: "claude-fable-5",
    files: ["src/ota/delta.c", "src/ota/transport.c"],
    cycleMin: 30,
    cycleMax: 50,
    estTokens: 410000,
  }),
  candidate(),
  candidate({
    issueId: "issue-489",
    number: 489,
    title: "CAN arbitration-lost storm under full telemetry load",
    updatedAt: hoursAgo(4),
    effort: "m",
    suggestedWorkflow: "standard-fix",
    routedModel: "claude-sonnet-5",
    files: ["drivers/can_arbitration.c", "src/telemetry/scheduler.c", "tests/hil/test_can_load.c"],
    cycleMin: 15,
    cycleMax: 25,
    estTokens: 210000,
  }),
  candidate({
    issueId: "issue-491",
    number: 491,
    title: "Add CRC32 to config persistence layer",
    updatedAt: hoursAgo(5),
    effort: "s",
    suggestedWorkflow: "standard-fix",
    routedModel: "copilot/gpt-5-codex",
    files: ["src/config/persist.c", "tests/unit/test_config_crc.c"],
    cycleMin: 8,
    cycleMax: 14,
    estTokens: 90000,
  }),
];

/** The seed's open `helios-firmware` issues by sizing status: 9 open, 7 sized, 1 each other. */
export const SEEDED_BACKLOG: BacklogCounts = { open: 9, sized: 7, sizing: 1, needsHuman: 1 };
