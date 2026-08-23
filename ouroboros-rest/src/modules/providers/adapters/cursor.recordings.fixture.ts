/**
 * The Cursor adapter's **recorded fixtures** — one captured route and the refusals it answers
 * with.
 *
 * AC.5 ([#220](https://github.com/NobuData/ouroboros/issues/220)). The stand-in `fetch` is
 * `http.recordings.fixture.ts`, shared with every other HTTP adapter; what is here is the
 * captures. No socket is opened, so `cursor.conformance.spec.ts` and `cursor.adapter.spec.ts`
 * run in `yarn test` — the suite that will actually notice them.
 *
 * ```
 * success     200  ·  apiKeyName · createdAt · userEmail   → the card foot's  ✓ 200 · 51ms
 * auth        401  ·  the key quoted back                  → key rejected (401)
 * rate_limit  429  ·  too many requests                    → rate limited (429)
 * upstream    503  ·  temporarily unavailable              → degraded upstream
 * config      —    ·  no key at all                        → needs configuration
 * network     —    ·  TypeError · ECONNREFUSED             → unreachable
 * ```
 *
 * ---------------------------------------------------------------------------
 * **The `401` body really contains {@link CURSOR_SECRET}.**
 *
 * That is deliberate and it is the sharpest fixture in the file: an adapter that put a
 * refusal's body into a `detail` would leak the credential, and the conformance kit's search
 * for the secret in every rendered detail would find it. The adapter cancels every refusal
 * unread, and this body is what makes that assertion mean something rather than pass vacuously.
 * A key quoted back in an error is not hypothetical — it is how a gateway tells you *which*
 * credential it rejected.
 *
 * ---------------------------------------------------------------------------
 * **Why the responses are built by functions rather than held as constants.** A `Response` body
 * may be read once. The kit builds a fresh harness for every `it` precisely so no case can be
 * affected by a previous one, and a shared `Response` would undo that by being consumed by
 * whichever test ran first. The *bodies* are the constants — they are the recording — and each
 * builder wraps one in a new envelope.
 *
 * It is a `.fixture.ts`: type-checked with the code it exercises, left out of the image by
 * `tsconfig.build.json`, and not counted as application code by `jest.config.mjs`.
 */

import type { NormalizedModel } from "../provider.adapter";
import {
  CURSOR_MODEL_CONTEXT_TOKENS,
  CURSOR_MODEL_DISPLAY,
  CURSOR_MODEL_ID,
} from "./cursor.adapter";

/**
 * The credential every recorded call is made with.
 *
 * Shaped like the key mockup 07's row holds — `key_cur-••••••••••••9f2e` — and long enough to
 * be findable: the conformance kit searches every rendered `detail` for this exact string, and
 * a secret of `"x"` would appear in a hundred innocent sentences and prove nothing. It is not a
 * key, has never been one, and reaches no network.
 */
export const CURSOR_SECRET = "key_cur-00000000000000000000000000000220-9f2e";

/** Mockup 07's capability line under the Cursor card's name, verbatim. */
export const CURSOR_CAPABILITY_NOTE = "api.cursor.com · used for second-opinion reviews";

/** Where the recorded key check was made. */
export const CURSOR_ME_URL = "https://api.cursor.com/v0/me";

/**
 * `GET /v0/me`, as Cursor answers it for a good key.
 *
 * What the key is called, when it was made, and who owns it — and, notably, **nothing about an
 * entitlement**. There is no seat, no allowance and no tier anywhere in it, which is why this
 * adapter reports `entitlements: false` and every model's `tier` is null. The capture is here
 * so that claim is checkable rather than asserted.
 */
export const CURSOR_ME_BODY: unknown = Object.freeze({
  apiKeyName: "ouroboros-control-plane",
  createdAt: "2026-07-02T10:05:00.000Z",
  userEmail: "ken@acme-robotics.example",
});

/**
 * Cursor's refusal bodies, by status.
 *
 * Nothing in the adapter reads one. They exist so the kit's *the detail never quotes the
 * provider's body* assertion is made against a body worth not quoting — see this file's header
 * on the `401`.
 */
export const CURSOR_REFUSALS: Readonly<Record<number, unknown>> = Object.freeze({
  401: {
    error: "unauthorized",
    // The credential, quoted back — which is what a gateway does to tell you which one it
    // rejected, and what makes the "no body in a detail" assertion worth making.
    message: `The API key ${CURSOR_SECRET} is not valid for this team.`,
  },
  403: { error: "forbidden", message: "This key may not read team data." },
  404: { error: "not_found", message: "No such route." },
  429: {
    error: "rate_limited",
    message: "Too many requests. Retry after 30 seconds.",
  },
  503: {
    error: "service_unavailable",
    message: "The service is temporarily unavailable. Please try again shortly.",
  },
});

/**
 * What the fixed catalog must normalize to — the one chip mockup 07's `CU` card draws.
 *
 * Written out here rather than exported from the adapter, because the point of the kit's
 * discovery leg is to state the answer somewhere other than where it is produced.
 */
export const CURSOR_EXPECTED_MODELS: readonly NormalizedModel[] = Object.freeze([
  {
    id: CURSOR_MODEL_ID,
    display: CURSOR_MODEL_DISPLAY,
    contextLength: CURSOR_MODEL_CONTEXT_TOKENS,
    sizeBytes: null,
    tier: null,
  },
]);

/**
 * A recorded `GET /v0/me`.
 *
 * @param body - What the route answered. Defaults to the capture.
 * @returns A fresh `Response`.
 */
export function recordedMe(body: unknown = CURSOR_ME_BODY): Response {
  return Response.json(body, { status: 200 });
}

/**
 * A recorded refusal.
 *
 * @param status - The status. One of {@link CURSOR_REFUSALS}' keys, or any other — an
 *   unrecorded status gets a plausible envelope so a test about classification does not need a
 *   body written for it.
 * @returns A fresh `Response`.
 */
export function recordedRefusal(status: number): Response {
  return Response.json(
    CURSOR_REFUSALS[status] ?? { error: "unexpected", message: "The service had a problem." },
    { status },
  );
}
