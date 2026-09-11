/**
 * The intake screen's copy and its decisions — everything `/issues` says, and every judgement about
 * when it may say it, as data and pure functions
 * ([#115](https://github.com/NobuData/ouroboros/issues/115)).
 *
 * `app/issues/data.ts` reads, the components beside this file draw, and this decides: what the
 * head's sentence is for a count, when each of the head's two actions is inert and why, and what a
 * press that came back is reported as. Framework-free and deliberately not `server-only`: the
 * Server Components, the Client Components and the Server Actions beside it all read from here, so
 * the sentence a button's tooltip carries and the one its action answers with are one string.
 *
 * ### The copy is the mockup's, and the mockup's numbers are not
 *
 * `docs/mockups/03-issues.html` writes the head as *"42 open issues. 38 already sized."* Those
 * figures are design copy — the seeds count nine and seven — so the *sentence* is taken from the
 * mockup and the *numbers* from the service, and `__tests__/issues/view.test.ts` reads the mockup to
 * hold the sentence, the eyebrow, the subline and both labels to it.
 */

import type { BacklogListing, EstimationFanout, QueuedSelection } from "@/app/api/backlog";
import type { EnabledRepo } from "@/app/api/enablement";
import type { Reading } from "@/app/api/reading";

/** The caption over the head, as the mockup writes it. */
export const ISSUES_EYEBROW = "Issue Intake";

/** The subline under the head, verbatim from the mockup. */
export const ISSUES_SUBLINE =
  "Ouroboros watches the GitHub backlog and continuously estimates effort, risk, and routing " +
  "for every open issue — before you ever ask it to work.";

/** The three figures the page head is drawn from. */
export interface BacklogCounts {
  /**
   * Open issues in scope — the workspace's, or the selected repository's — the head's first
   * figure. The contract scopes it by `repo` and by nothing else in the filter bar.
   */
  readonly openCount: number;
  /** How many of those open issues are `sized` — the head's second. */
  readonly sizedCount: number;
  /**
   * Every issue the **workspace** mirrors, open and closed, whatever the filter bar says. It is
   * what **Re-estimate all** claims from, and therefore the number its confirmation states.
   */
  readonly mirroredCount: number;
}

/** Everything the screen draws, each part either read or explained. */
export interface IssuesReadings {
  /** The head's counts, or why the backlog could not be counted. */
  readonly counts: Reading<BacklogCounts>;
  /**
   * The chip set ([#116](https://github.com/NobuData/ouroboros/issues/116)) — every label in
   * scope, ascending by name — or why it could not be read.
   */
  readonly facets: Reading<readonly string[]>;
  /** The repository select's options — the workspace's enabled repositories — or why not. */
  readonly repos: Reading<readonly EnabledRepo[]>;
}

/** What a press of either head action came back as. */
export type HeadOutcome =
  /** It took, and this sentence says what happened. */
  | { readonly ok: true; readonly message: string }
  /** It did not, and this is why — already written for a reader. */
  | { readonly ok: false; readonly reason: string };

/** Whole numbers, grouped the way a person reads a count: `1,204`. */
const WHOLE = new Intl.NumberFormat("en-US");

/**
 * A count with its noun agreeing with it.
 *
 * @param count How many.
 * @param one The noun for exactly one.
 * @param many The noun for every other count, zero included.
 * @returns `1 issue`, `9 issues`, `1,204 issues`, `0 issues`.
 */
function counted(count: number, one: string, many: string): string {
  return `${WHOLE.format(count)} ${count === 1 ? one : many}`;
}

/**
 * A count of issues.
 *
 * @param count How many.
 * @returns `1 issue`, `9 issues`, `0 issues`.
 */
export function issueCount(count: number): string {
  return counted(count, "issue", "issues");
}

/**
 * The page head's three figures, out of the page's two listings.
 *
 * The two head counts come from the **view** — the listing asked with the filter bar's query —
 * because the contract scopes `meta` by `repo` and by nothing else: choose a repository and the
 * head counts that repository's backlog; press a chip and it does not move. The mirrored count
 * comes from the **scope** listing — `state=all` and no other filter — because `total` describes
 * the filter, and only under that query is it every issue the workspace mirrors, which is the set
 * **Re-estimate all** claims from whatever the bar says (`app/issues/data.ts` argues both).
 *
 * @param view The listing read with the filter bar's query.
 * @param scope The listing read with `state=all` and no other filter.
 * @returns The three figures.
 */
export function backlogCounts(view: BacklogListing, scope: BacklogListing): BacklogCounts {
  return {
    openCount: view.meta.openCount,
    sizedCount: view.meta.sizedCount,
    mirroredCount: scope.total,
  };
}

/** The head when the backlog could not be counted — a sentence, never a zero. */
export const COUNTS_UNREAD = "The backlog could not be counted.";

/**
 * The page head's sentence.
 *
 * @param counts The counts, or why there are none.
 * @returns The mockup's sentence over the service's figures — *"9 open issues. 7 already
 *   sized."* — or {@link COUNTS_UNREAD}, whose reason the screen prints beneath it.
 */
export function headline(counts: Reading<BacklogCounts>): string {
  if (!counts.ok) return COUNTS_UNREAD;

  const { openCount, sizedCount } = counts.value;
  return `${counted(openCount, "open issue", "open issues")}. ${WHOLE.format(sizedCount)} already sized.`;
}

/* ------------------------------------------------------------------ Queue N selected ⟳ */

/**
 * The primary action's label, reflecting the selection.
 *
 * @param selected How many issues are selected.
 * @returns `Queue 3 selected ⟳` — the mockup's label with its figure replaced by the count.
 */
export function queueLabel(selected: number): string {
  return `Queue ${WHOLE.format(selected)} selected ⟳`;
}

/** Why a viewer's queue button is inert. A `403` for a press that went around it says the same. */
export const QUEUE_ROLE_REASON =
  "Queueing issues is for workspace owners, admins and members — a viewer can read the backlog " +
  "but not fill the queue.";

/**
 * Why the queue button is inert with nothing selected.
 *
 * It names the issue that builds the table a selection is made in, because until that lands the
 * honest answer to *"how do I select one?"* is *"not yet"* — and the design system's honesty rule
 * (§ 3.5) asks that a control say what it is waiting for rather than simply refuse.
 */
export const QUEUE_NOTHING_SELECTED =
  "Select issues to queue them — the backlog table you select them in arrives with #117.";

/** What a refused queue press says when the service gave no sentence of its own. */
export const QUEUE_FAILED = "The selection could not be queued.";

/** Said after every refusal, because the write is one transaction and a refusal took nothing. */
export const NOTHING_QUEUED = "Nothing was queued.";

/**
 * Why the queue button cannot act, if it cannot.
 *
 * **The role comes first.** A viewer who had selected three issues would still be refused, and
 * telling them to select issues would send them to do something that ends in that refusal.
 *
 * @param selected How many issues are selected.
 * @param mayContribute Whether this reader's role may queue.
 * @returns The reason, or `undefined` when the button may be pressed.
 */
export function queueReason(selected: number, mayContribute: boolean): string | undefined {
  if (!mayContribute) return QUEUE_ROLE_REASON;
  if (selected === 0) return QUEUE_NOTHING_SELECTED;
  return undefined;
}

/**
 * What a queue press that took says.
 *
 * @param queued The service's answer.
 * @returns `Queued 3 issues.` — counted from the rows the service created, not from the ids sent.
 */
export function queuedOutcome(queued: QueuedSelection): string {
  return `Queued ${issueCount(queued.items.length)}.`;
}

/**
 * What a refused queue press says.
 *
 * @param message The service's own sentence. Every message in the envelope is written for a
 *   person, and M.3's say what is wrong with the selection (*"Some of those issues have not been
 *   sized yet."*). An empty one falls back to {@link QUEUE_FAILED}.
 * @returns That sentence, followed by {@link NOTHING_QUEUED} — true of every refusal.
 */
export function queueRefusal(message: string): string {
  return `${message === "" ? QUEUE_FAILED : message} ${NOTHING_QUEUED}`;
}

/* ------------------------------------------------------------------ Re-estimate all */

/** The ghost action's label, as the mockup writes it. */
export const REESTIMATE_LABEL = "Re-estimate all";

/** The confirmation's title, and its accessible name. */
export const REESTIMATE_TITLE = "Re-estimate the whole backlog?";

/**
 * What the confirmation says under its count: which issues, what happens to their estimates, and
 * why fewer may start than it counted — L.4's contract, in a reader's words.
 */
export const REESTIMATE_NOTE =
  "Every issue this workspace mirrors is sized again, open or closed, and each new estimate is " +
  "kept as a new version beside the last. Issues already being estimated are left alone, so " +
  "fewer may start than this counts.";

/** The confirmation's way out without acting. */
export const CANCEL_LABEL = "Cancel";

/**
 * The confirmation's statement of scope.
 *
 * @param mirrored How many issues the workspace mirrors.
 * @returns `This re-estimates 9 issues.`
 */
export function reestimateScope(mirrored: number): string {
  return `This re-estimates ${issueCount(mirrored)}.`;
}

/**
 * The confirmation's control — the count again, on the button that commits to it.
 *
 * @param mirrored How many issues the workspace mirrors.
 * @returns `Re-estimate 9 issues`.
 */
export function reestimateConfirmLabel(mirrored: number): string {
  return `Re-estimate ${issueCount(mirrored)}`;
}

/** Why **Re-estimate all** is inert when the backlog could not be counted. */
export const REESTIMATE_UNCOUNTED =
  "The backlog could not be counted, so there is no honest number of issues to confirm.";

/** Why it is inert for a workspace that mirrors nothing. */
export const REESTIMATE_NOTHING =
  "There is nothing to re-estimate — this workspace mirrors no issues yet.";

/**
 * Why **Re-estimate all** cannot act, if it cannot.
 *
 * The confirmation's whole job is to state a number, so a press that could not state one is not
 * offered: the counts failing to read and the count being zero each say so instead.
 *
 * @param counts The head's counts, or why there are none.
 * @returns The reason, or `undefined` when the button may be pressed.
 */
export function reestimateReason(counts: Reading<BacklogCounts>): string | undefined {
  if (!counts.ok) return REESTIMATE_UNCOUNTED;
  if (counts.value.mirroredCount === 0) return REESTIMATE_NOTHING;
  return undefined;
}

/**
 * What a re-estimate press that took says — which is how many it actually started, since that can
 * be fewer than the confirmation counted.
 *
 * @param fanout The service's answer.
 * @returns `Re-estimating 9 issues.`, or with what was left alone —
 *   `Re-estimating 7 issues. 2 issues already being estimated were left alone.` — or, for a
 *   workspace that mirrored nothing by the time the press arrived, that there was nothing to do.
 */
export function fanoutOutcome({ enqueued, skipped, total }: EstimationFanout): string {
  if (total === 0) return "There was nothing to re-estimate — this workspace mirrors no issues.";

  const started = `Re-estimating ${issueCount(enqueued)}.`;
  if (skipped === 0) return started;

  return `${started} ${issueCount(skipped)} already being estimated ${skipped === 1 ? "was" : "were"} left alone.`;
}

/** What a second press says while the first still has every issue in flight. */
export const REESTIMATE_BUSY =
  "Every issue is already being estimated, so nothing new was started.";

/** What a press from a role below `admin` is answered with. */
export const REESTIMATE_ROLE_REASON =
  "Re-estimating the whole backlog is for workspace owners and admins.";

/** What a refused press says when the service gave no sentence of its own. */
export const REESTIMATE_FAILED = "The backlog could not be re-estimated.";

/**
 * What a rate-limited press says.
 *
 * @param retryAfterSeconds The refusal's `details.retryAfterSeconds`, as it arrived — `unknown`,
 *   because `details` is an open map and a value that is not a positive number is not a wait
 *   anybody can act on.
 * @returns The sentence, with the wait in whole seconds when there is one to give.
 */
export function reestimateRateLimited(retryAfterSeconds: unknown): string {
  const wait =
    typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? `in ${counted(Math.ceil(retryAfterSeconds), "second", "seconds")}`
      : "shortly";

  return `This workspace has asked for too many estimates in the last minute. Try again ${wait}.`;
}
