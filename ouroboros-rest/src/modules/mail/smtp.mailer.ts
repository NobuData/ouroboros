/**
 * Mail over SMTP (#440) — the one file in this service that names `nodemailer`.
 *
 * In development `OURO_SMTP_URL` points at mailpit, which accepts everything and shows it in a
 * browser; in production it is the operator's relay. Nothing here differs between the two.
 *
 * **Every phase has a timeout.** nodemailer's defaults are minutes long, and the digest run that
 * calls this holds a claim on its recipient while it waits — so a server that accepts the
 * connection and then says nothing costs seconds, not the run.
 */

import { createTransport, type Transporter } from "nodemailer";

import { MAIL_FROM_NAME, type Mailer, type MailMessage, type MailReceipt } from "./mailer";

/** Milliseconds allowed for the TCP connection. */
export const SMTP_CONNECTION_TIMEOUT_MS = 10_000;

/** Milliseconds allowed for the server's greeting once connected. */
export const SMTP_GREETING_TIMEOUT_MS = 10_000;

/** Milliseconds of silence allowed mid-conversation. */
export const SMTP_SOCKET_TIMEOUT_MS = 30_000;

/** What {@link SmtpMailer} needs of a transport — nodemailer's, or a test's. */
export type SmtpTransport = Pick<Transporter, "sendMail" | "close">;

export class SmtpMailer implements Mailer {
  readonly transport = "smtp" as const;

  /** The connection settings, held until the first send or `close`. */
  private readonly smtp: SmtpTransport;

  /**
   * @param url - `OURO_SMTP_URL`: `smtp://host:port` or `smtps://user:password@host:port`.
   * @param from - `OURO_MAIL_FROM`: the bare address mail leaves from.
   * @param transport - The transport to send through; nodemailer's for `url` when omitted.
   */
  constructor(
    url: string,
    private readonly from: string,
    transport?: SmtpTransport,
  ) {
    this.smtp =
      transport ??
      createTransport({
        url,
        connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
        greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
        socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
      });
  }

  /**
   * Hand one message to the server.
   *
   * @param message - The message.
   * @returns The receipt.
   * @throws {Error} nodemailer's own failure — unreachable, refused, or timed out.
   */
  async send(message: MailMessage): Promise<MailReceipt> {
    const sent = (await this.smtp.sendMail({
      from: { name: MAIL_FROM_NAME, address: this.from },
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.messageId === undefined ? {} : { messageId: message.messageId }),
      ...(message.headers === undefined ? {} : { headers: { ...message.headers } }),
    })) as { messageId: string };

    return { messageId: sent.messageId };
  }

  /** Release the transport's sockets. */
  close(): void {
    this.smtp.close();
  }
}
