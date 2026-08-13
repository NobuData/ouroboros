"use server";

/**
 * The server hop for the font-scale preference
 * ([#649](https://github.com/NobuData/ouroboros/issues/649)) — the two calls a Client
 * Component cannot make itself.
 *
 * `app/api/server.ts` states the rule these exist under: the browser cannot reach REST —
 * `OURO_REST_URL` has no `NEXT_PUBLIC_` prefix and the session cookie is `HttpOnly` — so
 * *"a Client Component that needs to write something calls a Server Action that calls
 * this."* The stepper and the session reconciler are Client Components; these are their
 * actions, opened beside their callers the way `actions.ts` opened sign-out beside the menu.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * The paragraph every action module in this product carries, and here it is short: both
 * actions act on *the caller's own session*. The REST routes resolve the person from the
 * cookie this request carries — there is no id to forge and nobody else's row reachable —
 * and a request with no session is `api()`'s to answer, which it does by redirecting to
 * the login screen the way every server read does.
 *
 * ### Failure posture: quiet, and local wins meanwhile
 *
 * `saveFontScale` swallowing nothing would mean a stepper press that *worked* — the screen
 * rescaled, the mirror moved — surfacing an error because the durable half failed. That is
 * `storeSidebarChoice`'s posture exactly: the choice applies to this session and simply
 * will not be remembered, so the answer says whether it stuck and the caller decides
 * whether that is worth a sentence to the reader.
 */

import { preferences } from "@/app/api/preferences";
import type { FontScale } from "@/app/font-scale";

/**
 * The caller's stored font scale — the server truth the mirror reconciles against.
 *
 * @returns Their step: the stored choice, or `'100'` for a person who has never chosen —
 *   the API synthesizes the default, so this never answers "nothing".
 */
export async function readFontScale(): Promise<FontScale> {
  return (await preferences.read()).fontScale;
}

/**
 * Persist a step to the caller's account, so their next device boots at it.
 *
 * @param scale The step to store. The five-value union holds at compile time; the API's
 *   422 and the CHECK behind it hold at run time, so a forged POST stores nothing.
 * @returns Whether it stuck. `false` is the quiet failure the module header argues for —
 *   the caller has already applied the scale locally, and the reader is mid-read at the
 *   size they just chose.
 */
export async function saveFontScale(scale: FontScale): Promise<boolean> {
  try {
    await preferences.update({ fontScale: scale });
    return true;
  } catch {
    return false;
  }
}
