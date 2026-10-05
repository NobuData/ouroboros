/**
 * The shell's lifecycle poll (BS.6, [#496](https://github.com/NobuData/ouroboros/issues/496)) —
 * the loop that keeps the app-wide paused banner true.
 *
 * `app/poll.ts`'s loop, pointed at `GET /api/settings/lifecycle`: one request on mount, one per
 * interval, none while the tab is hidden, and one at once on return. It is the same pattern as
 * the Needs-You badge's (`app/shell/inbox-poll.ts`), because it is the same kind of thing — a
 * fact about the workspace that chrome on every screen has to keep current.
 *
 * Framework-free.
 */

import type { WorkspaceLifecycle } from "@/app/api/settings-lifecycle";
import { type Poll, type PollOptions, type PollReader, createPoll, requestPayload } from "@/app/poll";

import { UNREACHABLE_LIFECYCLE, UNREADABLE_LIFECYCLE, isLifecycle } from "./banner";

/** The lifecycle, on this origin. */
export const LIFECYCLE_ENDPOINT = "/api/settings/lifecycle";

/** How the lifecycle is read: the conditional GET, or a test's stand-in. */
export type LifecycleReader = PollReader<WorkspaceLifecycle>;

/** The wiring a caller may replace. */
export interface LifecyclePollOptions extends PollOptions {
  /** Read the lifecycle. Defaults to {@link requestLifecycle}. */
  read?: LifecycleReader;
}

/**
 * Ask this origin where the workspace stands.
 *
 * @param etag The tag of the payload already held, or `null` for an unconditional read.
 * @returns The answer. Never a throw.
 */
export function requestLifecycle(etag: string | null) {
  return requestPayload(LIFECYCLE_ENDPOINT, etag, isLifecycle, {
    unreachable: UNREACHABLE_LIFECYCLE,
    unreadable: UNREADABLE_LIFECYCLE,
  });
}

/**
 * Build the poll.
 *
 * @param options The wiring to replace; a test passes its own reader and clock.
 * @returns The poll. Not started.
 */
export function createLifecyclePoll(options: LifecyclePollOptions = {}): Poll<WorkspaceLifecycle> {
  return createPoll(options.read ?? requestLifecycle, options);
}
