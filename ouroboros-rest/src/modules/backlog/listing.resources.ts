/**
 * One backlog row, the page head's counts, and the chip set — as JSON
 * (M.1, [#110](https://github.com/NobuData/ouroboros/issues/110)).
 *
 * Three shapes in one answer, because mockup 03 draws three things from one query and the
 * ticket's reason for that is the one worth keeping: *"the page head and freshness tag read
 * from the same query as the rows, so the numbers can never disagree with the list"*. A screen
 * that fetched `42 open issues. 38 already sized.` separately from the rows would eventually
 * render a head that counted a sync the table had not seen.
 *
 * ## The estimate is one object or nothing, and that is the contract
 *
 * The ticket's diagram lists `effort`, `confidence`, `suggestedWorkflow` and `routedModel`
 * beside each other, and they are published here as {@link BacklogRow.estimate} instead — the
 * same four fields, grouped. The reason is a property the flat shape cannot state: an issue has
 * a latest estimate or it has none, and there is no row with an effort and no confidence.
 * `issue_estimates` makes both columns `not null` (V026), so *"four nulls"* and *"no estimate"*
 * are the same fact written twice, and a renderer that tested `effort !== null` before reading
 * `confidence` would be carrying a check the database already made. N.3
 * ([#117](https://github.com/NobuData/ouroboros/issues/117))'s unsized row is one branch on one
 * field.
 *
 * ## What a row deliberately does not carry
 *
 * The ticket's scope is *"exactly what the table's cells need, no more"*, and the table's cells
 * are mockup 03's six columns: the checkbox, the issue (number, title, labels), effort with its
 * confidence, the suggested workflow, the routed model and the status pill. So there is no body,
 * no author and no `gh_url` here — those are the side panel's, and M.2
 * ([#111](https://github.com/NobuData/ouroboros/issues/111)) serves them for the one issue that
 * is open rather than for every row of a page nobody has clicked.
 *
 * There is no timestamp either, including under `sort=updated`. The ordering is the answer that
 * sort gives; the table has no *updated* column to print, and a field added for a cell that
 * does not exist is a field this endpoint would then have to keep.
 *
 * **The repository is carried, and it is not a cell.** `github_issues_repo_number_key` is
 * `(github_repo_id, number)` — every repository has its own `#489` — so in a listing that
 * names no `repo` the number alone does not identify a row, and two rows labelled `#489` with
 * nothing to tell them apart would be the table lying about its own contents. It is also the
 * value the *Repository* select sets, so a client can narrow from a row it is looking at.
 */

import type { EstimateEffort, GithubIssueState, SizingStatus } from "../db/schema";
import type { BacklogListRow } from "./listing.repository";
import type { Page } from "../tenancy/pagination";

/** The latest estimate of one issue, as the *Effort*, *Suggested workflow* and *Routed model* cells read it. */
export interface BacklogEstimate {
  /** The *Effort* chip — `xs`–`xl`, lower-case as the column holds it. */
  readonly effort: EstimateEffort;
  /** The percentage beside it, 0–100. */
  readonly confidence: number;
  /** The *Suggested workflow* tag. Opaque (decision **K5**). */
  readonly suggestedWorkflow: string;
  /** The *Routed model* pill. Opaque (decision **K6**), and resolved rather than invoked. */
  readonly routedModel: string;
}

/** One row of `BACKLOG · AS OUROBOROS SEES IT`. */
export interface BacklogRow {
  /**
   * `github_issues.id` — the row's identity on this API.
   *
   * What the selection model collects, what M.2's panel is addressed by, and what M.3's bulk
   * queue action sends back. Not the issue number, which is GitHub's and is unique only inside
   * its repository.
   */
  readonly id: string;
  /** The number GitHub assigned — the `#485` the cell prints. */
  readonly number: number;
  /** The title as GitHub currently has it (decision **K3**: mirrored, never edited here). */
  readonly title: string;
  /** GitHub's label names, in the order they are stored — the tags under the title. */
  readonly labels: readonly string[];
  /** GitHub's own two. Present on every row because a listing may be asked for `closed` or `all`. */
  readonly state: GithubIssueState;
  /** The *Status* pill: where the issue is in *our* sizing pipeline (decision **K4**). */
  readonly sizingStatus: SizingStatus;
  /** `github_repos.id` — what `?repo=` takes, so a row can narrow the listing it came from. */
  readonly githubRepoId: string;
  /** `owner/name`, as GitHub spells it. See this file's header on why a row carries it. */
  readonly repository: string;
  /** The estimate in force, or `null` for an issue that has none — see this file's header. */
  readonly estimate: BacklogEstimate | null;
}

/**
 * The page head, and the freshness tag.
 *
 * ## The counts describe the backlog; the rows describe the filter
 *
 * `openCount` and `sizedCount` are scoped by the workspace and by `?repo=` and **by nothing
 * else** — not by `state`, not by the chip set, not by the search. Mockup 03 puts them in the
 * page head, *above* the `.filter-bar` card, and that placement is the specification: the head
 * says how much work is in the backlog, the table says which of it you are looking at. Counts
 * that moved as chips were toggled would make *"38 already sized"* a statement about the filter
 * rather than about the repository, and toggling `state=closed` would leave the head reading
 * *"0 open issues"* over a full table.
 *
 * `total` on the page beside them is the filtered count — how many rows the listing has — so a
 * client has both numbers and neither has to be inferred from the other.
 *
 * **`sizedCount` counts open issues that are `sized`**, which is what makes *"9 open issues. 7
 * already sized."* one sentence about one set rather than two unrelated figures. An issue that
 * was sized and then closed is in neither number.
 */
export interface BacklogMeta {
  /** Open issues in scope — the head's first figure. */
  readonly openCount: number;
  /** How many of those carry a `sized` status — the head's second figure. */
  readonly sizedCount: number;
  /**
   * The freshness tag's instant — *"synced 40s ago"* — or `null` when it cannot be claimed.
   *
   * The **oldest** successful poll among the workspace's enabled repositories, lifted from
   * `SyncStatusService` rather than read again here, so the tag beside this listing and the tag
   * from `GET /api/v1/backlog/sync-status` are one number. `sync.resources.ts` carries the
   * argument for the oldest rather than the newest, and for `null` while any enabled repository
   * has never been polled.
   *
   * A stored column every time, never this request's clock — which is the ticket's own
   * criterion. A request timestamp would read as *"synced just now"* on a sync that last ran
   * yesterday.
   */
  readonly syncedAt: string | null;
}

/**
 * `GET /api/v1/backlog` — a page of rows, the head's counts, and the chips that exist.
 *
 * Extends the #31 page convention rather than restating it, so `items`, `total`, `limit` and
 * `offset` mean here exactly what they mean on every other listing in this API.
 */
export interface BacklogListing extends Page<BacklogRow> {
  /** The page head and the freshness tag. */
  readonly meta: BacklogMeta;
  /**
   * Every distinct label in scope, ascending — the chip set N.2
   * ([#116](https://github.com/NobuData/ouroboros/issues/116)) renders.
   *
   * Scoped exactly as {@link BacklogMeta}'s counts are: the workspace, and `?repo=` if one
   * narrows it. **Not** scoped by the chip set itself, and that is the whole reason the facets
   * are computed separately from the rows — `labels=bug` ANDed against the facets would leave
   * only the labels that co-occur with `bug`, so selecting a first chip would delete most of
   * the set it was selected from and a second chip could never be chosen. The mockup's chips
   * are a stable set with one of them on.
   *
   * Sorted by name rather than by frequency: the chip set is a set a person scans for a name
   * they already have in mind, and a set that reorders itself as the backlog changes is one
   * they have to scan twice.
   */
  readonly labelFacets: readonly string[];
}

/**
 * One row, as the API publishes it.
 *
 * A pure function over what the statement returned, for `dashboard/resources.ts`' reason: the
 * mapping is the contract, and a contract worth testing is worth testing without a database.
 * The four estimate columns collapse into one object here and nowhere else, so *"an issue has
 * an estimate or it has none"* is asserted in a single place.
 *
 * @param row - The joined issue and its latest estimate, or four nulls where there is none.
 * @returns The row, JSON-safe.
 */
export function backlogRow(row: BacklogListRow): BacklogRow {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    labels: row.labels,
    state: row.state,
    sizingStatus: row.sizingStatus,
    githubRepoId: row.githubRepoId,
    repository: row.repository,
    estimate: estimateOf(row),
  };
}

/**
 * The estimate in force, or `null` for an issue that has none.
 *
 * All four columns are tested rather than one. They are null **together** — the lateral either
 * matched a row, and V026 makes every one of these columns `not null`, or it matched nothing —
 * so any single test would be enough at run time. Testing the four is what lets the returned
 * object be built from narrowed values instead of from a cast or from invented defaults, and a
 * fallback like `confidence ?? 0` would be this file publishing a number no estimator produced.
 *
 * @param row - The joined row.
 * @returns The four fields as one object, or `null`.
 */
function estimateOf(row: BacklogListRow): BacklogEstimate | null {
  const { effort, confidence, suggestedWorkflow, routedModel } = row;

  if (
    effort === null ||
    confidence === null ||
    suggestedWorkflow === null ||
    routedModel === null
  ) {
    return null;
  }

  return { effort, confidence, suggestedWorkflow, routedModel };
}
