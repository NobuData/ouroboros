/**
 * Platform tags — the suite's `native_sim`, `qemu_cortex_m3` or `rig:helios-rig-02`, normalized to
 * V051's `test_suites_platform_shape` so a report's spelling never fails a write (AT.1,
 * [#329](https://github.com/NobuData/ouroboros/issues/329)).
 */

import type { TestSuiteKind } from "../db/schema";

/** What a suite with no platform is recorded under — always beside a `junit_platform_missing`. */
export const UNKNOWN_PLATFORM = "unknown";

/** The prefix that makes a platform a physical rig. */
const RIG_PREFIX = "rig:";

/**
 * Normalize a platform as a report spelled it.
 *
 * A board or simulator is lowercased with every character outside `[a-z0-9_]` turned into `_`
 * (`nrf52840dk/nrf52840` → `nrf52840dk_nrf52840`); a `rig:` keeps its case and turns every
 * character outside `[A-Za-z0-9._-]` into `-`. Leading separators are trimmed.
 *
 * @param raw - The report's spelling.
 * @returns The stored tag, or null when nothing usable is left.
 */
export function normalizePlatform(raw: string): string | null {
  const trimmed = raw.trim();

  if (trimmed.toLowerCase().startsWith(RIG_PREFIX)) {
    return rigPlatform(trimmed.slice(RIG_PREFIX.length));
  }

  const board = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+/, "");

  return board === "" ? null : board;
}

/**
 * The platform of a physical rig.
 *
 * @param rig - The rig's name.
 * @returns `rig:<name>`, or null when the name has nothing usable.
 */
export function rigPlatform(rig: string): string | null {
  const name = rig
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/^[._-]+/, "");

  return name === "" ? null : `${RIG_PREFIX}${name}`;
}

/**
 * Which half of the wall-time split a platform's suite belongs to.
 *
 * @param platform - A normalized platform.
 * @returns `physical` exactly for a rig (V051's `test_suites_rig_is_physical`).
 */
export function kindOf(platform: string): TestSuiteKind {
  return platform.startsWith(RIG_PREFIX) ? "physical" : "sim";
}
