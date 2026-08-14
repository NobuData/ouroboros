"use server";

/**
 * The server hop for the tenant chip's repository list
 * ([#77](https://github.com/NobuData/ouroboros/issues/77)) — the one call a Client Component
 * cannot make itself.
 *
 * `app/api/server.ts` states the rule this exists under, and `app/shell/preference-actions.ts`
 * is the same seam for the font scale: the browser cannot reach REST — `OURO_REST_URL` has
 * no `NEXT_PUBLIC_` prefix and the session cookie is `HttpOnly` — so *"a Client Component
 * that needs to read something calls a Server Action that calls this."* The chip is a Client
 * Component because it is a menu; this is its action, opened beside it.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * The paragraph every action module in this product carries, and here it is short: **this
 * action takes no arguments.** The workspace it answers for is the one *the caller's own
 * session is acting in*, resolved by `requireWorkspace()` from the cookie this request
 * carries — so there is no reference to forge, nothing to point at somebody else's
 * workspace, and a request with no session is the gate's to answer, which it does by
 * redirecting to the login screen exactly as every server read does.
 *
 * The answer names the workspace it describes for the opposite reason: not so the caller can
 * choose one, but so it can tell whether the answer still describes where the session is.
 * A listing that arrives after a workspace switch — or survives one — is void, and the chip
 * discards it by comparing that id, which is the pairing `app/shell/user-menu.tsx` makes with
 * the member role for the same reason.
 *
 * ### It is read when the menu opens, not when the page loads
 *
 * Behind this is `readEnablement`, which is `1 + n` requests — one listing of the workspace's
 * GitHub organisations, then one per organisation. That is the only composition the contract
 * offers ("the contract has no operation for this"), and it is why the chip asks for it when
 * somebody opens the menu rather than on every page load: the header draws its focus
 * repository from the stored name, and needs the listing only when a choice is about to be
 * made from it.
 */

import { requireWorkspace } from "@/app/api/access";
import { type EnabledRepo, enabledRepos, readEnablement } from "@/app/api/enablement";
import { isApiError } from "@/app/api/errors";

/** What the chip's repository submenu draws. */
export type FocusRepoReading =
  /** The listing, and the workspace it describes. */
  | {
      readonly ok: true;
      /** The workspace this answer is about — BetterAuth's organization id. */
      readonly organizationId: string;
      /** Every repository Ouroboros may work in there. Empty is a state, not a failure. */
      readonly repos: readonly EnabledRepo[];
    }
  /** It could not be read, with the message the service gave for refusing. */
  | { readonly ok: false; readonly reason: string };

/**
 * The repositories the caller's active workspace has enabled.
 *
 * The failure is kept as a value rather than thrown, which is `app/dashboard/data.ts`'s
 * `Reading<T>` and the argument behind it: the menu is chrome, and a workspace whose
 * repositories could not be listed is a submenu that says so — not an error boundary over
 * the screen the reader is still entitled to be on. *All repositories* remains choosable
 * either way, because that choice needs no listing to be true.
 *
 * @returns The enabled repositories with the workspace they belong to, or why they could not
 *   be read. Every message in the contract's envelope is written for a person and names
 *   nothing about the service's internals (`app/api/errors.ts`), so it is safe to render.
 * @throws Next.js's redirect signal for a request with no session or no chosen workspace —
 *   the gate's answer, and the one thing here that must not be caught.
 */
export async function readFocusRepos(): Promise<FocusRepoReading> {
  const { membership } = await requireWorkspace();

  try {
    return {
      ok: true,
      organizationId: membership.id,
      repos: enabledRepos(await readEnablement(membership.id)),
    };
  } catch (error) {
    // An `ApiError` and nothing else: the redirect signal above travels as a throw too, and a
    // `catch` wide enough to hold it would swallow the navigation to the login screen and
    // report the framework's internal message as a workspace that could not be listed.
    if (!isApiError(error)) throw error;

    return { ok: false, reason: error.message };
  }
}
