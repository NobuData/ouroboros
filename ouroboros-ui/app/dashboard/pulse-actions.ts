"use server";

/**
 * The server hop for the pulse card's switch
 * ([#83](https://github.com/NobuData/ouroboros/issues/83)) — the one call a Client Component
 * cannot make itself.
 *
 * `app/api/server.ts` states the rule this exists under, and `app/shell/preference-actions.ts`
 * is the same seam for the font scale: the browser cannot reach REST — `OURO_REST_URL` has no
 * `NEXT_PUBLIC_` prefix and the session cookie is `HttpOnly` — so *"a Client Component that
 * needs to write something calls a Server Action that calls this."* The switch is a Client
 * Component because it is optimistic; this is its action, opened beside it.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * The paragraph every action module in this product carries, and this is the one where it
 * matters most, because this is the only write the dashboard makes:
 *
 * - **The only argument is the switch's new position.** There is no workspace in the call
 *   and no person: the setting belongs to *the workspace the caller's own session is acting
 *   in*, resolved by `ouroboros-rest` from the cookie this request carries. There is nothing
 *   to forge and no way to point the write at somebody else's workspace.
 * - **The role gate is the service's, not this module's** ([#74](https://github.com/NobuData/ouroboros/issues/74)
 *   — `owner` or `admin`, and nobody else). The switch renders read-only for a role that may
 *   not press it, but that is *presentation*: a check made in the browser is a check anybody
 *   can skip, so the one that decides is behind the API, and a `member` who reaches this
 *   action anyway gets the service's `403` and writes nothing. Duplicating the rule here
 *   would create a second copy of it to drift.
 *
 * ### Failure posture: loud, and the switch goes back
 *
 * The opposite of `saveFontScale`'s, and the difference is what the write *means*. A font
 * scale that failed to persist still applied — the reader is looking at the size they chose,
 * and the only loss is that their next device will not remember it. This switch changes
 * **what the loop does without asking a human**, so a flip that did not persist must not be
 * left drawn as though it had: the reason comes back as a value, and the caller rolls the
 * optimistic toggle back and shows it.
 */

import { isApiError } from "@/app/api/errors";
import { FORBIDDEN_ROLE_CODE, autoMerge } from "@/app/api/settings";

import { AUTO_MERGE_READ_ONLY, AUTO_MERGE_WRITE_FAILURE, type AutoMergeResult } from "./view";

/**
 * **Every value this module needs is imported rather than declared.** A `"use server"` module
 * may export nothing but async functions — a `const` beside them is not a lint rule but a
 * build error, and the whole module is treated as exporting nothing — so the two sentences
 * and the result type live in `app/dashboard/view.ts` with the rest of this card's copy, which
 * is also where the switch's tooltip reads its half from.
 */

/**
 * Move this workspace's auto-merge switch.
 *
 * @param enabled The position to move to — the state to *be in* rather than a request to
 *   invert whatever is stored, so two administrators pressing at once agree on an outcome.
 * @returns Where the switch stands, or the sentence to show for a refusal. A refusal is a
 *   value rather than a throw because it is **a state to render**: one card's control failing
 *   must not replace the dashboard the reader is still entitled to be on.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all, which is how a
 *   session that expired since the page rendered still reaches the login screen.
 */
export async function setAutoMerge(enabled: boolean): Promise<AutoMergeResult> {
  try {
    return { ok: true, enabled: (await autoMerge.set(enabled)).enabled };
  } catch (error) {
    if (!isApiError(error)) throw error;

    // The service's own `403` message is written for an API caller. This answers with the
    // sentence the switch's tooltip already carries, from the one place it is written: a
    // reader who somehow pressed a control they may not press is told what the tooltip on
    // it would have told them, in the same words.
    if (error.code === FORBIDDEN_ROLE_CODE) {
      return { ok: false, reason: AUTO_MERGE_READ_ONLY };
    }

    return {
      ok: false,
      reason: error.message === "" ? AUTO_MERGE_WRITE_FAILURE : error.message,
    };
  }
}
