"use server";

/**
 * The server hop for the allowed-models table's **On** switch
 * ([#592](https://github.com/NobuData/ouroboros/issues/592)) — the one write the table makes.
 *
 * `app/api/server.ts` states the rule this exists under, and `app/providers/card-actions.ts`
 * is the same seam for the provider card's switch: the browser cannot reach REST, so a Client
 * Component that needs to write calls a Server Action that calls it.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in the call and no person.** The alias belongs to the workspace
 *   the caller's own session is acting in, resolved by `ouroboros-rest` from the cookie this
 *   request carries; an alias id from another workspace is the service's `404`, never a
 *   write.
 * - **The role gate is the service's.** `owner` or `admin`, and nobody else (CH.1). The table
 *   draws its switch read-only for a member, but that is presentation; a member who reaches
 *   this anyway gets the service's `403` and changes nothing, handed back here as the same
 *   sentence the read-only switch already shows.
 * - **The binding gate is the service's too.** The unbound row's switch is inert in the
 *   table, but a stale render can still ask; the service refuses with `model_alias_unbound`,
 *   and the switch says the same sentence it would have said as a tooltip.
 * - **What is sent is the position asked for**, and only that: a `PATCH` of `{ enabled }`, so
 *   the switch never resends a binding or a params document it does not own.
 *
 * ### Failure posture: a value, not a throw
 *
 * A refusal comes back as a value the switch draws under itself, because the table is on a
 * page the reader is still entitled to be on. The one throw that must travel is Next.js's
 * redirect signal, for a session that expired since the page rendered.
 */

import { isApiError } from "@/app/api/errors";
import { registry } from "@/app/api/registry";

import { SWITCH_FAILED, SWITCH_GONE, SWITCH_READ_ONLY, SWITCH_UNBOUND } from "./table";

/** What one press produced. */
export type SwitchOutcome =
  /**
   * The position the service now holds — which is what the switch will draw — and the
   * referrers whose hops the next resolution will drop, which is empty for everything but a
   * referenced alias switched off.
   */
  | { readonly ok: true; readonly enabled: boolean; readonly droppedHops: readonly string[] }
  /** Why not — a sentence already written for a reader. */
  | { readonly ok: false; readonly reason: string };

/** The service's code for a role that may read the table and not write to it. */
const FORBIDDEN_CODE = "forbidden";

/** The service's code for an alias this workspace no longer has. */
const NOT_FOUND_CODE = "model_alias_not_found";

/** The service's code for a switch-on the binding does not allow. */
const UNBOUND_CODE = "model_alias_unbound";

/**
 * Switch an alias on or off.
 *
 * @param id The alias.
 * @param enabled The position to move to — the state asked for, never the state the switch
 *   was in, so a stale render asks for something specific.
 * @returns The position as stored, or the reason the press did not take.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function setAliasEnabled(id: string, enabled: boolean): Promise<SwitchOutcome> {
  try {
    const change = await registry.update(id, { enabled });

    return {
      ok: true,
      enabled: change.alias.enabled,
      droppedHops: change.droppedHops.map((reference) => reference.label),
    };
  } catch (error) {
    if (!isApiError(error)) throw error;

    if (error.code === FORBIDDEN_CODE) return { ok: false, reason: SWITCH_READ_ONLY };
    if (error.code === NOT_FOUND_CODE) return { ok: false, reason: SWITCH_GONE };
    if (error.code === UNBOUND_CODE) return { ok: false, reason: SWITCH_UNBOUND };

    return { ok: false, reason: SWITCH_FAILED };
  }
}
