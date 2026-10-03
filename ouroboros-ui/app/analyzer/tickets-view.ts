/**
 * Every decision the drafted-tickets card makes, and every sentence it says (BW.4,
 * [#519](https://github.com/NobuData/ouroboros/issues/519), mockup 18's **Drafted tickets — from
 * patterns, not people**) — pure, so each honesty rule is a unit test on a small value rather
 * than an assertion about markup.
 *
 * ### A view onto planning's batch, not a second one
 *
 * A drafted ticket is an ordinary planning draft. So what a row's checkbox, effort chip and push
 * state mean, what the footer's total says and when a push may run are **the planning page's own
 * rules** (`app/planning/generator.ts`), called from here rather than restated: `isSelected`,
 * `rowSizing`, `rowPush`, `pushMode`, `pushReason`, `selectReason`, `loopTimeText`, `pushOutcome`.
 * What this module adds is only what the analyzer's card has that the planning page's does not —
 * the evidence line, a select-all, the mockup's button label, the closed batch's summary, the
 * un-drafted suggestions, and the toast.
 *
 * ### No number is computed here
 *
 * The effort chips are the estimator's and the `est. total` is the service's sum of the selected
 * drafts' `est_minutes` (`summary.loopDays`). Ticking a row moves the total when the service
 * answers the tick — never before, by arithmetic done in the browser.
 *
 * ### The evidence is the draft's body
 *
 * A row's evidence line and references are read from the draft's body by the service — what a push
 * will file, edits included. A draft whose body no longer states its evidence says so.
 *
 * **Framework-free**, as `app/analyzer/view.ts` is.
 */

import type {
  AnalysisDraftedTicket,
  AnalysisTickets,
  AnalysisUndraftedTicket,
  AnalyzerPushReport,
} from "@/app/api/analyzer";
import type { PlanningBatch, PlanningDraft } from "@/app/api/planning";
import { dayLabel } from "@/app/insights/series-view";
import { ISSUES_PATH } from "@/app/paths";
import {
  type PushMode,
  type TrackerOption,
  isSelected,
  pushOutcome,
  pushReason,
  selectReason,
} from "@/app/planning/generator";

import { count } from "./view";

/* ------------------------------------------------------------------ the card */

/** The card's title, verbatim from the mockup (the card head upper-cases it). */
export const TICKETS_TITLE = "Drafted tickets — from patterns, not people";

/** What the card says instead of an empty box. */
export interface TicketsEmpty {
  readonly title: string;
  readonly note: string;
}

/** Before any analysis has composed a suggestion for the repository. */
export const NO_TICKETS_YET: TicketsEmpty = {
  title: "No tickets drafted yet",
  note: "An analysis drafts a ticket when a pattern in the builds calls for one — a failure signature many builds share, an option nothing sets, a check waived again and again. Run an analysis to see them.",
};

/** When analyses have run and none of what they found is ticket work. */
export const NOTHING_TO_DRAFT: TicketsEmpty = {
  title: "Nothing to draft",
  note: "The last analysis found no pattern that calls for a ticket.",
};

/**
 * What the card says when it has no ticket to show.
 *
 * @param tickets The card's content.
 * @param analyzed Whether an analysis has ended having composed a suggestion.
 * @returns The sentence, or `null` when there is a batch or an un-drafted suggestion to draw.
 */
export function ticketsEmpty(tickets: AnalysisTickets, analyzed: boolean): TicketsEmpty | null {
  if (tickets.undrafted.length > 0 || tickets.batches.length > 0) return null;

  return analyzed ? NOTHING_TO_DRAFT : NO_TICKETS_YET;
}

/* ------------------------------------------------------------------ rows */

/** One drafted ticket: planning's draft, and what its body says its evidence is. */
export interface TicketRow {
  /** The draft, as planning answers it. */
  readonly draft: PlanningDraft;
  /** The body's evidence, or `null` when the service answered none for this key. */
  readonly stated: AnalysisDraftedTicket | null;
}

/**
 * A batch's rows — each draft beside the evidence its body states.
 *
 * The batch may be newer than the evidence beside it (a tick's answer arrives before the next
 * poll), so the two are joined by key rather than by position.
 *
 * @param batch The batch to draw.
 * @param stated The evidence the page read, one entry per draft.
 * @returns The rows, in the batch's order.
 */
export function ticketRows(batch: PlanningBatch, stated: readonly AnalysisDraftedTicket[]): TicketRow[] {
  const byKey = new Map(stated.map((entry) => [entry.localKey, entry]));

  return batch.drafts.map((draft) => ({ draft, stated: byKey.get(draft.localKey) ?? null }));
}

/** What a row says where its evidence line would be, when its body states none. */
export const NO_EVIDENCE_LINE = "no evidence line in this draft's body";

/** The glyph on an evidence line that opens its references. */
export const OPENS_GLYPH = "↗";

/**
 * The accessible name of a row's evidence control.
 *
 * @param subject What the evidence is about — `BA-2`, or an un-drafted suggestion's title.
 * @param line The evidence line.
 * @returns `Evidence for BA-2: cache-miss signature … in 118 builds`.
 */
export function evidenceName(subject: string, line: string): string {
  return `Evidence for ${subject}: ${line}`;
}

/* ------------------------------------------------------------------ selection */

/** Why a pushed draft's checkbox is inert: it is in the tracker, whatever the box says. */
export const PUSHED_TICK_REASON = "Already pushed — it is in the tracker.";

/**
 * Why a row's checkbox cannot change, if it cannot — planning's rule for the same checkbox, plus
 * this card's: a draft already in the tracker is not something to select.
 *
 * @param draft The draft.
 * @param batch Its batch.
 * @param mayContribute Whether the reader may select — `owner`, `admin` or `member`.
 * @param pushing Whether a push is in flight from this card.
 * @returns The reason, or `undefined`.
 */
export function tickReason(
  draft: PlanningDraft,
  batch: PlanningBatch,
  mayContribute: boolean,
  pushing: boolean,
): string | undefined {
  const reason = selectReason(batch, mayContribute, pushing);

  if (reason !== undefined) return reason;

  return draft.pushState === "pushed" ? PUSHED_TICK_REASON : undefined;
}

/** The select-all checkbox's label. */
export const SELECT_ALL_LABEL = "All drafts";

/** What the select-all checkbox shows, and what pressing it would do. */
export interface SelectAll {
  /** Whether every draft still to push is ticked. */
  readonly checked: boolean;
  /** Whether some are and some are not. */
  readonly indeterminate: boolean;
  /** What a press sets every draft to. */
  readonly next: boolean;
  /** The drafts a press would change, by key, in the batch's order. */
  readonly keys: readonly string[];
}

/**
 * The select-all checkbox over a batch's drafts that are **not yet pushed** — a pushed draft is
 * neither counted nor changed.
 *
 * @param drafts The batch's drafts.
 * @param pending Ticks made and not yet confirmed.
 * @returns Its state. A press ticks everything unless everything is already ticked.
 */
export function selectAll(
  drafts: readonly PlanningDraft[],
  pending: ReadonlyMap<string, boolean>,
): SelectAll {
  const open = drafts.filter((draft) => draft.pushState !== "pushed");
  const ticked = open.filter((draft) => isSelected(draft, pending));
  const checked = open.length > 0 && ticked.length === open.length;
  const next = !checked;

  return {
    checked,
    indeterminate: ticked.length > 0 && ticked.length < open.length,
    next,
    keys: open.filter((draft) => isSelected(draft, pending) !== next).map((draft) => draft.localKey),
  };
}

/** What is said when a tick was refused: the row is as the service has it. */
export const TICK_FAILED = "The selection could not be saved, so it is as it was.";

/* ------------------------------------------------------------------ pushing */

/**
 * The push button's label — the mockup's `Push 4 tickets to backlog →`, without its arrow.
 *
 * @param selected How many drafts are ticked right now.
 * @returns The label.
 */
export function pushLabel(selected: number): string {
  return `Push ${count(selected, "ticket")} to backlog`;
}

/**
 * Where a push files its tickets — the push button's tooltip, since the mockup's label says
 * *backlog* and a team may have several.
 *
 * @param tracker The batch's tracker, or `undefined` when it is not among the workspace's.
 * @returns `Files them in GitHub Issues.`, or `undefined`.
 */
export function pushTitle(tracker: TrackerOption | undefined): string | undefined {
  return tracker === undefined ? undefined : `Files them in ${tracker.label}.`;
}

/**
 * Why the push — or a failed row's **Retry** — cannot act, if it cannot: the planning page's own
 * reasons, with one this page adds. The trackers are read with the page, so a read that failed is
 * said as that, rather than as a tracker nobody connected.
 *
 * @param input.mode Which push the footer offers.
 * @param input.count How many drafts are ticked.
 * @param input.tracker The batch's tracker, or `undefined` when it is not among the workspace's.
 * @param input.mayAdminister Whether the reader may push — `owner` or `admin`.
 * @param input.busy What the group is doing, if anything.
 * @param input.trackersFailure Why the workspace's trackers could not be read, or `null`.
 * @returns The reason, or `undefined`.
 */
export function pushBlock(input: {
  readonly mode: PushMode;
  readonly count: number;
  readonly tracker: TrackerOption | undefined;
  readonly mayAdminister: boolean;
  readonly busy: string | null;
  readonly trackersFailure: string | null;
}): string | undefined {
  // Who may not push hears that first, whatever else is true.
  if (input.mayAdminister && input.tracker === undefined && input.trackersFailure !== null) {
    return input.trackersFailure;
  }

  return pushReason(input);
}

/** A failed row's control. */
export const RETRY_LABEL = "Retry";

/** What **Retry** does — it is the same push, which files only what has not landed. */
export const RETRY_NOTE = "Push again — only the drafts that have not landed are filed.";

/** The link to the planning page's editor, verbatim from the mockup. */
export const EDIT_DRAFTS_LABEL = "Edit drafts";

/** What is said when a push could not be made at all. */
export const PUSH_FAILED = "The push could not be made.";

/* ------------------------------------------------------------------ the toast */

/** Where a toast's link leads. */
export interface ToastLink {
  /** The link's text. */
  readonly label: string;
  /** Its destination. */
  readonly href: string;
}

/** The page's one toast: what happened, what follows from it, and where to look. */
export interface AnalyzerToast {
  /** The sentence. */
  readonly text: string;
  /** What the reader should know before following the link, or `null`. */
  readonly note: string | null;
  /** Where it points, or nowhere. */
  readonly links: readonly ToastLink[];
}

/** The toast's dismissal, by accessible name. */
export const DISMISS_TOAST = "Dismiss";

/** The intake link's text. */
export const OPEN_ISSUES_LABEL = "Open Issues";

/**
 * Why the pushed tickets may not be on the Issues page yet: it lists the backlog as last synced
 * from GitHub, and a ticket filed a moment ago arrives with the next sync.
 */
export const INTAKE_SYNC_NOTE = "They appear in Issues once the backlog has synced.";

/**
 * What a push leaves on the page.
 *
 * The sentence is the planning page's own (`pushOutcome`) — a full push, a partial one naming how
 * many did not land, or a throttle naming when to resume. The link to **Issues** is offered only
 * when something landed in a GitHub tracker: intake lists the GitHub backlog and nothing else yet,
 * so a ticket pushed to Jira or Linear is linked from its row instead of promised somewhere it
 * will not appear.
 *
 * @param report What the push did.
 * @param tracker The batch's tracker, or `undefined` when it is not among the workspace's.
 * @returns The toast.
 */
export function pushToast(report: AnalyzerPushReport, tracker: TrackerOption | undefined): AnalyzerToast {
  const [text = PUSH_FAILED] = pushOutcome({ report, queueSmall: null }, tracker?.pushName ?? "the tracker");
  const inIntake = report.pushedThisRun > 0 && tracker?.kind === "github";

  return {
    text,
    note: inIntake ? INTAKE_SYNC_NOTE : null,
    links: inIntake ? [{ label: OPEN_ISSUES_LABEL, href: ISSUES_PATH }] : [],
  };
}

/* ------------------------------------------------------------------ a closed batch */

/**
 * Whether a batch is closed — pushed, or abandoned — so nothing about it can change here and the
 * card draws its summary instead of its rows.
 *
 * @param batch The batch.
 * @returns `true` once the service has closed it.
 */
export function isClosed(batch: Pick<PlanningBatch, "status">): boolean {
  return batch.status === "pushed" || batch.status === "abandoned";
}

/** The link from a closed batch to its page. */
export const OPEN_BATCH_LABEL = "Open the batch";

/** What a closed batch says in place of its rows. */
export interface ClosedSummary {
  /** `All 4 tickets are in GitHub.` or `3 of 4 drafts were pushed to GitHub.` */
  readonly headline: string;
  /** `BA-3 was left out.`, or `null` when every draft was pushed. */
  readonly leftOut: string | null;
  /** The drafts that are in the tracker, in the batch's order. */
  readonly pushed: readonly PlanningDraft[];
}

/**
 * A list of keys as prose.
 *
 * @param keys The keys.
 * @returns `BA-3`, `BA-2 and BA-3`, `BA-1, BA-2 and BA-3`.
 */
function listed(keys: readonly string[]): string {
  return keys.length <= 1 ? keys.join("") : `${keys.slice(0, -1).join(", ")} and ${keys.at(-1) ?? ""}`;
}

/**
 * What a closed batch says: how much of it reached the tracker, and what did not.
 *
 * @param batch The closed batch.
 * @param tracker Its tracker, or `undefined` when it is not among the workspace's.
 * @returns The summary.
 */
export function closedSummary(batch: PlanningBatch, tracker: TrackerOption | undefined): ClosedSummary {
  const name = tracker?.pushName ?? "the tracker";
  const pushed = batch.drafts.filter((draft) => draft.pushState === "pushed");
  const rest = batch.drafts.filter((draft) => draft.pushState !== "pushed").map((draft) => draft.localKey);
  const total = batch.drafts.length;

  const headline =
    batch.status === "abandoned"
      ? `This batch was abandoned with ${pushed.length} of ${count(total, "draft")} pushed to ${name}.`
      : rest.length === 0
        ? `${total === 1 ? "The ticket is" : `All ${total} tickets are`} in ${name}.`
        : `${pushed.length} of ${count(total, "draft")} ${pushed.length === 1 ? "was" : "were"} pushed to ${name}.`;

  return {
    headline,
    leftOut: rest.length === 0 ? null : `${listed(rest)} ${rest.length === 1 ? "was" : "were"} left out.`,
    pushed,
  };
}

/* ------------------------------------------------------------------ groups */

/**
 * A batch group's caption, shown only when the card holds more than one group — which batch this
 * is, since two may both hold a `BA-1`.
 *
 * @param batch The batch.
 * @param tracker Its tracker, or `undefined`.
 * @returns `Drafted Oct 3 for GitHub Issues`.
 */
export function batchCaption(batch: Pick<PlanningBatch, "createdAt">, tracker: TrackerOption | undefined): string {
  const when = dayLabel(batch.createdAt.slice(0, 10));

  return tracker === undefined ? `Drafted ${when}` : `Drafted ${when} for ${tracker.label}`;
}

/**
 * Whether the card holds more than one group, so each needs its caption.
 *
 * @param tickets The card's content.
 * @returns `true` for two batches, or a batch beside un-drafted suggestions.
 */
export function manyGroups(tickets: AnalysisTickets): boolean {
  return tickets.batches.length + (tickets.undrafted.length > 0 ? 1 : 0) > 1;
}

/* ------------------------------------------------------------------ un-drafted suggestions */

/** The un-drafted group's caption. */
export const UNDRAFTED_HEADING = "Not drafted yet";

/** What drafting does, and does not do. */
export const UNDRAFTED_NOTE =
  "Drafting turns these into a planning batch and sizes each with the estimator. Nothing reaches a tracker until you push.";

/**
 * The draft control's label.
 *
 * @param suggestions How many ticket suggestions it drafts.
 * @returns `Draft 1 ticket`, `Draft 3 tickets`.
 */
export function draftLabel(suggestions: number): string {
  return `Draft ${count(suggestions, "ticket")}`;
}

/** The draft dialog's eyebrow. */
export const DRAFT_EYEBROW = "Draft tickets";

/**
 * The draft dialog's title.
 *
 * @param suggestions How many are being drafted.
 * @returns `Draft 3 tickets from the analyzer's findings`.
 */
export function draftTitle(suggestions: number): string {
  return `${draftLabel(suggestions)} from the analyzer's findings`;
}

/** What the dialog says before anything is drafted. */
export const DRAFT_LEDE =
  "Each becomes a draft in one planning batch, with its evidence line and every reference in its body, and is sized by the estimator. Nothing reaches a tracker until the batch is pushed.";

/** The tracker choice's label. */
export const DRAFT_TRACKER_LABEL = "Tracker";

/** What the dialog says about the choice: the service fixes a batch's tracker when it is drafted. */
export const TRACKER_FIXED_NOTE = "A batch's tracker is fixed once it is drafted.";

/** What the confirm says while the service drafts. */
export const DRAFTING_TICKETS = "Drafting…";

/** What is said when the drafting was refused. */
export const DRAFT_TICKETS_FAILED = "The tickets could not be drafted.";

/**
 * The ids a draft sends, in the order their drafts are keyed.
 *
 * @param undrafted The un-drafted suggestions, in the card's order.
 * @returns Their ids — most confident first, so `BA-1` is the surest.
 */
export function draftIds(undrafted: readonly AnalysisUndraftedTicket[]): string[] {
  return undrafted.map((entry) => entry.id);
}

/* ------------------------------------------------------------------ the evidence sheet */

/** The sheet's eyebrow. */
export const EVIDENCE_EYEBROW = "Evidence";

/** Under a draft's evidence: where it was read from. */
export const BODY_SOURCE_NOTE = "Read from the draft's body — what a push will file, edits included.";

/** Under an un-drafted suggestion's evidence: what its draft will carry. */
export const WILL_CARRY_NOTE = "What the draft's body will carry once drafted.";

/** What the sheet says when the body lists no reference. */
export const NO_REFERENCES = "No references are listed.";

/** What a row's evidence opens: whose it is, the line, and the references behind it. */
export interface TicketEvidence {
  /** `BA-2`, or `null` for a suggestion not drafted yet. */
  readonly localKey: string | null;
  /** The draft's — or the suggestion's — title. */
  readonly title: string;
  /** The evidence line, or `null` when a draft's body states none. */
  readonly line: string | null;
  /** The first references, resolved. */
  readonly evidence: AnalysisDraftedTicket["evidence"];
  /** How many there are in all. */
  readonly evidenceTotal: number;
}

/**
 * A drafted row's evidence, for the sheet.
 *
 * @param row The row.
 * @returns What the sheet draws.
 */
export function draftedEvidence(row: TicketRow): TicketEvidence {
  return {
    localKey: row.draft.localKey,
    title: row.draft.title,
    line: row.stated?.evidenceLine ?? null,
    evidence: row.stated?.evidence ?? [],
    evidenceTotal: row.stated?.evidenceTotal ?? 0,
  };
}

/**
 * An un-drafted suggestion's evidence, for the sheet.
 *
 * @param suggestion The suggestion.
 * @returns What the sheet draws.
 */
export function undraftedEvidence(suggestion: AnalysisUndraftedTicket): TicketEvidence {
  return {
    localKey: null,
    title: suggestion.title,
    line: suggestion.evidenceLine,
    evidence: suggestion.evidence,
    evidenceTotal: suggestion.evidenceTotal,
  };
}

/** Which row's evidence the sheet is open on. */
export type OpenedEvidence =
  /** A drafted row, by its batch and key. */
  | { readonly group: "batch"; readonly batchId: string; readonly localKey: string }
  /** A suggestion not drafted yet. */
  | { readonly group: "undrafted"; readonly id: string };

/**
 * The evidence the sheet draws, read from the page as it stands — so a sheet left open over a poll
 * follows its row, and closes when the row is gone.
 *
 * @param tickets The card's content.
 * @param opened Which row's evidence was opened, or `null`.
 * @returns The evidence, or `null` when nothing is open or the row is no longer on the card.
 */
export function openedEvidence(tickets: AnalysisTickets, opened: OpenedEvidence | null): TicketEvidence | null {
  if (opened === null) return null;

  if (opened.group === "undrafted") {
    const suggestion = tickets.undrafted.find((entry) => entry.id === opened.id);

    return suggestion === undefined ? null : undraftedEvidence(suggestion);
  }

  const entry = tickets.batches.find((candidate) => candidate.batch.id === opened.batchId);
  const row =
    entry === undefined
      ? undefined
      : ticketRows(entry.batch, entry.drafts).find((candidate) => candidate.draft.localKey === opened.localKey);

  return row === undefined ? null : draftedEvidence(row);
}
