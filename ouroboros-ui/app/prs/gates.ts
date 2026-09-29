/**
 * The Verification gates card, as data ([#365](https://github.com/NobuData/ouroboros/issues/365))
 * — mockup 12's seven rows, decided here and drawn by `gates-card.tsx`.
 *
 * ```
 * VERIFICATION GATES   5 / 7 green                                  Run console →
 * ✓ Build                forge-01 · zephyr.elf · FLASH 43.5%        build farm →
 * ✓ Test suite           63/63 after attempt 4                      test results →
 * – Second-model review  <the engine's line>   arrives with the provider stack
 * ○ Human approval       not required by policy   [auto-merge eligible]
 * ```
 *
 * **It formats; it composes nothing.** The evidence line is the engine's, as recorded. `5 / 7` is
 * the payload's aggregate for the revision on screen — never counted here. The rows are the
 * scoped revision's own snapshot (`strip.ts`'s `gatesScope`), so revision 1 shows revision 1's
 * verdicts.
 *
 * **`unavailable` is not `pending`.** Pending is a provider evaluating: a pulse, a gradient, `in
 * progress`. Unavailable is no provider at all: a still mark and the stated
 * {@link UNAVAILABLE_NOTE}, so nobody waits for a review that is not going to happen.
 *
 * **`not_required` and `waived` are policy, not outcome.** Neither is drawn as a pass.
 *
 * **A link is drawn only where it leads somewhere real.** Each is routed by what the evidence was
 * composed from (`evidenceRef.kind`), and a row with nowhere honest to lead has none.
 *
 * **The states after the happy one** ([#370](https://github.com/NobuData/ouroboros/issues/370)).
 * On a blocked PR the red required gates of the latest revision are {@link GateRowView.blocking}
 * — they are the point of the page, so they are drawn as it. On a merged or closed PR the card
 * says its verdicts are final. And an approval is answered by an owner or admin: a member is
 * offered *Request review*, and told who a waiting one is waiting for.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type {
  PrGateAggregate,
  PrGateRow,
  PrReview,
  PullRequestHead,
  PullRequestPage,
} from "@/app/api/pull-requests";
import { BUILD_FARM_PATH, runPath, testsPath } from "@/app/paths";
import type { ChipTone } from "@/app/ui";

import { DIFF_VS_PLAN_KEY, FLAGGED_LINK } from "./files";
import type { GatesScope } from "./strip";
import { currentReview, isFinished } from "./view";

/** A gate's verdict. */
export type GateVerdict = PrGateRow["verdict"];

/** The card's title — the mockup's `VERIFICATION GATES`. */
export const GATES_TITLE = "Verification gates";

/** The card's way back to the latest revision. */
export const FOLLOW_LATEST = "Follow the latest revision";

/** What the card says when the revision on screen was never evaluated. */
export const NO_GATES = "No gate has been evaluated on this revision.";

/** The header's link into the loop's run console — the mockup's `Run console →`. */
export const RUN_CONSOLE_LINK = "Run console →";

/** What an `unavailable` row states instead of spinning. */
export const UNAVAILABLE_NOTE = "arrives with the provider stack";

/** The pill a `pending` row carries — the mockup's `in progress`. */
export const PENDING_PILL = "in progress";

/** The tag a human approval the policy did not require carries. */
export const AUTO_MERGE_ELIGIBLE = "auto-merge eligible";

/** The gate a person answers. */
export const HUMAN_APPROVAL_KEY = "human_approval";

/** The waived row's button. */
export const WAIVER_BUTTON = "waived";

/** The waiver popover's title. */
export const WAIVER_TITLE = "Waiver";

/** What the popover says about the author — the page's payload names none on a gate. */
export const WAIVER_AUTHOR_UNKNOWN =
  "Who waived it is not recorded on this gate's row, so no name is shown.";

/** What the popover says when the engine recorded no line. */
export const WAIVER_NO_REASON = "No reason was recorded on this gate's row.";

/** The row's *Request human review*. */
export const REQUEST_LABEL = "Request review";

/** The row's *Approve*. */
export const APPROVE_LABEL = "Approve";

/** The row's *Decline*. */
export const DECLINE_LABEL = "Decline";

/** Why the row's buttons wait while an answer is in flight. */
export const APPROVAL_SENDING = "The answer is being sent.";

/** What a waiting review's row tells a reader who may not answer it. */
export const AWAITS_APPROVER = "waiting for an owner or admin";

/** What is said once a review has been approved. */
export const APPROVED = "Approved — human approval is green on this revision.";

/** What is said once a review has been declined. */
export const DECLINED = "Declined — human approval is red on this revision.";

/** What the card says of a merged PR's verdicts. */
export const GATES_FINAL_MERGED =
  "Final verdicts — gates are not evaluated again once a PR has merged.";

/** What the card says of a closed PR's verdicts. */
export const GATES_FINAL_CLOSED =
  "Verdicts as they stood — gates are not evaluated while a PR is closed.";

/** A gate's verdict, in words — what the mark is announced as. */
export const VERDICT_WORDS: Readonly<Record<GateVerdict, string>> = {
  green: "green",
  red: "red",
  pending: "pending",
  waived: "waived",
  not_required: "not required",
  unavailable: "unavailable",
};

/**
 * The mark each verdict is drawn with; `null` is the pulsing dot, which is drawn rather than
 * written.
 */
export const VERDICT_MARKS: Readonly<Record<GateVerdict, string | null>> = {
  green: "✓",
  red: "✗",
  pending: null,
  waived: "⊘",
  not_required: "○",
  unavailable: "–",
};

// --- the header ----------------------------------------------------------------------------

/** The header's pill. */
export interface GatesPill {
  /** `5 / 7 green`. */
  readonly label: string;
  readonly tone: ChipTone;
}

/**
 * The header's pill, from the payload's aggregate.
 *
 * @param aggregate The scoped revision's aggregate, or `null` when it was never evaluated.
 * @returns `5 / 7 green` — `err` while a required gate is red, `ok` once every required gate is
 *   satisfied, otherwise `warn`; `null` when there is no aggregate or no required gate to count.
 */
export function gatesPill(aggregate: PrGateAggregate | null): GatesPill | null {
  if (aggregate === null || aggregate.requiredCount === 0) return null;

  return {
    label: `${aggregate.greenCount} / ${aggregate.requiredCount} green`,
    tone: aggregate.redCount > 0 ? "err" : aggregate.mergeReady ? "ok" : "warn",
  };
}

/**
 * What the card says of a finished PR's verdicts — the gate engine leaves a merged or closed PR
 * alone, so what is on screen is what stood when the host finished with it.
 *
 * @param head The PR's head.
 * @returns The sentence for a merged or closed PR, else `null`.
 */
export function gatesFinal(head: PullRequestHead): string | null {
  if (head.state === "merged") return GATES_FINAL_MERGED;
  if (head.state === "closed") return GATES_FINAL_CLOSED;

  return null;
}

// --- the links -----------------------------------------------------------------------------

/** Where a row's evidence can be checked. */
export interface GateLink {
  /** `test results →`. */
  readonly label: string;
  readonly href: string;
}

/**
 * Where a row's evidence leads — the system that produced it.
 *
 * | Composed from          | Leads to                                                        |
 * |------------------------|-----------------------------------------------------------------|
 * | `build_job`            | the build farm                                                  |
 * | `test_run`             | test results, on the attempt the revision was judged on         |
 * | `hil_measurement`      | the same attempt's page, where the physical tests card is drawn |
 * | `guardrail_evaluation` | the run console, where the guardrails card holds the evaluation |
 * | `vote`, `approval`     | nowhere — the row itself is where those are answered            |
 *
 * A red diff-vs-plan row cites nothing of these: it leads to the page's own changed files
 * ({@link flaggedLink}).
 *
 * @param row The gate's row.
 * @param scope The gates on screen.
 * @param head The PR's head.
 * @param originId The module the page was opened from.
 * @returns The link, or `null` when the row cites nothing or there is nowhere honest to lead: a
 *   test or rig line is linked only when the attempt it was judged on is known, and a loop's
 *   pages only for a PR a loop opened.
 */
export function gateLink(
  row: PrGateRow,
  scope: GatesScope,
  head: PullRequestHead,
  originId: string,
): GateLink | null {
  const ref = row.evidenceRef;
  if (ref === null) return null;

  const run = head.run;
  const attempt = scope.revision.testAttempt;

  switch (ref.kind) {
    case "build_job":
      return { label: "build farm →", href: BUILD_FARM_PATH };
    case "test_run":
      return run === null || attempt === null || attempt.id !== ref.id
        ? null
        : {
            label: "test results →",
            href: testsPath(run.id, { from: originId, attempt: attempt.attemptSeq }),
          };
    case "hil_measurement":
      return run === null || attempt === null
        ? null
        : {
            label: "physical tests →",
            href: testsPath(run.id, { from: originId, attempt: attempt.attemptSeq }),
          };
    case "guardrail_evaluation":
      return run === null ? null : { label: "guardrails →", href: runPath(run.id, originId) };
    default:
      return null;
  }
}

/**
 * Where a red diff-vs-plan row leads — the changed files it flags
 * ([#367](https://github.com/NobuData/ouroboros/issues/367)).
 *
 * @param row The gate's row.
 * @param scope The gates on screen.
 * @param page The PR page.
 * @returns The link to the Changed files card, or `null` for any other gate or verdict, and for a
 *   revision whose files are not the ones on the page: the card draws the latest revision's
 *   snapshot only.
 */
export function flaggedLink(
  row: PrGateRow,
  scope: GatesScope,
  page: PullRequestPage,
): GateLink | null {
  if (row.key !== DIFF_VS_PLAN_KEY || row.verdict !== "red") return null;
  if (page.files === null || page.files.revisionId !== scope.revision.id) return null;

  return FLAGGED_LINK;
}

// --- the approval --------------------------------------------------------------------------

/** What the human-approval row offers. */
export type ApprovalOffer =
  /** Nobody is waiting: *Request review*. */
  | "request"
  /** A review is waiting: *Approve* and *Decline*. */
  | "decide";

/** What the approval's affordances are decided from. */
export interface ApprovalInput {
  /** The PR page. */
  readonly page: PullRequestPage;
  /** The gates on screen. */
  readonly scope: GatesScope;
  /** The approval slot a press just opened or answered, or `null`. */
  readonly answeredReview: PrReview | null;
  /** Whether the reader may take a head action — owner, admin or member (#361). */
  readonly mayContribute: boolean;
  /** Whether the reader may answer an approval — owner or admin (#370). */
  readonly mayApprove: boolean;
}

/**
 * The approval slot the row reads.
 *
 * @param polled The page payload's newest slot, or `null`.
 * @param answered The slot a press on this page opened or answered, or `null`.
 * @returns `view.ts`'s `currentReview` — except that of two readings of the *same* slot, one that
 *   has been answered is the newer: a slot is answered once and never reopened, so the page's
 *   `requested` is then the older reading, waiting for the next poll.
 */
export function rowReview(polled: PrReview | null, answered: PrReview | null): PrReview | null {
  if (
    polled !== null &&
    answered !== null &&
    polled.id === answered.id &&
    polled.state === "requested" &&
    answered.state !== "requested"
  ) {
    return answered;
  }

  return currentReview(polled, answered);
}

/**
 * What the human-approval row offers this reader.
 *
 * @param row The gate's row.
 * @param input See {@link ApprovalInput}.
 * @returns `decide` while a review is waiting — for a reader who may answer it — and `request`
 *   otherwise; but nothing for a gate that is not human approval, for a reader who may not
 *   contribute, on a merged or closed PR, on a revision that is not the latest (an answer is
 *   honoured only there), for a member while a review is waiting, and nothing to request once
 *   the gate is green or an approval was just given on this page.
 */
export function approvalOffer(row: PrGateRow, input: ApprovalInput): ApprovalOffer | null {
  const { page, scope, answeredReview, mayContribute, mayApprove } = input;

  if (row.key !== HUMAN_APPROVAL_KEY || !mayContribute || !scope.latest) return null;
  if (isFinished(page.pullRequest.state)) return null;

  const review = rowReview(page.review, answeredReview);
  if (review !== null && review.state === "requested") return mayApprove ? "decide" : null;
  // Approved on this page, and the gate's row has not been polled green yet.
  if (review !== null && review.state === "approved" && review.id === answeredReview?.id) {
    return null;
  }

  return row.verdict === "green" ? null : "request";
}

/**
 * Whether the row's review is waiting on somebody else.
 *
 * @param row The gate's row.
 * @param input See {@link ApprovalInput}.
 * @returns `true` for the human-approval row of the latest revision of an open PR, while a review
 *   is waiting and the reader contributes but may not answer it — a member.
 */
export function awaitsApprover(row: PrGateRow, input: ApprovalInput): boolean {
  const { page, scope, answeredReview, mayContribute, mayApprove } = input;

  if (row.key !== HUMAN_APPROVAL_KEY || !mayContribute || mayApprove || !scope.latest) return false;
  if (isFinished(page.pullRequest.state)) return false;

  return rowReview(page.review, answeredReview)?.state === "requested";
}

/**
 * What an answer did, said on the card.
 *
 * @param decision What was answered.
 * @returns The sentence.
 */
export function approvalOutcome(decision: "approve" | "decline"): string {
  return decision === "approve" ? APPROVED : DECLINED;
}

// --- the decline dialog --------------------------------------------------------------------

/** The dialog's note field. */
export const DECLINE_NOTE_LABEL = "Why it is declined";

/** What the note field says beneath it. */
export const DECLINE_NOTE_HINT =
  "Required. Human approval turns red on this revision, and a red gate says why.";

/** Why the dialog's button waits while the note is empty. */
export const DECLINE_NEEDS_NOTE = "Write why the review is declined.";

/** The dialog's cancel. */
export const DECLINE_CANCEL = "Keep on this page";

/**
 * The dialog's title.
 *
 * @param number The host's number for the PR.
 * @returns `Decline the review of PR #514`.
 */
export function declineTitle(number: number): string {
  return `Decline the review of PR #${number}`;
}

// --- the rows ------------------------------------------------------------------------------

/** One gate, ready to draw. */
export interface GateRowView {
  /** `physical_hil` — the row's key. */
  readonly key: string;
  /** `Physical HIL`. */
  readonly label: string;
  readonly verdict: GateVerdict;
  /** The mark, or `null` for the pulsing dot. */
  readonly mark: string | null;
  /** The verdict in words — what the mark is announced as. */
  readonly word: string;
  /** The engine's line, as recorded; `null` when it recorded none. */
  readonly evidence: string | null;
  /** Where the evidence can be checked, or `null`. */
  readonly link: GateLink | null;
  /** The changed files a red diff-vs-plan flags, on this page — or `null`. */
  readonly flagged: GateLink | null;
  /**
   * {@link UNAVAILABLE_NOTE} on an `unavailable` row, {@link AWAITS_APPROVER} on a waiting
   * review the reader may not answer, otherwise `null`.
   */
  readonly note: string | null;
  /** Whether it is one of the red required gates a blocked PR is blocked by (#370). */
  readonly blocking: boolean;
  /** {@link PENDING_PILL} on a `pending` row, otherwise `null`. */
  readonly pill: string | null;
  /** {@link AUTO_MERGE_ELIGIBLE} on a human approval the policy did not require. */
  readonly tag: string | null;
  /** Whether the row opens a waiver popover. */
  readonly waived: boolean;
  /** Why the PR has the gate — `standard-fix@v14 pin`. */
  readonly source: string;
  /** What the row offers the reader, or `null`. */
  readonly approval: ApprovalOffer | null;
}

/** The card, ready to draw. */
export interface GatesCardView {
  /** `5 / 7 green`, or `null`. */
  readonly pill: GatesPill | null;
  /** The loop's run console, or `null` for a PR no loop opened. */
  readonly runConsole: string | null;
  /** `Revision 1 · 3f9c2ae · 2 gates red`. */
  readonly heading: string;
  /** Whether the reader chose the revision on screen. */
  readonly scoped: boolean;
  /** The rows, in the card's order. */
  readonly rows: readonly GateRowView[];
  /** What is said of a merged or closed PR's verdicts, or `null` (#370). */
  readonly final: string | null;
}

/** What the card is decided from. */
export interface GatesCardInput extends ApprovalInput {
  /** The module the page was opened from. */
  readonly originId: string;
}

/**
 * Whether a row is one of the gates a blocked PR is blocked by.
 *
 * @param row The gate's row.
 * @param input See {@link GatesCardInput}.
 * @returns `true` for a red required gate of the latest revision while the PR is `blocked`. An
 *   earlier revision's red gates are history, and a red gate the policy does not require blocks
 *   nothing.
 */
export function isBlocking(row: PrGateRow, input: GatesCardInput): boolean {
  return (
    input.page.pullRequest.state === "blocked" &&
    input.scope.latest &&
    row.required &&
    row.verdict === "red"
  );
}

/**
 * What a row states beside its evidence.
 *
 * @param row The gate's row.
 * @param input See {@link GatesCardInput}.
 * @returns The note, or `null`.
 */
function rowNote(row: PrGateRow, input: GatesCardInput): string | null {
  if (row.verdict === "unavailable") return UNAVAILABLE_NOTE;

  return awaitsApprover(row, input) ? AWAITS_APPROVER : null;
}

/**
 * One gate's row.
 *
 * @param row The gate's row, from the scoped snapshot.
 * @param input See {@link GatesCardInput}.
 * @returns The row.
 */
export function gateRowView(row: PrGateRow, input: GatesCardInput): GateRowView {
  const { verdict } = row;

  return {
    key: row.key,
    label: row.label,
    verdict,
    mark: VERDICT_MARKS[verdict],
    word: VERDICT_WORDS[verdict],
    evidence: row.evidence,
    link: gateLink(row, input.scope, input.page.pullRequest, input.originId),
    flagged: flaggedLink(row, input.scope, input.page),
    note: rowNote(row, input),
    blocking: isBlocking(row, input),
    pill: verdict === "pending" ? PENDING_PILL : null,
    tag: verdict === "not_required" && row.key === HUMAN_APPROVAL_KEY ? AUTO_MERGE_ELIGIBLE : null,
    waived: verdict === "waived",
    source: row.source,
    approval: approvalOffer(row, input),
  };
}

/**
 * The card for the gates on screen.
 *
 * @param input See {@link GatesCardInput}.
 * @returns The card: the scoped revision's rows and its own aggregate.
 */
export function gatesCard(input: GatesCardInput): GatesCardView {
  const { page, scope, originId } = input;
  const run = page.pullRequest.run;

  return {
    pill: gatesPill(scope.revision.gates.aggregate),
    runConsole: run === null ? null : runPath(run.id, originId),
    heading: scope.heading,
    scoped: scope.scoped,
    rows: scope.rows.map((row) => gateRowView(row, input)),
    final: gatesFinal(page.pullRequest),
  };
}
