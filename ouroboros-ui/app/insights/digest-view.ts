/**
 * Every decision the weekly-digest sheet makes, and every sentence it says
 * (BK.6, [#447](https://github.com/NobuData/ouroboros/issues/447)).
 *
 * The head's **Email weekly digest** action opens a sheet over BJ.4's digest
 * ([#440](https://github.com/NobuData/ouroboros/issues/440)): a weekly toggle, when and where it
 * is sent, a preview that **is** what will be sent — the service's own render, not a picture of
 * it — and the way back out. Opt-in and per person: the toggle changes the reader's own
 * subscription and nobody else's.
 *
 * Framework-free and pure, as `app/insights/view.ts` is.
 */

import type { InsightsDigest, InsightsDigestPreview } from "@/app/api/insights";

import { dayLabel } from "./series-view";

/** The sheet's title — the head action's own label. */
export const DIGEST_TITLE = "Email weekly digest";

/** What the sheet is, under its title. */
export const DIGEST_LEAD =
  "A summary of this page's last seven days — the same figures, by email, once a week.";

/** The toggle's label. */
export const DIGEST_TOGGLE = "Send me the weekly digest";

/** The preview's heading. */
export const PREVIEW_HEADING = "Preview — what the next digest says now";

/** The preview frame's accessible name. */
export const PREVIEW_FRAME_TITLE = "Weekly digest preview";

/** The unsubscribe path, said where a subscribed reader looks for it. */
export const UNSUBSCRIBE_NOTE =
  "Turn the toggle off to stop it. Every digest also carries a one-click unsubscribe link.";

/** The development note — where mail goes when nothing leaves the machine. */
export const MAILPIT_NOTE =
  "Development: the digest goes to mailpit, which catches every message — read it at http://localhost:8025.";

/** Why the toggle is inert on a deployment that cannot send mail. */
export const MAIL_UNCONFIGURED =
  "This deployment has no mail server configured, so it cannot send the weekly digest. An operator sets OURO_SMTP_URL and OURO_MAIL_FROM to turn it on.";

/** The sheet over a digest that could not be read. */
export const DIGEST_UNREADABLE = "The digest settings could not be read. Close this and try again.";

/** The preview's place when it could not be rendered — the toggle still works. */
export const PREVIEW_UNREADABLE = "The preview could not be rendered just now.";

/** A subscription change the service refused for a reason this sheet does not know. */
export const SUBSCRIBE_FAILED = "That change did not save. Try again.";

/** The toggle's reason while a change is in flight. */
export const SAVING = "Saving…";

/** ISO days of the week, Monday first — the schedule's `weeklyDay` is 1–7. */
const WEEKDAYS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];

/**
 * When and where the digest goes.
 *
 * @param digest The digest, as served.
 * @returns `Sent Mondays at 09:00 UTC to ada@example.com. Next: Aug 10.`
 */
export function scheduleLine(digest: InsightsDigest): string {
  const { weeklyDay, weeklyTime, timezone, nextRunAt } = digest.schedule;
  const day = WEEKDAYS[weeklyDay - 1] ?? `day ${weeklyDay}`;

  return `Sent ${day} at ${weeklyTime} ${timezone} to ${digest.recipient}. Next: ${dayLabel(nextRunAt.slice(0, 10))}.`;
}

/**
 * Why the toggle cannot be pressed, or `undefined` when it can.
 *
 * Unsubscribing is always allowed — even with no mail server, a reader can say *stop*. Only the
 * opt-in is refused, because nobody can be promised an email a deployment cannot send.
 *
 * @param digest The digest, as served.
 * @param saving Whether a change is in flight.
 * @returns The reason, or `undefined`.
 */
export function toggleReason(digest: InsightsDigest, saving: boolean): string | undefined {
  if (saving) return SAVING;
  if (!digest.subscribed && digest.mail.transport === "none") return MAIL_UNCONFIGURED;
  return undefined;
}

/**
 * The preview's subject line, as the inbox will show it.
 *
 * @param preview The rendered digest.
 * @returns `Subject: …`.
 */
export function previewSubject(preview: InsightsDigestPreview): string {
  return `Subject: ${preview.subject}`;
}
