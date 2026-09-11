/**
 * The backlog — what mockup 03's `/issues` reads from `ouroboros-rest`, and the writes its page
 * head and its detail panel make.
 *
 * Six operations of the `backlog` tag in one module, for the reason `app/api/routing.ts` is one
 * module: they are one screen's calls. `GET /api/v1/backlog`
 * ([#110](https://github.com/NobuData/ouroboros/issues/110)) is the listing the head's counts,
 * the filter bar and the table are drawn from; `GET /api/v1/backlog/{id}`
 * ([#111](https://github.com/NobuData/ouroboros/issues/111)) is the one issue the detail panel
 * draws ([#119](https://github.com/NobuData/ouroboros/issues/119));
 * `POST /api/v1/backlog/estimate-all` ([#108](https://github.com/NobuData/ouroboros/issues/108))
 * is **Re-estimate all** and `POST /api/v1/backlog/{id}/estimate` the panel's **Re-estimate**;
 * `POST /api/v1/backlog/queue` ([#112](https://github.com/NobuData/ouroboros/issues/112)) is
 * **Queue N selected ⟳** — and the selection bar's and the detail panel's queue buttons after it,
 * because the contract makes all three one write; and `POST /api/v1/backlog/sync`
 * ([#113](https://github.com/NobuData/ouroboros/issues/113)) is the table's freshness tag, pressed
 * ([#117](https://github.com/NobuData/ouroboros/issues/117)).
 *
 * ### The role gates are the service's
 *
 * Reading is every member's, `viewer` included — the listing and the one issue alike, since
 * opening a panel spends nothing. Queueing, syncing and re-estimating one issue are `owner`,
 * `admin` or `member`; re-estimating the whole backlog is `owner` or `admin`, because one press
 * spends the workspace's engine quota. This module enforces none of it: a check made in the
 * browser is a check anybody can skip, so what the screen does with a role is presentation, and
 * {@link FORBIDDEN_CODE} is what a press that went around it is answered with.
 *
 * ### The workspace is the session's
 *
 * No workspace in any path, and this client sends no `X-Ouro-Tenant` (`app/api/server.ts` says
 * why), so every call is scoped to the session's active organization.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components, operations } from "@/app/api/schema";
import { api } from "@/app/api/server";

/**
 * One page of the backlog: the rows, the filtered `total`, the head's `meta` and the chip set.
 *
 * `meta.openCount` and `meta.sizedCount` are **not** narrowed by the filter — the head says how
 * much work there is — while `total` is. The page head leans on that difference; see
 * `app/issues/data.ts`.
 */
export type BacklogListing = components["schemas"]["BacklogListing"];

/**
 * One row of the listing: the issue as GitHub has it, where it is in the sizing pipeline, whether
 * the queue holds it, and the estimate in force — the table's cells and no more.
 */
export type BacklogRow = components["schemas"]["BacklogRow"];

/**
 * The estimate in force on one row — the *Effort*, *Suggested workflow* and *Routed model* cells.
 * `null` on the row for an issue that has none.
 */
export type BacklogEstimate = components["schemas"]["BacklogEstimate"];

/** The query the listing accepts: every control the filter bar draws, plus the page. */
export type BacklogQuery = NonNullable<operations["listBacklog"]["parameters"]["query"]>;

/**
 * One issue in full — mockup 03's `ISSUE DETAIL` panel in one answer
 * ([#111](https://github.com/NobuData/ouroboros/issues/111)): the issue as GitHub has it, the
 * estimate in force, and every version the issue has been estimated at, oldest first.
 *
 * `estimate` is `null` for an issue nothing has sized — `unsized`, or `estimating` before its
 * first answer lands — with every other field still there to draw; `history` is `[]` for the
 * same fact. The two come from one read, so they cannot disagree.
 */
export type IssueDetail = components["schemas"]["IssueDetail"];

/**
 * The issue as the panel's head, tags and excerpt read it: a {@link BacklogRow} without its
 * summary estimate, plus the body, the author, the opening instant and the GitHub URL.
 */
export type BacklogIssueDetail = components["schemas"]["BacklogIssueDetail"];

/**
 * The estimate in force, in full — everything the panel draws below the excerpt, where
 * {@link BacklogEstimate} is the four-field summary a table cell needs.
 */
export type IssueEstimateDetail = components["schemas"]["IssueEstimateDetail"];

/** The *AI Work Breakdown*'s numbers: the files, the tokens, the cycle range, the minutes. */
export type IssueEstimateBreakdown = components["schemas"]["IssueEstimateBreakdown"];

/**
 * Where the estimate came from — decision K10 as a shape: what produced it, when, what it
 * cost, and what it was reached from.
 */
export type IssueEstimateTrace = components["schemas"]["IssueEstimateTrace"];

/** One entry of the version list: the version, what produced it, and when the row was written. */
export type EstimateVersion = components["schemas"]["EstimateVersion"];

/**
 * What one press of the panel's **Re-estimate** answers: the issue, and the status it is now in
 * — `estimating`, already true when the answer is sent.
 */
export type EstimationAccepted = components["schemas"]["EstimationAccepted"];

/**
 * What one press of **Re-estimate all** answers: `enqueued` issues claimed and queued, `skipped`
 * left alone — in practice the ones already in flight — and the `total` the workspace mirrors.
 * The three cannot disagree: `skipped` is `total` less `enqueued`.
 */
export type EstimationFanout = components["schemas"]["EstimationFanout"];

/** A selection to queue: `github_issues.id`s in the order to append them, and an optional workflow. */
export type QueueSelection = components["schemas"]["QueueSelection"];

/**
 * A workflow the queue write accepts — the fixed set (decision K5), exactly as the contract
 * enumerates it, so the selection bar's menu ([#118](https://github.com/NobuData/ouroboros/issues/118))
 * cannot offer a tag the service would refuse.
 */
export type QueueWorkflow = NonNullable<QueueSelection["workflow"]>;

/** What one press of a queue button answers: the rows created, and their combined estimate. */
export type QueuedSelection = components["schemas"]["QueuedSelection"];

/**
 * What a sync press answers: the freshness instant, whether the loop is paused and why, whether a
 * cycle is in flight, and a row per enabled repository.
 */
export type SyncStatus = components["schemas"]["SyncStatus"];

/** The code a role that may read the backlog, but not do what it pressed, is answered with. */
export const FORBIDDEN_CODE = "forbidden";

/**
 * The code a sync press is answered with while a cycle is already in flight. It carries no
 * `retryAfterSeconds` — how long a cycle takes is not knowable in advance — and the thing asked
 * for is happening, so the honest response is to watch the tag rather than press again.
 */
export const BACKLOG_SYNC_RUNNING_CODE = "backlog_sync_running";

/**
 * The code a sync press is answered with when a cycle ran less than the minimum interval ago.
 * `details.retryAfterSeconds` says how long until another may start.
 */
export const BACKLOG_SYNC_TOO_SOON_CODE = "backlog_sync_too_soon";

/**
 * The code a second **Re-estimate all** is answered with while the first is still running: every
 * issue was already `estimating`, so the request claimed nothing. A `409` rather than a `202` of
 * zeros, because *accepted* would be a claim about work this request started.
 */
export const BACKLOG_ALREADY_ESTIMATING_CODE = "backlog_already_estimating";

/**
 * The code a workspace past its per-minute estimates is answered with.
 * `details.retryAfterSeconds` says how long until the window has room.
 */
export const ESTIMATION_RATE_LIMITED_CODE = "estimation_rate_limited";

/**
 * The code an id this workspace cannot see is answered with — by the one-issue read and by
 * the single re-estimate alike. An issue in another workspace is this, never a `403`: a `403`
 * would confirm that the id names a real issue somewhere.
 */
export const ISSUE_NOT_FOUND_CODE = "issue_not_found";

/**
 * The code a **Re-estimate** press is answered with while an estimate for that issue is already
 * in flight. The estimate in flight will finish and write its version; the panel is already
 * following it.
 */
export const ISSUE_ALREADY_ESTIMATING_CODE = "issue_already_estimating";

/**
 * The three codes a queue press is refused with, and the per-issue codes inside them.
 *
 * Every refusal of `POST /api/v1/backlog/queue` names its offenders: `details.issues` carries
 * one entry per issue — the id the caller sent, a code for what is wrong with that row, and
 * its number and status where this workspace's own row supplied them. The write is one
 * transaction, so any of the three means nothing was queued, and the selection bar
 * ([#118](https://github.com/NobuData/ouroboros/issues/118)) names the issues rather than
 * showing a generic failure.
 */
export const QUEUE_ISSUES_NOT_FOUND_CODE = "queue_issues_not_found";

/** The queue already holds one or more of the selection — see {@link QUEUE_ISSUES_NOT_FOUND_CODE}. */
export const QUEUE_ISSUES_CONFLICT_CODE = "queue_issues_conflict";

/**
 * One or more of the selection is not `sized` — see {@link QUEUE_ISSUES_NOT_FOUND_CODE}. The
 * per-issue codes inside all three are `app/issues/bar.ts`'s `QUEUE_ISSUE_CODES`, which the
 * Client Component that words them can import.
 */
export const QUEUE_ISSUES_NOT_QUEUEABLE_CODE = "queue_issues_not_queueable";

/** The backlog, as `ouroboros-rest` serves it. */
export const backlog = {
  /**
   * One page of the backlog, filtered, sorted and searched.
   *
   * @param query The filter bar's parameters and the page, every one optional — the service's
   *   defaults are `state=open`, `sort=effort` and `limit=25`.
   * @param client The client to call through. Defaults to the server-side one; tests pass one
   *   over a stub `fetch`.
   * @param signal A way to give up on the read. The route handler that answers the table's poll
   *   passes a timeout (`app/api/backlog-page.ts`), because a poll never overlaps itself and a read
   *   that never resolved would stop the loop rather than merely slow it; a render passes none.
   * @returns The listing: rows, filtered total, the head's counts and the chip set.
   * @throws {ApiError} What the service answered.
   */
  async list(
    query: BacklogQuery = {},
    client: ApiClient = api(),
    signal?: AbortSignal,
  ): Promise<BacklogListing> {
    return unwrap(await client.GET("/api/v1/backlog", { params: { query }, signal }));
  },

  /**
   * One issue, in full — everything the detail panel draws
   * ([#119](https://github.com/NobuData/ouroboros/issues/119)).
   *
   * @param id The issue's `github_issues.id` — the `id` a backlog row carries, never GitHub's
   *   number, which a workspace watching two repositories can hold twice.
   * @param client The client to call through. Defaults to the server-side one.
   * @param signal A way to give up on the read — the route handler answering the panel's poll
   *   passes a timeout (`app/api/backlog-detail.ts`), for the reason the listing's does.
   * @returns The issue, the estimate in force or `null`, and the version list.
   * @throws {ApiError} What the service answered — {@link ISSUE_NOT_FOUND_CODE} for an id this
   *   workspace cannot see.
   */
  async detail(id: string, client: ApiClient = api(), signal?: AbortSignal): Promise<IssueDetail> {
    return unwrap(await client.GET("/api/v1/backlog/{id}", { params: { path: { id } }, signal }));
  },

  /**
   * Re-estimate one issue — the detail panel's **Re-estimate**
   * ([#108](https://github.com/NobuData/ouroboros/issues/108)).
   *
   * @param id The issue's `github_issues.id`.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The issue and its status, which is `estimating` and already true: the row is moved
   *   before the work is queued. The new version lands when the pipeline finishes, and what a
   *   client watches for is the issue's status moving on.
   * @throws {ApiError} What the service answered — {@link FORBIDDEN_CODE} for a `viewer`,
   *   {@link ISSUE_NOT_FOUND_CODE} for an id this workspace cannot see,
   *   {@link ISSUE_ALREADY_ESTIMATING_CODE} while an estimate is in flight, and
   *   {@link ESTIMATION_RATE_LIMITED_CODE} past the workspace's per-minute limit.
   */
  async estimate(id: string, client: ApiClient = api()): Promise<EstimationAccepted> {
    return unwrap(await client.POST("/api/v1/backlog/{id}/estimate", { params: { path: { id } } }));
  },

  /**
   * Sync the backlog from GitHub now, rather than waiting for the next scheduled cycle.
   *
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The sync's status at the moment the cycle started — `running: true`, with freshness
   *   the cycle has not yet moved. The tag moves when the cycle finishes and the listing's `meta`
   *   says so.
   * @throws {ApiError} What the service answered — {@link FORBIDDEN_CODE} for a `viewer`,
   *   {@link BACKLOG_SYNC_RUNNING_CODE} while a cycle is in flight, and
   *   {@link BACKLOG_SYNC_TOO_SOON_CODE} within the minimum interval of the last one.
   */
  async sync(client: ApiClient = api()): Promise<SyncStatus> {
    return unwrap(await client.POST("/api/v1/backlog/sync", {}));
  },

  /**
   * Re-estimate every issue this workspace mirrors that is not already being estimated.
   *
   * @param client The client to call through. Defaults to the server-side one.
   * @returns How many issues were claimed and queued, how many were left alone, and how many the
   *   workspace mirrors. A workspace mirroring nothing answers zeros rather than a refusal.
   * @throws {ApiError} What the service answered — {@link FORBIDDEN_CODE} below `admin`,
   *   {@link BACKLOG_ALREADY_ESTIMATING_CODE} while every issue is in flight, and
   *   {@link ESTIMATION_RATE_LIMITED_CODE} past the workspace's per-minute limit.
   */
  async estimateAll(client: ApiClient = api()): Promise<EstimationFanout> {
    return unwrap(await client.POST("/api/v1/backlog/estimate-all", {}));
  },

  /**
   * Queue a selection of issues for the loop — all of them, or none.
   *
   * @param selection The issues, by `github_issues.id`, in the order to append them, and the
   *   workflow to run every one under. Without a workflow each issue is queued under the one its
   *   own estimate suggested, which is what **Queue N selected ⟳** means.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The rows created, in queue order, and their combined estimate in minutes.
   * @throws {ApiError} What the service answered. The write is one transaction, so any refusal —
   *   {@link QUEUE_ISSUES_NOT_FOUND_CODE} for an id this workspace cannot see,
   *   {@link QUEUE_ISSUES_NOT_QUEUEABLE_CODE} for an issue that is not `sized`,
   *   {@link QUEUE_ISSUES_CONFLICT_CODE} for one the queue already holds — means nothing was
   *   queued, and `details.issues` names the offenders.
   */
  async queue(selection: QueueSelection, client: ApiClient = api()): Promise<QueuedSelection> {
    return unwrap(await client.POST("/api/v1/backlog/queue", { body: selection }));
  },
};
