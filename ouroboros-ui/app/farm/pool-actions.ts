"use server";

/**
 * The server hops for the pools card and its configuration sheet
 * (AI.4, [#259](https://github.com/NobuData/ouroboros/issues/259)) — the writes their Client
 * Components cannot make themselves.
 *
 * `app/farm/enroll-actions.ts` is the same seam for the card above this one, and states the rule:
 * the browser cannot reach REST, so a Client Component that needs something from the API calls a
 * Server Action that calls it.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in any call.** A pool belongs to *the workspace the caller's own
 *   session is acting in*, resolved by `ouroboros-rest` from the cookie this request carries.
 * - **The role gate is the service's, not this module's** — `owner` or `admin`, and nobody else.
 *   The card draws a member read-only switches and the sheet a read-only form, but that is
 *   *presentation*: a member who reaches an action anyway gets the service's `403` and changes
 *   nothing. **Every pool write is audited there too** (AH.6, #254).
 * - **The body is judged there as well.** TypeScript's types are a promise about this module's
 *   callers in this codebase, not about what a POST carries; `fleet.dto.ts` is what validates,
 *   and it refuses a field it does not know.
 *
 * ### Failure posture: a value, not a throw
 *
 * A refusal comes back as a value, for the reason `app/sources/actions.ts` gives. The one throw
 * that must travel is Next.js's redirect signal, for a session that expired since the page
 * rendered.
 *
 * **Every value this module needs is imported rather than declared.** A `"use server"` module
 * may export nothing but async functions, so the outcome types and the sentences live in
 * `app/farm/pools.ts`.
 */

import { isApiError } from "@/app/api/errors";
import { type RunnerPoolChange, type RunnerPoolCreate, farm } from "@/app/api/farm";

import {
  type PoolDeleteOutcome,
  type PoolWriteOutcome,
  deleteRefusal,
  writeRefusal,
} from "./pools";

/**
 * Create a pool.
 *
 * @param pool The pool — `poolCreate`'s, from a form that validated.
 * @returns The pool as stored, or the sentence and the fields it is about. **A refusal means
 *   nothing was created.**
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function createPool(pool: RunnerPoolCreate): Promise<PoolWriteOutcome> {
  try {
    return { ok: true, pool: await farm.createPool(pool) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, ...writeRefusal(error) };
  }
}

/**
 * Change a pool — the sheet's save, and each of the card's two switches.
 *
 * @param id The pool.
 * @param change The fields to change, and only those: what is not named is left alone.
 * @returns The pool as it now stands, or the sentence and the fields it is about. **A refusal
 *   means nothing was changed.**
 * @throws Whatever is not an `ApiError`.
 */
export async function updatePool(id: string, change: RunnerPoolChange): Promise<PoolWriteOutcome> {
  try {
    return { ok: true, pool: await farm.updatePool(id, change) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, ...writeRefusal(error) };
  }
}

/**
 * Delete a pool that nothing points at.
 *
 * @param id The pool.
 * @returns That it is gone, or why it is not — with the service's own counts when runners or
 *   builds still name it.
 * @throws Whatever is not an `ApiError`.
 */
export async function deletePool(id: string): Promise<PoolDeleteOutcome> {
  try {
    await farm.deletePool(id);

    return { ok: true };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: deleteRefusal(error) };
  }
}
