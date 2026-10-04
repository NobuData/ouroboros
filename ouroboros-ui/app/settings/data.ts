import "server-only";

/**
 * What the settings hub reads to draw itself
 * (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491)).
 *
 * The hub is a page of cards owned by BS.2–BS.6, and each of those brings its own read. What
 * exists today is one: the dry-run policy (BA.3, #382), whose row is mounted in the Policies
 * section. It is read through the one read every surface uses (`app/api/policies.ts`) and kept
 * as a {@link Reading}, for the rule every screen here keeps — **one failed read is one
 * degraded region, never a blank page**: a policy that could not be read costs the Policies
 * section its row and nothing else its place.
 *
 * Server-side only. This is where each card's read joins as it lands, side by side in one
 * `Promise.all`, so the page waits for the slowest of them once rather than for each in turn.
 */

import type { Workspace } from "@/app/api/access";
import { type DryRunPolicy, dryRunPolicy } from "@/app/api/policies";
import { type Reading, attempt } from "@/app/api/reading";

/** Everything the hub draws from the service, each part either read or explained. */
export interface SettingsReadings {
  /** The workspace's dry-run policy — the Policies section's one built row. */
  readonly dryRun: Reading<DryRunPolicy>;
}

/**
 * Read what the hub draws.
 *
 * @param access The workspace this request may render. Unused by the calls themselves — the
 *   session's cookie scopes them — and taken so the reader cannot be called before the gate.
 * @returns The readings.
 */
export async function readSettings(access: Workspace): Promise<SettingsReadings> {
  void access;

  const [dryRun] = await Promise.all([attempt(() => dryRunPolicy.read())]);

  return { dryRun };
}
