"use server";

/**
 * The server hops for the runner's `⋯` menu (AI.5,
 * [#260](https://github.com/NobuData/ouroboros/issues/260)) — drain, undrain and the guarded
 * remove, the writes its Client Components cannot make themselves.
 *
 * `app/farm/pool-actions.ts` is the same seam for the pools card and states the rules this
 * module keeps:
 *
 * - **A Server Action is a POST endpoint anybody can reach.** There is no workspace in any call
 *   — a runner belongs to the workspace the caller's own session is acting in — and **the role
 *   gate is the service's**, `owner` or `admin`. The menu leaves these items out for a member,
 *   which is presentation: a member who reaches an action anyway gets the service's `403` and
 *   changes nothing. **Every one of these writes is audited there** (AH.6, #254).
 * - **The removal guard is the service's too.** The menu blocks Remove on a connected machine
 *   from a page up to ten seconds old; the service applies the guard again inside the write and
 *   refuses with the state the machine is in *now*.
 * - **Failure is a value, not a throw.** The one throw that must travel is Next.js's redirect
 *   signal, for a session that expired since the page rendered.
 *
 * **Every value this module needs is imported rather than declared** — a `"use server"` module
 * may export nothing but async functions, so the outcome type and the sentences live in
 * `app/farm/lifecycle.ts`.
 */

import { isApiError } from "@/app/api/errors";
import { farm } from "@/app/api/farm";

import { type LifecycleAction, type LifecycleOutcome, lifecycleRefusal } from "./lifecycle";

/**
 * Make one lifecycle write and turn a refusal into its sentence.
 *
 * @param action Which write — what a refusal's sentence is composed around.
 * @param write The call to make. Answers whether the frame was pushed, or `null` for a write
 *   that sends none.
 * @returns That it took, or why it did not. **A refusal means nothing was changed.**
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
async function attempt(
  action: LifecycleAction,
  write: () => Promise<boolean | null>,
): Promise<LifecycleOutcome> {
  try {
    return { ok: true, pushed: await write() };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: lifecycleRefusal(action, error) };
  }
}

/**
 * Withdraw a runner from dispatch. It finishes the build it is holding.
 *
 * @param id The runner.
 * @returns Whether the agent was told at once, or why nothing was changed.
 * @throws Whatever is not an `ApiError`.
 */
export async function drainRunner(id: string): Promise<LifecycleOutcome> {
  return attempt("drain", async () => (await farm.drainRunner(id)).pushed);
}

/**
 * Return a drained runner to dispatch.
 *
 * @param id The runner.
 * @returns Whether the agent was told at once, or why nothing was changed.
 * @throws Whatever is not an `ApiError`.
 */
export async function undrainRunner(id: string): Promise<LifecycleOutcome> {
  return attempt("undrain", async () => (await farm.undrainRunner(id)).pushed);
}

/**
 * Retire a runner from the fleet — permitted for an offline or drained machine only.
 *
 * @param id The runner.
 * @returns That it is gone, or why it is not — with the state the machine is now in when the
 *   service's guard refused.
 * @throws Whatever is not an `ApiError`.
 */
export async function removeRunner(id: string): Promise<LifecycleOutcome> {
  return attempt("remove", async () => {
    await farm.removeRunner(id);

    return null;
  });
}
