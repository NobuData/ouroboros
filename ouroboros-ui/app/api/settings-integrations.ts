/**
 * The integrations status hub and the org notification routes — mockup 17's **Integrations** and
 * **Notifications** cards ([#488](https://github.com/NobuData/ouroboros/issues/488) built them,
 * BS.5 [#495](https://github.com/NobuData/ouroboros/issues/495) draws them).
 *
 * - `/api/v1/settings/integrations` — one tile per integration, **composed on every request from
 *   the plane that owns each connection**. `availability` separates *not connected* from *does
 *   not exist yet*, and every `deepLink` is the surface that owns the connection.
 * - `/api/v1/settings/notifications` — the workspace's org-level routes, each with its lock
 *   derived: a route whose channel has no connection in this build is `locked` with the reason
 *   the card prints. Saving one **enabled** on such a channel is refused
 *   `409 notification_route_locked` — the rule is the service's, and the card only mirrors it.
 *
 * **Any member may read both**; the route write is `owner` or `admin`.
 *
 * These routes are the one store of org-level bindings: the ChatOps routing card (#543) edits the
 * same resource, so nothing here keeps a second copy.
 *
 * Server-side only, by way of `app/api/server.ts`.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** The grid: every tile, and how many are connected. */
export type Integrations = components["schemas"]["Integrations"];
/** One integration, composed from the plane that owns it. */
export type IntegrationTile = components["schemas"]["IntegrationTile"];
/** Where a tile's action leads — always the surface that owns the connection. */
export type IntegrationLink = components["schemas"]["IntegrationLink"];

/** The org routes, and every channel's availability. */
export type NotificationRoutes = components["schemas"]["NotificationRoutes"];
/** One org-level route, with its lock derived. */
export type NotificationRoute = components["schemas"]["NotificationRoute"];
/** Where a route delivers. */
export type NotificationRouteChannel = components["schemas"]["NotificationRouteChannel"];
/** A route's settings — when it sends and to whom. */
export type NotificationRouteConfig = components["schemas"]["NotificationRouteConfig"];
/** What saving a route takes — every field optional. */
export type NotificationRoutePatch = components["schemas"]["NotificationRoutePatch"];

/** The `code` the service refuses with when a save would arm a route that cannot fire. */
export const ROUTE_LOCKED_CODE = "notification_route_locked";

/** The integrations grid and the org routes, as `ouroboros-rest` serves them. */
export const settingsIntegrations = {
  /**
   * The integrations grid.
   *
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The tiles and the connected count.
   * @throws {ApiError} What the service answered.
   */
  async read(client: ApiClient = api()): Promise<Integrations> {
    return unwrap(await client.GET("/api/v1/settings/integrations", {}));
  },

  /**
   * The org notification routes.
   *
   * @param client The client to call through.
   * @returns The four core kinds in the card's order, then any custom kind, and the channels.
   * @throws {ApiError} What the service answered.
   */
  async routes(client: ApiClient = api()): Promise<NotificationRoutes> {
    return unwrap(await client.GET("/api/v1/settings/notifications", {}));
  },

  /**
   * Save one org notification route.
   *
   * @param kind The route — `daily_digest`, or `custom:<slug>`.
   * @param patch What changed. A body carrying nothing reads the route back.
   * @param client The client to call through.
   * @returns The route as it now stands.
   * @throws {ApiError} `409` {@link ROUTE_LOCKED_CODE} for a save that would leave the route
   *   enabled on a channel that cannot deliver; `422` with `details.fields` for a malformed
   *   config; `403` for a reader who is not an owner or an admin.
   */
  async updateRoute(
    kind: string,
    patch: NotificationRoutePatch,
    client: ApiClient = api(),
  ): Promise<NotificationRoute> {
    return unwrap(
      await client.PATCH("/api/v1/settings/notifications/{kind}", {
        params: { path: { kind } },
        body: patch,
      }),
    );
  },
};
