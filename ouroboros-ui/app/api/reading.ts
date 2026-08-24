/**
 * A read that is allowed to fail, and the wrapper that makes one.
 *
 * Every screen in this application is composed of several reads, and the rule they all
 * share — established by the dashboard ([#45](https://github.com/NobuData/ouroboros/issues/45),
 * [#86](https://github.com/NobuData/ouroboros/issues/86)) and inherited by the routing page
 * ([#200](https://github.com/NobuData/ouroboros/issues/200)) — is that **one failed read is
 * one degraded region, never a blank page**. A `Promise.all` over the raw calls makes every
 * region depend on the unluckiest of them; a `try` around each call site makes the same
 * decision five times, slightly differently.
 *
 * So the decision is one type and one function, here, where a second screen finds them
 * rather than writing them again. `app/dashboard/view.ts` re-exports {@link Reading} under
 * the name its own consumers already import.
 *
 * **Framework-free, and deliberately not `server-only`.** The type is part of what a screen's
 * components are handed, so a Client Component may name it; the function only needs to
 * recognise an {@link ApiError}, which is `app/api/errors.ts`'s job and carries no
 * environment, no cookies and no `next/*` behind it. What *is* server-only is the client the
 * calls go through, and that stays in `app/api/server.ts`.
 */

import { isApiError } from "@/app/api/errors";

/**
 * One read: either what it returned, or the reason it could not be made.
 *
 * A discriminated union rather than `T | null`, because the reason has to be renderable —
 * a card that could not be read says *what could not be read* and something else says
 * *why*. Making the failure explicit in the type is what stops a region being written to
 * treat *absent* and *zero* as the same thing, which is the specific way a screen built on
 * this can lie.
 */
export type Reading<T> =
  /** The read succeeded. */
  | { readonly ok: true; readonly value: T }
  /** It failed, with the message the service gave for it. */
  | { readonly ok: false; readonly reason: string };

/**
 * Run one read, keeping its failure as a value instead of as a throw.
 *
 * **What is not caught is the point of the narrow `catch`.** Only an `ApiError` — the
 * service refusing a request — becomes a value. A `401` reaches this layer as Next.js's
 * redirect signal rather than as an error (`app/api/server.ts`), and a `catch` wide enough
 * to hold it would swallow the navigation to the login screen and draw a screen captioned
 * with the framework's internal message. A dropped connection is the runtime's own
 * `TypeError` and is not an answer from the service either. Both keep travelling.
 *
 * @param read The call to make.
 * @returns What it returned, or the message the service gave for refusing. That message is
 *   safe to render: every one in the contract's envelope is written for a person and names
 *   nothing about the service's internals (`app/api/errors.ts`).
 * @throws Anything that is not an `ApiError`, unchanged — see above.
 */
export async function attempt<T>(read: () => Promise<T>): Promise<Reading<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    if (!isApiError(error)) throw error;
    return { ok: false, reason: error.message };
  }
}
