/**
 * Where a channel's links point (BN.3, [#463](https://github.com/NobuData/ouroboros/issues/463)) —
 * pure.
 *
 * Every link a mirror comment or a mail carries is on the **UI origin** (`OURO_UI_URL`):
 *
 * - a card's refs deep-link to the run and PR pages; a ticket or a path has no page of its own, so
 *   it is shown, not linked;
 * - *Answer →* opens the item in `/inbox`;
 * - a token link is `/api/v1/inbox/answer/<token>` **on the UI origin**, which `ouroboros-ui`'s
 *   `proxy.ts` forwards to this service — so the browser's session cookie, which lives on the UI
 *   origin, arrives with it, and a merge-class answer can demand that session (X5).
 */

import type { DecisionRef } from "../decisions/decision.types";

/** The confirm page's route under the API prefix. */
export const ANSWER_ROUTE = "inbox/answer";

/** The UI's sign-in page, and the parameter it returns through (`app/paths.ts`). */
const LOGIN_PATH = "/login";
const RETURN_TO_PARAM = "next";

/**
 * An origin with no trailing slash.
 *
 * @param origin - `OURO_UI_URL`.
 * @returns The origin, trimmed.
 */
function trimmed(origin: string): string {
  return origin.replace(/\/+$/, "");
}

/**
 * The confirm page's path for a token — origin-relative, so a sign-in can return to it.
 *
 * @param token - The token.
 * @returns `/api/v1/inbox/answer/<token>`.
 */
export function answerPath(token: string): string {
  return `/api/v1/${ANSWER_ROUTE}/${token}`;
}

/**
 * The link a mail carries for one action.
 *
 * @param uiUrl - `OURO_UI_URL`.
 * @param token - The token.
 * @returns The confirm page on the UI origin.
 */
export function answerUrl(uiUrl: string, token: string): string {
  return `${trimmed(uiUrl)}${answerPath(token)}`;
}

/**
 * The sign-in page, returning to a confirm page afterwards.
 *
 * @param uiUrl - `OURO_UI_URL`.
 * @param token - The token whose page asked for a session.
 * @returns `/login?next=/api/v1/inbox/answer/<token>` on the UI origin.
 */
export function signInUrl(uiUrl: string, token: string): string {
  return `${trimmed(uiUrl)}${LOGIN_PATH}?${RETURN_TO_PARAM}=${encodeURIComponent(answerPath(token))}`;
}

/**
 * An item in the inbox — the *Answer →* link.
 *
 * @param uiUrl - `OURO_UI_URL`.
 * @param itemId - The item.
 * @returns `/inbox?item=<id>` on the UI origin.
 */
export function inboxItemUrl(uiUrl: string, itemId: string): string {
  return `${trimmed(uiUrl)}/inbox?item=${encodeURIComponent(itemId)}`;
}

/**
 * The inbox itself.
 *
 * @param uiUrl - `OURO_UI_URL`.
 * @returns `/inbox` on the UI origin.
 */
export function inboxUrl(uiUrl: string): string {
  return `${trimmed(uiUrl)}/inbox`;
}

/**
 * A ref's page, when it has one.
 *
 * @param uiUrl - `OURO_UI_URL`.
 * @param ref - The ref.
 * @returns The run or PR page; undefined for a ticket or a path, which have none.
 */
export function refUrl(uiUrl: string, ref: DecisionRef): string | undefined {
  switch (ref.type) {
    case "run":
      return `${trimmed(uiUrl)}/runs/${encodeURIComponent(ref.id)}`;
    case "pr":
      return `${trimmed(uiUrl)}/prs/${encodeURIComponent(ref.id)}`;
    default:
      return undefined;
  }
}
