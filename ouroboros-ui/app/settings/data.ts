import "server-only";

/**
 * What the settings hub reads to draw itself
 * (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491)).
 *
 * The hub is a page of cards owned by BS.2–BS.6, and each of those brings its own read. Today
 * that is the dry-run policy (BA.3, #382), whose row is mounted in the Policies section, and the
 * Members & Roles card (BS.3, #493) — the members page, and for an administrator the
 * service-account list that carries the token hints and the scope registry — and the Workspace
 * card (BS.2, #492): the workspace card's payload and the retention tiers. Each is read
 * through the one read every surface uses (`app/api/policies.ts`) and kept
 * as a {@link Reading}, for the rule every screen here keeps — **one failed read is one
 * degraded region, never a blank page**: a policy that could not be read costs the Policies
 * section its row and nothing else its place.
 *
 * Server-side only. This is where each card's read joins as it lands, side by side in one
 * `Promise.all`, so the page waits for the slowest of them once rather than for each in turn.
 */

import type { Workspace } from "@/app/api/access";
import { mayAdminister } from "@/app/api/membership";
import { type DryRunPolicy, dryRunPolicy } from "@/app/api/policies";
import { type Reading, attempt } from "@/app/api/reading";
import {
  type MembersPage,
  type ServiceAccountList,
  settingsMembers,
} from "@/app/api/settings-members";
import {
  type RetentionSettings,
  type WorkspaceSettings,
  settingsWorkspace,
} from "@/app/api/settings-workspace";

/** Everything the hub draws from the service, each part either read or explained. */
export interface SettingsReadings {
  /** The workspace's dry-run policy — the Policies section's one built row. */
  readonly dryRun: Reading<DryRunPolicy>;
  /** The Workspace card's payload — name, domain, region, training data. */
  readonly workspace: Reading<WorkspaceSettings>;
  /** The Workspace card's retention tiers. */
  readonly retention: Reading<RetentionSettings>;
  /** The Members & Roles card's page. */
  readonly members: Reading<MembersPage>;
  /**
   * The service-account list, for an owner or admin only — `null` for anybody else, who would be
   * refused it. A failed read is `null` too: the card then draws the members page's service rows
   * without hints, which is degraded rather than wrong.
   */
  readonly serviceAccounts: ServiceAccountList | null;
  /** When these were read — what the card's relative ages are measured against. */
  readonly readAt: string;
}

/**
 * Read what the hub draws.
 *
 * @param access The workspace this request may render. The calls themselves are scoped by the
 *   session's cookie; the membership's roles decide whether the administrator-only
 *   service-account list is worth asking for.
 * @returns The readings.
 */
export async function readSettings(access: Workspace): Promise<SettingsReadings> {
  const administers = mayAdminister(access.membership.roles);

  const [dryRun, workspace, retention, members, serviceAccounts] = await Promise.all([
    attempt(() => dryRunPolicy.read()),
    attempt(() => settingsWorkspace.read()),
    attempt(() => settingsWorkspace.retention()),
    attempt(() => settingsMembers.read()),
    administers ? attempt(() => settingsMembers.serviceAccounts()) : Promise.resolve(null),
  ]);

  return {
    dryRun,
    workspace,
    retention,
    members,
    serviceAccounts: serviceAccounts?.ok === true ? serviceAccounts.value : null,
    readAt: new Date().toISOString(),
  };
}
