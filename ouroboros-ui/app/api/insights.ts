/**
 * Insights — what mockup 15 reads through `ouroboros-rest`.
 *
 * BK.2 ([#443](https://github.com/NobuData/ouroboros/issues/443)) needs one of BJ.2's operations
 * ([#438](https://github.com/NobuData/ouroboros/issues/438)): `GET /api/v1/insights`, **the page
 * in one payload** — the head's two numbers, the five KPI cards and every card below them, each
 * figure travelling with its methodology registry entry (BI.1,
 * [#432](https://github.com/NobuData/ouroboros/issues/432)). One payload because the page is one
 * window: switching the range re-reads all of it, so no card can draw 7 days beside another's 30.
 *
 * ### The range is the page's one input
 *
 * `range` is `7d`, `30d` or `90d`; the service defaults to `30d` and refuses anything else with a
 * `422`. `custom` is BL.3's ([#450](https://github.com/NobuData/ouroboros/issues/450)) and is not
 * in the contract, so it never reaches this client (`app/insights/range.ts`).
 *
 * ### `null` is not `0`
 *
 * A KPI's `value`, `prior` and `delta` are each `null` when there is nothing to measure or
 * compare, and the payload is handed back exactly as served — the em dash is
 * `app/insights/view.ts`'s to draw.
 *
 * ### The workspace is the session's
 *
 * There is no workspace in the path and this client sends no `X-Ouro-Tenant`
 * (`app/api/server.ts` says why). Every member may read the page, a `viewer` included.
 *
 * ### The interventions card's two operations (BK.4, [#445](https://github.com/NobuData/ouroboros/issues/445))
 *
 * `GET /api/v1/insights/interventions?range=&cause=` lists the events behind one bar — every
 * member may read it — and `POST /api/v1/insights/interventions/{id}/recategorize` sets a cause a
 * person says it was, **`owner`, `admin` or `member`** only: a `viewer` is refused by the service,
 * whatever the screen draws. The correction re-fills the day it was detected on, so the next read
 * of the page has the bars and the line computed from them already moved.
 *
 * Server-side only, by way of `app/api/server.ts`.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** The whole of mockup 15, for one range. */
export type InsightsPage = components["schemas"]["Insights"];

/** A window the page can be read over — `7d`, `30d` or `90d`. */
export type InsightsRange = InsightsPage["range"];

/** The numbers behind *"27 PRs merged this week. 2 needed a human."* — always the last 7 days. */
export type InsightsHead = components["schemas"]["InsightsHead"];

/** One KPI card: its figure, the prior window's, the move between them and its methodology. */
export type InsightsKpi = components["schemas"]["InsightsKpi"];

/** A metric's registry entry — everything its popover prints. */
export type MetricMethodology = components["schemas"]["MetricMethodology"];

/** One of the five horizontal-bar cards, its computed insight line included. */
export type InsightsBarCard = components["schemas"]["InsightsBarCard"];

/** Tokens, and the dollars they cost when priced (decision I8) — the page's `usage`. */
export type InsightsMoney = components["schemas"]["InsightsMoney"];

/** One cell of the build & test strip (BK.5, #446). `total_cost` is null when nothing was priced. */
export type InsightsPerformanceCell = components["schemas"]["InsightsPerformanceCell"];

/** The flaky card — AT.3's states over the window (BK.5, #446). */
export type InsightsFlaky = components["schemas"]["InsightsFlaky"];

/** One flaky case, with its real daily history and the context its occurrences name. */
export type InsightsFlakyCase = components["schemas"]["InsightsFlakyCase"];

/** The model scoreboard — task kind × serving model, with AB.3's suggestion when it exists. */
export type Scoreboard = components["schemas"]["Scoreboard"];

/** One scoreboard row. */
export type ScoreboardRow = components["schemas"]["ScoreboardRow"];

/** Why a loop needed a person — one bar of the interventions card. */
export type InterventionCause = components["schemas"]["InterventionCause"];

/** One moment a person stepped into a loop, with its cause and any correction of it. */
export type Intervention = components["schemas"]["Intervention"];

/** The events behind the interventions card over one range. */
export type InterventionList = components["schemas"]["InterventionList"];

/** The insights operations. */
export const insights = {
  /**
   * Read the page for one range.
   *
   * @param range The window. The service's default (`30d`) is never relied on: the caller always
   *   names the range it is drawing, so the answer and the segment cannot disagree.
   * @param client The client to read through. Defaults to the server's own, which redirects a
   *   `401` to the login screen — right for a render. A poll passes `anonymousApi()`.
   * @param signal A way to give up on the read — a poll's deadline.
   * @returns The page, as served.
   * @throws {ApiError} When the service refuses.
   */
  async page(
    range: InsightsRange,
    client: ApiClient = api(),
    signal?: AbortSignal,
  ): Promise<InsightsPage> {
    return unwrap(await client.GET("/api/v1/insights", { params: { query: { range } }, signal }));
  },

  /**
   * List the intervention events behind the card — one cause's bar, or every bar.
   *
   * @param range The page's range, so the list covers the bars' own window.
   * @param cause One cause, or `undefined` for every cause.
   * @param client The client to read through. Defaults to the server's own.
   * @returns The window, how many matched and the newest of them.
   * @throws {ApiError} When the service refuses.
   */
  async interventions(
    range: InsightsRange,
    cause?: InterventionCause,
    client: ApiClient = api(),
  ): Promise<InterventionList> {
    return unwrap(
      await client.GET("/api/v1/insights/interventions", {
        params: { query: cause === undefined ? { range } : { range, cause } },
      }),
    );
  },

  /**
   * Re-categorize one intervention event — `owner`, `admin` or `member` only.
   *
   * @param id The event.
   * @param cause The cause the person says it was.
   * @param reason Why — required and never blank; it is the audit row's reason.
   * @param client The client to write through. Defaults to the server's own.
   * @returns The event, now `causeOrigin: "human"`, with the override that set it.
   * @throws {ApiError} `forbidden` for a viewer, `intervention_not_found`,
   *   `intervention_cause_unchanged`, or `validation_failed`.
   */
  async recategorize(
    id: string,
    cause: InterventionCause,
    reason: string,
    client: ApiClient = api(),
  ): Promise<Intervention> {
    return unwrap(
      await client.POST("/api/v1/insights/interventions/{id}/recategorize", {
        params: { path: { id } },
        body: { cause, reason },
      }),
    );
  },
};
