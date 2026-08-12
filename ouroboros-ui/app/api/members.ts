/**
 * The members resource — who belongs to a workspace, and in what role.
 *
 * One line over the generated client, in the shape `app/api/tenants.ts` established. Only
 * the listing is wrapped: the dashboard (#45) needs a count and the roles behind it, and
 * inviting, removing and re-roling somebody are the workspace-settings screen's (#491)
 * mutations rather than this file's — a facade that wrapped operations nothing calls would
 * be three more signatures to keep in step with the contract for no reader.
 *
 * The workspace is in the path rather than in the `X-Ouro-Tenant` header, so a caller
 * naming a workspace it does not belong to gets the same `404` as one naming a workspace
 * that does not exist — the contract deliberately does not distinguish them.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components, operations } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** One member: the person, and what they may do in this workspace. */
export type Member = components["schemas"]["Member"];

/** A page of members: `{items, total, limit, offset}`. */
export type MemberPage = components["schemas"]["MemberPage"];

/** The window a listing accepts — `?limit=&offset=`, both optional. */
export type MemberListQuery = NonNullable<operations["listMembers"]["parameters"]["query"]>;

/**
 * A workspace's members.
 *
 * The method takes the client as an optional last argument, defaulting to the wired
 * server-side one. Production never passes it; tests pass a client over a stub `fetch`,
 * which is what lets this be covered without a request, an environment or a cookie.
 */
export const members = {
  /**
   * One page of the workspace's members, by name.
   *
   * @param tenantId The workspace's uuid.
   * @param query `limit` (1–100, default 25) and `offset`. Omitted, the service's own
   *   defaults apply — the page is echoed back in the response, so a caller that sent
   *   neither still knows what it got.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The page. `total` is the workspace's whole membership however small the
   *   window was, which is the field a count should be read from.
   * @throws {ApiError} What the service answered. A `401` redirects to login first.
   */
  async list(
    tenantId: string,
    query: MemberListQuery = {},
    client: ApiClient = api(),
  ): Promise<MemberPage> {
    return unwrap(
      await client.GET("/api/v1/tenants/{tenantId}/members", {
        params: { path: { tenantId }, query },
      }),
    );
  },
};
