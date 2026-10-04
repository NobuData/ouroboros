/**
 * The webhook event registry — which event types exist, under which family, since which registry
 * version (BR.3, [#487](https://github.com/NobuData/ouroboros/issues/487)).
 *
 * ```
 * family     audit.*  decision.*  run.*  pr.*
 * version 1  audit.<every AD.4 action> · decision.filed … · run.opened … · pr.criterion_verified …
 * version 2  audit.decision.answered · audit.decision.answer_failed · decision.answered · decision.answer_failed (#462)
 * version 3  audit.decision.snoozed · …snoozed_all · …unsnoozed, and their decision.* types (#464)
 * ```
 *
 * **Versioned so a subscription never widens by itself.** An endpoint records the registry
 * version it subscribed under (`webhook_endpoints.registry_version`), and is delivered only the
 * types registered at or below it. A release that adds an event type appends a version with that
 * type; endpoints already subscribed keep receiving exactly what they were shown until an
 * administrator moves them to the new version. Published versions are frozen —
 * `webhook.registry.spec.ts` holds version 1 to a literal list.
 *
 * **Matching is exact.** A subscription entry is a family wildcard (`audit.*`) or one concrete
 * type (`run.merged`), and a wildcard covers its own family only: `audit.*` never matches
 * `decision.filed`, even though the same audit row also fans out as `audit.decision.filed`.
 *
 * The database holds the grammar (V098's `webhook_subscription_valid`); this module holds the
 * list, because adding an event is an application release rather than a migration — the same
 * split V022 made for audit actions.
 */

import type { AuditAction } from "../audit/audit.events";

/** The four families an endpoint may subscribe to. */
export const WEBHOOK_FAMILIES = ["audit", "decision", "run", "pr"] as const;

/** One of {@link WEBHOOK_FAMILIES}. */
export type WebhookFamily = (typeof WEBHOOK_FAMILIES)[number];

/** The test event an administrator fires at one endpoint. Belongs to no family. */
export const PING_EVENT = "ping";

/** A run was opened by the ingestion contract (`POST /internal/runs`). */
export const RUN_OPENED_EVENT = "run.opened";
/** The merge executor merged the run's pull request and finished the run. */
export const RUN_MERGED_EVENT = "run.merged";
/** A run was canceled from its console. */
export const RUN_CANCELED_EVENT = "run.canceled";
/** The loop's pull request was merged by the merge executor — the PR-side view of `run.merged`. */
export const PR_MERGED_EVENT = "pr.merged";

/**
 * The audit actions that are also events of another family, and the type each becomes there.
 *
 * Decision items and PR verification already write audit rows; a subscriber to `decision.*` or
 * `pr.*` wants those facts without subscribing to the whole audit trail, so the audit writer fans
 * each of these out twice — `audit.<action>` and the type below — in the audit row's transaction.
 */
export const DERIVED_EVENT_TYPES: Readonly<Partial<Record<AuditAction, string>>> = {
  "decision.filed": "decision.filed",
  "decision.refreshed": "decision.refreshed",
  "decision.source_resolved": "decision.source_resolved",
  "decision.answered": "decision.answered",
  "decision.answer_failed": "decision.answer_failed",
  "decision.snoozed": "decision.snoozed",
  "decision.snoozed_all": "decision.snoozed_all",
  "decision.unsnoozed": "decision.unsnoozed",
  "pr_criterion.verified": "pr.criterion_verified",
  "pr_criterion.unverified": "pr.criterion_unverified",
  "pr_criterion.waived": "pr.criterion_waived",
  "pr_approval.requested": "pr.approval_requested",
  "pr_approval.approved": "pr.approval_approved",
  "pr_approval.declined": "pr.approval_declined",
  "pr_thread.resolved": "pr.thread_resolved",
};

/** One registry version: the types it adds to every version before it. */
export interface WebhookRegistryVersion {
  /** 1, 2, … — dense, in order. */
  readonly version: number;
  /** The event types this version introduces. Never edited once published. */
  readonly adds: readonly string[];
}

/**
 * Every published registry version, oldest first.
 *
 * Version 1 is BR.3's: every audit action this release writes, the decision and PR types derived
 * from them, and the run and PR transitions written by the run plane.
 *
 * **To add an event type**, append `{version: n + 1, adds: ["family.event"]}` — never edit an
 * existing entry. The spec fails if an audit action is not registered in any version (so a new
 * audit action cannot ship without a decision about its webhook type), and holds version 1 to its
 * published list.
 */
export const WEBHOOK_REGISTRY: readonly WebhookRegistryVersion[] = [
  {
    version: 1,
    // Literal on purpose: a list computed from AUDIT_ACTIONS would grow by itself.
    adds: [
      "audit.provider.added",
      "audit.provider.revealed",
      "audit.provider.rotated",
      "audit.provider.enabled",
      "audit.provider.disabled",
      "audit.provider.cap_changed",
      "audit.provider.updated",
      "audit.provider.deleted",
      "audit.provider.tested",
      "audit.credential.lease_granted",
      "audit.github.token_set",
      "audit.github.token_rotated",
      "audit.github.token_cleared",
      "audit.runner.token_minted",
      "audit.runner.token_revoked",
      "audit.runner.enrolled",
      "audit.runner.cert_renewed",
      "audit.runner.cert_revoked",
      "audit.runner.removed",
      "audit.runner.drained",
      "audit.runner.undrained",
      "audit.runner.pool_created",
      "audit.runner.pool_updated",
      "audit.runner.pool_deleted",
      "audit.runner.job_submitted",
      "audit.runner.flagged",
      "audit.triage.classified",
      "audit.triage.rerun_requested",
      "audit.triage.waived",
      "audit.triage.intents_set",
      "audit.pr_criterion.verified",
      "audit.pr_criterion.unverified",
      "audit.pr_criterion.waived",
      "audit.pr_approval.requested",
      "audit.pr_approval.approved",
      "audit.pr_approval.declined",
      "audit.pr_thread.resolved",
      "audit.knowledge.imported",
      "audit.knowledge.repo_map_generated",
      "audit.knowledge.env_recipe_saved",
      "audit.policy.dry_run_changed",
      "audit.analyzer.run_requested",
      "audit.analyzer.schedule_updated",
      "audit.workspace.paused",
      "audit.workspace.resumed",
      "audit.workspace.disconnected",
      "audit.workspace.delete_requested",
      "audit.workspace.restored",
      "audit.workspace.purged",
      "audit.workspace.updated",
      "audit.runner.pool_window_added",
      "audit.runner.pool_window_removed",
      "audit.runner.job_hook_registered",
      "audit.runner.job_hook_removed",
      "audit.analysis_suggestion.applied",
      "audit.analysis_suggestion.dismissed",
      "audit.analysis_suggestion.drafted",
      "audit.analyzer.batch_pushed",
      "audit.member.invited",
      "audit.member.invitation_resent",
      "audit.member.invitation_revoked",
      "audit.member.role_changed",
      "audit.member.removed",
      "audit.member.capability_changed",
      "audit.service_account.created",
      "audit.service_account.rotated",
      "audit.service_account.revoked",
      "audit.decision.filed",
      "audit.decision.refreshed",
      "audit.decision.source_resolved",
      "audit.webhook.created",
      "audit.webhook.updated",
      "audit.webhook.enabled",
      "audit.webhook.disabled",
      "audit.webhook.secret_rotated",
      "audit.webhook.deleted",
      "audit.webhook.redelivered",
      "decision.filed",
      "decision.refreshed",
      "decision.source_resolved",
      "pr.criterion_verified",
      "pr.criterion_unverified",
      "pr.criterion_waived",
      "pr.approval_requested",
      "pr.approval_approved",
      "pr.approval_declined",
      "pr.thread_resolved",
      "pr.merged",
      "run.opened",
      "run.merged",
      "run.canceled",
    ],
  },
  {
    version: 2,
    // BN.2 (#462): a person's answer through the inbox's action executor, and a press its plane
    // refused — each an audit action, and a decision type derived from it.
    adds: [
      "audit.decision.answered",
      "audit.decision.answer_failed",
      "decision.answered",
      "decision.answer_failed",
    ],
  },
  {
    version: 3,
    // BN.4 (#464): snoozing one item, Snooze all, and bringing items back early.
    adds: [
      "audit.decision.snoozed",
      "audit.decision.snoozed_all",
      "audit.decision.unsnoozed",
      "decision.snoozed",
      "decision.snoozed_all",
      "decision.unsnoozed",
    ],
  },
];

/** The newest registry version — what a new endpoint subscribes under. */
export const LATEST_REGISTRY_VERSION = WEBHOOK_REGISTRY[WEBHOOK_REGISTRY.length - 1].version;

/** A family wildcard: `audit.*`. */
const WILDCARD = /^(audit|decision|run|pr)\.\*$/;

/**
 * Every event type registered at or below a version.
 *
 * @param version - The registry version, 1 … {@link LATEST_REGISTRY_VERSION}.
 * @returns The set of types an endpoint subscribed under that version may be sent.
 */
export function registeredTypes(version: number): ReadonlySet<string> {
  return new Set(
    WEBHOOK_REGISTRY.filter((entry) => entry.version <= version).flatMap((e) => e.adds),
  );
}

/**
 * The family an event type belongs to.
 *
 * @param eventType - `audit.provider.rotated`, `run.merged`.
 * @returns The family, or `undefined` for `ping` and anything unregistered-looking.
 */
export function familyOf(eventType: string): WebhookFamily | undefined {
  const family = eventType.split(".", 1)[0];

  return (WEBHOOK_FAMILIES as readonly string[]).includes(family)
    ? (family as WebhookFamily)
    : undefined;
}

/**
 * Whether a subscription list is sent an event — exact family or exact type, at the endpoint's
 * registry version.
 *
 * @param subscriptions - The endpoint's `event_families`.
 * @param registryVersion - The version it subscribed under.
 * @param eventType - The event.
 * @returns `true` when the type is registered at that version and a wildcard of its own family
 *   or the type itself is subscribed. `ping` is never matched here — it is sent on request only.
 */
export function subscriptionMatches(
  subscriptions: readonly string[],
  registryVersion: number,
  eventType: string,
): boolean {
  const family = familyOf(eventType);

  if (family === undefined || !registeredTypes(registryVersion).has(eventType)) {
    return false;
  }

  return subscriptions.includes(`${family}.*`) || subscriptions.includes(eventType);
}

/**
 * Why a subscription entry is refused, or `undefined` when it is valid at a version.
 *
 * @param entry - One `event_families` entry.
 * @param registryVersion - The version the endpoint subscribes under.
 * @returns A sentence for the validation error, or `undefined`.
 */
export function subscriptionEntryProblem(
  entry: string,
  registryVersion: number,
): string | undefined {
  if (WILDCARD.test(entry)) {
    return undefined;
  }

  if (registeredTypes(registryVersion).has(entry)) {
    return undefined;
  }

  return `${entry} is neither a family wildcard (audit.*, decision.*, run.*, pr.*) nor an event type registered in version ${String(registryVersion)}`;
}

/**
 * The webhook types one audit row fans out as.
 *
 * @param action - The audit action.
 * @returns `audit.<action>`, and the derived decision or PR type when there is one.
 */
export function auditEventTypes(action: AuditAction): string[] {
  const derived = DERIVED_EVENT_TYPES[action];

  return derived === undefined ? [`audit.${action}`] : [`audit.${action}`, derived];
}
