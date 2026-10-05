import "server-only";

/**
 * The workspace lifecycle, answered for the shell's poll
 * (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)).
 *
 * The paused banner is chrome on every signed-in screen, and it has to clear *everywhere* when
 * somebody resumes — so the shell polls where the workspace stands
 * (`app/lifecycle/lifecycle-poll.ts`), and this is the server half of that poll: the same read
 * `app/api/settings-lifecycle.ts` makes, turned into the answer the poll's own route passes on.
 *
 * ### Through the client that redirects nowhere
 *
 * `anonymousApi()`, for `app/api/inbox-feed.ts`'s reason: a route handler answering `fetch` has
 * nobody to redirect. A `401` becomes the poll's `gone`.
 *
 * ### A frozen workspace is an answer, not a failure
 *
 * While a workspace is pending deletion a **non-owner** is refused even this read
 * (`403 workspace_pending_delete`). That refusal says exactly one thing about the lifecycle —
 * its state — so it is passed on as that state ({@link frozenLifecycle}) rather than as an
 * error: the browser's poll then sees `pending_delete` whoever is asking, and leaves for the
 * recovery screen, which is where the difference between an owner and anybody else is drawn.
 */

import { isWorkspaceFrozen } from "@/app/api/errors";
import { readForPoll } from "@/app/api/poll-read";
import { anonymousApi } from "@/app/api/server";
import { type WorkspaceLifecycle, settingsLifecycle } from "@/app/api/settings-lifecycle";
import { UNREACHABLE_LIFECYCLE } from "@/app/lifecycle/banner";
import type { PollAnswer } from "@/app/poll";

/** The code the route answers with when the lifecycle could not be read. */
export const LIFECYCLE_UNAVAILABLE_CODE = "lifecycle_unavailable";

/**
 * The lifecycle a frozen refusal describes.
 *
 * @param details The refusal's `details` — `purgeAfter` is read from it when it is a string.
 * @returns A `pending_delete` lifecycle carrying only what the refusal said: no banner, no
 *   attribution, and the window's close when the service named it.
 */
export function frozenLifecycle(details: unknown): WorkspaceLifecycle {
  const purgeAfter =
    typeof details === "object" && details !== null
      ? (details as { purgeAfter?: unknown }).purgeAfter
      : undefined;

  return {
    state: "pending_delete",
    changedAt: null,
    changedBy: null,
    purgeAfter: typeof purgeAfter === "string" ? purgeAfter : null,
    recoveryWindowDays: 30,
    banner: null,
  };
}

/**
 * Read where the workspace stands, for the poll.
 *
 * @param read The read. Defaults to the lifecycle read over the non-redirecting client; tests
 *   pass their own.
 * @returns The poll's answer — `fresh` with a `pending_delete` lifecycle for the frozen
 *   refusal. Never a throw.
 */
export async function readLifecyclePoll(
  read: (signal: AbortSignal) => Promise<WorkspaceLifecycle> = () =>
    settingsLifecycle.read(anonymousApi()),
): Promise<PollAnswer<WorkspaceLifecycle>> {
  return readForPoll(async (signal) => {
    try {
      return await read(signal);
    } catch (error) {
      if (isWorkspaceFrozen(error)) return frozenLifecycle(error.details);
      throw error;
    }
  }, UNREACHABLE_LIFECYCLE);
}
