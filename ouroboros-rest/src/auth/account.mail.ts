/**
 * The two emails account approval sends, composed as plain data.
 *
 * Decision 4 of the account-approval request: **only when `OURO_SMTP_URL` is configured**,
 *
 *   * every application administrator is emailed when somebody is held, with a link to
 *     `<OURO_UI_URL>/admin/accounts`;
 *   * the person is emailed when an administrator approves them, with a link to the product.
 *
 * Composition lives here, apart from both senders, because the two senders live on opposite
 * sides of the Nest boundary: the held email is sent from a BetterAuth database hook
 * (`account.approval.ts`, which imports nothing from Nest), and the approval email from the
 * admin routes' service. Neither email carries anything the recipient could not already see —
 * a name and an address — and every interpolated value is escaped for the HTML part.
 *
 * Whether to send at all is {@link mailEnabled}'s answer; a failed send is the caller's to log.
 */

import { escapeHtml } from "../modules/mail/html";
import type { MailMessage, Mailer } from "../modules/mail/mailer";

/** Where the admin page is, under `OURO_UI_URL`. The UI serves it at this path. */
export const ADMIN_ACCOUNTS_PATH = "/admin/accounts";

/** The person a mail is about. */
export interface AccountMailSubject {
  /** Their display name — `"user".name`. */
  readonly name: string;
  /** Their address. */
  readonly email: string;
  /** Their GitHub login, when the account came from GitHub. */
  readonly githubLogin?: string | null;
}

/**
 * Whether this deployment sends mail at all.
 *
 * `mailerFor` answers an `UnconfiguredMailer` (transport `none`) when `OURO_SMTP_URL` is unset,
 * whose `send` refuses. Account approval treats that as "send nothing, fail nothing" rather than
 * as an error to log on every sign-in, so it asks first.
 *
 * @param mailer - The mailer, or `undefined` where none was wired (the BetterAuth CLI).
 * @returns `true` when a send would be attempted.
 */
export function mailEnabled(mailer: Mailer | undefined): mailer is Mailer {
  return mailer !== undefined && mailer.transport !== "none";
}

/**
 * Join the UI's base URL and a path without doubling or dropping the slash.
 *
 * @param uiUrl - `OURO_UI_URL`, an origin that may or may not end in `/`.
 * @param path - An absolute path.
 * @returns The absolute URL.
 */
export function uiLink(uiUrl: string, path: string): string {
  return `${uiUrl.replace(/\/+$/, "")}${path}`;
}

/**
 * How the person is named in a mail: their name, then their GitHub login and address.
 *
 * @param subject - The person.
 * @returns For example `Priya Raman (@priyaraman, priya@contractor.dev)`.
 */
function describePerson(subject: AccountMailSubject): string {
  const login = subject.githubLogin ? `@${subject.githubLogin}, ` : "";

  return `${subject.name} (${login}${subject.email})`;
}

/**
 * The email an application administrator gets when somebody is held.
 *
 * @param to - The administrator's address.
 * @param subject - The person waiting.
 * @param uiUrl - `OURO_UI_URL`, for the link to the admin page.
 * @returns The message, ready for `Mailer.send`.
 */
export function heldMail(to: string, subject: AccountMailSubject, uiUrl: string): MailMessage {
  const link = uiLink(uiUrl, ADMIN_ACCOUNTS_PATH);
  const person = describePerson(subject);

  return {
    to,
    subject: `${subject.name} is waiting for approval`,
    text:
      `${person} signed in to Ouroboros and is waiting for an administrator to approve the ` +
      `account.\n\nApprove or deny it: ${link}\n`,
    html:
      `<p>${escapeHtml(person)} signed in to Ouroboros and is waiting for an administrator to ` +
      `approve the account.</p>` +
      `<p><a href="${escapeHtml(link)}">Approve or deny it</a></p>`,
  };
}

/**
 * The email a person gets when an administrator approves them.
 *
 * @param subject - The person approved; the mail goes to their address.
 * @param uiUrl - `OURO_UI_URL`, for the link back into the product.
 * @returns The message, ready for `Mailer.send`.
 */
export function approvedMail(subject: AccountMailSubject, uiUrl: string): MailMessage {
  const link = uiLink(uiUrl, "/");

  return {
    to: subject.email,
    subject: "Your Ouroboros account was approved",
    text: `Hello ${subject.name},\n\nAn administrator approved your account. You can sign in now: ${link}\n`,
    html:
      `<p>Hello ${escapeHtml(subject.name)},</p>` +
      `<p>An administrator approved your account. ` +
      `<a href="${escapeHtml(link)}">You can sign in now</a>.</p>`,
  };
}
