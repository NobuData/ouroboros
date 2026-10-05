"use server";

/**
 * The `/inbox` frame's writes and its sheet's read (BO.1, [#466](https://github.com/NobuData/ouroboros/issues/466)),
 * and a decision card's two (BO.2, [#467](https://github.com/NobuData/ouroboros/issues/467)): an
 * answer and a snooze of one item — and a snoozed card's one (BO.5,
 * [#470](https://github.com/NobuData/ouroboros/issues/470)): waking it early — as Server Actions. The browser cannot call `ouroboros-rest`,
 * so the button asks this module, which asks the service with the request's session.
 *
 * Every refusal comes back as a sentence rather than a throw: a person pressed a button, and a
 * button's failure is something to read beside it. An answer has a third way to end — someone
 * else answered first — and that comes back as who, not as a failure.
 */

import { isApiError } from "@/app/api/errors";
import {
  type InboxSnoozeResult,
  type InboxUnsnoozeResult,
  type NotificationPreferences,
  type NotificationPreferencesPatch,
  inbox,
} from "@/app/api/inbox";
import { type Reading, attempt } from "@/app/api/reading";

import {
  ANSWER_FAILED,
  ITEM_SNOOZE_FAILED,
  NOTE_MAX_LENGTH,
  type DecisionAnswer,
  winnerOf,
} from "./card-view";
import { PREFERENCES_FAILED } from "./notifications-view";
import { WAKE_FAILED } from "./snoozed-view";
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

/** The service's code for "someone answered first" (BN.2, #462). */
const ALREADY_ANSWERED = "decision_already_answered";

/** The service's status for an action whose plane is not built — its sentence says so. */
const NOT_IMPLEMENTED = 501;

/** The first status that is the service's own failure rather than a refusal with a reason. */
const SERVER_ERROR = 500;

/** The longest minutes a snooze may ask for — a week (`InboxSnoozeRequest.minutes`). */
const SNOOZE_MAX_MINUTES = 10_080;

/** The one refusal whose sentence is about the request's shape, not about the decision. */
const VALIDATION_FAILED = "validation_failed";

/**
 * What a refused write says to the person who pressed.
 *
 * A refusal with a reason (`4xx`, and `501` for an action whose plane is not built) carries a
 * sentence written for a reader — *This decision expired before it was answered.* — and is passed
 * on. The service's own failure, and a malformed request this module should never have sent, get
 * the plain fallback instead of a sentence about internals.
 *
 * @param error The refusal.
 * @param fallback What to say when the refusal's own words are no use.
 * @returns The sentence.
 */
function refusalWords(error: { status: number; code: string; message: string }, fallback: string): string {
  const reasoned = error.status < SERVER_ERROR || error.status === NOT_IMPLEMENTED;

  return reasoned && error.code !== VALIDATION_FAILED ? error.message : fallback;
}

/**
 * Answer a decision — one press of one action of one card.
 *
 * Three ways to end. **Answered**: the resolution and the receipt the card prints. **Raced**:
 * someone answered first (`409 decision_already_answered`), told as who, with what and when.
 * **Failed**: anything else — a refusal's own sentence (it expired, a plane refused, the action's
 * plane is not built), or a plain one for a failure with nothing a reader can use; the item is
 * still open either way, which is BN.2's rule for a failing handler.
 *
 * @param itemId The item.
 * @param actionId The declared action.
 * @param press The note the action takes, and the press's idempotency key — minted by the card,
 *   so a retried delivery of this one press can never execute twice.
 * @returns How the press ended.
 */
export async function answerDecision(
  itemId: string,
  actionId: string,
  press: Readonly<{ note?: string; idempotencyKey: string }>,
): Promise<DecisionAnswer> {
  const note = typeof press.note === "string" ? press.note.trim().slice(0, NOTE_MAX_LENGTH) : "";

  try {
    const result = await inbox.answer(String(itemId), String(actionId), {
      idempotencyKey: String(press.idempotencyKey),
      ...(note === "" ? {} : { note }),
    });

    return { outcome: "answered", result };
  } catch (error) {
    if (!isApiError(error)) throw error;

    if (error.code === ALREADY_ANSWERED) {
      const winner = winnerOf(error.details);

      if (winner !== null) return { outcome: "raced", winner };
    }

    return { outcome: "failed", reason: refusalWords(error, ANSWER_FAILED) };
  }
}

/**
 * Snooze one asking item.
 *
 * @param itemId The item.
 * @param minutes How long — clamped to the service's one minute to one week.
 * @returns What was snoozed and until when, or why not.
 */
export async function snoozeDecision(itemId: string, minutes: number): Promise<InboxWrite<InboxSnoozeResult>> {
  const asked = Number.isFinite(minutes) ? Math.round(minutes) : SNOOZE_ALL_MINUTES;

  try {
    return {
      ok: true,
      value: await inbox.snoozeItem(String(itemId), Math.min(SNOOZE_MAX_MINUTES, Math.max(1, asked))),
    };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: refusalWords(error, ITEM_SNOOZE_FAILED) };
  }
}

/**
 * Wake one snoozed item now, before its time — it goes back into the queue and the badge.
 *
 * @param itemId The item.
 * @returns The items back in the queue (none when it was no longer snoozed — it is back either
 *   way), or why not: the service's own sentence for a refusal (`403` for a viewer), a plain one
 *   for its own failure.
 */
export async function unsnoozeDecision(itemId: string): Promise<InboxWrite<InboxUnsnoozeResult>> {
  try {
    return { ok: true, value: await inbox.unsnooze(String(itemId)) };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return { ok: false, reason: refusalWords(error, WAKE_FAILED) };
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
