/**
 * What the product says when a queued issue is not starting a live run — DI.4
 * ([#1312](https://github.com/NobuData/ouroboros/issues/1312)).
 *
 * ```
 * QueueItemSummary.waiting / BacklogRow.queueWaiting { reason, scope } ─▶ waitingCopy() ─▶ label · sentence · fix
 * ```
 *
 * Every refusal of the engine's claim is one of `ouroboros-rest`'s admission reasons, and every
 * queued item that waits carries one — nothing waits silently. The dashboard's queue card and
 * the issues screen both draw from this map, so a reason reads the same wherever it is seen:
 * a short **label** for a chip, one **sentence** for a tooltip or the panel, and **where it is
 * fixed**. Pure, so every reason is tested without a page.
 */

import type { components } from "@/app/api/schema";
import { DOCS_URL } from "@/app/external";
import {
  type CapabilityFix,
  ENGINE_HEALTH,
  HOW_TO_ENABLE,
  POLICIES,
  PROVIDERS,
} from "@/app/loop/capability-copy";
import { REPOSITORIES_PATH, WORKFLOWS_PATH, settingsSectionPath } from "@/app/paths";

/** Why a queued item waits — the contract's own type. */
export type QueueWaiting = components["schemas"]["QueueWaiting"];

/** One admission reason code. */
export type AdmissionReason = QueueWaiting["reason"];

/** What a surface says about one waiting reason. */
export interface WaitingCopy {
  /** A few words for a chip. */
  readonly label: string;
  /** One sentence: what holds the item and what that means. */
  readonly sentence: string;
  /** Where it is fixed, or `null` when the fix is an action on the item itself. */
  readonly fix: CapabilityFix | null;
}

/** The administration page's section on live-run limits. */
export const LIVE_LIMITS_DOCS = `${DOCS_URL}administration/live-execution#limits`;

/** The issues guide's section on a waiting queue — where confirming is explained. */
export const WAITING_DOCS = `${DOCS_URL}user-guide/issues#why-a-queued-issue-is-waiting`;

/** The workspace's lifecycle — where a pause is lifted. */
const DANGER_ZONE: CapabilityFix = {
  label: "Workspace settings →",
  href: settingsSectionPath("danger"),
  external: false,
};

/** Repositories — where one is enabled for the loop. */
const REPOSITORIES: CapabilityFix = {
  label: "Repositories →",
  href: REPOSITORIES_PATH,
  external: false,
};

/** Workflows — where a version is published. */
const WORKFLOWS: CapabilityFix = { label: "Workflows →", href: WORKFLOWS_PATH, external: false };

/** The limits documentation — how the ceiling is raised. */
const LIMITS: CapabilityFix = { label: "About the ceiling", href: LIVE_LIMITS_DOCS, external: true };

/** Every reason's words. */
export const WAITING_COPY: Readonly<Record<AdmissionReason, WaitingCopy>> = {
  deployment_disabled: {
    label: "Live runs off",
    sentence: "Live execution is off for this deployment — nothing in the queue starts until it is on.",
    fix: HOW_TO_ENABLE,
  },
  workspace_paused: {
    label: "Workspace paused",
    sentence: "This workspace is paused — nothing in the queue starts until it resumes.",
    fix: DANGER_ZONE,
  },
  workspace_pending_delete: {
    label: "Pending deletion",
    sentence: "This workspace is pending deletion — nothing in the queue starts.",
    fix: DANGER_ZONE,
  },
  no_executor: {
    label: "No executor",
    sentence: "The engine has no stage executor registered — nothing in the queue can start.",
    fix: ENGINE_HEALTH,
  },
  concurrency_ceiling: {
    label: "Waiting for a slot",
    sentence:
      "The workspace is running as many live runs as its ceiling allows — this starts when one finishes.",
    fix: LIMITS,
  },
  repository_disabled: {
    label: "Repository off",
    sentence: "Its repository is not enabled for the loop.",
    fix: REPOSITORIES,
  },
  policy_not_dry_run: {
    label: "Not in dry-run",
    sentence:
      "Its repository is not in dry-run — live runs open draft pull requests only, so it cannot start.",
    fix: POLICIES,
  },
  workflow_unpublished: {
    label: "No published workflow",
    sentence: "It pins no published version of its workflow.",
    fix: WORKFLOWS,
  },
  route_not_invocable: {
    label: "No model to call",
    sentence: "A route its workflow uses has no provider connection that may be invoked.",
    fix: PROVIDERS,
  },
  needs_confirmation: {
    label: "Needs confirmation",
    sentence: "Nobody with loop approval has confirmed it for a live run yet.",
    fix: null,
  },
};

/**
 * The words for one waiting reason.
 *
 * @param waiting Why the item waits.
 * @returns Its label, sentence and fix.
 */
export function waitingCopy(waiting: Pick<QueueWaiting, "reason">): WaitingCopy {
  return WAITING_COPY[waiting.reason];
}

/**
 * The reason that holds a whole list alike, if one does — a workspace reason every waiting item
 * carries. A card says it once, above its rows, rather than on each.
 *
 * @param waits Each item's reason, `null` for an item that is not waiting.
 * @returns The shared workspace reason, or `null` when there is none.
 */
export function sharedWaiting(waits: readonly (QueueWaiting | null)[]): QueueWaiting | null {
  const [first] = waits;

  if (first === undefined || first === null || first.scope !== "workspace") return null;

  return waits.every((wait) => wait?.reason === first.reason) ? first : null;
}
