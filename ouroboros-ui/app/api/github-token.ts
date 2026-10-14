import "server-only";

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/**
 * The workspace's backlog GitHub token — `/api/v1/settings/github-token`
 * ([#1250](https://github.com/NobuData/ouroboros/issues/1250)).
 *
 * The token the **Issues** backlog reads GitHub with. It is not a ticket source's credential:
 * a source keeps its own, and storing one there leaves the backlog paused. All three
 * operations answer the same resource, which never carries the token — only its mask.
 *
 * The service lets owners and admins call these and nobody else, the read included.
 */

/** What the service says about the stored token: whether there is one, its mask and its dates. */
export type GithubToken = components["schemas"]["GithubToken"];

export const githubToken = {
  /**
   * Read the token's state.
   *
   * @param client The API client. Defaults to this request's.
   * @returns The masked resource, or `configured: false`.
   * @throws {ApiError} A `403` for a caller who is neither an owner nor an admin.
   */
  async read(client: ApiClient = api()): Promise<GithubToken> {
    return unwrap(await client.GET("/api/v1/settings/github-token"));
  },

  /**
   * Store a token, or replace the one that is there.
   *
   * @param token The GitHub token.
   * @param client The API client. Defaults to this request's.
   * @returns The masked resource as it now stands.
   * @throws {ApiError} A `422` for a value that is not shaped like a GitHub token.
   */
  async set(token: string, client: ApiClient = api()): Promise<GithubToken> {
    return unwrap(await client.PUT("/api/v1/settings/github-token", { body: { token } }));
  },

  /**
   * Remove the token. Idempotent.
   *
   * @param client The API client. Defaults to this request's.
   * @returns The not-configured resource.
   */
  async clear(client: ApiClient = api()): Promise<GithubToken> {
    return unwrap(await client.DELETE("/api/v1/settings/github-token"));
  },
};
