/**
 * The Autonomy policies card's words and decisions
 * (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)) — mockup 17's `c-7` card:
 * the version tag and its history, the publish confirmation, the owner gate and the toast.
 *
 * The rules of the document itself are `app/policies/document.ts`'s; this is everything said
 * *about* a publish:
 *
 * - **Tightening and loosening are different acts**, so the confirmation names which one each
 *   changed rule is, in BQ.2's own classification (`POST /api/v1/policies/preview`) — never one
 *   this module worked out for itself.
 * - **A loosening is the owner's to publish.** An admin is told which rules loosen, why that
 *   takes an owner, and who the owners are — rather than meeting a button that fails.
 * - **A version is something a reader can open.** Each history entry carries its note, its
 *   publisher and a before → after of every rule it changed, drawn from the two documents with
 *   the same chips the card draws.
 *
 * Framework-free and pure.
 */

import { settingsSectionPath } from "@/app/paths";

import {
  CORE_RULES,
  type CoreRuleId,
  type PolicyDocument,
  RULE_NAMES,
  ruleChips,
} from "./document";

/* ------------------------------------------------------------------ what the service answers */

/** Which way a change moves autonomy — BQ.2's classification. */
export type ChangeClass = "tightening" | "loosening" | "neutral";

/** One changed rule, as the service classified it. */
export interface RuleChange {
  readonly ruleId: string;
  readonly classification: ChangeClass;
  readonly verb: "enabled" | "disabled" | "changed" | "removed";
  /** The change as the audit line says it — `enabled auto-merge`. */
  readonly summary: string;
}

/** What publishing a draft would do (`POST /api/v1/policies/preview`). */
export interface PolicyPreview {
  readonly baseVersion: number | null;
  readonly classification: ChangeClass;
  readonly changes: readonly RuleChange[];
  readonly requiresOwner: boolean;
  /** Whether this reader may publish it — `false` for an admin and a loosening. */
  readonly mayPublish: boolean;
}

/** One published version (`GET /api/v1/policies/versions`). */
export interface PolicyVersionEntry {
  readonly version: number;
  readonly publishedAt: string;
  readonly publishedBy: string | null;
  /** Who published it, by name — `null` for a person since removed. */
  readonly publisherName: string | null;
  readonly changeNote: string | null;
  readonly classification: ChangeClass;
  /** What it changed from the version before it. */
  readonly changes: readonly RuleChange[];
  /** Its audit line — `enabled auto-merge (policy v7)`. */
  readonly summary: string;
  /** The document it published. */
  readonly document: PolicyDocument;
}

/** A page of history, newest first. */
export interface PolicyHistoryPage {
  readonly items: readonly PolicyVersionEntry[];
  /** The `before` that reads the next page, or `null` at the first version. */
  readonly nextBefore: number | null;
}

/** What the preview action answers. */
export type PreviewResult =
  | { readonly ok: true; readonly preview: PolicyPreview }
  | { readonly ok: false; readonly reason: string };

/** What the publish action answers. */
export type PublishResult =
  | { readonly ok: true; readonly version: number; readonly summary: string }
  | { readonly ok: false; readonly reason: string };

/** What the history action answers. */
export type HistoryResult =
  | { readonly ok: true; readonly page: PolicyHistoryPage }
  | { readonly ok: false; readonly reason: string };

/* ------------------------------------------------------------------ the card */

/** The footer's line — mockup 17's, verbatim. */
export const FOOTER_LINE = "Policies are versioned — changes appear in the audit log.";

/** The footer's link text — mockup 17's. */
export const EDIT_AS_CODE = "Edit as code";

/** The marker beside it until policy-as-code exists. */
export const SOON = "soon";

/** What stands where the link's destination would be. */
export const EDIT_AS_CODE_SOON =
  "Policy as code arrives with #498 (BT.2). Until then, policies are edited on this card.";

/** What a workspace that has published nothing is told. */
export const UNPUBLISHED_NOTE =
  "Nothing is published yet, so no rule binds. Turn a rule on and save to publish policy v1.";

/** Why a reader below admin cannot operate the card. */
export const POLICIES_READ_ONLY = "Only an owner or admin can change policies.";

/** What a rule whose conditions the chip editor cannot represent says. */
export const TERMS_NOT_EDITABLE =
  "These conditions are more detailed than this card can edit. They stay exactly as published; " +
  "the switch still turns the rule on and off.";

/** What introduces the workspace-wide dry-run switch under the rules. */
export const OVERRIDE_LEAD =
  "Workspace-wide override — while it is on, nothing merges whatever the rules above allow.";

/** What a `custom:*` rule's row says about editing it. */
export const CUSTOM_RULE_NOTE =
  "Custom rule — published as written; editing arrives with Edit as code.";

/**
 * What the Policies section says when the document could not be read.
 *
 * @param reason The message the service gave for refusing the read.
 * @returns The sentence — what is missing, then why.
 */
export function policyUnread(reason: string): string {
  return `The autonomy policies could not be read. ${reason}`;
}

/**
 * The card's tag — mockup 17's `policy v7`.
 *
 * @param version The version in force, or `null` when nothing is published.
 * @returns The tag's text.
 */
export function versionTag(version: number | null): string {
  return version === null ? "not published" : `policy v${String(version)}`;
}

/**
 * A rule's name wherever one is listed — the card's own name for a core rule, the id for a
 * `custom:*` rule, which has no other.
 *
 * @param ruleId The rule.
 * @returns Its name.
 */
export function ruleLabel(ruleId: string): string {
  return (CORE_RULES as readonly string[]).includes(ruleId) ? RULE_NAMES[ruleId as CoreRuleId] : ruleId;
}

/**
 * What a rule's switch does when pressed, as its accessible name.
 *
 * @param ruleId The rule.
 * @param enabled Whether it is on now.
 * @returns `Turn off Spend guard` / `Turn on Spend guard`.
 */
export function switchLabel(ruleId: string, enabled: boolean): string {
  return `${enabled ? "Turn off" : "Turn on"} ${ruleLabel(ruleId)}`;
}

/* ------------------------------------------------------------------ the confirmation */

/** Each class as the verb a sentence uses. */
export const CLASS_VERBS: Readonly<Record<ChangeClass, string>> = {
  tightening: "Tightens",
  loosening: "Loosens",
  neutral: "Changes",
};

/** What each class means, said once under the list. */
export const CLASS_MEANINGS: Readonly<Record<ChangeClass, string>> = {
  tightening: "Tightening: more work waits for a person, or less may run without one.",
  loosening: "Loosening: more work may run without a person.",
  neutral: "Neither tightens nor loosens: nothing moves between a person and the loop.",
};

/** The confirmation's cancel button, and the owner gate's only one. */
export const KEEP_EDITING = "Keep editing";

/** The change note's label and hint. */
export const NOTE_LABEL = "Change note (optional)";
export const NOTE_HINT = "Why — shown in the policy history beside this version.";

/** The longest note the service takes. */
export const NOTE_MAX_LENGTH = 500;

/** The publish button while the request is in flight. */
export const PUBLISHING = "Publishing…";

/**
 * The version a publish would create.
 *
 * @param baseVersion The version in force, or `null`.
 * @returns The next version's number.
 */
export function nextVersion(baseVersion: number | null): number {
  return (baseVersion ?? 0) + 1;
}

/**
 * The confirmation's title.
 *
 * @param baseVersion The version in force, or `null`.
 * @returns `Publish policy v8?`
 */
export function confirmTitle(baseVersion: number | null): string {
  return `Publish policy v${String(nextVersion(baseVersion))}?`;
}

/**
 * The publish button's label.
 *
 * @param baseVersion The version in force, or `null`.
 * @returns `Publish policy v8`.
 */
export function publishLabel(baseVersion: number | null): string {
  return `Publish policy v${String(nextVersion(baseVersion))}`;
}

/**
 * One changed rule, as the confirmation's line.
 *
 * @param change The change.
 * @returns `Loosens Auto-merge when all gates green — enabled auto-merge`.
 */
export function changeLine(change: RuleChange): string {
  return `${CLASS_VERBS[change.classification]} ${ruleLabel(change.ruleId)} — ${change.summary}`;
}

/**
 * A list of names in a sentence.
 *
 * @param names One or more names.
 * @returns `a`, `a and b`, `a, b and c`.
 */
export function sentenceList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";

  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The rules a preview loosens, by name.
 *
 * @param preview The preview.
 * @returns Their names, in the preview's order.
 */
export function loosenedRules(preview: PolicyPreview): readonly string[] {
  return preview.changes
    .filter((change) => change.classification === "loosening")
    .map((change) => ruleLabel(change.ruleId));
}

/** What an admin whose edit loosens a rule is told, in order. */
export interface OwnerGate {
  /** *This loosens Human review required — an owner must publish.* */
  readonly head: string;
  /** Why that is the rule. */
  readonly why: string;
  /** Who to ask. */
  readonly ask: string;
  /** What the admin can still do alone. */
  readonly alone: string;
}

/**
 * The owner gate's explanation — a path, not a dead end.
 *
 * @param preview The preview that named a loosening this reader may not publish.
 * @param owners The workspace's owners, by name. May be empty when the members could not be read.
 * @returns The sentences.
 */
export function ownerGate(preview: PolicyPreview, owners: readonly string[]): OwnerGate {
  return {
    head: `This loosens ${sentenceList(loosenedRules(preview))} — an owner must publish.`,
    why:
      "Loosening lets more work run without a person, so publishing it is the workspace " +
      "owner's decision. The service refuses it from anyone else.",
    ask:
      owners.length === 0
        ? "Ask a workspace owner to make this change."
        : `Ask ${sentenceList(owners)} to make this change — ${owners.length === 1 ? "they are the owner" : "they are the owners"} of this workspace.`,
    alone:
      "Your edits stay on the page, unsaved. Undo the loosening and you can publish the rest yourself.",
  };
}

/** The owner gate's dialog title. */
export const OWNER_GATE_TITLE = "An owner must publish this";

/* ------------------------------------------------------------------ why a save did not publish */

/** The reader chose **Keep editing**. */
export const PUBLISH_CANCELLED =
  "Not published — you chose to keep editing. Your policy edits are still unsaved.";

/** An admin met the owner gate. */
export const PUBLISH_NEEDS_OWNER =
  "Not published — this edit loosens a rule, and only an owner can publish that.";

/** The service was not reached, or answered with nothing to say. */
export const PUBLISH_FAILED = "The policy could not be published. Nothing was changed — try again.";

/** The preview was refused with nothing to say. */
export const PREVIEW_FAILED = "The change could not be checked. Nothing was published — try again.";

/** The history could not be read, with nothing to say. */
export const HISTORY_FAILED = "The policy history could not be read. Try again.";

/** The codes `POST /api/v1/policies` refuses with. */
export const PUBLISH_CODES = {
  conflict: "policy_version_conflict",
  unchanged: "policy_unchanged",
  ownerRequired: "policy_loosening_requires_owner",
  invalid: "policy_document_invalid",
} as const;

/** What a publish of nothing is told. */
export const NOTHING_TO_PUBLISH =
  "These edits change nothing the policy holds, so there is no new version to publish.";

/**
 * What a publish that lost a race is told.
 *
 * @param currentVersion The version now in force, when the service said.
 * @returns The sentence — what happened, and what to do.
 */
export function versionConflict(currentVersion: number | null): string {
  const who =
    currentVersion === null
      ? "A newer policy version was published"
      : `Policy v${String(currentVersion)} was published`;

  return `${who} while you were editing. Reload the page to edit from it; nothing of yours was published.`;
}

/* ------------------------------------------------------------------ the toast */

/** What the card says once a version is published. */
export interface PublishedToast {
  /** *Policy v8 published.* */
  readonly text: string;
  /** The audit log's line for it — `enabled auto-merge (policy v8)`. */
  readonly line: string;
  /** Where that line lives. */
  readonly href: string;
  /** The link's text. */
  readonly link: string;
}

/** The toast's dismissal, as its accessible name. */
export const DISMISS_TOAST = "Dismiss";

/**
 * The toast for a published version.
 *
 * @param version The version published.
 * @param summary Its audit line, as the service composed it.
 * @returns The toast.
 */
export function publishedToast(version: number, summary: string): PublishedToast {
  return {
    text: `Policy v${String(version)} published.`,
    line: summary,
    href: settingsSectionPath("audit"),
    link: "See it in the audit log",
  };
}

/* ------------------------------------------------------------------ the history */

/** The history dialog's title. */
export const HISTORY_TITLE = "Policy history";

/** The history's states. */
export const HISTORY_LOADING = "Reading the policy history…";
export const HISTORY_EMPTY = "No version has been published yet.";
export const HISTORY_OLDER = "Show older versions";
export const HISTORY_CLOSE = "Close";

/** What a version with no note says. */
export const NO_NOTE = "No change note.";

/** Who published a version whose publisher has since been removed. */
export const FORMER_MEMBER = "a former member";

/**
 * What the version tag does when pressed, as its accessible name.
 *
 * @param version The version in force.
 * @returns `policy v7 — open the policy history`.
 */
export function historyTrigger(version: number): string {
  return `${versionTag(version)} — open the policy history`;
}

/**
 * When a version was published, as text that reads the same on every machine.
 *
 * @param iso The instant.
 * @returns `2026-10-04 13:48 UTC`.
 */
export function publishedWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;

  return `${at.toISOString().slice(0, 10)} ${at.toISOString().slice(11, 16)} UTC`;
}

/**
 * A version's byline.
 *
 * @param entry The version.
 * @returns `Ken Suenobu · 2026-10-04 13:48 UTC`.
 */
export function versionByline(entry: PolicyVersionEntry): string {
  return `${entry.publisherName ?? FORMER_MEMBER} · ${publishedWhen(entry.publishedAt)}`;
}

/**
 * What a version's diff is a diff *of*.
 *
 * @param version The version.
 * @returns `v6 → v7`, or for the first version, that there was nothing before it.
 */
export function diffHeading(version: number): string {
  return version <= 1 ? "v1 — the first version" : `v${String(version - 1)} → v${String(version)}`;
}

/** One side of a rule's diff. */
export interface RuleSide {
  /** `on`, `off`, or `absent` for a rule the document does not carry. */
  readonly state: "on" | "off" | "absent";
  /** Its terms chips. */
  readonly chips: readonly string[];
}

/** One changed rule, before and after. */
export interface RuleDiff {
  readonly ruleId: string;
  /** The rule's name. */
  readonly name: string;
  readonly classification: ChangeClass;
  /** The change as the audit line says it. */
  readonly summary: string;
  /** The rule before this version — `null` when the version before it is not loaded. */
  readonly before: RuleSide | null;
  readonly after: RuleSide;
}

/** One side's state, in words. */
export const SIDE_STATES: Readonly<Record<RuleSide["state"], string>> = {
  on: "on",
  off: "off",
  absent: "not in the policy",
};

/**
 * One side of a rule's diff, read from a document.
 *
 * @param document The document, or `null` for "no policy".
 * @param ruleId The rule.
 * @returns The side.
 */
function sideOf(document: PolicyDocument | null, ruleId: string): RuleSide {
  const rule = document?.[ruleId];
  if (rule === undefined) return { state: "absent", chips: [] };

  return { state: rule.enabled ? "on" : "off", chips: ruleChips(ruleId, rule) };
}

/**
 * A version's diff: every rule the service says it changed, with both sides drawn from the two
 * documents.
 *
 * @param entry The version.
 * @param previous The version before it, or `null` when there is none (or it is not loaded).
 * @returns One row per changed rule, in the service's order.
 */
export function versionDiff(
  entry: PolicyVersionEntry,
  previous: PolicyVersionEntry | null,
): readonly RuleDiff[] {
  // The first version is compared with "no policy"; any other needs its predecessor's document.
  const known = previous !== null || entry.version <= 1;

  return entry.changes.map((change) => ({
    ruleId: change.ruleId,
    name: ruleLabel(change.ruleId),
    classification: change.classification,
    summary: change.summary,
    before: known ? sideOf(previous?.document ?? null, change.ruleId) : null,
    after: sideOf(entry.document, change.ruleId),
  }));
}

/**
 * The version before one, from a loaded list.
 *
 * @param items The loaded versions, newest first.
 * @param version The version whose predecessor is wanted.
 * @returns The predecessor, or `null` when it is the first version or not loaded yet.
 */
export function previousOf(
  items: readonly PolicyVersionEntry[],
  version: number,
): PolicyVersionEntry | null {
  return items.find((item) => item.version === version - 1) ?? null;
}

/**
 * The owners of a workspace, by name, from its members list.
 *
 * @param members The members, each with a name and roles.
 * @returns The owners' names, in the list's order.
 */
export function ownerNames(
  members: readonly { readonly name: string; readonly roles: readonly string[] }[],
): readonly string[] {
  return members.filter((member) => member.roles.includes("owner")).map((member) => member.name);
}
