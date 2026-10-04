/**
 * The Needs-You inbox — what the shell reads through `ouroboros-rest`.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)) ships one operation:
 * `GET /api/v1/inbox/feed`, the counts behind the sidebar's **Needs You** badge — open decisions by
 * severity, snooze-aware, with the snoozed count beside them. The queue, resolved list and stats
 * arrive with BN.4 (#464) and are added here then.
 *
 * ### `open` is the badge
 *
 * `open` is what the badge draws; a snoozed item still hidden is in `snoozed`, never `open`, and one
 * whose snooze has elapsed is already back in `open`. A zero hides the badge (`Badge` draws nothing
 * for `0`), which is a counted zero, not an unknown.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** `GET /api/v1/inbox/feed`'s answer. */
export type InboxFeed = components["schemas"]["InboxFeed"];

export const inbox = {
  /**
   * Read the feed.
   *
   * @param client The client to read through. Defaults to the server's own, which redirects a
   *   `401` to the login screen — right for a render. A poll passes `anonymousApi()`.
   * @param signal A way to give up on the read — a poll's deadline.
   * @returns The counts, as served.
   * @throws {ApiError} When the service refuses.
   */
  async feed(client: ApiClient = api(), signal?: AbortSignal): Promise<InboxFeed> {
    return unwrap(await client.GET("/api/v1/inbox/feed", { signal }));
  },
};
