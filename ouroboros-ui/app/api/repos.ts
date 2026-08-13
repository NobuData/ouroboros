/**
 * The repositories resource — the second half of the enablement list.
 *
 * A repository is in scope for Ouroboros only when its own `enabled` **and** its
 * organisation's are both true. Neither operation here applies that rule: they set the
 * flags, and whatever is about to act on a repository is what has to find both of them
 * true. The screen that renders them says so in words, because two switches that read
 * independently but act together would otherwise be a trap.
 *
 * A repository hangs from a GitHub organisation rather than from the workspace, which is why
 * every path here carries both — and why this is a file beside `app/api/orgs.ts` rather
 * than more methods on it. The resource names that parent `githubOrgId` rather than `orgId`
 * since [#714](https://github.com/NobuData/ouroboros/issues/714), because `orgId` is the
 * *workspace* everywhere else in the contract.
 *
 * Server-side only, by way of `app/api/server.ts`.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components, operations } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** One repository within an organisation. */
export type Repo = components["schemas"]["Repo"];

/** A page of repositories: `{items, total, limit, offset}`. */
export type RepoPage = components["schemas"]["RepoPage"];

/** The window a listing accepts — `?limit=&offset=`, both optional. */
export type RepoListQuery = NonNullable<operations["listRepos"]["parameters"]["query"]>;

/**
 * An organisation's repositories, and whether Ouroboros may work in them.
 *
 * Each method takes the client as an optional last argument, defaulting to the wired
 * server-side one. Production never passes it; tests pass a client over a stub `fetch`.
 */
export const repos = {
  /**
   * One page of the organisation's repositories, by name, enabled or not.
   *
   * @param tenantId The workspace's uuid.
   * @param login The organisation's lower-cased GitHub login.
   * @param query `limit` (1–100, default 25) and `offset`.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The page. An organisation with nothing recorded under it gets an empty one.
   * @throws {ApiError} What the service answered. A `401` redirects to login first.
   */
  async list(
    tenantId: string,
    login: string,
    query: RepoListQuery = {},
    client: ApiClient = api(),
  ): Promise<RepoPage> {
    return unwrap(
      await client.GET("/api/v1/orgs/{orgId}/github-orgs/{login}/repos", {
        params: { path: { orgId: tenantId, login }, query },
      }),
    );
  },

  /**
   * Turn a repository on or off — **and record it if this is the first Ouroboros has heard
   * of it.**
   *
   * There is no `POST` for a repository, and that is why this one creates: the GitHub App
   * installation flow that would discover repositories is future product work, so nothing
   * exists today to have created a row for somebody to then switch on. `defaultBranch` is
   * left alone when omitted rather than cleared — it is discovered from GitHub, and an
   * enable/disable is not the thing that should forget it.
   *
   * @param tenantId The workspace's uuid.
   * @param login The organisation's lower-cased GitHub login.
   * @param name The repository's name within that organisation, without the owner prefix.
   * @param enabled What the flag should become.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The repository, after the change — created if it was not there before.
   * @throws {ApiError} What the service answered — `403 insufficient_role` for a caller who
   *   may read the workspace but not administer it.
   */
  async setEnabled(
    tenantId: string,
    login: string,
    name: string,
    enabled: boolean,
    client: ApiClient = api(),
  ): Promise<Repo> {
    return unwrap(
      await client.PATCH("/api/v1/orgs/{orgId}/github-orgs/{login}/repos/{name}", {
        params: { path: { orgId: tenantId, login, name } },
        body: { enabled },
      }),
    );
  },
};
