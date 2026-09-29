/**
 * The Merge plan card, as data ([#369](https://github.com/NobuData/ouroboros/issues/369)) — mockup
 * 12's merge plan, its arm flow and what a merge did, decided here and drawn by
 * `merge-plan-card.tsx` and `arm-dialog.tsx`.
 *
 * ```
 * MERGE PLAN                                                    Edit policy →
 * Strategy                                           squash · delete branch
 * Commit message      fix(can): … Closes #482.                    (editable)
 *   ⚠ no closing keyword for #482 — the toggle and the message disagree
 * Close issue #482 on merge                                            [on]
 * Comment evidence summary on the host PR                              [on]
 * Back-annotate roadmap (OTA hardening ▾)                             [off]
 * Merges as the workspace's configured token — bot identity arrives with the GitHub App (#374)
 * [Merge when all gates green] ─▶ armed ● (Disarm) ─▶ merged ✓ sha · identity · actions
 * ```
 *
 * **This card arms an irreversible action, so every sentence on it is one the code keeps.** Its
 * sentences are its neighbours':
 *
 * | file | what it states |
 * | ---- | -------------- |
 * | `merge-terms.ts` | what an arm waits on, the re-check, and why one refused |
 * | `merge-message.ts` | the message's unsaved edit, and whether it still closes the ticket |
 * | `merge-receipt.ts` | who a merge is made as — never a `[bot]` — and what one did |
 *
 * What is decided here is the card around them: where the plan stands, what each reader may
 * change, and which control is offered.
 *
 * **The plan is read before the PR's state** ({@link effectivePage}): an answer is drawn the
 * moment it arrives, and a merge is recorded on the plan before the host's mirror moves the PR.
 *
 * **Roles decide what is drawn, never what is allowed.** An owner or admin edits, arms and
 * merges; a member reads the plan and may disarm it, the safe direction; a viewer reads. The
 * service refuses on every press whatever this page draws (#360).
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type {
  PrMergeOutcome,
  PrMergePlan,
  PullRequestPage,
  PullRequestState,
} from "@/app/api/pull-requests";
import { workflowPath } from "@/app/paths";
import { clockOf } from "@/app/test-results/timeline";

import { standing } from "./criteria";
import { type CloseCheck, type MessageDraft, SAVE_FIRST, closeCheck } from "./merge-message";
import {
  IDENTITY_LINE,
  type MergeAnswer,
  type ReceiptView,
  actionLabel,
  configuredActions,
  honestIdentity,
  identityFooter,
  receipt,
} from "./merge-receipt";
import {
  MERGE_NOW_TERMS,
  type RefusalView,
  type WaitingGate,
  armTerms,
  refusalView,
  waitingOn,
} from "./merge-terms";
import { shortSha } from "./strip";
import { MERGE_LABEL, MERGE_NOW_LABEL, hostOwnedReason, latestRevision, notArmable } from "./view";

/** The element id *Merge when all gates green* lands on — AY.1's slot's, kept. */
export const MERGE_PLAN_ID = "merge-plan";

/** The card's title — the mockup's `MERGE PLAN`. */
export const MERGE_PLAN_TITLE = "Merge plan";

/** The head's link — the mockup's `Edit policy →`. */
export const EDIT_POLICY_LINK = "Edit policy →";

/** The strategy row's name. */
export const STRATEGY_LABEL = "Strategy";

/** Why the draft's buttons wait while a change is being sent. */
export const PLAN_SENDING = "A change to the plan is being sent.";

/** Why a reader who may not change the plan finds its controls read-only. */
export const READ_ONLY = "Only an owner or admin changes the merge plan.";

/** Why an armed plan's controls are read-only. */
export const DISARM_TO_EDIT = "This plan is armed — disarm it to change what it will do.";

/** Why a merged plan's controls are read-only. */
export const PLAN_FINAL = "This PR has merged — its plan is final.";

/** Why the close toggle is inert on a PR with no ticket. */
export const NO_TICKET = "This PR has no ticket to close.";

/** Why back-annotate waits for an epic. */
export const CHOOSE_EPIC = "Choose the roadmap epic to back-annotate first.";

/** The epic picker's name, and the option that clears it. */
export const EPIC_LABEL = "Roadmap epic";
export const NO_EPIC = "No epic";

/** What the picker says when the workspace has no roadmap. */
export const NO_EPICS = "This workspace has no roadmap epics yet.";

/** What the picker says when the roadmap could not be read. */
export const EPICS_UNREAD = "The roadmap's epics could not be read — reload to choose one.";

/** What an epic the roadmap no longer lists is called. */
export const UNKNOWN_EPIC = "an epic no longer on the roadmap";

/** That a merge cannot be taken back, said in both confirmations. */
export const IRREVERSIBLE = "A merge cannot be undone from here.";

/** The confirmations' buttons. */
export const ARM_CONFIRM = "Arm the merge";
export const MERGE_CONFIRM = "Merge now";
export const ARM_CANCEL = "Keep on this page";

/** Why a confirmation's button waits while it is being sent. */
export const ARM_SENDING = "Arming the merge…";
export const MERGE_SENDING = "Merging…";

/** Why a confirmation goes inert when the PR moved under it. */
export const TERMS_MOVED =
  "This PR changed while the confirmation was open. Close it and review the gates again.";

/** *Disarm*. */
export const DISARM_LABEL = "Disarm";

/** What is said after each action. */
export const PLAN_SAVED = "Plan saved.";
export const DISARMED = "Disarmed — nothing will merge until it is armed again.";

/** What an unreachable service means for an arm or a merge: it may have landed. */
export const MAY_HAVE_LANDED =
  "The service did not answer, so this may or may not have taken effect. The page shows which " +
  "once it has been read again.";

/** The armed state's first word, and the receipt's. */
export const ARMED_WORD = "Armed";
export const MERGED_WORD = "Merged";

/** What a PR merged on its host, and not by this plan, says. */
export const MERGED_ELSEWHERE = "Merged on the host — not by this plan, so it recorded nothing.";

// --- the effective page --------------------------------------------------------------------

/** A plan one of this page's actions answered with, and when. */
export interface LocalPlan {
  /** The plan, as answered. */
  readonly plan: PrMergePlan;
  /** When it was answered, in epoch milliseconds. */
  readonly at: number;
}

/**
 * The PR's state, as its plan states it.
 *
 * @param state The state the page read.
 * @param plan The plan.
 * @returns `merged` once the plan recorded a merge — the host's mirror follows after the commit;
 *   `armed` for an armed plan of a PR still being verified; `verifying` for a plan no longer
 *   armed whose PR still says so; otherwise the state as read.
 */
export function stateOf(state: PullRequestState, plan: PrMergePlan): PullRequestState {
  if (plan.mergedResult !== null) return "merged";
  if (plan.armed && state === "verifying") return "armed";
  if (!plan.armed && state === "armed") return "verifying";

  return state;
}

/**
 * The page every surface that reads the plan is drawn from — the head's pill and button, the
 * strip's future step and this card — so an answer never shows armed in one and not another.
 *
 * @param page The page as read.
 * @param locals The plans this page's actions answered with.
 * @param readAt When the page was last read, in epoch milliseconds, or `null`.
 * @returns The page with the newest plan no read has caught up with, and the state that plan
 *   states. The page itself when nothing differs.
 */
export function effectivePage(
  page: PullRequestPage,
  locals: readonly LocalPlan[],
  readAt: number | null,
): PullRequestPage {
  const plan = standing(locals, readAt).at(-1)?.plan ?? page.plan;
  const state = stateOf(page.pullRequest.state, plan);

  if (plan === page.plan && state === page.pullRequest.state) return page;

  return { ...page, plan, pullRequest: { ...page.pullRequest, state } };
}

// --- the card ------------------------------------------------------------------------------

/** Where a plan stands — what the card draws around it. */
export type PlanStanding =
  /** The plan recorded a merge. */
  | "merged"
  /** The PR merged on its host, and the plan recorded nothing. */
  | "merged_elsewhere"
  /** The PR is closed on its host. */
  | "closed"
  /** Armed, and waiting. */
  | "armed"
  /** A re-check disarmed it, and it says why. */
  | "disarmed"
  /** Planned, and not armed. */
  | "planned";

/** One switch of the card. */
export interface ToggleView {
  /** The plan field it writes. */
  readonly field: "closeTicket" | "commentEvidence" | "backAnnotateEpic";
  /** The row's text — `Close issue #482 on merge`. */
  readonly text: string;
  /** Whether it is on. */
  readonly checked: boolean;
  /** Its accessible name: what pressing it would do. */
  readonly label: string;
  /** Why it cannot be pressed, or `null`. */
  readonly reason: string | null;
}

/** The epic picker. */
export interface EpicPickerView {
  /** The epic chosen, or `""`. */
  readonly value: string;
  /** The epics to choose from — and the chosen one, named as unknown when the roadmap lost it. */
  readonly options: readonly { readonly id: string; readonly name: string }[];
  /** What the picker says beneath it, or `null`. */
  readonly hint: string | null;
  /** Whether it can be changed. */
  readonly enabled: boolean;
}

/** The primary control: arm, or merge now. */
export interface PrimaryView {
  /** Which confirmation it opens. */
  readonly kind: "arm" | "merge";
  /** {@link MERGE_LABEL} or {@link MERGE_NOW_LABEL}. */
  readonly label: string;
  /** Why it is off, or `null`. */
  readonly reason: string | null;
}

/** The armed state. */
export interface ArmedView {
  /** `Merges automatically when Second-model review turns green.` */
  readonly terms: string;
  /** `against revision 2 · b7e41d0`, or `null` when the revision is no longer on the page. */
  readonly against: string | null;
  /** `14:40:12`, or `null`. */
  readonly time: string | null;
  /** When it was armed, as recorded, or `null`. */
  readonly at: string | null;
  /** What is said when the armed revision is no longer the head, or `null`. */
  readonly stale: string | null;
}

/** The card. */
export interface MergePlanCardView {
  readonly standing: PlanStanding;
  /** `squash · delete branch`. */
  readonly strategy: string;
  /** The pinned workflow, for a reader who may edit it — or `null`. */
  readonly policy: string | null;
  /** The message as stored. */
  readonly message: string;
  /** Whether the message is drawn as a field. */
  readonly editable: boolean;
  /** Whether the toggle and the message on screen agree. */
  readonly close: CloseCheck;
  /** The three switches, in the mockup's order. */
  readonly toggles: readonly ToggleView[];
  readonly epic: EpicPickerView;
  /** The footer, or `null` once the receipt states who merged. */
  readonly footer: string | null;
  /** What the host-owned states say, or `null`. */
  readonly note: string | null;
  readonly armed: ArmedView | null;
  readonly disarmed: RefusalView | null;
  readonly receipt: ReceiptView | null;
  /** The primary control, or `null` when the reader is drawn none. */
  readonly primary: PrimaryView | null;
  /** Whether *Disarm* is drawn. */
  readonly disarm: boolean;
  /** What is said when the head handed the reader here, or `null`. */
  readonly handedOff: string | null;
}

/** A roadmap epic, as the card holds one. */
export interface PlanEpic {
  /** The epic's id — what the plan is sent. */
  readonly id: string;
  /** Its name — `OTA hardening`. */
  readonly name: string;
}

/** What the card is decided from. */
export interface MergePlanCardInput {
  /** The effective page — see {@link effectivePage}. */
  readonly page: PullRequestPage;
  /** The workspace's roadmap epics, or `null` when they could not be read. */
  readonly epics: readonly PlanEpic[] | null;
  /** The unsaved edit of the message, or `null`. */
  readonly draft: MessageDraft | null;
  /** What this page's merge answered, or `null`. */
  readonly answer: MergeAnswer | null;
  /** Whether the reader may arm, merge and edit — owner or admin. */
  readonly mayArm: boolean;
  /** Whether the reader may disarm — owner, admin or member. */
  readonly mayContribute: boolean;
  /** The revision the head handed off for, by its ordinal, or `null`. */
  readonly chosen: number | null;
}

/**
 * The strategy tag.
 *
 * @param plan The plan.
 * @returns `squash · delete branch`, or `squash · keep branch`.
 */
export function strategyTag(plan: PrMergePlan): string {
  return `${plan.strategy} · ${plan.deleteBranch ? "delete" : "keep"} branch`;
}

/**
 * Where the plan stands.
 *
 * @param page The effective page.
 * @returns The standing — the plan's own record first, then what the host owns, then the arm.
 */
export function planStanding(page: PullRequestPage): PlanStanding {
  const { plan, pullRequest } = page;

  if (plan.mergedResult !== null) return "merged";
  if (pullRequest.state === "merged") return "merged_elsewhere";
  if (pullRequest.state === "closed") return "closed";
  if (plan.armed) return "armed";

  return plan.disarmReason === null ? "planned" : "disarmed";
}

/**
 * Why the plan's controls are read-only.
 *
 * @param input See {@link MergePlanCardInput}.
 * @param where Where the plan stands.
 * @returns The reason, or `null` for a plan this reader can change now.
 */
function frozen(input: MergePlanCardInput, where: PlanStanding): string | null {
  switch (where) {
    case "merged":
      return PLAN_FINAL;
    case "merged_elsewhere":
    case "closed":
      return hostOwnedReason(input.page.pullRequest.state);
    case "armed":
      return input.mayArm ? DISARM_TO_EDIT : READ_ONLY;
    default:
      return input.mayArm ? null : READ_ONLY;
  }
}

/**
 * The epic the plan names.
 *
 * @param plan The plan.
 * @param epics The roadmap's epics, or `null`.
 * @returns Its name, {@link UNKNOWN_EPIC} when the roadmap no longer lists it or could not be
 *   read, and `null` when the plan names none.
 */
export function epicName(
  plan: PrMergePlan,
  epics: MergePlanCardInput["epics"],
): string | null {
  if (plan.epicId === null) return null;

  return epics?.find((epic) => epic.id === plan.epicId)?.name ?? UNKNOWN_EPIC;
}

/**
 * The three switches.
 *
 * @param input See {@link MergePlanCardInput}.
 * @param locked Why the plan is read-only, or `null`.
 * @returns The switches, each with its state, its name and why it waits.
 */
function toggles(input: MergePlanCardInput, locked: string | null): readonly ToggleView[] {
  const { plan, pullRequest } = input.page;
  const ticket = pullRequest.ticket?.key ?? null;
  const closing = ticket === null ? "Close the ticket on merge" : `Close issue ${ticket} on merge`;
  const epic = epicName(plan, input.epics);
  const annotating =
    epic === null ? "Back-annotate roadmap" : `Back-annotate roadmap (${epic})`;
  const commenting = "Comment evidence summary on the host PR";

  /** What pressing a switch would do — its accessible name, apart from the row's own text. */
  const press = (text: string, on: boolean) => `Switch ${on ? "off" : "on"}: ${text}`;

  return [
    {
      field: "closeTicket",
      text: closing,
      checked: plan.closeTicket,
      label: press(closing, plan.closeTicket),
      reason: locked ?? (ticket === null ? NO_TICKET : null),
    },
    {
      field: "commentEvidence",
      text: commenting,
      checked: plan.commentEvidence,
      label: press(commenting, plan.commentEvidence),
      reason: locked,
    },
    {
      field: "backAnnotateEpic",
      text: annotating,
      checked: plan.backAnnotateEpic,
      label: press(annotating, plan.backAnnotateEpic),
      reason: locked ?? (plan.epicId === null ? CHOOSE_EPIC : null),
    },
  ];
}

/**
 * The epic picker.
 *
 * @param input See {@link MergePlanCardInput}.
 * @param locked Why the plan is read-only, or `null`.
 * @returns The picker. An epic the roadmap no longer lists stays an option, named as unknown, so
 *   the picker never shows *No epic* for a plan that names one.
 */
function epicPicker(input: MergePlanCardInput, locked: string | null): EpicPickerView {
  const { plan } = input.page;
  const listed = (input.epics ?? []).map((epic) => ({ id: epic.id, name: epic.name }));
  const known = plan.epicId === null || listed.some((epic) => epic.id === plan.epicId);
  const options = known ? listed : [...listed, { id: plan.epicId ?? "", name: UNKNOWN_EPIC }];

  return {
    value: plan.epicId ?? "",
    options,
    hint: input.epics === null ? EPICS_UNREAD : listed.length === 0 ? NO_EPICS : null,
    enabled: locked === null && listed.length > 0,
  };
}

/**
 * The armed state.
 *
 * @param page The effective page.
 * @returns What the arm waits on, the revision it was made against, and a warning when that
 *   revision is no longer the head — the re-check will then disarm rather than merge.
 */
function armedView(page: PullRequestPage): ArmedView {
  const { plan } = page;
  const against = page.revisions.find((each) => each.id === plan.armedAgainstRevisionId) ?? null;
  const latest = latestRevision(page);
  const moved = against !== null && latest !== null && latest.id !== against.id;

  return {
    terms: armTerms(waitingOn(page)),
    against:
      against === null ? null : `against revision ${against.seq} · ${shortSha(against.headSha)}`,
    time: plan.armedAt === null ? null : clockOf(plan.armedAt),
    at: plan.armedAt,
    stale: moved
      ? `Armed against revision ${against.seq}, and revision ${latest.seq} is now the head. ` +
        "The re-check will disarm rather than merge — disarm, review the new gates and arm again."
      : null,
  };
}

/**
 * The primary control.
 *
 * @param input See {@link MergePlanCardInput}.
 * @param where Where the plan stands.
 * @returns *Merge now* when every required gate is already green — and only then — otherwise
 *   *Merge when all gates green*; inert, with the reason, for a PR that cannot be armed or a
 *   message with unsaved edits. `null` for a reader who may not arm, and once there is nothing
 *   left to decide. An armed plan whose gates are all green offers *Merge now* too: the armed
 *   merge should already have fired, and this is the way out if it did not.
 */
function primary(input: MergePlanCardInput, where: PlanStanding): PrimaryView | null {
  if (!input.mayArm) return null;

  const { page } = input;
  const ready = page.gates?.aggregate?.mergeReady === true && latestRevision(page) !== null;
  const unsaved = input.draft === null ? null : SAVE_FIRST;

  if (where === "armed") {
    return ready ? { kind: "merge", label: MERGE_NOW_LABEL, reason: unsaved } : null;
  }

  if (where !== "planned" && where !== "disarmed") return null;

  const reason =
    notArmable(page.pullRequest.state, latestRevision(page), page.gates?.aggregate ?? null) ??
    unsaved;

  return ready
    ? { kind: "merge", label: MERGE_NOW_LABEL, reason }
    : { kind: "arm", label: MERGE_LABEL, reason };
}

/**
 * What the card says when the head's button brought the reader here.
 *
 * @param revisionSeq The revision they were looking at.
 * @param kind What the card offers.
 * @returns The sentence — which says, above all, that nothing has happened yet.
 */
export function handedOff(revisionSeq: number, kind: PrimaryView["kind"]): string {
  const act = kind === "merge" ? MERGE_NOW_LABEL : MERGE_LABEL;

  return (
    `Nothing has happened yet. ${act}, below, states its terms for revision ${revisionSeq} ` +
    "before anything is confirmed."
  );
}

/**
 * The card for one PR.
 *
 * @param input See {@link MergePlanCardInput}.
 * @returns The card.
 */
export function mergePlanCard(input: MergePlanCardInput): MergePlanCardView {
  const { page, mayArm, mayContribute } = input;
  const { plan, pullRequest } = page;
  const where = planStanding(page);
  const locked = frozen(input, where);
  const ticket = pullRequest.ticket?.key ?? null;
  const control = primary(input, where);
  const run = pullRequest.run;

  return {
    standing: where,
    strategy: strategyTag(plan),
    policy: mayArm && run !== null ? workflowPath(run.workflowTag) : null,
    message: plan.commitMessage,
    editable: locked === null,
    close:
      where === "planned" || where === "disarmed" || where === "armed"
        ? closeCheck(input.draft?.text ?? plan.commitMessage, ticket, plan.closeTicket)
        : { kind: "agrees" },
    toggles: toggles(input, locked),
    epic: epicPicker(input, locked),
    footer: where === "merged" || where === "merged_elsewhere" ? null : identityFooter(plan),
    note:
      where === "merged_elsewhere"
        ? MERGED_ELSEWHERE
        : where === "closed"
          ? hostOwnedReason("closed")
          : null,
    armed: plan.armed && plan.mergedResult === null ? armedView(page) : null,
    disarmed:
      where === "disarmed" && plan.disarmReason !== null
        ? refusalView(plan.disarmReason.code, plan.disarmReason.message)
        : null,
    receipt: receipt(plan, ticket, input.answer),
    primary: control,
    disarm: plan.armed && plan.mergedResult === null && mayContribute,
    handedOff:
      input.chosen === null || control === null || control.reason !== null
        ? null
        : handedOff(input.chosen, control.kind),
  };
}

// --- the confirmation ----------------------------------------------------------------------

/** What a confirmation states — read once, when it opens. */
export interface ConfirmationView {
  /** Arming, or merging now. */
  readonly kind: PrimaryView["kind"];
  /** `Merge PR #514 when all gates are green`. */
  readonly title: string;
  /** The revision it is about — sent with an arm. */
  readonly revisionId: string;
  /** `Revision 2 · b7e41d0`. */
  readonly revision: string;
  /** The promise — {@link armTerms}, or {@link MERGE_NOW_TERMS}. */
  readonly terms: string;
  /** Each gate waited on, with where it stands. Empty for a merge. */
  readonly waiting: readonly WaitingGate[];
  /** `squash · delete branch`. */
  readonly strategy: string;
  /** What the merge will do afterwards — `close issue #482`. */
  readonly actions: readonly string[];
  /** Who the merge is made as. */
  readonly identity: string;
  /** The plan as it stood — a plan that changes under the confirmation makes it inert. */
  readonly planAt: string;
}

/**
 * The confirmation for the primary control.
 *
 * @param page The effective page.
 * @param kind Arming, or merging now.
 * @returns What it states, or `null` for a PR with no revision — there is nothing to arm against.
 */
export function confirmation(
  page: PullRequestPage,
  kind: PrimaryView["kind"],
): ConfirmationView | null {
  const revision = latestRevision(page);
  if (revision === null) return null;

  const { plan, pullRequest } = page;
  const waiting = waitingOn(page);
  const number = `PR #${pullRequest.number}`;

  return {
    kind,
    title: kind === "merge" ? `Merge ${number} now` : `Merge ${number} when all gates are green`,
    revisionId: revision.id,
    revision: `Revision ${revision.seq} · ${shortSha(revision.headSha)}`,
    terms: kind === "merge" ? MERGE_NOW_TERMS : armTerms(waiting),
    waiting: kind === "merge" ? [] : waiting.gates,
    strategy: strategyTag(plan),
    actions: configuredActions(plan, pullRequest.ticket !== null).map((action) =>
      actionLabel(action, pullRequest.ticket?.key ?? null, false),
    ),
    identity: IDENTITY_LINE,
    planAt: plan.updatedAt,
  };
}

/**
 * Whether the PR moved under an open confirmation.
 *
 * @param open What the confirmation stated when it opened.
 * @param page The effective page now.
 * @returns `true` when a new revision is the head, the plan was changed, or what a merge would
 *   find is no longer what was confirmed — the reader is then agreeing to something else.
 */
export function termsMoved(open: ConfirmationView, page: PullRequestPage): boolean {
  if (latestRevision(page)?.id !== open.revisionId) return true;
  if (page.plan.updatedAt !== open.planAt) return true;

  return open.kind === "merge" && page.gates?.aggregate?.mergeReady !== true;
}

/** What became of a press, said on the card. */
export interface PlanNotice {
  readonly text: string;
  /** Whether it is a refusal rather than something done. */
  readonly failed: boolean;
}

/**
 * What an arm did.
 *
 * @param plan The plan, as answered.
 * @param page The effective page, for what it waits on.
 * @returns `Armed. Merges automatically when …`
 */
export function armedNotice(plan: PrMergePlan, page: PullRequestPage): PlanNotice {
  return {
    text: `${ARMED_WORD}. ${armTerms(waitingOn({ ...page, plan }))}`,
    failed: false,
  };
}

/**
 * What a merge did.
 *
 * @param outcome The merge's answer.
 * @returns `Merged as ken-s (b7e41d0).` — and how many switched-on actions did not run.
 */
export function mergedNotice(outcome: PrMergeOutcome): PlanNotice {
  const result = outcome.plan.mergedResult;
  if (result === null) return { text: `${MERGED_WORD}.`, failed: false };

  const missed = outcome.failedActions.length;
  const tail =
    missed === 0
      ? ""
      : ` ${missed} action${missed === 1 ? "" : "s"} did not run — see the receipt.`;

  return {
    text:
      `${MERGED_WORD} as ${honestIdentity(result.identityUsed)} ` +
      `(${shortSha(result.sha)}).${tail}`,
    failed: false,
  };
}
