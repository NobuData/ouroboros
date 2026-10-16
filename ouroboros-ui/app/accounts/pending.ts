/**
 * The waiting page's words (account approval) — what a person whose account is on hold reads.
 *
 * Framework-free and value-only, so the screen and its suites read one copy of every sentence.
 * The two titles are the user's own wording and are not to be paraphrased.
 */

/** The held statuses — the two the waiting page draws. */
export type HeldStatus = "pending" | "denied";

/** The eyebrow over either title. */
export const ACCOUNT_EYEBROW = "Account on hold";

/** The title while an administrator has not decided yet. */
export const PENDING_TITLE = "Your account is waiting for approval";

/** What happens next, while pending. */
export const PENDING_LEAD =
  "An administrator has been asked to approve it. Once they have, reload this page to continue.";

/** The title once an administrator has refused the account. */
export const DENIED_TITLE = "Your account was not approved";

/** What to do about it, once denied. */
export const DENIED_LEAD = "Contact your administrator if you need access.";

/** The one action on the page. */
export const SIGN_OUT_LABEL = "Sign out";

/** The page's `<title>`. */
export const PENDING_PAGE_TITLE = "Account on hold · Ouroboros";

/** The words for one held status. */
export interface HeldCopy {
  /** The page's heading. */
  readonly title: string;
  /** The sentence under it. */
  readonly lead: string;
}

/**
 * The heading and the sentence for a held status.
 *
 * @param status Pending or denied.
 * @returns The two strings to draw.
 */
export function heldCopy(status: HeldStatus): HeldCopy {
  return status === "denied"
    ? { title: DENIED_TITLE, lead: DENIED_LEAD }
    : { title: PENDING_TITLE, lead: PENDING_LEAD };
}

/**
 * Which account is on hold — so somebody signed in with the wrong identity can tell.
 *
 * @param email The account's email.
 * @returns `Signed in as …`.
 */
export function signedInAs(email: string): string {
  return `Signed in as ${email}`;
}
