"use server";

/**
 * The server hops for the enroll card and the token list
 * (AI.3, [#258](https://github.com/NobuData/ouroboros/issues/258)) — the calls their Client
 * Components cannot make themselves.
 *
 * `app/api/server.ts` states the rule this exists under, and `app/sources/actions.ts` is the
 * same seam for the page beside it: the browser cannot reach REST — `OURO_REST_URL` has no
 * `NEXT_PUBLIC_` prefix and the session cookie is `HttpOnly` — so a Client Component that needs
 * something from the API calls a Server Action that calls it.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in any call and no person.** A token belongs to *the workspace the
 *   caller's own session is acting in*, and is attributed to the session's own user — both
 *   resolved by `ouroboros-rest` from the cookie this request carries. There is nothing to forge.
 * - **The role gate is the service's, not this module's** — `owner` or `admin`, and nobody else.
 *   The card draws a member no mint and no copy, but that is *presentation*: the check that
 *   decides is behind the API, and a member who reaches an action anyway gets the service's
 *   `403` and mints nothing. **Minting and revoking are audited there too** (AH.2, #250).
 *
 * ### The one secret this module touches
 *
 * {@link mintEnrollCommand} answers the full command — it has to, because the clipboard is in
 * the browser. It is the *only* field that carries the value: the command as **shown** is masked
 * here, on the server (`maskedCommand`), so the component never holds a string it would have to
 * be careful with except the one it hands straight to the clipboard. Nothing here logs.
 *
 * ### Failure posture: a value, not a throw
 *
 * A refusal comes back as a value, for the reason `app/sources/actions.ts` gives. The one throw
 * that must travel is Next.js's redirect signal, for a session that expired since the page
 * rendered.
 *
 * **Every value this module needs is imported rather than declared.** A `"use server"` module
 * may export nothing but async functions, so the outcome types and the sentences live in
 * `app/farm/enroll.ts`.
 */

import { isApiError } from "@/app/api/errors";
import { farm } from "@/app/api/farm";

import {
  type MintOutcome,
  type RevokeOutcome,
  type TokenListing,
  maskedCommand,
  mintRefusal,
  revokeRefusal,
} from "./enroll";
import { readTokenListing } from "./token-data";

/**
 * Mint a single-use enrollment token and answer the install command that carries it.
 *
 * **Every call mints.** It is called by a press of *Copy command* and by nothing else.
 *
 * @param pool The pool the enrolled machine joins.
 * @returns The command — **secret**, for the clipboard alone — beside everything the card may
 *   draw: the command masked, the deployment's origin, the pinned version and the masked token.
 *   Or the sentence to show instead; **a refusal means nothing was minted.**
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function mintEnrollCommand(pool: string): Promise<MintOutcome> {
  try {
    const minted = await farm.enrollCommand(pool);

    return {
      ok: true,
      command: minted.command,
      shown: maskedCommand(minted.command, minted.token.masked),
      origin: minted.origin,
      version: minted.version,
      token: minted.token,
    };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: mintRefusal(error.code) };
  }
}

/**
 * Read the workspace's enrollment tokens, for the sheet and for a refresh.
 *
 * @returns The listing, or the sentence to show instead.
 * @throws Whatever is not an `ApiError`.
 */
export async function readEnrollmentTokens(): Promise<TokenListing> {
  return readTokenListing();
}

/**
 * Revoke a token.
 *
 * @param id The token.
 * @returns The token as it now stands — revoked, with the uses it had spent — or why not.
 *   Revoking a revoked token is a success: the caller asked for it to be dead and it is.
 * @throws Whatever is not an `ApiError`.
 */
export async function revokeEnrollmentToken(id: string): Promise<RevokeOutcome> {
  try {
    return { ok: true, token: await farm.revokeToken(id) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: revokeRefusal(error.code) };
  }
}
