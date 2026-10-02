/**
 * A mailer that keeps what it was asked to send (#440) — for suites that care what a message
 * said and to whom, and not how SMTP carried it.
 */

import type { Mailer, MailMessage, MailReceipt, MailTransport } from "./mailer";

export class RecordingMailer implements Mailer {
  /** Every message handed over, oldest first — including the ones {@link failFor} refused. */
  readonly sent: MailMessage[] = [];

  /** Recipients whose next sends fail, with how many failures are left for each. */
  private readonly failures = new Map<string, number>();

  /**
   * @param transport - What the mailer reports itself as.
   */
  constructor(readonly transport: MailTransport = "smtp") {}

  /**
   * Make the next sends to one recipient fail.
   *
   * @param to - The recipient.
   * @param times - How many sends fail before one succeeds.
   */
  failFor(to: string, times = 1): void {
    this.failures.set(to, times);
  }

  /**
   * Record the message; succeed unless a failure was arranged for its recipient.
   *
   * @param message - The message.
   * @returns A receipt under the message's own id, or a made-up one.
   * @throws {Error} A connection failure, when one was arranged.
   */
  send(message: MailMessage): Promise<MailReceipt> {
    this.sent.push(message);

    const left = this.failures.get(message.to) ?? 0;

    if (left > 0) {
      this.failures.set(message.to, left - 1);

      return Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:1025"));
    }

    return Promise.resolve({
      messageId: message.messageId ?? `<recorded-${String(this.sent.length)}@ouroboros.test>`,
    });
  }

  /**
   * The messages sent to one address.
   *
   * @param to - The recipient.
   * @returns Them, oldest first.
   */
  to(to: string): MailMessage[] {
    return this.sent.filter((message) => message.to === to);
  }
}
