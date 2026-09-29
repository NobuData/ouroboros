/**
 * What Mark & Route shows of a decision once it is made
 * ([#340](https://github.com/NobuData/ouroboros/issues/340)) — the routed receipt, the recorded
 * decision, and a recorded waiver.
 *
 * **The note's promise is proved by a receipt** ({@link receiptView}). *"Injected into attempt
 * 4's planning context"* is true because the service composes a steer carrying the text; the card
 * shows what was dispatched — the control's id and the attempt it opens, linked — rather than a
 * toast.
 *
 * **Only a person's decision is a decision** ({@link currentDecision}). A classification a rule
 * or a model stored is its suggestion — `mark-route-pick.ts`'s — so a case that holds only one is
 * undecided, and is never drawn with a receipt it could not have.
 *
 * **A waiver says which half is deferred.** It is recorded with its author and its reason; the
 * pull request is not annotated until the PR plane's activation
 * ([#344](https://github.com/NobuData/ouroboros/issues/344)), and the card says so in those words.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type { Classification, ClassifyResult, Waiver } from "@/app/api/test-results";
import { runPath } from "@/app/paths";

import { HUMAN_ACTOR, classLabel, heuristicAffix } from "./mark-route-pick";
import { clockOf } from "./timeline";

// --- the receipt and the recorded decision ----------------------------------------------------------

/** What was dispatched. */
export interface ReceiptView {
  /** The route, in words — `Correction round queued`. */
  readonly headline: string;
  /** The correction round's control (`run_controls.id`), or `null`. */
  readonly controlId: string | null;
  /** The attempt the correction round opens, linked into the run console — or `null`. */
  readonly attempt: { readonly label: string; readonly href: string } | null;
  /** The re-run's build (`build_jobs.id`), or `null`. */
  readonly rerunJobId: string | null;
  /** When it was dispatched, as the payload states it. */
  readonly at: string;
  /** `14:22`, UTC — or `null` for a value that is not a date. */
  readonly time: string | null;
}

/** What each route is called on a receipt. */
const ROUTE_HEADLINE: Readonly<Record<string, string>> = {
  correction_round: "Correction round queued",
  flake_retry: "Flake marked, case re-run queued",
  infra_rig: "Rig flagged, build requeued",
};

/**
 * A classification's receipt.
 *
 * @param classification The decision.
 * @param runId The run — the attempt's link leads into its console.
 * @param from The module the page was opened from, which the console keeps lit.
 * @returns What was dispatched, or `null` when nothing was.
 */
export function receiptView(
  classification: Pick<Classification, "routed" | "createdAt">,
  runId: string,
  from: string,
): ReceiptView | null {
  const routed = classification.routed;
  if (routed === null) return null;

  return {
    headline: (routed.route === null ? undefined : ROUTE_HEADLINE[routed.route]) ?? "Dispatched",
    controlId: routed.controlId,
    attempt:
      routed.targetAttempt === null
        ? null
        : { label: `attempt ${routed.targetAttempt}`, href: runPath(runId, from) },
    rerunJobId: routed.rerunJobId,
    at: classification.createdAt,
    time: clockOf(classification.createdAt, false),
  };
}

/** Who a decision is attributed to when its author has been removed from the workspace. */
export const AUTHOR_REMOVED = "someone no longer in this workspace";

/** Who a decision is attributed to when the workspace's members could not be read. */
export const AUTHOR_UNNAMED = "a member of this workspace";

/**
 * Who made a decision.
 *
 * @param decision The decision's actor and author.
 * @param readerId The reader's id, or `null` when it is not known.
 * @param people Display names by id, or `null` when the members could not be read.
 * @returns `you` for the reader; the person's name; a rule or a model by what it is.
 */
export function actorName(
  decision: Pick<Classification, "actor" | "createdBy" | "ruleId">,
  readerId: string | null,
  people: Readonly<Record<string, string>> | null,
): string {
  if (decision.actor === "heuristic") return heuristicAffix(decision.ruleId);
  if (decision.actor === "model") return "a model";
  if (decision.createdBy === null) return AUTHOR_REMOVED;
  if (decision.createdBy === readerId) return "you";
  if (people === null) return AUTHOR_UNNAMED;

  return people[decision.createdBy] ?? AUTHOR_REMOVED;
}

/** A decision the card holds for a case. */
export interface HeldDecision {
  /** What classifying answered. */
  readonly result: ClassifyResult;
  /** The decision it replaced, or `null` when it was the case's first. */
  readonly prior: Classification | null;
}

/** A recorded decision, as the card states it. */
export interface RecordedView {
  /** The decision's id. */
  readonly id: string;
  /** `Product bug`. */
  readonly classLabel: string;
  /** `you`, a name, or what decided. */
  readonly actor: string;
  /** The correction note, or `null`. */
  readonly note: string | null;
  readonly at: string;
  /** `14:22`, UTC — or `null`. */
  readonly time: string | null;
  /** What was dispatched, or `null` when nothing was. */
  readonly receipt: ReceiptView | null;
  /** The runner the infra route flagged, in one line — known only to the press that sent it. */
  readonly flagged: string | null;
  /** What routing could not do, in the service's sentences — known only to the press that sent it. */
  readonly skipped: readonly string[];
  /** The decision this one replaced, in one line — or `null`. */
  readonly supersedes: string | null;
}

/**
 * The runner the infra route flagged, in one line.
 *
 * @param flag The routing's runner flag, or `null`.
 * @returns `Runner helios-rig-02 flagged with a farm health note.` — or `null` when none was.
 */
export function flaggedLine(
  flag: ClassifyResult["routing"]["runnerFlag"],
): string | null {
  if (flag === null) return null;

  return flag.runnerName === null
    ? "The attempt's runner was flagged with a farm health note."
    : `Runner ${flag.runnerName} flagged with a farm health note.`;
}

/** What the card says for a decision that dispatched nothing. */
export const NOTHING_DISPATCHED = "Nothing was dispatched for this decision.";

/**
 * A decision, in one line — what a replaced decision is remembered by.
 *
 * @param decision The decision.
 * @param readerId The reader's id, or `null`.
 * @param people Display names by id, or `null`.
 * @returns `Product bug, by you at 14:22 — kept in the record as superseded.`
 */
export function supersededLine(
  decision: Classification,
  readerId: string | null,
  people: Readonly<Record<string, string>> | null,
): string {
  const time = clockOf(decision.createdAt, false);
  const when = time === null ? "" : ` at ${time}`;

  return `${classLabel(decision.class)}, by ${actorName(decision, readerId, people)}${when} — kept in the record as superseded.`;
}

/**
 * The decision the card shows for a case: the newest of what the page serves and what this
 * reader just recorded. **A person's only** — a classification a rule or a model stored is a
 * suggestion ({@link storedPick}), and a case that holds only one is undecided.
 *
 * @param served The attempt's current classifications, as the page's poll serves them.
 * @param held What this reader recorded for the case, or `null`.
 * @param caseId The failure's case.
 * @returns The decision and, when it is the held one, what came with it — or `null` while the
 *   case is undecided.
 */
export function currentDecision(
  served: readonly Classification[],
  held: HeldDecision | null,
  caseId: string,
): { readonly decision: Classification; readonly held: HeldDecision | null } | null {
  const polled =
    served.find((each) => each.testCaseId === caseId && each.actor === HUMAN_ACTOR) ?? null;
  const mine =
    held !== null && held.result.classification.testCaseId === caseId ? held : null;

  if (mine === null) return polled === null ? null : { decision: polled, held: null };
  if (polled === null || polled.id === mine.result.classification.id) {
    // The poll's copy carries the receipt as stored; the held one carries what routing said.
    return { decision: polled ?? mine.result.classification, held: mine };
  }

  // Two different decisions: the later one stands. Somebody else may have decided since.
  return Date.parse(polled.createdAt) > Date.parse(mine.result.classification.createdAt)
    ? { decision: polled, held: null }
    : { decision: mine.result.classification, held: mine };
}

/**
 * A recorded decision, as the card states it.
 *
 * @param input.current The decision, from {@link currentDecision}.
 * @param input.runId The run.
 * @param input.from The module the page was opened from.
 * @param input.readerId The reader's id, or `null`.
 * @param input.people Display names by id, or `null`.
 * @returns The class, who decided, the note, the receipt and what could not be routed.
 */
export function recordedView(input: {
  readonly current: NonNullable<ReturnType<typeof currentDecision>>;
  readonly runId: string;
  readonly from: string;
  readonly readerId: string | null;
  readonly people: Readonly<Record<string, string>> | null;
}): RecordedView {
  const { current, runId, from, readerId, people } = input;
  const { decision, held } = current;

  return {
    id: decision.id,
    classLabel: classLabel(decision.class),
    actor: actorName(decision, readerId, people),
    note: decision.note,
    at: decision.createdAt,
    time: clockOf(decision.createdAt, false),
    receipt: receiptView(decision, runId, from),
    flagged: flaggedLine(held?.result.routing.runnerFlag ?? null),
    skipped: held?.result.routing.skipped ?? [],
    supersedes:
      held === null || held.prior === null ? null : supersededLine(held.prior, readerId, people),
  };
}

// --- the waiver -------------------------------------------------------------------------------------

/** The waiver dialog's title. */
export const WAIVE_TITLE = "Waive this failure";

/** What the dialog says a waiver does. */
export const WAIVE_CONSEQUENCE =
  "A waiver lets this failure through. It is recorded with your name and your reason, and it cannot be edited afterwards.";

/** The dialog's plainly worded note about the half that is deferred. */
export const WAIVE_DEFERRED =
  "The waiver is recorded now. It is not posted on the pull request: PR annotation arrives with the PR plane (#344).";

/** The reason field's label. */
export const WAIVE_REASON_LABEL = "Why this failure is waived";

/** What the reason field says beneath it. */
export const WAIVE_REASON_HINT =
  "Required. Kept with the waiver as written — “known rig drift on helios-rig-02; tracked in #512”.";

/** Why the dialog's button waits while the reason is empty. */
export const WAIVE_NEEDS_REASON = "Write why the failure is waived.";

/** The dialog's button. */
export const WAIVE_CONFIRM = "Record waiver";

/** The dialog's button, and its reason, while the waiver is being sent. */
export const WAIVE_SENDING = "The waiver is being sent.";

/** The dialog's cancel. */
export const WAIVE_CANCEL = "Keep on this page";

/** The annotation state of a waiver nothing has posted (V055). */
const ANNOTATION_PENDING = "pending_pr_plane";

/** A recorded waiver, as the card states it. */
export interface WaiverView {
  readonly id: string;
  /** `Waived by you at 14:25`. */
  readonly headline: string;
  readonly reason: string;
  readonly at: string;
  /** That the PR was not annotated, in words — or `null` for a waiver that says it was. */
  readonly annotation: string | null;
}

/**
 * A waiver this reader just recorded.
 *
 * @param waiver The waiver.
 * @param readerId The reader's id, or `null`.
 * @param people Display names by id, or `null`.
 * @returns Who waived, when, why, and that the PR was not annotated.
 */
export function waiverView(
  waiver: Waiver,
  readerId: string | null,
  people: Readonly<Record<string, string>> | null,
): WaiverView {
  const time = clockOf(waiver.createdAt, false);
  const who = actorName(
    { actor: "human", createdBy: waiver.author, ruleId: null },
    readerId,
    people,
  );

  return {
    id: waiver.id,
    headline: `Waived by ${who}${time === null ? "" : ` at ${time}`}`,
    reason: waiver.reason,
    at: waiver.createdAt,
    // Read as text: the contract fixes the state at one value today, and widens with #344.
    annotation: String(waiver.annotationState) === ANNOTATION_PENDING ? WAIVE_DEFERRED : null,
  };
}
