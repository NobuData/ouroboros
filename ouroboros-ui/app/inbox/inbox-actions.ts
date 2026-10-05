"use server";

/**
 * The `/inbox` frame's writes and its sheet's read (BO.1, [#466](https://github.com/NobuData/ouroboros/issues/466)),
 * as Server Actions — the browser cannot call `ouroboros-rest`, so the button asks this module,
 * which asks the service with the request's session.
 *
 * Every refusal comes back as a sentence rather than a throw: a person pressed a button, and a
 * button's failure is something to read beside it.
 */

import { isApiError } from "@/app/api/errors";
import {
  type InboxSnoozeResult,
  type NotificationPreferences,
  type NotificationPreferencesPatch,
  inbox,
} from "@/app/api/inbox";
import { type Reading, attempt } from "@/app/api/reading";

import { PREFERENCES_FAILED } from "./notifications-view";
import { SNOOZE_ALL_MINUTES, SNOOZE_FAILED } from "./view";

/** A write's outcome: what the service answered, or why not as a sentence. */
export type InboxWrite<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/**
 * Snooze every asking item for an hour.
 *
 * @returns What was snoozed and until when, or why not.
 */
export async function snoozeAll(): Promise<InboxWrite<InboxSnoozeResult>> {
  try {
    return { ok: true, value: await inbox.snoozeAll(SNOOZE_ALL_MINUTES) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: error.status === 403 ? error.message : SNOOZE_FAILED };
  }
}

/**
 * Read the caller's notification preferences for the sheet.
 *
 * @returns The preferences, or why they could not be read.
 */
export async function readNotificationSettings(): Promise<Reading<NotificationPreferences>> {
  return attempt(() => inbox.notifications());
}

/**
 * Change the caller's notification preferences.
 *
 * @param patch The fields to change. Anything else is dropped before it is sent.
 * @returns The preferences after the write, or why not.
 */
export async function updateNotificationSettings(
  patch: NotificationPreferencesPatch,
): Promise<InboxWrite<NotificationPreferences>> {
  const clean: NotificationPreferencesPatch = {
    ...(typeof patch.digestEnabled === "boolean" ? { digestEnabled: patch.digestEnabled } : {}),
    ...(typeof patch.digestTime === "string" ? { digestTime: patch.digestTime } : {}),
    ...(patch.instantSeverity === "err" || patch.instantSeverity === "off"
      ? { instantSeverity: patch.instantSeverity }
      : {}),
    ...(Array.isArray(patch.mutedKinds)
      ? { mutedKinds: patch.mutedKinds.filter((kind) => typeof kind === "string") }
      : {}),
  };

  try {
    return { ok: true, value: await inbox.updateNotifications(clean) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: error.status === 422 ? error.message : PREFERENCES_FAILED };
  }
}
