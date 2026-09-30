/**
 * The workspace's org-level policies — today, the dry-run policy (BA.3,
 * [#382](https://github.com/NobuData/ouroboros/issues/382)).
 *
 * `/api/v1/policies/dry-run` is **the one source every consuming surface reads**: the merge plan
 * carries the same state as `plan.dryRun`, and this module reads it with its attribution and
 * flips it. The flip is `owner`/`admin` at the service — a `member` or `viewer` gets the API's one
 * `403` (`code: "forbidden"`) — and the UI only mirrors that as presentation.
 *
 * Server-side only, by way of `app/api/server.ts`.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** The dry-run policy, with its attribution. */
export type DryRunPolicy = components["schemas"]["DryRunPolicy"];

/** The `code` the service answers a role that may read the policy and not flip it. */
export const FORBIDDEN_CODE = "forbidden";

/** The dry-run policy, as `ouroboros-rest` keeps it. */
export const dryRunPolicy = {
  /**
   * Where the policy stands, and who last moved it.
   *
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The policy — never a `404`: a workspace that never answered reads off.
   * @throws {ApiError} What the service answered.
   */
  async read(client: ApiClient = api()): Promise<DryRunPolicy> {
    return unwrap(await client.GET("/api/v1/policies/dry-run", {}));
  },

  /**
   * Set the policy — the state to be in, not a toggle, so two administrators pressing at once
   * agree on an outcome.
   *
   * @param dryRun The new value.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The policy after the write.
   * @throws {ApiError} What the service answered — {@link FORBIDDEN_CODE} for a role below admin.
   */
  async set(dryRun: boolean, client: ApiClient = api()): Promise<DryRunPolicy> {
    return unwrap(await client.PATCH("/api/v1/policies/dry-run", { body: { dryRun } }));
  },
};
