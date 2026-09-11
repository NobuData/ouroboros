/**
 * The selection action bar's copy and its decisions — every word mockup 03's `.sel-bar` prints,
 * and every judgement about a selection, as data and pure functions
 * ([#118](https://github.com/NobuData/ouroboros/issues/118)).
 *
 * `app/issues/selection-bar.tsx` draws, `app/issues/head-actions.ts` sends, and this decides:
 * what the bar's sentence is over the rows a person ticked, what the primary action is called
 * under each workflow choice, how a refused selection is explained issue by issue, and what a
 * press that took says. Framework-free and deliberately not `server-only`, the way
 * `app/issues/view.ts` is: the Client Component, the Server Action and the suite all read from
 * here, so the sentence a refusal is drawn with and the one the action answers with are one
 * string.
 *
 * ### The estimate is a preview; the service's is the truth
 *
 * The bar sums `estMinutes` client-side over the selected rows as the table last saw them
 * (`app/issues/seen-rows.ts`), and prints *"est. 2h 5m combined autonomous work"* before
 * anything is sent. The queue write answers with its own `estMinutes`, summed over the rows it
 * actually created, and that is the number the toast prints. The two agree on a backlog nobody
 * re-estimated between the tick and the press, and where they do not the toast is right.
 *
 * ### The mockup's number is design copy
 *
 * The mockup's selected trio reads *"est. 1h 10m"* over a table whose rows carry no minutes at
 * all. The seeds carry them — 45, 50 and 30 for `#485`, `#484` and `#491` — and M.3 answers
 * 125 for that selection, so the seeded bar reads *"est. 2h 5m"*: the sentence is the mockup's
 * and the figure is the service's, exactly as the page head's counts are.
 *
 * ### A refusal names its issues
 *
 * The queue write is one transaction, and every refusal carries `details.issues` — one entry
 * per issue, with a code for what is wrong with that row. The bar turns each into a sentence
 * that names the issue (*"#483 is still being sized."*) under a title that says what the
 * transaction did, which is nothing; the reader deselects the named issues, or fixes them, and
 * presses again. What it will not do is print a code.
 */

import type { QueueWorkflow, QueuedSelection } from "@/app/api/backlog";
import { durationOfMinutes } from "@/app/format";
import { DASHBOARD_PATH, DASHBOARD_QUEUE_HASH } from "@/app/paths";

import type { SeenRowMap } from "./seen-rows";
import type { TableRow } from "./table";
import { issueCount } from "./view";

/**
 * What can be wrong with one issue in a refused selection — the `code` of each
 * `details.issues` entry `POST /api/v1/backlog/queue` answers with.
 *
 * Here rather than beside the operation's own codes in `app/api/backlog.ts`, because that
 * module sits on the server-side client and this one is read by a Client Component; the suite
 * holds these spellings to the contract the same way. `notFound` carries nothing but the id,
 * deliberately: an issue this workspace cannot see has no number this request is entitled to
 * learn. `notSized` carries the status the issue is in — `unsized`, `estimating` or
 * `needs_human`. `numberTaken` is two issues *in the request* sharing one GitHub number, which a
 * workspace watching two repositories can produce.
 */
export const QUEUE_ISSUE_CODES = {
  notFound: "issue_not_found",
  notSized: "issue_not_sized",
  estimateMissing: "issue_estimate_missing",
  alreadyQueued: "issue_already_queued",
  numberTaken: "issue_number_taken",
} as const;

/* ------------------------------------------------------------------ the workflow menu */

/**
 * The fixed set (decision K5), in the order the menu lists them: the tag the mockup's own
 * button names first, then the other three.
 *
 * Typed against the contract's enum rather than declared beside it, so a tag the service
 * stopped accepting is a compile error here and not a `422` in a browser. The amendment on the
 * ticket turns this list into the workflow registry once P.4
 * ([#135](https://github.com/NobuData/ouroboros/issues/135)) serves one; until then the four
 * are the whole vocabulary, and stored tags keep resolving because each is a valid slug.
 */
export const WORKFLOWS: readonly QueueWorkflow[] = [
  "standard-fix",
  "feature-loop",
  "docs-loop",
  "deps-refresh",
];

/**
 * What the bar sends as the workflow: one of the set, or `null` for *use suggested* — the
 * request without a `workflow`, which the contract reads as *each issue under the workflow its
 * own estimate suggested*.
 */
export type WorkflowChoice = QueueWorkflow | null;

/**
 * Whether a value is a workflow the service accepts.
 *
 * @param value Anything — what a menu row carries, or what a forged POST sent.
 * @returns `true` for one of {@link WORKFLOWS}.
 */
export function isWorkflow(value: unknown): value is QueueWorkflow {
  return typeof value === "string" && (WORKFLOWS as readonly string[]).includes(value);
}

/** The menu's trigger, as the mockup writes it — without the caret, which is drawn beside it. */
export const ASSIGN_LABEL = "Assign workflow";

/** The caret after the trigger's label, decorative. */
export const ASSIGN_CARET = "▾";

/** The menu's own name. */
export const ASSIGN_MENU_LABEL = "Workflow to queue the selection under";

/** The menu's default row: no workflow, each issue on its own suggestion. */
export const SUGGESTED_LABEL = "Use suggested";

/** What the default row means, under its name. */
export const SUGGESTED_NOTE = "Each issue runs under the workflow its own estimate suggested.";

/* ------------------------------------------------------------------ the sentence */

/** What the bar knows about the selection, from the rows as the table last saw them. */
export interface SelectionSummary {
  /** How many issues are selected. */
  readonly count: number;
  /**
   * The selected estimates added up, in minutes, over the issues that carry one — or `null`
   * when none of them does, which is a sentence rather than `0m`.
   */
  readonly estMinutes: number | null;
  /**
   * How many selected issues carry no estimate: unsized, mid-flight, or — through no path the
   * table offers — never seen. The queue will refuse a selection holding one, and the bar says
   * how many before the press does.
   */
  readonly unestimated: number;
  /**
   * The one workflow every estimated issue in the selection suggests, or `null` when they
   * differ or none is known — what *Queue → suggested* reads under *use suggested*.
   */
  readonly suggested: string | null;
}

/**
 * The selection, summed.
 *
 * @param ids The selected issues, in their order.
 * @param seen The rows as the table last saw them.
 * @returns The count, the combined estimate, how many carry none, and the one suggested
 *   workflow if there is one.
 */
export function summarize(ids: readonly string[], seen: SeenRowMap): SelectionSummary {
  let estMinutes: number | null = null;
  let unestimated = 0;
  const suggestions = new Set<string>();

  for (const id of ids) {
    const row: TableRow | undefined = seen.get(id);

    if (row === undefined || row.estMinutes === null) {
      unestimated += 1;
      continue;
    }

    estMinutes = (estMinutes ?? 0) + row.estMinutes;
    if (row.workflow !== null) suggestions.add(row.workflow);
  }

  const [only] = suggestions;

  return {
    count: ids.length,
    estMinutes,
    unestimated,
    suggested: suggestions.size === 1 && only !== undefined ? only : null,
  };
}

/**
 * The bar's leading figure.
 *
 * @param count How many issues are selected.
 * @returns `3 issues selected` — the mockup's phrase over the live count.
 */
export function selectedLabel(count: number): string {
  return `${issueCount(count)} selected`;
}

/** What the estimate part says when no selected issue has one yet. */
export const NOT_SIZED_YET = "· not sized yet";

/**
 * The bar's estimate, after the figure.
 *
 * @param summary The selection, summed.
 * @returns `· est. 2h 5m combined autonomous work` — the mockup's phrase over the sum — with
 *   `· 1 issue not sized yet` after it when part of the selection carries no estimate, or
 *   {@link NOT_SIZED_YET} alone when none does.
 */
export function estimateLabel(summary: SelectionSummary): string {
  if (summary.estMinutes === null) return NOT_SIZED_YET;

  const estimate = `· est. ${durationOfMinutes(summary.estMinutes)} combined autonomous work`;
  if (summary.unestimated === 0) return estimate;

  return `${estimate} · ${issueCount(summary.unestimated)} not sized yet`;
}

/** What the primary action reads under *use suggested* over a selection that agrees on nothing. */
export const SUGGESTED_TARGET = "suggested";

/**
 * The primary action's label, reflecting the choice.
 *
 * @param choice The menu's choice.
 * @param summary The selection, summed.
 * @returns `Queue → standard-fix` for a chosen workflow; under *use suggested*, the one
 *   workflow the selection agrees on, or `Queue → suggested` for a mixed selection.
 */
export function queueUnderLabel(choice: WorkflowChoice, summary: SelectionSummary): string {
  return `Queue → ${choice ?? summary.suggested ?? SUGGESTED_TARGET}`;
}

/* ------------------------------------------------------------------ what a press comes back as */

/** One issue a refused selection names — a `details.issues` entry, read defensively. */
export interface Offender {
  /** The id the caller sent. */
  readonly issueId: string;
  /** What is wrong with that row — one of {@link QUEUE_ISSUE_CODES}'s values, or something newer. */
  readonly code: string;
  /** Its number, where the workspace's own row supplied one. A `404` carries none. */
  readonly issueNumber: number | null;
  /** The status a not-sized issue is actually in, where the entry says. */
  readonly sizingStatus: string | null;
}

/** What one press of the bar's action came back as. */
export type QueueOutcome =
  /** It took: the rows created and their combined estimate, as the service answered. */
  | { readonly ok: true; readonly queued: QueuedSelection }
  /**
   * It did not. `reason` is the sentence a line prints, and `offenders` names the issues —
   * empty for a refusal that was about the request rather than the selection.
   */
  | { readonly ok: false; readonly reason: string; readonly offenders: readonly Offender[] };

/**
 * The offenders a refusal's `details` names.
 *
 * `details` is an open map on the wire, so nothing about it is trusted: an entry is kept only
 * when it carries a string id and a string code, and its number and status only when they are
 * the types the contract promises. Anything else is left out rather than drawn as `#NaN`.
 *
 * @param details The envelope's `details`, whatever arrived.
 * @returns The entries that could be read, in the service's order — which is the order that
 *   matters to it: ids it cannot see first, then the unsized, then the queued.
 */
export function offendersOf(details: unknown): readonly Offender[] {
  if (typeof details !== "object" || details === null) return [];

  const { issues } = details as { readonly issues?: unknown };
  if (!Array.isArray(issues)) return [];

  const read: Offender[] = [];

  for (const entry of issues) {
    if (typeof entry !== "object" || entry === null) continue;

    const { issueId, code, issueNumber, sizingStatus } = entry as Record<string, unknown>;
    if (typeof issueId !== "string" || typeof code !== "string") continue;

    read.push({
      issueId,
      code,
      issueNumber: typeof issueNumber === "number" && Number.isInteger(issueNumber) ? issueNumber : null,
      sizingStatus: typeof sizingStatus === "string" ? sizingStatus : null,
    });
  }

  return read;
}

/** The refusal dialog's title, and its accessible name: what the transaction did. */
export const NOTHING_QUEUED_TITLE = "Nothing was queued";

/** The dialog's way out without acting. */
export const CLOSE_LABEL = "Close";

/**
 * The dialog's other way out: drop the named issues and keep the rest selected.
 *
 * @param offenders How many issues the refusal named.
 * @returns `Deselect 1 issue`, `Deselect 2 issues`.
 */
export function deselectLabel(offenders: number): string {
  return `Deselect ${issueCount(offenders)}`;
}

/**
 * The all-or-nothing sentence, for the issues the refusal did not name.
 *
 * @param selected How many issues were sent.
 * @param offenders How many the refusal named.
 * @returns Why the rest were not queued either, or `null` when there was no rest.
 */
export function leftOutNote(selected: number, offenders: number): string | null {
  const rest = selected - offenders;
  if (rest <= 0) return null;

  return `The queue takes a selection whole or not at all, so the other ${issueCount(rest)} ${
    rest === 1 ? "was" : "were"
  } left out with ${offenders === 1 ? "it" : "them"}.`;
}

/**
 * How an offender is named in a sentence.
 *
 * @param offender The entry.
 * @param seen The rows as the table last saw them — where a `404`'s number comes from, since
 *   the entry itself carries none.
 * @returns `#483`, or `null` when nothing on this page knows the issue's number.
 */
function nameOf(offender: Offender, seen: SeenRowMap): string | null {
  const number = offender.issueNumber ?? seen.get(offender.issueId)?.number ?? null;

  return number === null ? null : `#${number}`;
}

/**
 * What is wrong with one issue, as a sentence that names it.
 *
 * @param offender The entry.
 * @param seen The rows as the table last saw them.
 * @returns One sentence — *"#483 is still being sized."* — from the entry's code and status;
 *   an issue nothing here can name is *"One of the selected issues …"*.
 */
export function offenderLine(offender: Offender, seen: SeenRowMap): string {
  const name = nameOf(offender, seen);
  const subject = name ?? "One of the selected issues";

  switch (offender.code) {
    case QUEUE_ISSUE_CODES.notSized:
      switch (offender.sizingStatus) {
        case "estimating":
          return `${subject} is still being sized.`;
        case "needs_human":
          return `${subject} needs a human before it can be queued.`;
        default:
          return `${subject} has not been sized yet.`;
      }
    case QUEUE_ISSUE_CODES.estimateMissing:
      return `${subject} has lost its estimate — re-estimate it first.`;
    case QUEUE_ISSUE_CODES.alreadyQueued:
      return `${subject} is already in the queue.`;
    case QUEUE_ISSUE_CODES.numberTaken:
      return `${subject} is two issues in this selection — two repositories share that number, and the queue takes one.`;
    case QUEUE_ISSUE_CODES.notFound:
      return `${subject} is not in this workspace.`;
    default:
      return `${subject} cannot be queued.`;
  }
}

/* ------------------------------------------------------------------ the toast */

/**
 * What a press that took says.
 *
 * @param queued The service's answer.
 * @returns `Queued 3 issues · est. 2h 5m combined autonomous work.` — counted and summed
 *   from the rows the service created, never from the preview — or without the estimate when
 *   the sum is nothing, which the contract reserves for rows carrying no estimate at all.
 */
export function queuedToast(queued: QueuedSelection): string {
  const count = `Queued ${issueCount(queued.items.length)}`;

  return queued.estMinutes > 0
    ? `${count} · est. ${durationOfMinutes(queued.estMinutes)} combined autonomous work.`
    : `${count}.`;
}

/** The toast's link: where the queued issues can be seen. */
export const SEE_QUEUE_LABEL = "See them on the dashboard →";

/** The toast's dismissal. */
export const DISMISS_LABEL = "Dismiss";

/** Where the toast's link goes: the dashboard, at its *Up next in queue* card. */
export const DASHBOARD_QUEUE_HREF = `${DASHBOARD_PATH}#${DASHBOARD_QUEUE_HASH}`;
