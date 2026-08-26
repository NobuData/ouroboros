/**
 * Writing to `ouroboros-rest` on a browser context's behalf, and putting it back afterwards.
 *
 * Several legs need the same two moves. A browser leg that is *about* one control has to
 * arrange the state around it — a font scale, an auto-merge position, a route's chain, a
 * rule's switch — and every one of those is a row somewhere rather than something in the
 * browser, so the arrangement is a request carrying the **browser's own session**. And every
 * one of them outlives the context that made it, so the leg has to put it back.
 *
 * Both halves were `support/settings.ts`'s until the routing leg
 * ([#206](https://github.com/NobuData/ouroboros/issues/206)) needed them for a route and a
 * rule. They moved here rather than being written a second time, because the interesting
 * part of each is a decision, and a decision restated is a decision that will shortly be made
 * two different ways:
 *
 *   * **a write that did not land must throw, with the body it answered.** The alternative is
 *     a leg that renders the *old* value and asserts against it, which looks exactly like a
 *     passing test of the wrong thing;
 *   * **a restore that did not land must not throw.** It runs in teardown, where the
 *     interesting failure is the one the test has already reported — but it is written to
 *     stderr, because the next run is the thing that pays for it.
 *
 * Nothing here knows what any of these surfaces mean. The paths, the bodies and the values a
 * restore puts back belong to the module that owns the surface.
 */

import type { BrowserContext } from "@playwright/test";

import { SESSION_COOKIE, sessionTokenOf } from "./session";
import { REST_URL } from "./stack";

/**
 * The methods a leg arranges state with.
 *
 * The two the contract publishes for the surfaces legs arrange today — a preference, a
 * workspace setting, a route, a rule — and no more. No `GET`, because reading is the
 * browser's job in this directory; and no verb nothing sends, because a union with an
 * unexercised member is a branch nobody has run. Adding one is a word.
 */
export type WriteMethod = "PATCH" | "PUT";

/**
 * Send a write to `ouroboros-rest` with the context's session, and insist it worked.
 *
 * @param context - The context to act for. It must already carry a session
 *   (`support/session.ts`) — these are the caller's own rows, so there is nobody to store
 *   one against otherwise.
 * @param method - The verb the contract publishes for this path.
 * @param path - The absolute path to write, beginning with a slash.
 * @param body - The request body. Every one of these surfaces takes a document, so there is
 *   no bodyless case to carry.
 * @param what - What the caller is doing, for both failure messages — a phrase that
 *   completes *"… needs a signed-in context"* and reads as a subject before *"answered
 *   422"*, e.g. `setting the font scale to 125%`.
 * @returns When the service has stored it.
 * @throws {Error} If the context carries no session, or if the service refused — with the
 *   status and the body it answered.
 */
export async function writeAs(
  context: BrowserContext,
  method: WriteMethod,
  path: string,
  body: Readonly<Record<string, unknown>>,
  what: string,
): Promise<void> {
  const token = await sessionTokenOf(context, what);

  const response = await fetch(`${REST_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${what} answered ${response.status}: ${await response.text()}`);
  }
}

/**
 * Attempt a restore, and complain rather than throw when it does not land.
 *
 * @param restore - The write to attempt.
 * @param what - What was being put back, and what a leftover value would cost — the whole of
 *   the warning, since nobody is watching the run that prints it.
 * @returns When the restore has been attempted.
 */
export async function quietly(restore: () => Promise<void>, what: string): Promise<void> {
  try {
    await restore();
  } catch (reason) {
    process.stderr.write(`warning: ${what} ${String(reason)}\n`);
  }
}
