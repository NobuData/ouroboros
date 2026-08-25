"use server";

/**
 * The server hops for the key management flows
 * ([#229](https://github.com/NobuData/ouroboros/issues/229)): reveal, rotate, delete, the
 * address save, and the step-up's fresh sign-in.
 *
 * `card-actions.ts` is the seam this extends and states the rule it exists under: the
 * browser cannot reach `ouroboros-rest`, so a Client Component that needs to write calls a
 * Server Action that calls it. Everything that file says about a Server Action being a POST
 * endpoint anybody can reach is true of each of these, and each carries the same three
 * facts: **no workspace and no person in the call** — the connection belongs to the
 * workspace the caller's own session is acting in, and a foreign id is the service's `404`;
 * **the role gate is the service's** — a member who reaches any of these gets its `403`,
 * handed back as the same sentence the card would have shown; and **a refusal is a value**,
 * because the card is on a page the reader is still entitled to be on.
 *
 * ### One of these returns a secret
 *
 * {@link revealCredential} is the only Server Action in this module family whose answer
 * carries secret material. It is the service's decision that a browser may hold the value
 * (decision **P4**: behind a step-up, rate-limited, audited, with an `expiresAt`), and this
 * hop adds nothing and removes nothing — it does not log the value, does not cache it, and
 * hands back exactly the three fields the contract sends. What the browser then does with
 * it is `key-row.tsx`'s: shown in place, masked on the service's timer and on navigation.
 *
 * ### A wrong password is an absent one, here too
 *
 * `revealCredential` forwards a password when it was given one and sends `{}` otherwise,
 * and a `401 step_up_required` comes back as the *same* challenge either way. It is the
 * service's rule and this file keeps it: nothing here can tell a reader more than the
 * service told it.
 *
 * ### The fresh sign-in is a sign-out with a return-to
 *
 * The `session` method of the step-up is a session *created* inside the window, and a
 * GitHub-only account has no other. The only way to create one is to end this one, so
 * {@link reauthenticate} is `signOutSession` with the providers page as the return-to — the
 * one caller that signs out in order to come straight back.
 */

import { signOutSession } from "@/app/api/auth-server";
import { isApiError } from "@/app/api/errors";
import { providers } from "@/app/api/providers";
import { PROVIDERS_PATH } from "@/app/paths";

import { BASE_URL_FIELD } from "./catalog";
import {
  type AddressOutcome,
  type RemoveOutcome,
  type RevealOutcome,
  type RotateOutcome,
  addressRefusal,
  removeRefusal,
  revealRefusal,
  rotateRefusal,
} from "./keys";

/**
 * Reveal a connection's credential.
 *
 * @param id The connection.
 * @param password The reader's own password, when the step-up dialog collected one. Sent as
 *   typed — a password is opaque — and never kept. Absent or empty, the request leans on a
 *   session created inside the window.
 * @returns The value with its expiry, the challenge, or the reason.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function revealCredential(id: string, password?: string): Promise<RevealOutcome> {
  try {
    const revealed = await providers.reveal(
      id,
      password === undefined || password === "" ? {} : { password },
    );

    return {
      ok: true,
      connectionId: revealed.connectionId,
      value: revealed.value,
      expiresAt: revealed.expiresAt,
    };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return revealRefusal(error);
  }
}

/**
 * Replace a connection's credential — or store its first.
 *
 * The service checks the new key with the provider before it writes anything, so an `ok:
 * false` here means the key in use before the call is the key in use after it.
 *
 * @param id The connection.
 * @param secret The new key, exactly as typed.
 * @returns The connection's new mask, or the reason.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function rotateCredential(id: string, secret: string): Promise<RotateOutcome> {
  try {
    const connection = await providers.rotate(id, secret);

    return { ok: true, mask: connection.mask };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return rotateRefusal(error);
  }
}

/**
 * Disconnect a provider.
 *
 * @param id The connection.
 * @returns Gone; or the aliases that still resolve through it, in the service's own words;
 *   or the reason.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function removeProvider(id: string): Promise<RemoveOutcome> {
  try {
    await providers.remove(id);

    return { ok: true };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return removeRefusal(error);
  }
}

/**
 * Save a connection's address — the vLLM card's **Base URL**, the Ollama card's **Host**.
 *
 * A `PATCH` carrying the one field, under the name the contract reserves for it across every
 * adapter. The service checks the new address against the adapter's schema and then asks the
 * provider at it, with the stored key, before it writes — so an `ok: false` here means the
 * address in use before the call is the address in use after it.
 *
 * @param id The connection.
 * @param baseUrl The address, as typed.
 * @returns The address as stored, or the reason.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function saveProviderAddress(id: string, baseUrl: string): Promise<AddressOutcome> {
  try {
    const connection = await providers.update(id, { config: { [BASE_URL_FIELD]: baseUrl } });

    return { ok: true, value: connection.baseUrl };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return addressRefusal(error, BASE_URL_FIELD);
  }
}

/**
 * End this session so a fresh one can be started — the step-up's `session` method.
 *
 * Everything it does is `signOutSession()`'s, with the providers page as the return-to. It
 * takes no arguments even though a form hands its action `FormData`, for the reason
 * `app/shell/actions.ts` gives.
 *
 * @throws Next.js's redirect signal, always — to `/login?next=/models/providers`.
 */
export async function reauthenticate(): Promise<void> {
  await signOutSession(fetch, PROVIDERS_PATH);
}
