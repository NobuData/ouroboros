/**
 * The mailer abstraction (BJ.4, [#440](https://github.com/NobuData/ouroboros/issues/440)) — the
 * one seam anything in this service sends mail through.
 *
 * The weekly Insights digest is its first caller; the invitation flow (E.3, #724) and the inbox
 * digest (BN.3, #463) are written against this same interface when they arrive, which is why it
 * knows nothing about digests: a message goes in, a receipt or a failure comes out.
 *
 * **A deployment with no mail server says so.** `transport` is `none` when `OURO_SMTP_URL` is
 * unset, and a caller reads that *before* it promises anyone an email — a subscribe that
 * succeeds into a mailer that cannot send would be the silent no-op the issue rules out.
 */

/** How this deployment sends mail: through an SMTP server, or not at all. */
export type MailTransport = "smtp" | "none";

/** One message. */
export interface MailMessage {
  /** The recipient's address. */
  readonly to: string;
  readonly subject: string;
  /** The plain-text part. Every message has one: clients that show no HTML show this. */
  readonly text: string;
  /** The HTML part. */
  readonly html: string;
  /**
   * The `Message-ID` header, angle brackets included. Given by a caller that needs the same id
   * on a retry, so a receiver can collapse the duplicate; generated when absent.
   */
  readonly messageId?: string;
  /** Extra headers, such as `List-Unsubscribe`. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** What a server accepted. */
export interface MailReceipt {
  /** The `Message-ID` the message went out under. */
  readonly messageId: string;
}

/** Sends mail. */
export interface Mailer {
  /** `none` when this deployment has no mail server. */
  readonly transport: MailTransport;

  /**
   * Hand one message to the mail server.
   *
   * @param message - The message.
   * @returns The receipt, once the server has accepted it.
   * @throws {MailUnavailableError} When `transport` is `none`.
   * @throws {Error} When the server could not be reached or refused the message.
   */
  send(message: MailMessage): Promise<MailReceipt>;
}

/** The injection token a {@link Mailer} is provided under. */
export const MAILER = Symbol("MAILER");

/** The name mail is sent under, beside `OURO_MAIL_FROM`'s address. */
export const MAIL_FROM_NAME = "Ouroboros";

/** A send was asked of a deployment that has no mail server. */
export class MailUnavailableError extends Error {
  constructor() {
    super("This deployment sends no mail: OURO_SMTP_URL is not set.");
    this.name = "MailUnavailableError";
  }
}
