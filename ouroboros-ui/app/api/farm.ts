/**
 * The build farm — what mockup 08 reads through `ouroboros-rest`.
 *
 * AI.1 ([#256](https://github.com/NobuData/ouroboros/issues/256)) needs one of AH.6's operations
 * ([#254](https://github.com/NobuData/ouroboros/issues/254)): `GET /api/v1/farm`, **the page in
 * one observation** — the four stat cards, the runners, the pools and the live build. One payload
 * rather than four endpoints because the figures are claims about each other: `4/5` counts the
 * rows of the table beside it, and a pool's `3 runners` partitions the same set. The runners
 * table (AI.2, #257) reads that payload and nothing else. The enroll flow (AI.3,
 * [#258](https://github.com/NobuData/ouroboros/issues/258)) added its three — the minting read of
 * the install command, the token list and the revoke — and the pools' own listing, for naming a
 * token's pool. The pools card (AI.4, #259) and the lifecycle writes (AI.5, #260) add theirs as
 * they arrive.
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

/**
 * The enroll card's one-liner and the parts it was built from (AI.3). **`command` carries a live
 * enrollment token** — see {@link farm.enrollCommand} for what that obliges a caller to.
 */
export type EnrollCommand = components["schemas"]["EnrollCommand"];

/** One enrollment token, **masked** — there is no operation that answers one un-masked (AI.3). */
export type EnrollmentToken = components["schemas"]["EnrollmentToken"];

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

  /**
   * Mint an enrollment token and read the install one-liner that carries it
   * (AI.3, [#258](https://github.com/NobuData/ouroboros/issues/258)).
   *
   * **This mints, although it is a `GET`** — every call leaves a live, single-use token in the
   * workspace's list, so it is called when somebody asks for a command and never to draw a page.
   * `command` is one of the two places in the whole API a token's value appears: a caller hands
   * it to the clipboard and to nothing else (`app/farm/enroll-actions.ts`).
   *
   * @param pool The pool the enrolled machine joins — the command's `--pool`.
   * @param client The client to call through.
   * @returns The command, the parts it was built from, and the masked token it carries.
   * @throws {ApiError} `403 forbidden` for anybody but an `owner` or `admin`,
   *   `404 farm_pool_not_found`, or `404 farm_enroll_command_unavailable` when this deployment
   *   cannot serve an installer. **A refusal means nothing was minted.**
   */
  async enrollCommand(pool: string, client: ApiClient = api()): Promise<EnrollCommand> {
    return unwrap(
      await client.GET("/api/v1/farm/enroll-command", { params: { query: { pool } } }),
    );
  },

  /**
   * Every enrollment token this workspace has minted, newest first — live, expired and revoked
   * alike, and masked without exception.
   *
   * @param client The client to call through.
   * @returns The tokens, as served.
   * @throws {ApiError} `403 forbidden` for anybody but an `owner` or `admin`.
   */
  async tokens(client: ApiClient = api()): Promise<EnrollmentToken[]> {
    return unwrap(await client.GET("/api/v1/farm/enrollment-tokens"));
  },

  /**
   * Revoke a token before it expires. Idempotent: revoking a revoked token answers it as it
   * stands. The certificates it already issued are untouched — those are per-runner (AI.5).
   *
   * @param id The token.
   * @param client The client to call through.
   * @returns The token as it now stands, with the uses it had spent.
   * @throws {ApiError} `403 forbidden`, or `404 farm_enrollment_token_not_found`.
   */
  async revokeToken(id: string, client: ApiClient = api()): Promise<EnrollmentToken> {
    return unwrap(
      await client.DELETE("/api/v1/farm/enrollment-tokens/{id}", { params: { path: { id } } }),
    );
  },

  /**
   * The workspace's pools, on their own — for a surface that names a token's pool and has no use
   * for the fleet beside it (`app/farm/token-data.ts`). Every member may read it.
   *
   * @param client The client to call through.
   * @returns The pools, as served.
   * @throws {ApiError} When the service refuses.
   */
  async pools(client: ApiClient = api()): Promise<RunnerPool[]> {
    return unwrap(await client.GET("/api/v1/farm/pools"));
  },
};
