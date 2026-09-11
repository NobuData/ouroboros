/**
 * The backlog — what mockup 03's `/issues` reads from `ouroboros-rest`, and the two writes its
 * page head makes.
 *
 * Three operations of the `backlog` tag in one module, for the reason `app/api/routing.ts` is one
 * module: they are one screen's calls. `GET /api/v1/backlog`
 * ([#110](https://github.com/NobuData/ouroboros/issues/110)) is the listing the head's counts —
 * and, as they land, the filter bar and the table — are drawn from;
 * `POST /api/v1/backlog/estimate-all` ([#108](https://github.com/NobuData/ouroboros/issues/108))
 * is **Re-estimate all**; and `POST /api/v1/backlog/queue`
 * ([#112](https://github.com/NobuData/ouroboros/issues/112)) is **Queue N selected ⟳** — and the
 * selection bar's and the detail panel's queue buttons after it, because the contract makes all
 * three one write.
 *
 * ### The role gates are the service's
 *
 * Reading is every member's, `viewer` included. Queueing is `owner`, `admin` or `member`;
 * re-estimating the whole backlog is `owner` or `admin`, because one press spends the workspace's
 * engine quota. This module enforces neither: a check made in the browser is a check anybody can
 * skip, so what the screen does with a role is presentation, and {@link FORBIDDEN_CODE} is what a
 * press that went around it is answered with.
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

/** The query the listing accepts: every control the filter bar draws, plus the page. */
export type BacklogQuery = NonNullable<operations["listBacklog"]["parameters"]["query"]>;

/**
 * What one press of **Re-estimate all** answers: `enqueued` issues claimed and queued, `skipped`
 * left alone — in practice the ones already in flight — and the `total` the workspace mirrors.
 * The three cannot disagree: `skipped` is `total` less `enqueued`.
 */
export type EstimationFanout = components["schemas"]["EstimationFanout"];

/** A selection to queue: `github_issues.id`s in the order to append them, and an optional workflow. */
export type QueueSelection = components["schemas"]["QueueSelection"];

/** What one press of a queue button answers: the rows created, and their combined estimate. */
export type QueuedSelection = components["schemas"]["QueuedSelection"];

/** The code a role that may read the backlog, but not do what it pressed, is answered with. */
export const FORBIDDEN_CODE = "forbidden";

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

/** The backlog, as `ouroboros-rest` serves it. */
export const backlog = {
  /**
   * One page of the backlog, filtered, sorted and searched.
   *
   * @param query The filter bar's parameters and the page, every one optional — the service's
   *   defaults are `state=open`, `sort=effort` and `limit=25`.
   * @param client The client to call through. Defaults to the server-side one; tests pass one
   *   over a stub `fetch`.
   * @returns The listing: rows, filtered total, the head's counts and the chip set.
   * @throws {ApiError} What the service answered.
   */
  async list(query: BacklogQuery = {}, client: ApiClient = api()): Promise<BacklogListing> {
    return unwrap(await client.GET("/api/v1/backlog", { params: { query } }));
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
   *   an id this workspace cannot see, an issue that is not `sized`, one the queue already holds
   *   — means nothing was queued, and `details.issues` names the offenders.
   */
  async queue(selection: QueueSelection, client: ApiClient = api()): Promise<QueuedSelection> {
    return unwrap(await client.POST("/api/v1/backlog/queue", { body: selection }));
  },
};
