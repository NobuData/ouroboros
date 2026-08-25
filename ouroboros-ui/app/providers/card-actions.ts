"use server";

/**
 * The server hop for the provider card's switch
 * ([#228](https://github.com/NobuData/ouroboros/issues/228)) and, since AE.6
 * ([#232](https://github.com/NobuData/ouroboros/issues/232)), its monthly cap — the two
 * writes a card makes to its own row.
 *
 * `app/api/server.ts` states the rule this exists under, and `app/providers/add-actions.ts` is
 * the same seam for the dialog beside it: the browser cannot reach REST, so a Client Component
 * that needs to write calls a Server Action that calls it.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in the call and no person.** The connection belongs to the
 *   workspace the caller's own session is acting in, resolved by `ouroboros-rest` from the
 *   cookie this request carries; a connection id from another workspace is the service's
 *   `404`, never a write.
 * - **The role gate is the service's.** `owner` or `admin`, and nobody else (AD.2). The card
 *   draws its switch read-only for a member, but that is presentation; a member who reaches
 *   this anyway gets the service's `403` and changes nothing, handed back here as the same
 *   sentence the read-only switch already shows.
 * - **What is sent is the position asked for**, and only that: a `PATCH` of `{ enabled }`, so
 *   the switch never resends an address or a cap it does not own — and the cap's hop sends
 *   `{ monthlyCapCents }` and nothing else, for the same reason.
 *
 * ### Failure posture: a value, not a throw
 *
 * A refusal comes back as a value the switch draws under itself, because the card is on a
 * page the reader is still entitled to be on. The one throw that must travel is Next.js's
 * redirect signal, for a session that expired since the page rendered.
 */

import { isApiError } from "@/app/api/errors";
import { providers } from "@/app/api/providers";

import { type CapOutcome, capRefusal } from "./caps";
import { SWITCH_FAILED, SWITCH_GONE, SWITCH_READ_ONLY } from "./cards";

/** What one press produced. */
export type SwitchOutcome =
  /** The position the service now holds — which is what the switch will draw. */
  | { readonly ok: true; readonly enabled: boolean }
  /** Why not — a sentence already written for a reader. */
  | { readonly ok: false; readonly reason: string };

/** The service's code for a role that may read the card and not write to it. */
const FORBIDDEN_CODE = "forbidden";

/** The service's code for a connection this workspace no longer has. */
const NOT_FOUND_CODE = "provider_connection_not_found";

/**
 * Switch a connection on or off.
 *
 * @param id The connection.
 * @param enabled The position to move to — the state asked for, never the state the switch
 *   was in, so a stale render asks for something specific.
 * @returns The position as stored, or the reason the press did not take.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function setProviderEnabled(id: string, enabled: boolean): Promise<SwitchOutcome> {
  try {
    const connection = await providers.update(id, { enabled });

    return { ok: true, enabled: connection.enabled };
  } catch (error) {
    if (!isApiError(error)) throw error;

    if (error.code === FORBIDDEN_CODE) return { ok: false, reason: SWITCH_READ_ONLY };
    if (error.code === NOT_FOUND_CODE) return { ok: false, reason: SWITCH_GONE };

    return { ok: false, reason: SWITCH_FAILED };
  }
}

/**
 * Set or clear a connection's monthly cap.
 *
 * @param id The connection.
 * @param monthlyCapCents The cap in whole cents, or `null` to clear it — *no cap*, which the
 *   contract distinguishes from `0`, a real cap meaning *spend nothing*. Already parsed:
 *   `app/providers/caps.ts`'s `parseCap` is what turns typed text into this, and it runs in
 *   the browser so a refusal there costs no round trip.
 * @returns The cap as stored, or the reason the save did not take.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function setProviderCap(
  id: string,
  monthlyCapCents: number | null,
): Promise<CapOutcome> {
  try {
    const connection = await providers.update(id, { monthlyCapCents });

    return { ok: true, cents: connection.monthlyCapCents };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return capRefusal(error);
  }
}
