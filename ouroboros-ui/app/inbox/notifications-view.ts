/**
 * The notification preferences sheet's words and rules (BO.1, [#466](https://github.com/NobuData/ouroboros/issues/466)) —
 * the minimal surface over BN.3's `GET`/`PATCH /api/v1/inbox/notifications` (#463) that BO.4
 * ([#469](https://github.com/NobuData/ouroboros/issues/469)) extends: the daily digest and its UTC
 * send time, instant mail for blocking decisions, and per-kind mutes.
 */

import type { NotificationPreferences } from "@/app/api/inbox";

/** The sheet's title and lead. */
export const PREFERENCES_TITLE = "Notification settings";
export const PREFERENCES_LEAD =
  "How decisions reach you by mail in this workspace. Each mail's links answer once, only for you.";

/** The controls' labels. */
export const DIGEST_TOGGLE = "Daily digest";
export const DIGEST_TIME_LABEL = "Send at (UTC)";
export const INSTANT_TOGGLE = "Instant mail for blocking decisions";
export const MUTES_LEGEND = "Never mail me about";
export const SAVE_LABEL = "Save";
export const SAVED = "Saved.";

/** What the sheet says when the preferences could not be read, or a save was refused. */
export const PREFERENCES_UNREADABLE = "Your notification settings could not be read.";
export const PREFERENCES_FAILED = "Your notification settings could not be saved. Try again.";

/** `HH:MM`, as REST holds the digest time. */
export const DIGEST_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The decision kinds a person may mute, with the words the sheet uses — the shipped kinds that
 * can file a card today (`spend_approval` is dormant until AF.4, so muting it would promise
 * something that never mails).
 */
export const MUTABLE_KINDS: readonly { readonly id: string; readonly label: string }[] = [
  { id: "merge_approval", label: "Merge approvals" },
  { id: "protected_path_allow_once", label: "Protected-path edits" },
  { id: "claim_waiver", label: "Claim waivers" },
  { id: "plan_sign_off", label: "Plan sign-offs" },
  { id: "run_needs_human", label: "Loops that need a human" },
  { id: "split_approval", label: "Ticket splits" },
  { id: "resize_review", label: "Re-sizes" },
  { id: "fact_review", label: "Fact reviews" },
];

/** What the form holds while it is edited. */
export interface PreferencesDraft {
  readonly digestEnabled: boolean;
  readonly digestTime: string;
  readonly instant: boolean;
  readonly mutedKinds: readonly string[];
}

/**
 * The draft a sheet opens on.
 *
 * @param preferences What the service answered.
 * @returns The form's starting values.
 */
export function draftOf(preferences: NotificationPreferences): PreferencesDraft {
  return {
    digestEnabled: preferences.digest.enabled,
    digestTime: preferences.digest.time,
    instant: preferences.instant.severity === "err",
    mutedKinds: [...preferences.mutedKinds],
  };
}

/**
 * Why the draft cannot be saved, or `undefined` when it can.
 *
 * @param draft The form.
 * @returns The reason.
 */
export function draftProblem(draft: PreferencesDraft): string | undefined {
  return DIGEST_TIME_PATTERN.test(draft.digestTime) ? undefined : "Use a time like 09:00 (UTC).";
}

/**
 * The line under the digest toggle.
 *
 * @param preferences What the service answered.
 * @param format How an instant is printed.
 * @returns `Next digest 2026-10-05 09:00 UTC`, or a sentence saying it is off.
 */
export function nextDigestLine(
  preferences: NotificationPreferences,
  format: (iso: string) => string,
): string {
  return preferences.digest.nextSendAt === null
    ? "Off — nothing is mailed daily."
    : `Next digest ${format(preferences.digest.nextSendAt)}`;
}

/**
 * An instant as the sheet prints it — UTC, to the minute, since the digest's clock is UTC.
 *
 * @param iso The instant.
 * @returns `2026-10-05 09:00 UTC`.
 */
export function utcMinute(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}
