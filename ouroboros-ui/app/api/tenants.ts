/**
 * The workspaces resource — the first of the contract's resources given a name.
 *
 * `api().GET("/api/v1/tenants", …)` is already fully typed; what this adds is a vocabulary
 * a screen can read (`tenants.list()`), one place where the path string is written down,
 * and a return type that is the body rather than the body-or-nothing every raw call
 * returns. Every method is one line over the generated client, on purpose: a facade that
 * reshaped the contract would be a second contract to keep in step with the first.
 *
 * **It is the pattern for the resources that follow.** A new one is a file beside this,
 * exporting a `const` of the same shape — the types come from the generated schema, never
 * from a hand-written interface, which is what makes a renamed field in
 * `ouroboros-rest/openapi.yaml` a failed typecheck here after `yarn api:sync` rather than
 * a surprise in a browser.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components, operations } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** One workspace, as the contract describes it. */
export type Tenant = components["schemas"]["Tenant"];

/** A page of workspaces: `{items, total, limit, offset}`. */
export type TenantPage = components["schemas"]["TenantPage"];

/** The window a listing accepts — `?limit=&offset=`, both optional. */
export type TenantListQuery = NonNullable<operations["listTenants"]["parameters"]["query"]>;

/**
 * The workspaces the signed-in person belongs to, and the one they are looking at.
 *
 * Each method takes the client as an optional last argument, defaulting to the wired
 * server-side one. Production never passes it; tests pass a client over a stub `fetch`,
 * which is what lets this be covered without a request, an environment or a cookie —
 * the same shape `app/env.ts` uses for the environment it reads.
 */
export const tenants = {
  /**
   * One page of the workspaces the caller belongs to, oldest first.
   *
   * @param query `limit` (1–100, default 25) and `offset`. Omitted, the service's own
   *   defaults apply — the page is echoed back in the response, so a caller that sent
   *   neither still knows what it got.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The page. Somebody who belongs to no workspace gets an empty one.
   * @throws {ApiError} What the service answered, parsed. A `401` redirects to login
   *   before this rejects.
   */
  async list(query: TenantListQuery = {}, client: ApiClient = api()): Promise<TenantPage> {
    return unwrap(await client.GET("/api/v1/tenants", { params: { query } }));
  },

  /**
   * One workspace by id.
   *
   * @param tenantId The workspace's uuid.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The workspace.
   * @throws {ApiError} What the service answered — `404 tenant_not_found` for a workspace
   *   that does not exist *or* one the caller does not belong to, which the contract
   *   deliberately does not distinguish.
   */
  async read(tenantId: string, client: ApiClient = api()): Promise<Tenant> {
    return unwrap(
      await client.GET("/api/v1/tenants/{tenantId}", { params: { path: { tenantId } } }),
    );
  },
};
