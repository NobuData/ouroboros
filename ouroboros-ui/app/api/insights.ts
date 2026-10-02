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
};
