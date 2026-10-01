/**
 * Environment recipes — mockup 14's Environment block, through `ouroboros-rest`
 * (BE.4's table, [#408](https://github.com/NobuData/ouroboros/issues/408); served and drawn by
 * BG.4, [#420](https://github.com/NobuData/ouroboros/issues/420)).
 *
 * ### An edit is a new version
 *
 * Decision **K7**: the block is the ordered setup commands the farm's container pools, the
 * prebuild tier and execution workspace prep run. A save sends the whole block and the service
 * stores it as the repository's **next** version; the one it followed stays readable. Two editors
 * racing get `409 env_recipe_version_conflict` for the loser, which the card turns into *re-read
 * and edit again*.
 *
 * ### A repository with no recipe is a state
 *
 * The read is `404 env_recipe_not_found` for one, which the reader keeps as *no recipe yet* rather
 * than as a failed read — the card draws an add action, not an error.
 *
 * ### The workspace is the session's
 *
 * No workspace in these paths and no `X-Ouro-Tenant` sent (`app/api/server.ts` says why). Every
 * member reads; saving is `owner` or `admin`.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** The recipe in force for a repository. */
export type EnvRecipe = components["schemas"]["EnvRecipe"];

/** One command, in run order, with the comment people read beside it. */
export type EnvRecipeCommand = components["schemas"]["EnvRecipeCommand"];

/** What a save sends: the repository and the whole block. */
export type SaveEnvRecipeBody = components["schemas"]["SaveEnvRecipeBody"];

/** One command as a save sends it — the comment omitted rather than empty. */
export type EnvRecipeCommandBody = components["schemas"]["EnvRecipeCommandBody"];

/** The code the service answers for a repository with no recipe. */
export const ENV_RECIPE_NOT_FOUND_CODE = "env_recipe_not_found";

/** The code the service answers when another editor saved the next version first. */
export const ENV_RECIPE_CONFLICT_CODE = "env_recipe_version_conflict";

/** Environment recipes, as `ouroboros-rest` serves them. */
export const envRecipes = {
  /**
   * The version in force for a repository.
   *
   * @param repo The repository, `owner/name`.
   * @param client The client to call through. Defaults to the server-side one; tests pass one
   *   over a stub `fetch`.
   * @returns The recipe.
   * @throws {ApiError} `404 env_recipe_not_found` for a repository with none.
   */
  async read(repo: string, client: ApiClient = api()): Promise<EnvRecipe> {
    return unwrap(await client.GET("/api/v1/knowledge/env-recipe", { params: { query: { repo } } }));
  },

  /**
   * Save the block as the repository's next version.
   *
   * @param body The repository and the commands, in run order.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The version now in force — the one just written.
   * @throws {ApiError} `403 forbidden` for a member, `409 env_recipe_version_conflict` when
   *   another editor saved first, `422 validation_failed` for a malformed block.
   */
  async save(body: SaveEnvRecipeBody, client: ApiClient = api()): Promise<EnvRecipe> {
    return unwrap(await client.PUT("/api/v1/knowledge/env-recipe", { body }));
  },
};
