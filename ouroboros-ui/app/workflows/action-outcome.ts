/**
 * What a studio Server Action answers — S.6 ([#152](https://github.com/NobuData/ouroboros/issues/152))
 * wrote it for the canvas's draft flows, and V.4 ([#172](https://github.com/NobuData/ouroboros/issues/172))
 * shares it for the code editor's save, so both actions refuse in one shape.
 *
 * ### Failure posture: a value, not a throw
 *
 * Every refusal comes back as `{ ok: false, refusal }` for a dialog, a toolbar or a banner to draw,
 * because a rejected action would replace a page the reader is still entitled to be on. The one throw
 * that must travel is Next.js's redirect signal, for a session that expired since the page rendered.
 *
 * Not a `"use server"` module itself: that directive makes every export an endpoint, and `attempt` is a
 * helper the actions call, not something a browser should be able to post to.
 */

import { type ErrorEnvelope, isApiError } from "@/app/api/errors";

/** What one action produced: its value, or the service's refusal. */
export type ActionOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: ErrorEnvelope };

/**
 * Run one call, turning an `ApiError` into a refusal value.
 *
 * @param work The call.
 * @returns Its value, or the service's envelope.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function attempt<T>(work: () => Promise<T>): Promise<ActionOutcome<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, refusal: { code: error.code, message: error.message, details: error.details } };
  }
}
