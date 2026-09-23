/**
 * The run console's read ([#309](https://github.com/NobuData/ouroboros/issues/309)) —
 * `GET /api/v1/runs/{id}`, mockup 10's page as one snapshot (AP.2,
 * [#304](https://github.com/NobuData/ouroboros/issues/304)).
 *
 * One call and its types, in the shape every other module under `app/api/` keeps: the
 * generated client does the transport, `unwrap` turns a non-2xx into an `ApiError`, and a
 * caller that already holds a client — the poll route's anonymous one — passes it in.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** The whole page: the run row, the head, the timeline and the three cards. */
export type RunConsole = components["schemas"]["RunConsole"];

/** What the page head adds to the run row — loop number, pin, branch, watermark, liveness. */
export type RunConsoleHead = components["schemas"]["RunConsoleHead"];

/** The *Wall clock* row, and the head's *elapsed*. */
export type RunWallClock = components["schemas"]["RunWallClock"];

/** The repository the run's issue lives in, as GitHub names it. */
export type RunRepository = components["schemas"]["RunRepository"];

/** One page of the transcript's tail (AP.2) — what the transcript card appends (#312). */
export type RunEventsPage = components["schemas"]["RunEventsPage"];

/** One transcript entry. */
export type RunEventEntry = components["schemas"]["RunEventEntry"];

/** What an elision marker accounts for. */
export type RunEventElision = components["schemas"]["RunEventElision"];

/** One control on a run's queue — what the head's delivery chip reads (#306). */
export type RunControl = components["schemas"]["RunControl"];

/** Which control: `pause`, `resume`, `abort` or `steer`. */
export type RunControlKind = components["schemas"]["RunControlKind"];

/** Where a control has got to: `pending`, `delivered`, `acked`, `expired` or `rejected`. */
export type RunControlState = components["schemas"]["RunControlState"];

/** A run's recent controls, newest first. */
export type RunControlList = components["schemas"]["RunControlList"];

/** What a submission carries. */
export type SubmitRunControlRequest = components["schemas"]["SubmitRunControlRequest"];

/** The error code the service answers for a run this workspace cannot see. */
export const RUN_NOT_FOUND_CODE = "run_not_found";

/** The code this module answers, before calling out, for a run id that is not a uuid. */
export const RUN_ID_INVALID_CODE = "validation_failed";

/** What is said beside {@link RUN_ID_INVALID_CODE}. */
export const RUN_ID_INVALID = "That is not a run id.";

/** A run's id: `runs.id`, a uuid minted by the database (V008). */
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a value can be a run's id.
 *
 * Checked by the hops that put an id into a path themselves — the transcript's pass-through and
 * the controls' Server Action — because `encodeURIComponent` leaves `.` and `..` alone, and a
 * path segment of `..` would reach a different route of the service than the one meant.
 *
 * @param value What arrived.
 * @returns `true` for a uuid.
 */
export function isRunId(value: unknown): value is string {
  return typeof value === "string" && RUN_ID.test(value);
}

export const runs = {
  /**
   * Read one run's console snapshot.
   *
   * @param id The run's id.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @param signal Aborts the read — the poll route's timeout.
   * @returns The snapshot.
   * @throws ApiError `404 run_not_found` for a run that is not this workspace's, `400` for an
   *   id that is not a uuid, `401` for a session that has ended.
   */
  async console(id: string, client: ApiClient = api(), signal?: AbortSignal): Promise<RunConsole> {
    return unwrap(await client.GET("/api/v1/runs/{id}", { params: { path: { id } }, signal }));
  },

  /**
   * Read the transcript past a cursor — the tail the transcript card polls
   * ([#312](https://github.com/NobuData/ouroboros/issues/312)).
   *
   * @param id The run's id.
   * @param after The last `seq` the reader holds; `0` for the start.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @param signal Aborts the read — the poll route's timeout.
   * @returns The page: the entries after the cursor, the next cursor, and the run's liveness.
   * @throws ApiError `404 run_not_found` for a run that is not this workspace's.
   */
  async events(
    id: string,
    after: number,
    client: ApiClient = api(),
    signal?: AbortSignal,
  ): Promise<RunEventsPage> {
    return unwrap(
      await client.GET("/api/v1/runs/{id}/events", {
        params: { path: { id }, query: { after } },
        signal,
      }),
    );
  },

  /**
   * Read one run's recent controls — the head's delivery chips
   * ([#310](https://github.com/NobuData/ouroboros/issues/310)).
   *
   * @param id The run's id.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @param signal Aborts the read — the poll route's timeout.
   * @returns The controls, newest first. Elapsed ones are already `expired`.
   * @throws ApiError `404 run_not_found` for a run that is not this workspace's.
   */
  async controls(
    id: string,
    client: ApiClient = api(),
    signal?: AbortSignal,
  ): Promise<RunControlList> {
    return unwrap(
      await client.GET("/api/v1/runs/{id}/controls", { params: { path: { id } }, signal }),
    );
  },

  /**
   * Queue a control on a run — *Pause loop*, *Resume*, *Abort run*
   * ([#310](https://github.com/NobuData/ouroboros/issues/310), over #306's queue).
   *
   * The service is the gate: `pause`, `resume` and `abort` are `owner` or `admin`, checked
   * before the run is read, and an abort's `confirmation` is re-checked against the run's
   * loop number whatever the browser decided.
   *
   * @param id The run's id.
   * @param body The control.
   * @param client The client to ask through. Defaults to the request-scoped one.
   * @returns The control as the queue holds it — `pending`, `rejected` for a finished run, or
   *   the one already outstanding when this was a repeat.
   * @throws ApiError `403` for a role that may not press it, `422 abort_confirmation_invalid`
   *   for a wrong typed number, `404 run_not_found` for another workspace's run.
   */
  async submitControl(
    id: string,
    body: SubmitRunControlRequest,
    client: ApiClient = api(),
  ): Promise<RunControl> {
    return unwrap(
      await client.POST("/api/v1/runs/{id}/controls", { params: { path: { id } }, body }),
    );
  },
};
