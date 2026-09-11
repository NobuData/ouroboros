/**
 * The backlog table's copy and its decisions — every word mockup 03's `BACKLOG · AS OUROBOROS
 * SEES IT` card prints, and every judgement about a row, as data and pure functions
 * ([#117](https://github.com/NobuData/ouroboros/issues/117)).
 *
 * `app/issues/backlog-table.tsx` draws, and this decides: which pill a row wears and in
 * which hue, what an unsized row's cells say, what the freshness tag reads, whether the
 * header's checkbox is checked, and what a sync press came back as. Framework-free and
 * deliberately not `server-only`, the way `app/issues/view.ts` is: the table is a Client
 * Component, its Server Action answers with these sentences, and the suite reads the mockup
 * to hold the copy to it.
 *
 * ### The row is M.1's, and two of its cells cannot be the mockup's
 *
 * The mockup's `#483` is `estimating…` and still shows `standard-fix` and `claude-sonnet-5`
 * in its workflow and model cells. Those two are not storable: an estimate is one answer, not
 * four fields that arrive separately (`issue_estimates` makes every one `not null`), and an
 * issue mid-flight has none. So a row without an estimate prints the mockup's `sizing…` in
 * the effort cell — a placeholder the ticket asks for by name — and an em dash in the two
 * cells whose values would have to be invented, which is the design system's rule for a
 * figure nobody has (§ 3.5: *a computed number or an em dash*). The seed's own header
 * (`R__dev_seed_intake.sql`) records the same decision from the data's side.
 *
 * ### Five pipeline states, not four
 *
 * The ticket names four pills — `sized`, `queued`, `estimating…`, `needs human` — and M.1's
 * row carries a fifth fact: `unsized`, an issue the sync has mirrored and the pipeline has not
 * yet picked up. The mockup has no such row, because its nine issues are all past that point,
 * but a real backlog has one for a few seconds after every sync. It is drawn in the neutral
 * hue under its own word rather than folded into `sized`: a pill that read *sized* over an
 * issue with no estimate would be the one dishonest thing in the column.
 */

import type { BacklogEstimate, BacklogListing, BacklogRow, SyncStatus } from "@/app/api/backlog";
import type { ChipTone, Effort } from "@/app/ui/chip";

import type { HeadOutcome } from "./view";

/* ------------------------------------------------------------------ copy, from the mockup */

/**
 * The card's title. The mockup writes it in capitals; the card head's own treatment
 * (`ou-card__title`) is what capitalises it, so the string is written the way a heading is.
 */
export const TABLE_TITLE = "Backlog · as Ouroboros sees it";

/**
 * The table's own name, for a reader moving between tables by landmark. Hidden, because the
 * card's heading is directly above it — but present, because a heading outside a table is
 * not the table's accessible name.
 */
export const TABLE_CAPTION = "The backlog, one issue per row";

/** The five column headings the mockup prints, in its order, after the checkbox column. */
export const COLUMN_HEADERS = {
  issue: "Issue",
  effort: "Effort",
  workflow: "Suggested workflow",
  model: "Routed model",
  status: "Status",
} as const;

/** The header checkbox's name — it selects every row on this page, not every row there is. */
export const SELECT_ALL_LABEL = "Select every issue on this page";

/**
 * A row checkbox's name.
 *
 * @param number The issue's number.
 * @returns `Select #485`.
 */
export function selectLabel(number: number): string {
  return `Select #${number}`;
}

/** What the effort cell says for an issue with no estimate yet — verbatim from the mockup. */
export const SIZING = "sizing…";

/**
 * What the workflow and model cells say for an issue with no estimate — the design system's
 * em dash for a figure nobody has, rather than a value invented to match the mockup.
 */
export const UNESTIMATED = "—";

/* ------------------------------------------------------------------ the status pill */

/** Where an issue is, as the *Status* column reports it. */
export type BacklogStatus = BacklogRow["sizingStatus"] | "queued";

/**
 * Which pill a row wears.
 *
 * `queued` first: the contract says a client rendering a single pill renders it in
 * preference, because *where the loop will pick the issue up* is the more recent fact about
 * it than *how it was sized* — an issue can be `needs_human` and queued at once.
 *
 * @param row One row of the listing.
 * @returns Its status.
 */
export function statusOf(row: Pick<BacklogRow, "queued" | "sizingStatus">): BacklogStatus {
  return row.queued ? "queued" : row.sizingStatus;
}

/**
 * What each status is called, as the mockup prints the four it draws — the contract's own
 * words, with `needs_human`'s underscore taken out and `estimating`'s ellipsis put on.
 */
export const STATUS_LABEL: Record<BacklogStatus, string> = {
  queued: "queued",
  sized: "sized",
  estimating: "estimating…",
  needs_human: "needs human",
  unsized: "unsized",
};

/**
 * The hue each status takes — the ticket's map: `sized`/neutral, `queued`/run (the accent,
 * which is what the mockups' `.pill.run` is), `estimating…`/warn, `needs human`/err. All four
 * are real pipeline states; none is decoration. `unsized` is neutral, for the module note's
 * reason.
 */
export const STATUS_TONE: Record<BacklogStatus, ChipTone> = {
  queued: "accent",
  sized: "neutral",
  estimating: "warn",
  needs_human: "err",
  unsized: "neutral",
};

/* ------------------------------------------------------------------ the row */

/**
 * What each of the contract's sizes is called on the chip — the whole of the difference
 * between the column and the mockup, as `app/dashboard/view.ts` keeps it for the queue card.
 * The detail panel's *Effort* row ([#119](https://github.com/NobuData/ouroboros/issues/119))
 * reads the same map, so the chip in the panel is the chip in the row.
 */
export const EFFORT_LABEL: Record<BacklogEstimate["effort"], Effort> = {
  xs: "XS",
  s: "S",
  m: "M",
  l: "L",
  xl: "XL",
};

/** One row, as the table draws it — every field already the thing its cell renders. */
export interface TableRow {
  /** The row's identity on this API — the React key, what the selection collects. */
  readonly id: string;
  /** The number GitHub assigned — the `#485` the cell prints. */
  readonly number: number;
  /** The title as GitHub currently has it. */
  readonly title: string;
  /** GitHub's labels, in the order they are stored — the tags under the title. */
  readonly labels: readonly string[];
  /** The effort chip, or `null` for an issue with no estimate — drawn as {@link SIZING}. */
  readonly effort: Effort | null;
  /** The mono figure beside the chip — `92%` — or `null` with the chip. */
  readonly confidence: string | null;
  /** The suggested workflow tag, or `null` — drawn as {@link UNESTIMATED}. */
  readonly workflow: string | null;
  /** The routed model pill, or `null` — drawn as {@link UNESTIMATED}. */
  readonly model: string | null;
  /**
   * The estimate's `estMinutes`, or `null` with the rest — drawn by no cell. It rides the row
   * for the selection bar ([#118](https://github.com/NobuData/ouroboros/issues/118)), which
   * sums it over the rows a person ticked.
   */
  readonly estMinutes: number | null;
  /** Which pill the row wears. */
  readonly status: BacklogStatus;
}

/**
 * The listing's rows, as the table's.
 *
 * The order is the payload's — M.1 sorts the whole view under the bar's `sort` — and it is
 * deliberately not re-sorted here, for the reason the dashboard's tables are not: a client
 * that re-sorted its page would produce a different order from the pages either side of it.
 *
 * @param items The listing's `items`.
 * @returns The rows, in the order they are drawn.
 */
export function tableRows(items: readonly BacklogRow[]): readonly TableRow[] {
  return items.map((row) => ({
    id: row.id,
    number: row.number,
    title: row.title,
    labels: row.labels,
    effort: row.estimate === null ? null : EFFORT_LABEL[row.estimate.effort],
    confidence: row.estimate === null ? null : `${Math.round(row.estimate.confidence)}%`,
    workflow: row.estimate?.suggestedWorkflow ?? null,
    model: row.estimate?.routedModel ?? null,
    estMinutes: row.estimate?.estMinutes ?? null,
    status: statusOf(row),
  }));
}

/* ------------------------------------------------------------------ select all */

/** How much of the page the selection covers — what the header's checkbox draws. */
export type Coverage =
  /** No row on the page is selected — or there are no rows. */
  | "none"
  /** Some are, some are not: the checkbox is indeterminate. */
  | "some"
  /** Every row on the page is selected. */
  | "all";

/**
 * How much of the page the selection covers.
 *
 * @param visible The ids of the rows on the page, in order.
 * @param selected The selection's ids.
 * @returns The coverage. An empty page is `none`: a checked header over no rows would claim a
 *   selection of nothing.
 */
export function coverage(visible: readonly string[], selected: readonly string[]): Coverage {
  if (visible.length === 0) return "none";

  const count = visible.filter((id) => selected.includes(id)).length;

  return count === 0 ? "none" : count === visible.length ? "all" : "some";
}

/* ------------------------------------------------------------------ the pill swap */

/**
 * Which rows changed status between one listing and the next — the pills to animate.
 *
 * A row is *swapped* once it has been seen in two statuses, and stays so: the animation
 * plays when the pill is remounted, which the table does by keying the pill on the status,
 * so a row that has changed once carries the class and animates on every change after.
 * Rows seen for the first time — the first render, a page turn, a filter change — are not
 * swapped, which is what keeps every pill on a fresh page from fading in at once.
 *
 * @param seen The statuses as last drawn, by row id.
 * @param rows The rows about to be drawn.
 * @param swapped The rows already known to have changed.
 * @returns The statuses to remember, and the rows now known to have changed.
 */
export function statusChanges(
  seen: ReadonlyMap<string, BacklogStatus>,
  rows: readonly TableRow[],
  swapped: ReadonlySet<string>,
): { readonly seen: ReadonlyMap<string, BacklogStatus>; readonly swapped: ReadonlySet<string> } {
  const next = new Map<string, BacklogStatus>();
  const changed = new Set(swapped);

  for (const row of rows) {
    const before = seen.get(row.id);
    if (before !== undefined && before !== row.status) changed.add(row.id);
    next.set(row.id, row.status);
  }

  return { seen: next, swapped: changed };
}

/* ------------------------------------------------------------------ the freshness tag */

/** What the tag says over a backlog no sync has ever stamped. */
export const NEVER_SYNCED = "never synced";

/** What the tag says while a press of it is in flight. */
export const SYNCING = "syncing…";

/** Why a member may press the tag — its tooltip. */
export const SYNC_TITLE = "Sync the backlog from GitHub now";

/** Why a viewer's tag is inert. A `403` for a press that went around it says the same. */
export const SYNC_ROLE_REASON =
  "Syncing the backlog is for workspace owners, admins and members — a viewer can read the " +
  "backlog but not ask GitHub for it again.";

/** Seconds in a minute, an hour and a day, for the relative age. */
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago an instant was, in the coarsest unit that is still honest — the mockup's
 * `40s`, then `3m`, `2h`, `5d`.
 *
 * Whole units, rounded down: `59s` is not yet a minute, and a tag that read `1m` over a sync
 * fifty-nine seconds old would be claiming a freshness the backlog does not have — the same
 * direction M.4 rounds in by taking the *oldest* repository's stamp.
 *
 * @param seconds How many seconds ago. A negative one — two clocks disagreeing — reads as
 *   now, which is what a stamp in the future means.
 * @returns `40s`, `3m`, `2h` or `5d`.
 */
export function age(seconds: number): string {
  const elapsed = Math.max(0, Math.floor(seconds));

  if (elapsed < MINUTE) return `${elapsed}s`;
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  return `${Math.floor(elapsed / DAY)}d`;
}

/**
 * What the freshness tag reads.
 *
 * @param syncedAt M.1's `meta.syncedAt` — the oldest successful poll among the enabled
 *   repositories, or `null` while any of them has never been polled.
 * @param nowSeconds What time it is, in whole seconds since the epoch — the reader's own
 *   clock, ticking (`app/shell/clock.ts`), or the server's reading of it on the first paint.
 * @returns `synced 40s ago`, or {@link NEVER_SYNCED} — also for a stamp that cannot be read,
 *   which every stamp in the contract can, so that is the guard rather than the expected case.
 */
export function syncedLabel(syncedAt: string | null, nowSeconds: number): string {
  if (syncedAt === null) return NEVER_SYNCED;

  const stamped = Date.parse(syncedAt);
  if (Number.isNaN(stamped)) return NEVER_SYNCED;

  return `synced ${age(nowSeconds - stamped / 1000)} ago`;
}

/** What a sync press that took says. The tag moves when the listing's `meta` does. */
export const SYNC_STARTED = "Syncing now. The tag moves when the cycle finishes.";

/** What a press answered `backlog_sync_running` says — the thing asked for is happening. */
export const SYNC_RUNNING = "A sync is already running. The tag moves when it finishes.";

/** What a refused press says when the service gave no sentence of its own. */
export const SYNC_FAILED = "The backlog could not be synced.";

/**
 * What a press within the minimum interval of the last cycle says.
 *
 * @param retryAfterSeconds The refusal's `details.retryAfterSeconds`, as it arrived —
 *   `unknown`, because `details` is an open map and a value that is not a positive number is
 *   not a wait anybody can act on.
 * @returns The sentence, with the wait in whole seconds when there is one to give.
 */
export function syncTooSoon(retryAfterSeconds: unknown): string {
  const wait =
    typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? `in ${Math.ceil(retryAfterSeconds)} ${Math.ceil(retryAfterSeconds) === 1 ? "second" : "seconds"}`
      : "shortly";

  return `The backlog was synced moments ago. Try again ${wait}.`;
}

/**
 * What a sync press that took says, from what the service answered.
 *
 * @param status The status at the moment the cycle started.
 * @returns {@link SYNC_STARTED} while the cycle it started is running — which is what a `202`
 *   means — and the service's own sentence when the loop is paused and the press could start
 *   nothing that will move the tag.
 */
export function syncOutcome(status: SyncStatus): HeadOutcome {
  if (status.state === "paused" && status.message !== null) {
    return { ok: false, reason: status.message };
  }

  return { ok: true, message: SYNC_STARTED };
}

/* ------------------------------------------------------------------ what the table says instead of rows */

/** What the card says when the read the page was drawn from failed. */
export const BACKLOG_UNREAD = "The backlog could not be read";

/** What the card says when the filter matched nothing. */
export const NO_MATCHES = "No issues match this filter";

/** The note under {@link NO_MATCHES} — what would put a row here. */
export const NO_MATCHES_NOTE =
  "Turn a label chip off, widen the state, or clear the search to see more of the backlog.";

/** What the card says when the workspace mirrors no issue at all. */
export const NOTHING_MIRRORED = "No issues yet";

/**
 * The note under {@link NOTHING_MIRRORED}. The guidance for *why* — no token, no enabled
 * repository, a sync that is paused — is N.6's ([#120](https://github.com/NobuData/ouroboros/issues/120));
 * this is the sentence until then.
 */
export const NOTHING_MIRRORED_NOTE =
  "Issues appear here once an enabled repository has been synced from GitHub.";

/** What is said, under the rows, when the poll that keeps them fresh stopped succeeding. */
export const REFRESH_FAILED = "The backlog stopped refreshing.";

/**
 * Which of the two empty states a page with no rows is in.
 *
 * *Nothing matched* and *nothing mirrored* are different facts and must not read alike: the
 * first sends a reader to the filter bar and the second to a repository. The listing's `meta`
 * tells them apart — its counts are scoped by `repo` alone, so a workspace (or a repository)
 * that mirrors nothing counts zero open and zero sized whatever the chips say — except when
 * the bar asks for closed issues, where `openCount` says nothing about what was asked for and
 * the view's own `total` has to decide.
 *
 * @param listing The page's listing.
 * @param filtered Whether anything differs from the default view.
 * @returns `matches` when narrowing is what emptied the page, else `mirrored`.
 */
export function emptyKind(
  listing: Pick<BacklogListing, "meta" | "total">,
  filtered: boolean,
): "matches" | "mirrored" {
  return filtered && listing.meta.openCount > 0 ? "matches" : "mirrored";
}
