/**
 * The Needs-You inbox — what the shell reads through `ouroboros-rest`.
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)) ships one operation:
 * `GET /api/v1/inbox/feed`, the counts behind the sidebar's **Needs You** badge — open decisions by
 * severity, snooze-aware, with the snoozed count beside them. BO.1
 * ([#466](https://github.com/NobuData/ouroboros/issues/466)) adds what the `/inbox` frame reads and
 * writes: the queue (`GET /api/v1/inbox`, BN.4 #464), *Snooze all* (`POST /api/v1/inbox/snooze-all`)
 * and the caller's notification preferences (`GET`/`PATCH /api/v1/inbox/notifications`, BN.3 #463).
 * BO.2 ([#467](https://github.com/NobuData/ouroboros/issues/467)) adds what a decision card
 * writes: an answer (`POST /api/v1/inbox/items/{id}/actions/{actionId}`, BN.2 #462) and a snooze of
 * one item (`POST /api/v1/inbox/items/{id}/snooze`).
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

/** `GET /api/v1/inbox`'s answer — the head, the asking items and the snoozed ones. */
export type InboxQueue = components["schemas"]["InboxQueue"];

/** One asking item of the queue. */
export type InboxItem = components["schemas"]["InboxItem"];

/** One snoozed item of the queue. */
export type InboxSnoozedItem = components["schemas"]["InboxSnoozedItem"];

/** One ref of an item's tag row, with where its tag leads. */
export type InboxRef = components["schemas"]["InboxRef"];

/** One declared action of an item, resolved against the caller. */
export type InboxAction = components["schemas"]["InboxActionView"];

/** A press of an action: the note it carries and the caller's name for the press. */
export type InboxActionRequest = components["schemas"]["InboxActionRequest"];

/** An answered press: the resolution and the receipt the card prints. */
export type InboxActionResult = components["schemas"]["InboxActionResult"];

/** What an answer executed, in words, with where to see it. */
export type InboxActionReceipt = components["schemas"]["InboxActionReceipt"];

/** What *Snooze all* did. */
export type InboxSnoozeResult = components["schemas"]["InboxSnoozeResult"];

/** The caller's notification preferences in this workspace. */
export type NotificationPreferences = components["schemas"]["NotificationPreferences"];

/** A change to them: absent fields are kept. */
export type NotificationPreferencesPatch = components["schemas"]["NotificationPreferencesPatch"];

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

  /**
   * Read the queue: the head (count, estimate, sentence), the asking items and the snoozed ones.
   *
   * @param client The client to read through. A poll passes `anonymousApi()`.
   * @param signal A way to give up on the read — a poll's deadline.
   * @returns The queue, as served.
   * @throws {ApiError} When the service refuses.
   */
  async queue(client: ApiClient = api(), signal?: AbortSignal): Promise<InboxQueue> {
    return unwrap(await client.GET("/api/v1/inbox", { signal }));
  },

  /**
   * Snooze every asking item for a while — one event for all of them.
   *
   * @param minutes How long. *Snooze all 1h* is 60.
   * @param client The client to write through.
   * @returns What was snoozed, and until when.
   * @throws {ApiError} When the service refuses — `403` for a viewer.
   */
  async snoozeAll(minutes: number, client: ApiClient = api()): Promise<InboxSnoozeResult> {
    return unwrap(await client.POST("/api/v1/inbox/snooze-all", { body: { minutes } }));
  },

  /**
   * Snooze one asking item for a while.
   *
   * @param itemId The item.
   * @param minutes How long, 1–10080.
   * @param client The client to write through.
   * @returns What was snoozed, and until when.
   * @throws {ApiError} When the service refuses — `403` for a viewer, `409` once it is answered.
   */
  async snoozeItem(itemId: string, minutes: number, client: ApiClient = api()): Promise<InboxSnoozeResult> {
    return unwrap(
      await client.POST("/api/v1/inbox/items/{id}/snooze", {
        params: { path: { id: itemId } },
        body: { minutes },
      }),
    );
  },

  /**
   * Answer a decision — press one of its card's actions.
   *
   * @param itemId The item.
   * @param actionId The declared action.
   * @param request The note (when the action takes one) and the press's idempotency key.
   * @param client The client to write through.
   * @returns The resolution and its receipt.
   * @throws {ApiError} When the service refuses — `409 decision_already_answered` carries the
   *   winner in `details.resolution`; a failing handler answers with its plane's own error and
   *   leaves the item open.
   */
  async answer(
    itemId: string,
    actionId: string,
    request: InboxActionRequest,
    client: ApiClient = api(),
  ): Promise<InboxActionResult> {
    return unwrap(
      await client.POST("/api/v1/inbox/items/{id}/actions/{actionId}", {
        params: { path: { id: itemId, actionId } },
        body: request,
      }),
    );
  },

  /**
   * Read the caller's notification preferences here, defaults filled in.
   *
   * @param client The client to read through.
   * @returns The preferences.
   * @throws {ApiError} When the service refuses.
   */
  async notifications(client: ApiClient = api()): Promise<NotificationPreferences> {
    return unwrap(await client.GET("/api/v1/inbox/notifications"));
  },

  /**
   * Change the caller's notification preferences here.
   *
   * @param patch The fields to change.
   * @param client The client to write through.
   * @returns The preferences after the write.
   * @throws {ApiError} When the service refuses — `422` for a malformed time or an unknown kind.
   */
  async updateNotifications(
    patch: NotificationPreferencesPatch,
    client: ApiClient = api(),
  ): Promise<NotificationPreferences> {
    return unwrap(await client.PATCH("/api/v1/inbox/notifications", { body: patch }));
  },
};
