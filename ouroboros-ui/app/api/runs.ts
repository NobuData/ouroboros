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

/** The error code the service answers for a run this workspace cannot see. */
export const RUN_NOT_FOUND_CODE = "run_not_found";

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
};
