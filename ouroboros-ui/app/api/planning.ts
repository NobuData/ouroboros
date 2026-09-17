/**
 * Planning — what mockup 09 reads and writes through `ouroboros-rest`.
 *
 * AM.1 ([#283](https://github.com/NobuData/ouroboros/issues/283)) needs two of AL.4's operations
 * ([#280](https://github.com/NobuData/ouroboros/issues/280)): the roadmap read, which the page's
 * roadmap region heads itself with, and the lane create, which **New roadmap** is. The generator,
 * the drafts and the push are AM.2's ([#284](https://github.com/NobuData/ouroboros/issues/284)) and
 * the rest of the epic CRUD is AM.4's ([#286](https://github.com/NobuData/ouroboros/issues/286)), so
 * they are not here yet.
 *
 * ### A roadmap is not an entity
 *
 * There is no `POST /roadmaps`. AK.3 ([#274](https://github.com/NobuData/ouroboros/issues/274))
 * stores `roadmap_name` and `roadmap_window` **on each lane**, and the roadmap read's head is the
 * top named lane's. So *creating a roadmap* is creating its first lane with the name on it — which
 * is exactly what {@link planning.createEpic} is asked to do by the dialog.
 *
 * ### The workspace is the session's
 *
 * There is no workspace in these paths and this client sends no `X-Ouro-Tenant`
 * (`app/api/server.ts` says why). Any member may read the roadmap; creating a lane is `owner` or
 * `admin`, and the service is what enforces it.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** The roadmap: its head (name and window, both nullable) and every lane, top first. */
export type PlanningRoadmap = components["schemas"]["PlanningRoadmap"];

/** One roadmap lane, with its computed `12 issues · 8 done` chip. */
export type PlanningEpic = components["schemas"]["PlanningEpic"];

/**
 * What a lane create sends. Only `name` is required; months are paired — both, or both `null` for
 * the dashed unscoped lane — and run forwards (`epic_month_range_invalid` otherwise).
 */
export type PlanningEpicCreate = components["schemas"]["PlanningEpicCreate"];

/** Planning, as `ouroboros-rest` serves it. */
export const planning = {
  /**
   * The roadmap — every lane with its computed chip, and the head.
   *
   * @param client The client to call through. Defaults to the server-side one; tests pass one
   *   over a stub `fetch`.
   * @returns The roadmap. A workspace that has planned nothing answers `name: null` and no
   *   lanes — the empty roadmap, not a failure.
   * @throws {ApiError} What the service answered. A `401` redirects to login before this rejects.
   */
  async roadmap(client: ApiClient = api()): Promise<PlanningRoadmap> {
    return unwrap(await client.GET("/api/v1/planning/roadmap", {}));
  },

  /**
   * Create one lane at the bottom of the roadmap.
   *
   * @param body The lane, as the caller composed it — forwarded as it is.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The stored lane.
   * @throws {ApiError} What the service answered — `403 forbidden` for a role below `admin`,
   *   `422 epic_month_range_invalid` for a half or backwards range, `422 validation_failed` for a
   *   body whose shape is wrong.
   */
  async createEpic(body: PlanningEpicCreate, client: ApiClient = api()): Promise<PlanningEpic> {
    return unwrap(await client.POST("/api/v1/planning/epics", { body }));
  },
};
