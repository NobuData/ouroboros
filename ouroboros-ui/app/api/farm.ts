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
 * token's pool. The pools card (AI.4, [#259](https://github.com/NobuData/ouroboros/issues/259))
 * added the three pool writes — create, change and delete. The live log card (AI.6,
 * [#261](https://github.com/NobuData/ouroboros/issues/261)) added AH.5's offset read of one
 * build's log. The runner menu and the submit dialog (AI.5,
 * [#260](https://github.com/NobuData/ouroboros/issues/260)) added the last four: drain, undrain,
 * the guarded remove, and AH.4's build submission.
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

/** A new pool — `name` and `executor`, and whatever else should not take the column's default. */
export type RunnerPoolCreate = components["schemas"]["CreateRunnerPoolRequest"];

/**
 * A change to a pool. **A field it does not name is left alone, and `null` is a value** — *there
 * is none* — which is the distinction that matters for `image`.
 */
export type RunnerPoolChange = components["schemas"]["UpdateRunnerPoolRequest"];

/**
 * The enroll card's one-liner and the parts it was built from (AI.3). **`command` carries a live
 * enrollment token** — see {@link farm.enrollCommand} for what that obliges a caller to.
 */
export type EnrollCommand = components["schemas"]["EnrollCommand"];

/** One enrollment token, **masked** — there is no operation that answers one un-masked (AI.3). */
export type EnrollmentToken = components["schemas"]["EnrollmentToken"];

/**
 * One page of a build's log (AI.6), as AH.5 serves it
 * ([#253](https://github.com/NobuData/ouroboros/issues/253)): the text from `offset` up to
 * `nextOffset`, where the stored log ends, whether it can still grow, and the holes in it — as
 * data, by position, never as text in the stream.
 */
export type BuildLog = components["schemas"]["BuildLog"];

/**
 * What a drain or an undrain did (AI.5): the runner as it now stands, and whether the frame
 * reached a session in the process that answered. **`pushed: false` is not a failure** — the
 * intent is written first and the agent is told at its next heartbeat.
 */
export type RunnerLifecycle = components["schemas"]["RunnerLifecycle"];

/** One build attempt, as a submission answers it (AI.5) — `queued`, with its public number. */
export type BuildJob = components["schemas"]["BuildJob"];

/**
 * A build to run (AI.5). **`command` is argv, never a shell string**, and the pool's default
 * applies when it is absent; **`commit` is required**, because an offer pins the exact commit.
 */
export type BuildJobSubmission = components["schemas"]["SubmitBuildJobRequest"];

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
   * Read one page of a build's log, from an offset
   * (AI.6, [#261](https://github.com/NobuData/ouroboros/issues/261)).
   *
   * Successive pages concatenate to exactly the stored log — ask for the next with `after` set to
   * the last page's `nextOffset` — and **`live` is the job's state, never chunk recency**, which
   * is what the card's cursor is bound to. The cadence (`X-Ouro-Poll-After`: two seconds while
   * the build runs, fifteen after) is in the body too, as `pollAfter`, so no header is read here.
   *
   * @param id The build job.
   * @param after Where to read from — the `nextOffset` last reached, or `0`.
   * @param client The client to read through. A route handler answering a poll passes
   *   `anonymousApi()`, for the reason {@link farm.observe} gives.
   * @param signal A way to give up on the read — a poll's deadline.
   * @returns The page, as served.
   * @throws {ApiError} `404 farm_job_not_found` — another workspace's job is the same answer —
   *   or `422 farm_log_offset_out_of_range` for an `after` past the end of the log.
   */
  async log(
    id: string,
    after: number,
    client: ApiClient = api(),
    signal?: AbortSignal,
  ): Promise<BuildLog> {
    return unwrap(
      await client.GET("/api/v1/farm/jobs/{id}/log", {
        params: { path: { id }, query: { after } },
        signal,
      }),
    );
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

  /**
   * Create a pool (AI.4, [#259](https://github.com/NobuData/ouroboros/issues/259)).
   *
   * @param pool The pool. A container pool must pin an image and a shell pool must not.
   * @param client The client to call through.
   * @returns The pool as stored, holding no runners yet.
   * @throws {ApiError} `403 forbidden` for anybody but an `owner` or `admin`,
   *   `409 farm_pool_name_taken`, or `422` — `validation_failed` naming the field, or
   *   `farm_pool_image_mismatch`.
   */
  async createPool(pool: RunnerPoolCreate, client: ApiClient = api()): Promise<RunnerPool> {
    return unwrap(await client.POST("/api/v1/farm/pools", { body: pool }));
  },

  /**
   * Change a pool — the card's two switches and the sheet's save. What already ran is not
   * rewritten: the executor and image are snapshotted onto every build at submission.
   *
   * @param id The pool.
   * @param change The fields to change, and only those.
   * @param client The client to call through.
   * @returns The pool as it now stands, with its runner count.
   * @throws {ApiError} `403 forbidden`, `404 farm_pool_not_found`, `409 farm_pool_name_taken`,
   *   or `422` — `validation_failed`, or `farm_pool_image_mismatch` against the merged pool.
   */
  async updatePool(
    id: string,
    change: RunnerPoolChange,
    client: ApiClient = api(),
  ): Promise<RunnerPool> {
    return unwrap(
      await client.PATCH("/api/v1/farm/pools/{id}", { params: { path: { id } }, body: change }),
    );
  },

  /**
   * Delete a pool that nothing points at.
   *
   * @param id The pool.
   * @param client The client to call through.
   * @returns When it is gone.
   * @throws {ApiError} `403 forbidden`, `404 farm_pool_not_found`, or `409 farm_pool_in_use` —
   *   runners (retired ones included) or builds still name it, and `details` carries both counts.
   */
  async deletePool(id: string, client: ApiClient = api()): Promise<void> {
    // A `204`: there is no body to unwrap, and a refusal is thrown by the client's middleware.
    await client.DELETE("/api/v1/farm/pools/{id}", { params: { path: { id } } });
  },

  /**
   * Withdraw a runner from dispatch (AI.5, [#260](https://github.com/NobuData/ouroboros/issues/260)):
   * it declines new offers and **finishes the build it is holding**. There is no deadline.
   *
   * **The pill does not change in this answer.** What this writes is `desiredState`; `status`
   * is the agent's own heartbeat and reads `draining` on the next one.
   *
   * @param id The runner.
   * @param client The client to call through.
   * @returns The runner as it now stands, and whether the frame was pushed.
   * @throws {ApiError} `403 forbidden` for anybody but an `owner` or `admin`,
   *   `404 farm_runner_not_found`, or `409 farm_runner_removed`.
   */
  async drainRunner(id: string, client: ApiClient = api()): Promise<RunnerLifecycle> {
    return unwrap(
      await client.POST("/api/v1/farm/runners/{id}/drain", { params: { path: { id } } }),
    );
  },

  /**
   * Return a drained runner to dispatch — the other half of {@link farm.drainRunner}.
   *
   * @param id The runner.
   * @param client The client to call through.
   * @returns The runner as it now stands, and whether the frame was pushed.
   * @throws {ApiError} As {@link farm.drainRunner}.
   */
  async undrainRunner(id: string, client: ApiClient = api()): Promise<RunnerLifecycle> {
    return unwrap(
      await client.POST("/api/v1/farm/runners/{id}/undrain", { params: { path: { id } } }),
    );
  },

  /**
   * Retire a runner from the fleet — **guarded to machines that are `offline` or `draining`**.
   *
   * The service applies the guard again inside the write, so a machine that heartbeated its
   * way back to `online` in between is refused with the state it is *now* in. A removal also
   * revokes the machine's certificate, so it cannot reconnect; its builds keep their rows.
   *
   * @param id The runner.
   * @param client The client to call through.
   * @returns The runner, `removed`.
   * @throws {ApiError} `403 forbidden`, `404 farm_runner_not_found`, `409 farm_runner_removed`,
   *   or `409 farm_runner_not_removable` — with the status it is in under `details.status`.
   */
  async removeRunner(id: string, client: ApiClient = api()): Promise<FarmRunner> {
    return unwrap(await client.DELETE("/api/v1/farm/runners/{id}", { params: { path: { id } } }));
  },

  /**
   * Submit a build to a pool (AH.4, [#252](https://github.com/NobuData/ouroboros/issues/252)) —
   * the MVP's workload source (decision B6). Dispatch is kicked at once, so the job may already
   * be `offered` by the time this answers.
   *
   * @param submission The pool, repository, ref, exact commit and — or the pool's default — argv.
   * @param client The client to call through.
   * @returns The job, `queued`, with the number it is known by.
   * @throws {ApiError} `403 forbidden` for a `viewer`, `404 farm_pool_not_found` or
   *   `404 farm_repository_not_found`, `409 farm_pool_disabled`, or `422` —
   *   `farm_command_required`, or `validation_failed` naming the field. **A refusal means
   *   nothing was queued.**
   */
  async submitJob(submission: BuildJobSubmission, client: ApiClient = api()): Promise<BuildJob> {
    return unwrap(await client.POST("/api/v1/farm/jobs", { body: submission }));
  },
};
