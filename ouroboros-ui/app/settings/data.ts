import "server-only";

/**
 * What the settings hub reads to draw itself
 * (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491)).
 *
 * The hub is a page of cards owned by BS.2–BS.6, and each of those brings its own read. Today
 * that is the Autonomy policies card (BS.4, #494) — the org policy document in force, and the
 * dry-run policy (BA.3, #382) whose switch sits under its rules — the
 * Members & Roles card (BS.3, #493) — the members page, and for an administrator the
 * service-account list that carries the token hints and the scope registry — and the Workspace
 * card (BS.2, #492): the workspace card's payload and the retention tiers — and BS.5's three
 * (#495): the Audit card's today view and the webhook endpoints behind its SIEM row (both for an
 * administrator only, who is the only reader the service answers), the integrations grid, and the
 * org notification routes — and BS.6's (#496): the workspace's lifecycle, which the Danger zone
 * draws its pause switch from. Each is read
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
import { type OrgPolicy, orgPolicy } from "@/app/api/org-policy";
import { type DryRunPolicy, dryRunPolicy } from "@/app/api/policies";
import { type Reading, attempt } from "@/app/api/reading";
import { type AuditToday, settingsAudit } from "@/app/api/settings-audit";
import {
  type Integrations,
  type NotificationRoutes,
  settingsIntegrations,
} from "@/app/api/settings-integrations";
import { type WorkspaceLifecycle, settingsLifecycle } from "@/app/api/settings-lifecycle";
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
import { type WebhookList, settingsWebhooks } from "@/app/api/settings-webhooks";

/** Everything the hub draws from the service, each part either read or explained. */
export interface SettingsReadings {
  /** The workspace-wide dry-run policy — the switch under the Autonomy policies card's rules. */
  readonly dryRun: Reading<DryRunPolicy>;
  /** The org policy document in force — the Autonomy policies card. */
  readonly policy: Reading<OrgPolicy>;
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
  /**
   * The Audit card's today view, for an owner or admin only — `null` for anybody else, who would
   * be refused it, and whose seat says so instead.
   */
  readonly audit: Reading<AuditToday> | null;
  /**
   * The webhook endpoints — the SIEM row and the Webhooks tile's sheet — for an owner or admin
   * only. `null` for anybody else, and for a failed read: the row then says its status is
   * unavailable and the sheet reads for itself when opened.
   */
  readonly webhooks: WebhookList | null;
  /** The Integrations card's grid. */
  readonly integrations: Reading<Integrations>;
  /** The Notifications card's org routes. */
  readonly routes: Reading<NotificationRoutes>;
  /** Where the workspace stands — the Danger zone card. Any member may read it. */
  readonly lifecycle: Reading<WorkspaceLifecycle>;
  /** When these were read — what the card's relative ages are measured against. */
  readonly readAt: string;
}

/**
 * Read what the hub draws.
 *
 * @param access The workspace this request may render. The calls themselves are scoped by the
 *   session's cookie; the membership's roles decide whether the administrator-only reads — the
 *   service-account list, the audit log, the webhook endpoints — are worth asking for.
 * @returns The readings.
 */
export async function readSettings(access: Workspace): Promise<SettingsReadings> {
  const administers = mayAdminister(access.membership.roles);

  const [
    dryRun,
    policy,
    workspace,
    retention,
    members,
    serviceAccounts,
    audit,
    webhooks,
    integrations,
    routes,
    lifecycle,
  ] = await Promise.all([
    attempt(() => dryRunPolicy.read()),
    attempt(() => orgPolicy.read()),
    attempt(() => settingsWorkspace.read()),
    attempt(() => settingsWorkspace.retention()),
    attempt(() => settingsMembers.read()),
    administers ? attempt(() => settingsMembers.serviceAccounts()) : Promise.resolve(null),
    administers ? attempt(() => settingsAudit.today()) : Promise.resolve(null),
    administers ? attempt(() => settingsWebhooks.list()) : Promise.resolve(null),
    attempt(() => settingsIntegrations.read()),
    attempt(() => settingsIntegrations.routes()),
    attempt(() => settingsLifecycle.read()),
  ]);

  return {
    dryRun,
    policy,
    workspace,
    retention,
    members,
    serviceAccounts: serviceAccounts?.ok === true ? serviceAccounts.value : null,
    audit,
    webhooks: webhooks?.ok === true ? webhooks.value : null,
    integrations,
    routes,
    lifecycle,
    readAt: new Date().toISOString(),
  };
}
