"use server";

/**
 * The server hops for the **alias inspector**
 * ([#593](https://github.com/NobuData/ouroboros/issues/593)) — the three writes its Client
 * Component cannot make itself.
 *
 * `app/api/server.ts` states the rule this exists under, and `app/registry/switch-actions.ts`
 * and `app/registry/create-actions.ts` are the same seam for the table's switch and the create
 * dialog: the browser cannot reach REST — `OURO_REST_URL` has no `NEXT_PUBLIC_` prefix and the
 * session cookie is `HttpOnly` — so a Client Component that needs to write calls a Server
 * Action that calls it.
 *
 * ### The card's two *reads* are not here, and that is the point
 *
 * The model list and the parameter schema are `create-actions.ts`'s `readModelOptions` and
 * `readParamSchema`, imported by the card unchanged. They ask the same two questions the create
 * dialog asks — *what models does this connection have*, *what can this model be tuned with* —
 * and a second pair of actions wrapping the same two calls would be two places for one answer
 * to drift. What is here is only what the inspector does that the dialog does not: change an
 * alias, copy one, and remove one.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * The paragraph every action module in this product carries:
 *
 * - **There is no workspace in any of the three calls and no person.** The alias belongs to the
 *   workspace the caller's own session is acting in, resolved by `ouroboros-rest` from the
 *   cookie this request carries; an alias id from another workspace is the service's `404`,
 *   never a write.
 * - **The role gate is the service's** — `owner` or `admin`, and nobody else (CH.1). The card
 *   draws every control inert for a member, but that is *presentation*: a check made in the
 *   browser is a check anybody can skip, so the one that decides is behind the API, and a
 *   member who reaches these anyway gets the service's `403` and writes nothing.
 * - **The guards are the service's too.** A rename of a referenced alias is
 *   `model_alias_rename_blocked`, a delete of one is `model_alias_referenced` decided *inside
 *   the delete's own transaction under a lock*, and a copy's name is composed by the service.
 *   The card anticipates all three from the references it already read, which is what makes it
 *   explain early; none of it is what decides.
 * - **What is sent is the difference and only the difference.** {@link saveAlias} forwards the
 *   body `inspector.ts`'s `updateBody` composed, and the contract writes only the fields
 *   present — so a rebind is a `PATCH` carrying a `connectionId` and nothing else.
 *
 * ### Failure posture: a value, not a throw
 *
 * A refusal comes back as a value. The card is part of a page the reader is still entitled to
 * be on, and a rejected action would replace it with an error screen — which is the wrong
 * outcome for "that name is taken". The one throw that must travel is Next.js's redirect
 * signal, for a session that expired since the page rendered.
 */

import type { ErrorEnvelope } from "@/app/api/errors";
import { isApiError } from "@/app/api/errors";
import { type UpdateModelAlias, registry } from "@/app/api/registry";

/**
 * **Every value this module needs is imported or inlined rather than declared.** A
 * `"use server"` module may export nothing but async functions — a `const` beside them is a
 * build error, and the whole module is then treated as exporting nothing — so the sentences
 * live in `app/registry/inspector.ts` with the rest of the card's decisions, and only types
 * (which are erased) are declared here.
 */

/** What one save produced. */
export type SaveOutcome =
  /**
   * The alias as stored, by name — which is what the page then selects, because a save may
   * have been a rename and the URL carries the name rather than the id.
   */
  | { readonly ok: true; readonly alias: string }
  /** The service's refusal, for `inspector.ts`'s `saveFailure` to turn into sentences. */
  | { readonly ok: false; readonly refusal: ErrorEnvelope };

/** What one duplicate produced. */
export type DuplicateOutcome =
  /** The copy's name, as the **service** composed it — `<alias>-copy`, or `-copy-2`, `-copy-3`. */
  | { readonly ok: true; readonly alias: string }
  /** The service's refusal. */
  | { readonly ok: false; readonly refusal: ErrorEnvelope };

/** What one removal produced. */
export type RemoveOutcome =
  /** Gone. There is no body and nothing to report about a row that no longer exists. */
  | { readonly ok: true }
  /** The service's refusal — a `409` naming the referrers above all. */
  | { readonly ok: false; readonly refusal: ErrorEnvelope };

/**
 * Save one alias — a rename, a rebind, new parameters, or any combination.
 *
 * @param id The alias.
 * @param change What changed, and only what changed. Composed by the card from
 *   `inspector.ts`'s `updateBody` and forwarded as it is: the name's shape, the rename guard,
 *   the model's existence in discovery and the parameters' fit to the model are all the
 *   service's checks, and the answer is the service's own envelope so the card can put each
 *   refusal under the field it is about.
 * @returns The stored alias's name, or the refusal. **A refusal means nothing was written** —
 *   the row is checked whole and written whole inside one transaction.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function saveAlias(id: string, change: UpdateModelAlias): Promise<SaveOutcome> {
  try {
    const written = await registry.update(id, change);

    return { ok: true, alias: written.alias.alias };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return {
      ok: false,
      refusal: { code: error.code, message: error.message, details: error.details },
    };
  }
}

/**
 * Copy one alias — the *same model, different keys* story, in one press.
 *
 * **The copy's name is not proposed here.** The service names it `<alias>-copy`, or `-copy-2`
 * and onwards when that is taken, inside the same transaction that makes it; a client that
 * proposed one would be a second opinion about a name two readers could reach at once.
 *
 * @param id The alias to copy.
 * @returns The copy's name — which the page then selects, so the row that was just made is the
 *   one the inspector is open on — or the refusal.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function duplicateAlias(id: string): Promise<DuplicateOutcome> {
  try {
    const copy = await registry.duplicate(id);

    return { ok: true, alias: copy.alias.alias };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return {
      ok: false,
      refusal: { code: error.code, message: error.message, details: error.details },
    };
  }
}

/**
 * Remove one alias.
 *
 * @param id The alias to remove.
 * @returns That it is gone, or the refusal. A `409 model_alias_referenced` carries
 *   `details.references` — every referrer with its kind and its chip label — which is the work
 *   list a reader is given rather than *something depends on this*.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function removeAlias(id: string): Promise<RemoveOutcome> {
  try {
    await registry.remove(id);

    return { ok: true };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return {
      ok: false,
      refusal: { code: error.code, message: error.message, details: error.details },
    };
  }
}
