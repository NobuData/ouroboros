/**
 * The dry-run policy, as words and decisions (BA.3,
 * [#382](https://github.com/NobuData/ouroboros/issues/382), decision **O3**) — shared by every
 * surface that states it: the Settings → Policies tab that flips it, and the PR page's merge
 * plan card and head that render its refusal.
 *
 * **One source.** Each surface reads the same policy — `GET /policies/dry-run`, or the merge
 * plan's `dryRun`, which the service fills from it — and draws it with the sentences below, so the
 * wizard's safety rows, the PR page and the merge plan cannot disagree.
 *
 * **A refusal says why and where to go.** A blocked merge whose cause is invisible reads as a
 * bug, so the dry-run note always names the policy and the path to the flip.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type { DryRunPolicy } from "@/app/api/policies";
import type { components } from "@/app/api/schema";

/** The merge plan's dry-run state (`plan.dryRun`). */
export type PlanDryRun = components["schemas"]["PrMergeDryRunState"];

/** The merge affordance's label while dry-run is active — AY.7's (#369) relabelling contract. */
export const DRY_RUN_MERGE_LABEL = "Dry-run — review the draft PR";

/** Why merging is off while dry-run is active — the designed reason, stated. */
export const DRY_RUN_NOTE =
  "Dry-run policy active — this PR stays a draft and never merges until an owner or admin " +
  "turns dry-run off.";

/** The link to the flip. */
export const POLICIES_LINK_LABEL = "Settings → Policies";

/** What an overridden auto-merge terminal says. */
export const AUTO_MERGE_OVERRIDDEN =
  "The pinned workflow asks to auto-merge; dry-run overrides it without changing the workflow, " +
  "and turning dry-run off restores it exactly.";

// --- the PR page -----------------------------------------------------------------------------

/**
 * The dry-run note a PR surface draws, or `null` when dry-run is off.
 *
 * @param state The plan's dry-run state.
 * @returns The note and, when the pinned workflow's auto-merge is overridden, that too.
 */
export function dryRunNotes(
  state: PlanDryRun,
): { readonly note: string; readonly override: string | null } | null {
  if (!state.active) return null;

  return { note: DRY_RUN_NOTE, override: state.autoMerge.overridden ? AUTO_MERGE_OVERRIDDEN : null };
}

// --- the Policies tab ------------------------------------------------------------------------

/** The tab's title and the sentence under it. */
export const POLICIES_TITLE = "Policies";
export const POLICIES_SUBLINE =
  "What the loop may do without a person — enforced by the PR plane, not promised by a screen.";

/** The dry-run row's name and what it is. */
export const DRY_RUN_TITLE = "Dry-run";
export const DRY_RUN_SUMMARY =
  "Pull requests open as drafts and nothing merges. Workflows that auto-merge are overridden, " +
  "never edited.";

/** Why a reader below admin finds the flip read-only. */
export const POLICY_READ_ONLY = "Only an owner or admin can change the dry-run policy.";

/** What an unreachable service means for a flip. */
export const POLICY_WRITE_FAILURE =
  "The dry-run policy could not be changed. Nothing was changed — try again.";

/** The confirmation's buttons. */
export const POLICY_CANCEL = "Keep it as it is";
export const POLICY_SENDING = "Saving…";

/**
 * Where the policy stands, in one line.
 *
 * @param policy The policy.
 * @returns `On` or `Off`, with what that means — and, for a workspace that never answered, that
 *   completing the Get Started wizard turns it on.
 */
export function policyStatus(policy: DryRunPolicy): string {
  if (policy.dryRun) return "On — pull requests open as drafts and nothing merges.";
  if (!policy.explicit) {
    return "Off — never set. Completing the Get Started wizard turns it on.";
  }

  return "Off — pull requests may merge without a person in the loop.";
}

/**
 * When the policy last changed, and whether a person did it.
 *
 * @param policy The policy.
 * @returns `Last changed 2026-09-30.` (with `by the onboarding wizard` when no person did), or
 *   `null` when it never has. The person's name is the audit log's to show; this says when.
 */
export function attributionLine(policy: DryRunPolicy): string | null {
  if (policy.updatedAt === null) return null;

  const day = policy.updatedAt.slice(0, 10);

  return policy.updatedBy === null
    ? `Last changed ${day}, by the Get Started wizard's default.`
    : `Last changed ${day}. Every change is in the audit log.`;
}

/**
 * The flip button's label.
 *
 * @param policy The policy.
 * @returns What pressing it would do.
 */
export function flipLabel(policy: DryRunPolicy): string {
  return policy.dryRun ? "Turn dry-run off" : "Turn dry-run on";
}

/** What a confirmation states. */
export interface FlipConfirmation {
  /** The value it sets. */
  readonly dryRun: boolean;
  /** Its title. */
  readonly title: string;
  /** The consequences, in plain terms. */
  readonly consequences: readonly string[];
  /** The confirm button. */
  readonly confirm: string;
  /** Whether it loosens the policy — drawn as the dangerous direction. */
  readonly loosens: boolean;
}

/**
 * The confirmation for flipping the policy — its consequences stated before anything is sent.
 *
 * @param policy The policy as it stands.
 * @returns What the confirmation states.
 */
export function flipConfirmation(policy: DryRunPolicy): FlipConfirmation {
  if (policy.dryRun) {
    return {
      dryRun: false,
      title: "Turn dry-run off?",
      consequences: [
        "Pull requests open ready for review, not as drafts.",
        "Armed merges, and workflows whose last stage auto-merges, will merge code without a " +
          "person in the loop.",
        "Every surface lifts its dry-run refusal at once.",
        "The change is recorded in the audit log under your name, with the value it replaced.",
      ],
      confirm: "Turn dry-run off",
      loosens: true,
    };
  }

  return {
    dryRun: true,
    title: "Turn dry-run on?",
    consequences: [
      "New pull requests open as drafts.",
      "Nothing merges: arming and merging are refused, and an armed merge is disarmed when it " +
        "would fire.",
      "Workflows that auto-merge are overridden, not changed — turning dry-run off restores them.",
      "The change is recorded in the audit log under your name, with the value it replaced.",
    ],
    confirm: "Turn dry-run on",
    loosens: false,
  };
}

/** What a flip answered. */
export type PolicyFlipResult =
  | { readonly ok: true; readonly policy: DryRunPolicy }
  | { readonly ok: false; readonly reason: string };
