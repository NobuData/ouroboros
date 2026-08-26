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
 *
 * ## Creating and removing, since the providers leg
 *
 * [#233](https://github.com/NobuData/ouroboros/issues/233) arranges something the four
 * surfaces before it did not: a **row of its own**. Its subject is the credential lifecycle,
 * and every interesting step of it — a rotation, a reveal, a pull — needs a connection this
 * deployment's own vault sealed and its own adapter validated, which is a connection the leg
 * has to create and then take away again. So the verb union gained `POST` and `DELETE`, and
 * {@link requestAs} came out from under {@link writeAs} because a create's *answer* is the
 * thing the leg needs — a row nobody can address is a row nobody can delete.
 *
 * The rule about restores is unchanged and reaches further here than anywhere: a leg that
 * left its connection behind would put a sixth card in a grid whose parity screenshots are
 * five, and the next run would fail on an image rather than on the leg that made the mess.
 */

import type { BrowserContext } from "@playwright/test";

import { SESSION_COOKIE, sessionTokenOf } from "./session";
import { REST_URL } from "./stack";

/**
 * The methods a leg arranges state with.
 *
 * The five the contract publishes for the surfaces legs arrange today — a preference, a
 * workspace setting, a route, a rule, and a provider connection a leg brings into existence
 * for the length of one test. No verb nothing sends, because a union with an unexercised
 * member is a branch nobody has run; adding one is a word.
 *
 * `GET` is here for exactly one caller and it is a **teardown**: `support/providers.ts` has
 * to find the connections a leg created in order to remove them, and a test that failed
 * before it could write the id down is precisely the case that most needs cleaning up.
 * Reading in order to *assert* is still the browser's job in this directory — a leg that
 * checked a payload would be a leg that passes while the page renders nothing.
 */
export type WriteMethod = "GET" | "PATCH" | "POST" | "PUT" | "DELETE";

/**
 * Send a request to `ouroboros-rest` with the context's session, insist it worked, and hand
 * back what it answered.
 *
 * @param context - The context to act for. It must already carry a session
 *   (`support/session.ts`) — these are the caller's own rows, so there is nobody to store
 *   one against otherwise.
 * @param method - The verb the contract publishes for this path.
 * @param path - The absolute path, beginning with a slash.
 * @param body - The request body, or `null` for the verbs that take none. A `DELETE` with a
 *   document is a request nothing in this contract answers.
 * @param what - What the caller is doing, for both failure messages — a phrase that
 *   completes *"… needs a signed-in context"* and reads as a subject before *"answered
 *   422"*, e.g. `setting the font scale to 125%`.
 * @returns What the service answered, parsed — or `null` for a `204`, which is what a
 *   delete answers and is not the same as an empty document.
 * @throws {Error} If the context carries no session, or if the service refused — with the
 *   status and the body it answered.
 * @typeParam Answer The shape the caller expects. Unchecked, as every payload this directory
 *   reads is: the suite asserts against the *page*, and a helper that validated a response
 *   would be a second contract to keep in step with the first.
 */
export async function requestAs<Answer>(
  context: BrowserContext,
  method: WriteMethod,
  path: string,
  body: Readonly<Record<string, unknown>> | null,
  what: string,
): Promise<Answer | null> {
  const token = await sessionTokenOf(context, what);

  const response = await fetch(`${REST_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
    body: body === null ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${what} answered ${response.status}: ${await response.text()}`);
  }

  // A `204` has no body at all, and `response.json()` on one throws — which would turn a
  // successful delete into a failure that names JSON.
  if (response.status === 204) return null;

  return (await response.json()) as Answer;
}

/**
 * Send a write to `ouroboros-rest` with the context's session, and insist it worked.
 *
 * The shape every caller before the providers leg wanted: the answer is not the point, so it
 * is discarded here rather than at four call sites.
 *
 * @param context - The context to act for.
 * @param method - The verb the contract publishes for this path.
 * @param path - The absolute path to write, beginning with a slash.
 * @param body - The request body.
 * @param what - What the caller is doing, for both failure messages.
 * @returns When the service has stored it.
 * @throws {Error} As {@link requestAs} does.
 */
export async function writeAs(
  context: BrowserContext,
  method: WriteMethod,
  path: string,
  body: Readonly<Record<string, unknown>>,
  what: string,
): Promise<void> {
  await requestAs(context, method, path, body, what);
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
