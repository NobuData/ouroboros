/**
 * The two settings a browser leg puts into place before it looks — and puts back after.
 *
 * `support/workspace.ts` moves the session's *pointer* at a workspace; this writes the two
 * pieces of stored state the dashboard leg
 * ([#88](https://github.com/NobuData/ouroboros/issues/88)) has to control:
 *
 *   * **the reader's font scale**, which is the person's and the same in every workspace
 *     (`/api/v1/me/preferences`, [#649](https://github.com/NobuData/ouroboros/issues/649));
 *   * **the auto-merge switch**, which is the workspace's and the same for everybody in it
 *     (`/api/v1/settings/auto-merge`, [#74](https://github.com/NobuData/ouroboros/issues/74)).
 *
 * Different scopes, one shape: a `PATCH` to `ouroboros-rest` carrying the browser's own
 * session, made from outside the stack over HTTP, exactly as this directory's rule requires.
 *
 * ## Why the font scale is set here and not in `localStorage`
 *
 * The scale is stamped on `<html>` by an inline boot script reading a `localStorage`
 * mirror, so seeding that key with `addInitScript` would paint the right size — for about as
 * long as it takes the session to load. `app/shell/font-scale-sync.tsx` then asks the
 * *server* what this **person** chose and corrects the document, because the server is the
 * cross-device truth and the mirror exists only to make the first paint instant. A leg that
 * seeded the mirror would be asserting against a value the product is in the middle of
 * overwriting, and would go green or red depending on how fast the reconcile answered.
 *
 * So the preference is set where the preference lives, by the operation the menu's stepper
 * and Settings → Appearance call. What the leg then observes — `data-font-scale="125"` on
 * `<html>`, and a shell that still holds — is the whole round trip, which is the only
 * version of that assertion that is about the deployment rather than about a string this
 * file wrote.
 *
 * ## Both have to be put back
 *
 * Neither of these is scoped to a browser: one is a row keyed on the person and the other a
 * row keyed on the workspace, and this suite signs the same seeded owner into the same
 * seeded workspace in every browser leg — against a stack that is not always torn down
 * between runs (`scripts/run.sh --keep`, and a developer's own `docker compose up`). A leg
 * that left the scale at 125% would hand every later leg and the next run's screenshots a
 * page a fifth larger than the one they were written against; a leg that left auto-merge off
 * would make the *next* run's round trip start from the wrong position and assert nothing.
 *
 * So each has a `restore*` twin that **never throws**. They run in teardown, where the
 * interesting failure is the one the test has already reported and an exception would
 * replace it with a less useful one — but a restore that did not land is written to stderr,
 * because the next run needs to know.
 */

import type { BrowserContext } from "@playwright/test";

import { SESSION_COOKIE, sessionTokenOf } from "./session";
import { REST_URL } from "./stack";

/**
 * `PATCH` a path with the context's session, and insist it worked.
 *
 * @param context - The context to act for. It must already carry a session
 *   (`support/session.ts`) — these are the caller's own settings, so there is nobody to
 *   store one against otherwise.
 * @param path - The absolute path to patch.
 * @param body - What changed. Every one of these surfaces takes *what changed*, so an
 *   object with one property is the whole request.
 * @param what - What the caller is doing, for both failure messages.
 * @returns When the service has stored it.
 * @throws {Error} If the context carries no session, or if the service refused — with the
 *   status and the body it answered. A silent failure here would surface as a page that
 *   simply rendered the old value, which looks like a passing test of the wrong thing.
 */
async function patch(
  context: BrowserContext,
  path: string,
  body: Readonly<Record<string, unknown>>,
  what: string,
): Promise<void> {
  const token = await sessionTokenOf(context, what);

  const response = await fetch(`${REST_URL}${path}`, {
    method: "PATCH",
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
async function quietly(restore: () => Promise<void>, what: string): Promise<void> {
  try {
    await restore();
  } catch (reason) {
    process.stderr.write(`warning: ${what} ${String(reason)}\n`);
  }
}

/**
 * The five font-size steps, as the contract publishes them (`FontScale` in `openapi.json`).
 *
 * Strings rather than numbers, deliberately and in the contract's own words: the value is a
 * label the UI stamps onto `<html>`, nothing does arithmetic with it, and `"100.0"` is not
 * `"100"`.
 */
export type FontScale = "87.5" | "100" | "112.5" | "125" | "150";

/**
 * What a reader who has never chosen is at — and therefore what {@link restoreFontScale}
 * puts back.
 *
 * The preferences surface answers this for a person with no stored row, so restoring it
 * leaves the *rendered* page exactly where an untouched stack would, whether or not the
 * write left a row behind.
 */
export const DEFAULT_FONT_SCALE: FontScale = "100";

/** The attribute the scale is expressed as — `app/font-scale.ts` stamps it on `<html>`. */
export const FONT_SCALE_ATTRIBUTE = "data-font-scale";

/**
 * The root `font-size` each step resolves to, in pixels, from a 16px browser base.
 *
 * Written down because it is the assertion that the *stylesheet* shipped: the attribute
 * moving proves the preference was read, and the computed size moving proves one of the five
 * `:root[data-font-scale]` rules in `app/globals.css` is what read it. A page carrying the
 * attribute at 16px is a page whose font-scale rules never made it into the image.
 *
 * @param scale - The step.
 * @returns The root font size it produces, as `getComputedStyle` reports it.
 */
export function rootFontSize(scale: FontScale): string {
  return `${(16 * Number.parseFloat(scale)) / 100}px`;
}

/**
 * Choose a font scale for the person this context is signed in as.
 *
 * @param context - The context to act for.
 * @param scale - The step to choose.
 * @returns When the service has stored it. The document is *not* stamped by this call — the
 *   page has to be loaded or reloaded for the shell to read the preference back, which is
 *   the behaviour under test.
 * @throws {Error} As {@link patch} does.
 */
export function setFontScale(context: BrowserContext, scale: FontScale): Promise<void> {
  return patch(
    context,
    "/api/v1/me/preferences",
    { fontScale: scale },
    `setting the font scale to ${scale}%`,
  );
}

/**
 * Put the font scale back to {@link DEFAULT_FONT_SCALE}.
 *
 * @param context - The context whose person to restore.
 * @returns When the restore has been attempted.
 */
export function restoreFontScale(context: BrowserContext): Promise<void> {
  return quietly(
    () => setFontScale(context, DEFAULT_FONT_SCALE),
    `the font scale was not restored to ${DEFAULT_FONT_SCALE}% — later legs and the next ` +
      "run's screenshots will see the leftover value.",
  );
}

/**
 * Set the **Auto-merge when checks pass** switch for the workspace this session is acting in.
 *
 * The workspace is the session's rather than the request's — there is no organization in the
 * path — so this moves whichever workspace `selectWorkspace()` last pointed the session at.
 *
 * @param context - The context to act for. Its person must be an `owner` or an `admin` of
 *   that workspace; the API answers `403` to anybody else, which is the rule the switch's
 *   read-only treatment mirrors rather than enforces.
 * @param enabled - The position to store.
 * @returns When the service has stored it.
 * @throws {Error} As {@link patch} does.
 */
export function setAutoMerge(context: BrowserContext, enabled: boolean): Promise<void> {
  return patch(
    context,
    "/api/v1/settings/auto-merge",
    { enabled },
    `setting auto-merge to ${String(enabled)}`,
  );
}

/**
 * Put the auto-merge switch back where the seed left it.
 *
 * @param context - The context whose active workspace to restore.
 * @param enabled - The position the seed wrote — `true` for the demo workspace, which is the
 *   position mockup 02 draws.
 * @returns When the restore has been attempted.
 */
export function restoreAutoMerge(context: BrowserContext, enabled: boolean): Promise<void> {
  return quietly(
    () => setAutoMerge(context, enabled),
    `auto-merge was not restored to ${String(enabled)} — the next run's round trip will ` +
      "start from the wrong position and prove nothing.",
  );
}
