/**
 * The accounts page's words and small decisions (account approval) — what an application
 * administrator reads on `/admin/accounts`.
 *
 * Framework-free, so the screen, its Server Actions and the suites share one copy of every
 * sentence. A `"use server"` module may export only async functions, which is the other reason
 * {@link AdminWrite} is declared here rather than beside the actions.
 */

import { coarseAgo } from "@/app/format";

/** The page's heading. */
export const ADMIN_TITLE = "Accounts";

/** The sentence under it. */
export const ADMIN_LEAD =
  "People who sign in without an invitation wait here until an administrator approves them.";

/** The page's `<title>`. */
export const ADMIN_PAGE_TITLE = "Accounts · Ouroboros";

/** The first section: accounts waiting for a decision. */
export const PENDING_SECTION = "Waiting for approval";

/** The first section, empty. */
export const PENDING_EMPTY = "No one is waiting.";

/** The second section: refused accounts, which stay blocked until approved. */
export const DENIED_SECTION = "Denied";

/** The second section, empty. */
export const DENIED_EMPTY = "No one has been denied.";

/** The third section: emails let in ahead of their first sign-in. */
export const PREAPPROVED_SECTION = "Pre-approved emails";

/** What a pre-approved email means, under the section's heading. */
export const PREAPPROVED_HINT = "An email listed here is approved the moment it first signs in.";

/** The third section, empty. */
export const PREAPPROVED_EMPTY = "No emails are pre-approved.";

/** Let an account in. */
export const APPROVE_LABEL = "Approve";

/** Refuse an account. */
export const DENY_LABEL = "Deny";

/** Forget a pre-approved email. */
export const REMOVE_LABEL = "Remove";

/** Add an email to the pre-approved list. */
export const ADD_LABEL = "Pre-approve";

/** Close the confirmation without denying. */
export const CANCEL_LABEL = "Cancel";

/** A button's label while its request is out. */
export const WORKING_LABEL = "Working…";

/** The add form's email field. */
export const EMAIL_LABEL = "Email";

/** The add form's note field. */
export const NOTE_LABEL = "Note (optional)";

/** The add form, submitted with no email. */
export const EMAIL_REQUIRED = "Enter an email to pre-approve.";

/** The longest note the service accepts. */
export const NOTE_MAX_LENGTH = 200;

/** What the deny confirmation says will happen. */
export const DENY_WARNING = "They stay signed out until approved.";

/** A refusal that carried no sentence of its own. */
export const WRITE_FAILED = "That did not go through. Try again.";

/**
 * A Server Action's outcome: the value, or the sentence to show in the error toast.
 *
 * @typeParam T What a successful write returns.
 */
export type AdminWrite<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/**
 * The deny confirmation's question.
 *
 * @param email The account about to be denied.
 * @returns `Deny … ?`.
 */
export function denyTitle(email: string): string {
  return `Deny ${email}?`;
}

/**
 * When a waiting account first signed in.
 *
 * @param createdAt The account's creation, ISO 8601.
 * @param now The instant the page was read.
 * @returns `signed in 3d ago`.
 */
export function signedInAgo(createdAt: string, now: Date): string {
  return `signed in ${coarseAgo(createdAt, now)}`;
}

/**
 * When, and by whom, a denied account was refused.
 *
 * @param changedAt When the status changed, or `null` (then the account's creation is used).
 * @param changedBy The administrator's email, or `null` for an automatic decision.
 * @param createdAt The account's creation, ISO 8601.
 * @param now The instant the page was read.
 * @returns `denied 2d ago by ken@…`, or without the `by` when nobody is named.
 */
export function deniedAgo(
  changedAt: string | null,
  changedBy: string | null,
  createdAt: string,
  now: Date,
): string {
  const when = `denied ${coarseAgo(changedAt ?? createdAt, now)}`;
  return changedBy === null ? when : `${when} by ${changedBy}`;
}

/**
 * Who added a pre-approved email, and when.
 *
 * @param addedBy The administrator's email.
 * @param createdAt When it was added, ISO 8601.
 * @param now The instant the page was read.
 * @returns `added by ken@… · 3d ago`.
 */
export function addedBy(addedBy: string, createdAt: string, now: Date): string {
  return `added by ${addedBy} · ${coarseAgo(createdAt, now)}`;
}

/**
 * A GitHub login as the rows draw it.
 *
 * @param login The login, or `null`.
 * @returns `@login`, or `null` when there is none to draw.
 */
export function githubHandle(login: string | null): string | null {
  return login === null || login === "" ? null : `@${login}`;
}

/**
 * The toast after an approval.
 *
 * @param email The account approved.
 * @returns The sentence.
 */
export function approvedToast(email: string): string {
  return `Approved ${email}.`;
}

/**
 * The toast after a denial.
 *
 * @param email The account denied.
 * @returns The sentence.
 */
export function deniedToast(email: string): string {
  return `Denied ${email}.`;
}

/**
 * The toast after an email was pre-approved — saying so when that also approved somebody
 * already waiting, which the service does in the same request.
 *
 * @param email The email added.
 * @param approvedWaiting Whether a pending account with that email was approved by it.
 * @returns The sentence.
 */
export function preapprovedToast(email: string, approvedWaiting: boolean): string {
  return approvedWaiting
    ? `Pre-approved ${email} and approved their waiting account.`
    : `Pre-approved ${email}.`;
}

/**
 * The toast after a pre-approved email was removed.
 *
 * @param email The email removed.
 * @returns The sentence.
 */
export function removedToast(email: string): string {
  return `Removed ${email} from the pre-approved list.`;
}
