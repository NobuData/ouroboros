/**
 * The mailer of a deployment with no mail server (#440): it reports `none` and refuses to send.
 *
 * It exists so that "mail is not configured" is a state callers read, rather than an injection
 * failure at boot or a message silently dropped.
 */

import { MailUnavailableError, type Mailer, type MailReceipt } from "./mailer";

export class UnconfiguredMailer implements Mailer {
  readonly transport = "none" as const;

  /**
   * Refuse.
   *
   * @returns Never.
   * @throws {MailUnavailableError} Always.
   */
  send(): Promise<MailReceipt> {
    return Promise.reject(new MailUnavailableError());
  }
}
