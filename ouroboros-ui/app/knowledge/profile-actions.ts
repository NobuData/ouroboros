"use server";

/**
 * The server hop for the repo-profile card
 * (BG.4, [#420](https://github.com/NobuData/ouroboros/issues/420)) — the one call its Client
 * Component cannot make itself: saving the Environment block as the next version.
 *
 * `app/knowledge/facts-actions.ts` is the same seam for the learned-facts card and states the
 * rule: the browser cannot reach REST, so a Client Component that needs the API calls a Server
 * Action that calls it.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in the call and no person.** The recipe belongs to the workspace the
 *   caller's own session is acting in, and **the version is saved in the session's person's
 *   name**, both resolved by `ouroboros-rest` from the cookie — which is what makes *edited by
 *   Ken* a recorded fact rather than a claim the page made.
 * - **The gates are the service's.** A member's edit is drawn inert, but that is presentation; a
 *   member who reaches {@link saveEnvRecipe} anyway gets `403 forbidden` back as a value and
 *   writes nothing. Two editors racing: the loser gets `409 env_recipe_version_conflict`.
 *
 * A refusal comes back as a value, not a throw, so the block can show it. The one throw that
 * must travel is Next.js's redirect signal. A `"use server"` module may export only async
 * functions, so the sentences live in `app/knowledge/profile.ts`.
 */

import { type EnvRecipe, type SaveEnvRecipeBody, envRecipes } from "@/app/api/env-recipes";
import type { ErrorEnvelope } from "@/app/api/errors";
import { isApiError } from "@/app/api/errors";

/** What the call produced: the version now in force, or the service's refusal as a value. */
export type SaveRecipeOutcome =
  | { readonly ok: true; readonly value: EnvRecipe }
  | { readonly ok: false; readonly refusal: ErrorEnvelope };

/**
 * Save the block as the repository's next version.
 *
 * @param body The repository and the commands, in run order, as the editor parsed them —
 *   forwarded as they are.
 * @returns The version now in force, or the service's refusal.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function saveEnvRecipe(body: SaveEnvRecipeBody): Promise<SaveRecipeOutcome> {
  try {
    return { ok: true, value: await envRecipes.save(body) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return {
      ok: false,
      refusal: { code: error.code, message: error.message, details: error.details },
    };
  }
}
