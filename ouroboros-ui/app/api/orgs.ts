/**
 * The GitHub-organisations resource — the workspace's enablement list.
 *
 * A row records that an organisation is *known*; its `enabled` flag records that somebody
 * deliberately turned it on. Both operations here are per workspace, and the workspace is
 * in the path rather than in the `X-Ouro-Tenant` header, so a caller naming a workspace it
 * does not belong to gets the same `404` as one naming a workspace that does not exist —
 * the contract deliberately does not distinguish them.
 *
 * One line per operation over the generated client, in the shape `app/api/tenants.ts`
 * established. Server-side only, by way of `app/api/server.ts`.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components, operations } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** One GitHub organisation a workspace has recorded, enabled or not. */
export type Org = components["schemas"]["Org"];

/** A page of organisations: `{items, total, limit, offset}`. */
export type OrgPage = components["schemas"]["OrgPage"];

/** The window a listing accepts — `?limit=&offset=`, both optional. */
export type OrgListQuery = NonNullable<operations["listOrgs"]["parameters"]["query"]>;

/**
 * A workspace's GitHub organisations, and whether Ouroboros may work in them.
 *
 * Each method takes the client as an optional last argument, defaulting to the wired
 * server-side one. Production never passes it; tests pass a client over a stub `fetch`.
 */
export const orgs = {
  /**
   * One page of the workspace's organisations, by login — **including the disabled ones**,
   * because the screen has to render the switch that is off.
   *
   * @param tenantId The workspace's uuid.
   * @param query `limit` (1–100, default 25) and `offset`. Omitted, the service's own
   *   defaults apply; the page is echoed back in the response either way.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The page. A workspace with no organisations recorded gets an empty one.
   * @throws {ApiError} What the service answered. A `401` redirects to login first.
   */
  async list(
    tenantId: string,
    query: OrgListQuery = {},
    client: ApiClient = api(),
  ): Promise<OrgPage> {
    return unwrap(
      await client.GET("/api/v1/tenants/{tenantId}/orgs", {
        params: { path: { tenantId }, query },
      }),
    );
  },

  /**
   * Turn an organisation on or off for this workspace.
   *
   * Turning it off suspends everything under it **without** discarding the per-repository
   * choices underneath — which is why there are two flags rather than one, and why this
   * touches only the organisation's.
   *
   * @param tenantId The workspace's uuid.
   * @param login The organisation's lower-cased GitHub login.
   * @param enabled What the flag should become.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The organisation, after the change.
   * @throws {ApiError} What the service answered — `403 insufficient_role` for a caller
   *   who may read the workspace but not administer it, `404` for an organisation this
   *   workspace has not recorded.
   */
  async setEnabled(
    tenantId: string,
    login: string,
    enabled: boolean,
    client: ApiClient = api(),
  ): Promise<Org> {
    return unwrap(
      await client.PATCH("/api/v1/tenants/{tenantId}/orgs/{login}", {
        params: { path: { tenantId, login } },
        body: { enabled },
      }),
    );
  },
};
