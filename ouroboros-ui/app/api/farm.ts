/**
 * The build farm — what mockup 08 reads through `ouroboros-rest`.
 *
 * AI.1 ([#256](https://github.com/NobuData/ouroboros/issues/256)) needs one of AH.6's operations
 * ([#254](https://github.com/NobuData/ouroboros/issues/254)): `GET /api/v1/farm`, **the page in
 * one observation** — the four stat cards, the runners, the pools and the live build. One payload
 * rather than four endpoints because the figures are claims about each other: `4/5` counts the
 * rows of the table beside it, and a pool's `3 runners` partitions the same set. The runners
 * table (AI.2, #257), the enroll flow (AI.3, #258), the pools card (AI.4, #259) and the lifecycle
 * writes (AI.5, #260) add their own operations here as they arrive; none of them is drawn yet, so
 * none of them is here.
 *
 * ### `null` is not `0`, and this module keeps it that way
 *
 * A count of nothing is zero; an *average* of nothing is `null` — `avgBuildTime.seconds`,
 * `avgBuildTime.deltaVsLastWeek` and `cacheHitRate.pct` are each null when there is nothing to
 * average or compare. The payload is handed back exactly as served, so the em-dash the contract
 * asks for is `app/farm/view.ts`'s to draw and never a zero invented on the way through.
 *
 * ### The cadence is the server's
 *
 * The answer carries `X-Ouro-Poll-After` — the fleet's own ten-second heartbeat — and no `ETag`
 * (every figure is a claim about the present, so it is `no-store`). {@link farm.observe} reads the
 * hint off the response beside the body, which is what lets `app/api/farm-page.ts` hand the poll
 * the server's interval rather than the contract's default.
 *
 * ### The workspace is the session's
 *
 * There is no workspace in the path and this client sends no `X-Ouro-Tenant`
 * (`app/api/server.ts` says why). Every member may read the farm, a `viewer` included.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";
import { readPollAfter } from "@/app/poll";

/** Everything mockup 08 reads: the stat row, the fleet, the pools and the live build. */
export type FarmPage = components["schemas"]["FarmPage"];

/** The four stat cards. `null` means *not measured* wherever it appears, never `0`. */
export type FarmStats = components["schemas"]["FarmStats"];

/** One machine in the fleet, as the runners table draws it (AI.2). */
export type FarmRunner = components["schemas"]["FarmRunner"];

/** One pool, with its metadata and how many runners it holds (AI.4). */
export type RunnerPool = components["schemas"]["RunnerPool"];

/** One read of the page, and the cadence the service asked for beside it. */
export interface FarmObservation {
  /** The page, as served. */
  readonly page: FarmPage;
  /**
   * `X-Ouro-Poll-After`, in seconds, or `null` when the answer carried nothing usable — see
   * `readPollAfter` in `app/poll.ts` for what *usable* means.
   */
  readonly pollAfterSeconds: number | null;
}

/** The farm's operations. */
export const farm = {
  /**
   * Read the page.
   *
   * @param client The client to read through. Defaults to the server's own, which redirects a
   *   `401` to the login screen — right for a render, wrong for a poll (see {@link farm.observe}).
   * @param signal A way to give up on the read.
   * @returns The page, as served.
   * @throws {ApiError} When the service refuses.
   */
  async page(client: ApiClient = api(), signal?: AbortSignal): Promise<FarmPage> {
    return (await farm.observe(client, signal)).page;
  },

  /**
   * Read the page and the cadence hint it came with.
   *
   * @param client The client to read through. A route handler answering a poll passes
   *   `anonymousApi()`, so a session that has ended is an `ApiError` rather than a redirect.
   * @param signal A way to give up on the read — a poll's deadline.
   * @returns The page and the server's interval.
   * @throws {ApiError} When the service refuses.
   */
  async observe(client: ApiClient = api(), signal?: AbortSignal): Promise<FarmObservation> {
    const result = await client.GET("/api/v1/farm", { signal });

    return { page: unwrap(result), pollAfterSeconds: readPollAfter(result.response.headers) };
  },
};
