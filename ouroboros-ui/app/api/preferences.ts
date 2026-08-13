import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/**
 * `/api/v1/me/preferences`, as one object — the caller's own product preferences
 * ([#649](https://github.com/NobuData/ouroboros/issues/649)).
 *
 * The `tenants.ts` pattern, at its smallest: every method is one line over the generated
 * client, the types come from the generated schema and never from a hand-written interface,
 * and the client is a parameter with a server-side default so a test hands in a stub.
 *
 * Server-side by construction, like every facade on `api()` — the browser cannot reach
 * REST (no `NEXT_PUBLIC_` URL, an `HttpOnly` cookie) — so a Client Component that wants
 * these goes through the Server Actions in `app/shell/preference-actions.ts`, which exist
 * for exactly that hop.
 */

/** The whole preferences surface, as the contract promises it. */
export type Preferences = components["schemas"]["Preferences"];

/** What a change may carry — each field optional, absent meaning "unchanged". */
export type PreferencesPatch = components["schemas"]["PreferencesPatch"];

export const preferences = {
  /**
   * The caller's preferences, defaults included.
   *
   * @param client The API client to use. Defaults to the ambient server client.
   * @returns The surface. Never a 404: absence of a stored choice reads as the default.
   */
  async read(client: ApiClient = api()): Promise<Preferences> {
    return unwrap(await client.GET("/api/v1/me/preferences"));
  },

  /**
   * Change what `patch` carries; answer with the surface as it now stands.
   *
   * @param patch What changed. `{}` is legal and reads back the current state.
   * @param client The API client to use. Defaults to the ambient server client.
   * @returns The surface after the write.
   */
  async update(patch: PreferencesPatch, client: ApiClient = api()): Promise<Preferences> {
    return unwrap(await client.PATCH("/api/v1/me/preferences", { body: patch }));
  },
};
