/**
 * The GitHub-organisations resource — the workspace's enablement list.
 *
 * A row records that an organisation is *known*; its `enabled` flag records that somebody
 * deliberately turned it on. Both operations here are per workspace, and the workspace is
 * in the path rather than in the `X-Ouro-Tenant` header, so a caller naming a workspace it
 * does not belong to gets the same `404` as one naming a workspace that does not exist —
 * the contract deliberately does not distinguish them.
 *
 * **The paths gained a segment in [#714](https://github.com/NobuData/ouroboros/issues/714)**:
 * `/api/v1/orgs/{orgId}/github-orgs/{login}` rather than `/tenants/{tenantId}/orgs/{login}`.
 * Two words called "org" meet on that path and the segment is what keeps them apart —
 * `{orgId}` is the *workspace*, and these are GitHub's. The first argument of every method
 * below is therefore a workspace id, exactly as it was; only the URL it is written into
 * changed.
 *
 * One line per operation over the generated client, in the shape `app/api/tenants.ts`
 * established. Server-side only, by way of `app/api/server.ts`.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components, operations } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** One GitHub organisation a workspace has recorded, enabled or not. */
export type Org = components["schemas"]["GithubOrg"];

/** A page of organisations: `{items, total, limit, offset}`. */
export type OrgPage = components["schemas"]["GithubOrgPage"];

/** The window a listing accepts — `?limit=&offset=`, both optional. */
export type OrgListQuery = NonNullable<operations["listGithubOrgs"]["parameters"]["query"]>;

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
      await client.GET("/api/v1/orgs/{orgId}/github-orgs", {
        params: { path: { orgId: tenantId }, query },
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
      await client.PATCH("/api/v1/orgs/{orgId}/github-orgs/{login}", {
        params: { path: { orgId: tenantId, login } },
        body: { enabled },
      }),
    );
  },
};
