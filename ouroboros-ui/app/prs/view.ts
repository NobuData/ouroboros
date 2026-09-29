/**
 * The PR verification frame, as data ([#363](https://github.com/NobuData/ouroboros/issues/363)) —
 * mockup 12's page head and its three actions, decided here and drawn by `pr-head.tsx`,
 * `pr-actions.tsx` and `return-dialog.tsx`.
 *
 * **Three buttons at three stakes.** *Request human review* is a policy change, so it becomes
 * state-aware once asked. *Return to loop* costs time and tokens, so it is a decision surface: the
 * reader picks which red gates the agent receives as its steer (#361). *Merge when all gates green*
 * is a promise about the future, so it hands off to the Merge plan card (#369) rather than arming
 * on one click — and is named *Merge now* when every required gate is already green, as the card's
 * own control is.
 *
 * **It formats; it derives nothing.** `5 of 7` is the payload's aggregate, the red gates are the
 * latest revision's snapshot, and whether a review is waiting is the payload's approval slot. The
 * one judgement made here is the pill's hue.
 *
 * **Roles decide what is drawn, never what is allowed.** The service refuses a viewer's head action
 * and a member's arm whatever this page draws (#361, #360).
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type {
  PrGateAggregate,
  PrGateRow,
  PrReview,
  PrRevision,
  PullRequestHead,
  PullRequestPage,
  PullRequestState,
  ReturnToLoop,
} from "@/app/api/pull-requests";
import { runPath } from "@/app/paths";
import type { ChipDot, ChipTone } from "@/app/ui";

/** The eyebrow's first words — the mockup's `PR Verification`. */
export const PR_EYEBROW = "PR Verification";

/** The actions' accessible name. */
export const ACTIONS_LABEL = "PR actions";

/** What the page says while its first read is in flight. */
export const READING_PR = "Reading the pull request…";

/** The banner's headline when the first read failed and nothing is on screen. */
export const UNREAD_HEADLINE = "This pull request could not be read.";

/** The banner's headline when a refresh failed and the last answer is still on screen. */
export const STALE_HEADLINE = "This pull request could not be refreshed.";

/** *Request human review*, before anybody has asked. */
export const REVIEW_LABEL = "Request human review";

/** The same button once a review is waiting — the state-aware form. */
export const REVIEW_REQUESTED_LABEL = "review requested";

/** The same button while the request is being sent. */
export const REVIEW_SENDING_LABEL = "Requesting review…";

/** Why the review button waits while its request is in flight. */
export const REVIEW_SENDING = "The review request is being sent.";

/** *Return to loop*. */
export const RETURN_LABEL = "Return to loop";

/** *Merge when all gates green*. */
export const MERGE_LABEL = "Merge when all gates green";

/** The same button once every required gate is green — the direct merge (#369). */
export const MERGE_NOW_LABEL = "Merge now";

/** Why nothing can act on a PR that has no revision. */
export const NO_REVISION = "This PR has no recorded revision yet.";

/** Why a PR no loop opened cannot be returned. */
export const NO_LOOP = "No loop opened this PR, so there is nothing to return it to.";

/** Why a PR whose verification has not started cannot be armed. */
export const NOT_VERIFYING = "Verification has not started on this PR, so it cannot be armed yet.";

/** Why an armed PR cannot be armed again. */
export const ALREADY_ARMED = "Already armed — this PR merges when every required gate is green.";

/** What a gate with no evidence line is listed with. */
export const NO_EVIDENCE = "red — no evidence line was recorded";

/** The return receipt's link into the run console. */
export const RECEIPT_LINK = "Open the run console";

/** What a rejected correction round says when the service gave no sentence. */
export const RETURN_REJECTED = "The loop did not take the correction round.";

/** What is said once a review has been requested. */
export const REVIEW_OPENED = "Human review requested — human approval is now required.";

/** What is said when a review was already waiting. */
export const REVIEW_ALREADY_OPEN = "A human review was already waiting — nothing new was requested.";

// --- the revision --------------------------------------------------------------------------

/**
 * The revision the head describes.
 *
 * @param page The PR page.
 * @returns The latest revision, or `null` before the first push was recorded.
 */
export function latestRevision(page: PullRequestPage): PrRevision | null {
  return page.revisions.at(-1) ?? null;
}

/**
 * A revision's name.
 *
 * @param seq Its ordinal.
 * @returns `revision 2`.
 */
function revisionName(seq: number): string {
  return `revision ${seq}`;
}

// --- the head ------------------------------------------------------------------------------

/**
 * The eyebrow, composing the PR's number and its current revision.
 *
 * @param number The host's number for the PR.
 * @param revisionSeq The latest revision's ordinal, or `null` before there is one.
 * @returns `PR Verification · PR #514 · Revision 2`, or without the revision before any.
 */
export function prEyebrow(number: number, revisionSeq: number | null): string {
  const pr = `${PR_EYEBROW} · ${prLabel(number)}`;

  return revisionSeq === null ? pr : `${pr} · Revision ${revisionSeq}`;
}

/**
 * The PR's short name.
 *
 * @param number The host's number for the PR.
 * @returns `PR #514`.
 */
export function prLabel(number: number): string {
  return `PR #${number}`;
}

/**
 * A URL a link may carry.
 *
 * @param value A URL from the payload — the host's PR page, the ticket on its tracker.
 * @returns The URL when it is `http(s)`, otherwise `null`: the text is then drawn without a link
 *   rather than with one a browser would execute.
 */
export function httpUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  try {
    const { protocol } = new URL(value);

    return protocol === "http:" || protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** One half of the `loop #1847 · issue #482` tag. */
export interface TagLink {
  /** `loop #1847`, `issue #482`, `issue HEL-12`. */
  readonly label: string;
  /** Where it leads, or `null` when there is nowhere honest to lead. */
  readonly href: string | null;
  /** Whether it leaves the application — the ticket on its tracker does. */
  readonly external: boolean;
}

/**
 * The tag's loop half.
 *
 * @param head The PR's head.
 * @param originId The module the page was opened from, which the run console keeps lit.
 * @returns `loop #1847`, linked to the run console; `null` for a PR no loop opened.
 */
export function loopLink(head: PullRequestHead, originId: string): TagLink | null {
  if (head.run === null) return null;

  return {
    label: `loop #${head.run.loopSeq}`,
    href: runPath(head.run.id, originId),
    external: false,
  };
}

/**
 * The tag's issue half, through the ticket's canonical record — so any tracker works.
 *
 * @param head The PR's head.
 * @returns `issue #482` or `issue HEL-12`, linked to the ticket's own URL. A PR with a loop and no
 *   ticket record names the loop's issue number without a link, never a guessed one; `null` when
 *   neither is known.
 */
export function issueLink(head: PullRequestHead): TagLink | null {
  if (head.ticket !== null) {
    return {
      label: `issue ${head.ticket.key}`,
      href: httpUrl(head.ticket.url),
      external: true,
    };
  }

  return head.run === null
    ? null
    : { label: `issue #${head.run.issueNumber}`, href: null, external: false };
}

/** The aggregate pill. */
export interface AggregatePill {
  /** `verifying — 5 of 7 gates green`. */
  readonly label: string;
  readonly tone: ChipTone;
  /** A pulse while the PR is armed, so a promise that is still open says so. */
  readonly dot: ChipDot | undefined;
}

/**
 * The aggregate pill, coloured by the PR's state.
 *
 * @param state The PR's state.
 * @param aggregate The latest revision's aggregate, or `null` when nothing was evaluated.
 * @returns `err` for a blocked PR and `ok` for a merged one; a verifying or armed PR is `warn`
 *   until every required gate is satisfied and `ok` once it is; an open or closed PR takes no
 *   outcome hue. The counts are the payload's, said only when there is a required gate to count.
 */
export function aggregatePill(
  state: PullRequestState,
  aggregate: PrGateAggregate | null,
): AggregatePill {
  const counted = aggregate !== null && aggregate.requiredCount > 0;
  const label = counted
    ? `${state} — ${aggregate.greenCount} of ${aggregate.requiredCount} gates green`
    : state;
  const dot: ChipDot | undefined = state === "armed" ? "pulse" : undefined;

  switch (state) {
    case "blocked":
      return { label, tone: "err", dot };
    case "merged":
      return { label, tone: "ok", dot };
    case "open":
    case "closed":
      return { label, tone: "neutral", dot };
    case "verifying":
    case "armed":
      return { label, tone: aggregate?.mergeReady === true ? "ok" : "warn", dot };
  }
}

/**
 * The branches, head into base.
 *
 * @param head The PR's head.
 * @returns `loop/482-canbus-flake → main`.
 */
export function branchLine(head: PullRequestHead): string {
  return `${head.headBranch} → ${head.baseBranch}`;
}

/**
 * The counts, as the host states them.
 *
 * @param head The PR's head.
 * @returns `+68 −15 · 3 files`.
 */
export function countsLine(head: PullRequestHead): string {
  const files = `${head.changedFiles} file${head.changedFiles === 1 ? "" : "s"}`;

  return `+${head.additions} −${head.deletions} · ${files}`;
}

/** The head, ready to draw. */
export interface PrHeadView {
  /** `PR Verification · PR #514 · Revision 2`. */
  readonly eyebrow: string;
  /** `PR #514` — the breadcrumb's current page. */
  readonly prLabel: string;
  /** The host PR's title. */
  readonly headline: string;
  /** The PR on its host, or `null` — the headline is then plain text. */
  readonly hostUrl: string | null;
  /** `loop #1847`, or `null`. */
  readonly loop: TagLink | null;
  /** `issue #482`, or `null`. */
  readonly issue: TagLink | null;
  readonly pill: AggregatePill;
  /** `loop/482-canbus-flake → main`. */
  readonly branches: string;
  /** `+68 −15 · 3 files`. */
  readonly counts: string;
}

/**
 * The head for one PR.
 *
 * @param page The PR page.
 * @param originId The module the page was opened from.
 * @returns The head.
 */
export function prHead(page: PullRequestPage, originId: string): PrHeadView {
  const head = page.pullRequest;

  return {
    eyebrow: prEyebrow(head.number, latestRevision(page)?.seq ?? null),
    prLabel: prLabel(head.number),
    headline: head.title,
    hostUrl: httpUrl(head.url),
    loop: loopLink(head, originId),
    issue: issueLink(head),
    pill: aggregatePill(head.state, page.gates?.aggregate ?? null),
    branches: branchLine(head),
    counts: countsLine(head),
  };
}

// --- the red gates -------------------------------------------------------------------------

/** One red gate, as *Return to loop*'s dialog lists it. */
export interface RedGate {
  /** `physical_hil` — what the service is sent. */
  readonly key: string;
  /** `Physical HIL`. */
  readonly label: string;
  /** Its evidence line — what the agent receives. */
  readonly evidence: string;
}

/**
 * The red gates of the latest revision, in the gates card's order.
 *
 * @param page The PR page.
 * @returns Each red gate with its evidence; empty when none is red or nothing was evaluated.
 */
export function redGates(page: PullRequestPage): readonly RedGate[] {
  return (page.gates?.rows ?? [])
    .filter((row: PrGateRow) => row.verdict === "red")
    .map((row: PrGateRow) => ({
      key: row.key,
      label: row.label,
      evidence: row.evidence ?? NO_EVIDENCE,
    }));
}

// --- the review ----------------------------------------------------------------------------

/**
 * The approval slot the head reads — the page's, or the one a press just opened.
 *
 * @param polled The page payload's newest slot, or `null`.
 * @param answered The slot *Request human review* answered with, or `null`.
 * @returns Whichever was requested later; the page's when they are the same slot, since it is
 *   the newer reading of it.
 */
export function currentReview(polled: PrReview | null, answered: PrReview | null): PrReview | null {
  if (polled === null || answered === null) return polled ?? answered;
  if (polled.id === answered.id) return polled;

  return Date.parse(answered.requestedAt) > Date.parse(polled.requestedAt) ? answered : polled;
}

/**
 * Why a review is waiting, said.
 *
 * @param review An open approval slot.
 * @returns `Ken S asked for a human review — it is waiting for an answer.`
 */
export function reviewWaiting(review: PrReview): string {
  const who = review.requestedBy?.name ?? "Somebody";

  return `${who} asked for a human review — it is waiting for an answer.`;
}

// --- the actions ---------------------------------------------------------------------------

/** One action: its label, and why it is off — `null` when it is on. */
export interface ActionView {
  readonly label: string;
  readonly reason: string | null;
}

/** The head's three actions. An action the reader's role may not take is `null` — not drawn. */
export interface ActionsView {
  readonly review: ActionView | null;
  readonly returnToLoop: ActionView | null;
  readonly merge: ActionView | null;
}

/** What the actions are decided from. */
export interface ActionsInput {
  readonly page: PullRequestPage;
  /** The approval slot a press just opened, or `null`. */
  readonly answeredReview: PrReview | null;
  /** Whether the reader may take a head action — owner, admin or member (#361). */
  readonly mayContribute: boolean;
  /** Whether the reader may arm a merge — owner or admin. */
  readonly mayArm: boolean;
  /** Whether a review request is in flight. */
  readonly requestingReview: boolean;
}

/**
 * Why nothing acts on a PR its host has finished with.
 *
 * @param state The PR's state.
 * @returns The reason for a merged or closed PR, otherwise `null`.
 */
export function hostOwnedReason(state: PullRequestState): string | null {
  if (state === "merged") return "This PR has merged — there is nothing left to decide.";
  if (state === "closed") return "This PR is closed on its host.";

  return null;
}

/**
 * *Request human review*, state-aware.
 *
 * @param input See {@link ActionsInput}.
 * @returns The button: `review requested` and inert while a slot is waiting, so a second press
 *   cannot queue a duplicate; inert with the reason while sending, on a finished PR, and before
 *   the first revision.
 */
export function reviewAction(input: ActionsInput): ActionView {
  const { page, answeredReview, requestingReview } = input;
  const review = currentReview(page.review, answeredReview);

  if (requestingReview) return { label: REVIEW_SENDING_LABEL, reason: REVIEW_SENDING };

  if (review !== null && review.state === "requested") {
    return { label: REVIEW_REQUESTED_LABEL, reason: reviewWaiting(review) };
  }

  return {
    label: REVIEW_LABEL,
    reason:
      hostOwnedReason(page.pullRequest.state) ??
      (latestRevision(page) === null ? NO_REVISION : null),
  };
}

/**
 * *Return to loop*.
 *
 * @param page The PR page.
 * @returns The button: inert with the reason on a finished PR, for a PR no loop opened or whose
 *   loop has finished, before the first revision, and when no gate is red.
 */
export function returnAction(page: PullRequestPage): ActionView {
  const { run, state } = page.pullRequest;
  const revision = latestRevision(page);

  const reason =
    hostOwnedReason(state) ??
    (run === null
      ? NO_LOOP
      : run.finishedAt !== null
        ? `Loop #${run.loopSeq} has finished, so it cannot take a correction round.`
        : revision === null
          ? NO_REVISION
          : redGates(page).length === 0
            ? `No gate is red on ${revisionName(revision.seq)} — there is nothing to send back.`
            : null);

  return { label: RETURN_LABEL, reason };
}

/**
 * *Merge when all gates green* — a hand-off to the Merge plan card, where arming states its terms.
 *
 * @param page The PR page.
 * @returns The button: on only for a PR that can be armed — `verifying`, with a revision — and
 *   inert with the stated reason otherwise. It is named {@link MERGE_NOW_LABEL} when every
 *   required gate is already green, which is what the card then offers (#369).
 */
export function mergeAction(page: PullRequestPage): ActionView {
  const { state } = page.pullRequest;
  const revision = latestRevision(page);
  const aggregate = page.gates?.aggregate ?? null;
  const ready = state === "verifying" && revision !== null && aggregate?.mergeReady === true;

  return {
    label: ready ? MERGE_NOW_LABEL : MERGE_LABEL,
    reason: notArmable(state, revision, aggregate),
  };
}

/**
 * Why a PR cannot be armed.
 *
 * @param state The PR's state.
 * @param revision The latest revision, or `null`.
 * @param aggregate The latest revision's aggregate, or `null`.
 * @returns The reason, or `null` for a PR that can be armed.
 */
export function notArmable(
  state: PullRequestState,
  revision: PrRevision | null,
  aggregate: PrGateAggregate | null,
): string | null {
  const finished = hostOwnedReason(state);
  if (finished !== null) return finished;
  if (revision === null) return NO_REVISION;

  switch (state) {
    case "open":
      return NOT_VERIFYING;
    case "armed":
      return ALREADY_ARMED;
    case "blocked": {
      const red = aggregate?.redCount ?? 0;
      const gates = red === 1 ? "1 gate is" : red > 1 ? `${red} gates are` : "A gate is";

      return `${gates} red on ${revisionName(revision.seq)} — a blocked PR cannot be armed.`;
    }
    default:
      return null;
  }
}

/**
 * The head's actions, gated by role and by state.
 *
 * A viewer is drawn none of them; a member is drawn *Request human review* and *Return to loop*;
 * only an owner or admin is drawn *Merge when all gates green*.
 *
 * @param input See {@link ActionsInput}.
 * @returns The three actions, each `null` when the reader's role may not take it.
 */
export function actionsView(input: ActionsInput): ActionsView {
  const { page, mayContribute, mayArm } = input;

  return {
    review: mayContribute ? reviewAction(input) : null,
    returnToLoop: mayContribute ? returnAction(page) : null,
    merge: mayArm ? mergeAction(page) : null,
  };
}

/**
 * Whether any action is drawn at all.
 *
 * @param view The actions.
 * @returns `false` for a reader whose role takes none — the group is then left out.
 */
export function hasActions(view: ActionsView): boolean {
  return view.review !== null || view.returnToLoop !== null || view.merge !== null;
}

// --- the outcomes --------------------------------------------------------------------------

/** What became of a press, said under the buttons. */
export interface OutcomeView {
  readonly text: string;
  /** Whether it is a refusal rather than something done. */
  readonly failed: boolean;
  /** Where the outcome can be seen, or `null`. */
  readonly link: { readonly label: string; readonly href: string } | null;
}

/**
 * *Return to loop*'s receipt.
 *
 * @param answer The service's answer.
 * @param head The PR's head.
 * @param originId The module the page was opened from.
 * @returns What was queued, with a link into the run console where the steer appears — or, for a
 *   correction round the loop rejected, the service's reason.
 */
export function returnReceipt(
  answer: ReturnToLoop,
  head: PullRequestHead,
  originId: string,
): OutcomeView {
  if (answer.control.state === "rejected" || answer.loopReturn === null) {
    return {
      text: answer.skipped[0] ?? answer.control.detail ?? RETURN_REJECTED,
      failed: true,
      link: null,
    };
  }

  const gates = `${answer.gates.length} gate${answer.gates.length === 1 ? "" : "s"}`;
  const loop = head.run === null ? "the loop" : `loop #${head.run.loopSeq}`;
  const expected = answer.loopReturn.expected;
  const next =
    expected === null
      ? ""
      : ` The next revision is expected from attempt ${expected.attempt} of ${expected.stageKey}.`;

  return {
    text: `Correction round queued for ${loop}, with the evidence of ${gates} as its steer.${next}`,
    failed: false,
    link:
      head.run === null ? null : { label: RECEIPT_LINK, href: runPath(head.run.id, originId) },
  };
}

/**
 * What a review request did.
 *
 * @param created Whether the press opened the slot.
 * @returns The sentence.
 */
export function reviewOutcome(created: boolean): OutcomeView {
  return { text: created ? REVIEW_OPENED : REVIEW_ALREADY_OPEN, failed: false, link: null };
}

// --- the dialog ----------------------------------------------------------------------------

/** Why the dialog's button waits while nothing is selected. */
export const RETURN_NEEDS_GATE = "Select at least one red gate to send.";

/** Why the dialog's button waits while the return is being sent. */
export const RETURN_SENDING = "The correction round is being sent.";

/** The dialog's cancel. */
export const RETURN_CANCEL = "Keep on this page";

/** The dialog's gate list, named. */
export const RETURN_GATES_LABEL = "Red gates to send as context";

/** What the dialog says the return does not do. */
export const RETURN_KEEPS =
  "Nothing is discarded: the branch and this PR stay as they are, and the next push is verified " +
  "as a new revision.";

/**
 * The dialog's title.
 *
 * @param number The host's number for the PR.
 * @returns `Return PR #514 to the loop`.
 */
export function returnTitle(number: number): string {
  return `Return ${prLabel(number)} to the loop`;
}

/**
 * What a return costs, said before anything can be pressed.
 *
 * @param head The PR's head.
 * @returns The sentence, naming the loop when there is one.
 */
export function returnCosts(head: PullRequestHead): string {
  const loop = head.run === null ? "the loop" : `loop #${head.run.loopSeq}`;

  return (
    `This sends the work back to ${loop} for another attempt, which costs time and tokens. ` +
    "The evidence of the gates selected below is what the agent receives."
  );
}

/**
 * The dialog's confirm label.
 *
 * @param selected How many gates are selected.
 * @returns `Return to loop with 2 gates`.
 */
export function returnConfirmLabel(selected: number): string {
  return `${RETURN_LABEL} with ${selected} gate${selected === 1 ? "" : "s"}`;
}
