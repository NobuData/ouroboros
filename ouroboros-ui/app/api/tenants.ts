/**
 * The workspaces resource — the first of the contract's resources given a name.
 *
 * `api().GET("/api/v1/orgs", …)` is already fully typed; what this adds is a vocabulary
 * a screen can read (`tenants.list()`), one place where the path string is written down,
 * and a return type that is the body rather than the body-or-nothing every raw call
 * returns. Every method is one line over the generated client, on purpose: a facade that
 * reshaped the contract would be a second contract to keep in step with the first.
 *
 * **It moved from `/api/v1/tenants` to `/api/v1/orgs` in
 * [#714](https://github.com/NobuData/ouroboros/issues/714)**, and it did more than change a
 * path. A workspace *is* an organization since
 * [#704](https://github.com/NobuData/ouroboros/issues/704), so creating one, renaming one and
 * switching into one are BetterAuth's — called through `app/api/auth-client.ts`, never
 * through this. What is left here is the one read the plugin cannot answer, and it is the
 * whole of mockup 01 Step 2: every workspace the caller belongs to, with the monogram
 * initials, the personal flag, the enabled-repository counts and **the role they hold**, in
 * one request. `app/api/session.ts` composes the first two of those from
 * `organization/list` plus one `get-active-member-role` per workspace today;
 * [#719](https://github.com/NobuData/ouroboros/issues/719) is what re-points it here.
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

/** One workspace row, as mockup 01 Step 2 draws it. */
export type OrgRow = components["schemas"]["OrgRow"];

/** A page of workspaces: `{items, total, limit, offset}`. */
export type OrgRowPage = components["schemas"]["OrgRowPage"];

/** One workspace's GitHub organisation, as a row summarises it for its switch. */
export type OrgRowGithubOrg = components["schemas"]["GithubOrgSummary"];

/** How many repositories are on, and how many there are. */
export type RepoCounts = components["schemas"]["RepoCounts"];

/** The window a listing accepts — `?limit=&offset=`, both optional. */
export type TenantListQuery = NonNullable<operations["listOrgs"]["parameters"]["query"]>;

/**
 * The workspaces the signed-in person belongs to.
 *
 * The method takes the client as an optional last argument, defaulting to the wired
 * server-side one. Production never passes it; tests pass a client over a stub `fetch`,
 * which is what lets this be covered without a request, an environment or a cookie —
 * the same shape `app/env.ts` uses for the environment it reads.
 */
export const tenants = {
  /**
   * One page of the workspaces the caller belongs to, oldest first.
   *
   * **It needs no workspace to be chosen first**, and is the only operation in the contract
   * that does not: asking somebody to name a workspace before being told which they have
   * would be circular, and it is exactly the state `400 organization_required` tells them to
   * leave.
   *
   * @param query `limit` (1–100, default 25) and `offset`. Omitted, the service's own
   *   defaults apply — the page is echoed back in the response, so a caller that sent
   *   neither still knows what it got.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The page. Somebody who belongs to no workspace gets an empty one, which is the
   *   login screen's `no-workspace` state rather than a failure.
   * @throws {ApiError} What the service answered, parsed. A `401` redirects to login
   *   before this rejects.
   */
  async list(query: TenantListQuery = {}, client: ApiClient = api()): Promise<OrgRowPage> {
    return unwrap(await client.GET("/api/v1/orgs", { params: { query } }));
  },
};
