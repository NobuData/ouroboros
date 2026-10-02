/**
 * Mail (#440): one {@link Mailer} for the process, chosen by configuration.
 *
 * `OURO_SMTP_URL` set — SMTP. Unset — a mailer that reports `none` and refuses. The choice is
 * made once at boot, so every caller agrees about whether this deployment can send.
 *
 * The module imports nothing but configuration: mail is a leaf, and whatever sends through it
 * (Insights today; invitations and the inbox later) imports this, never the other way round.
 */

import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { MAILER, type Mailer } from "./mailer";
import { SmtpMailer } from "./smtp.mailer";
import { UnconfiguredMailer } from "./unconfigured.mailer";

/**
 * The mailer this deployment's configuration asks for.
 *
 * @param config - The configuration.
 * @returns SMTP when a server is configured, the refusing mailer otherwise.
 */
export function mailerFor(config: Pick<AppConfigService, "smtpUrl" | "mailFrom">): Mailer {
  const { smtpUrl, mailFrom } = config;

  // The configuration schema refuses one without the other; both are checked so this function
  // is safe to call with a hand-built stub as well.
  return smtpUrl === undefined || mailFrom === undefined
    ? new UnconfiguredMailer()
    : new SmtpMailer(smtpUrl, mailFrom);
}

@Module({
  providers: [{ provide: MAILER, useFactory: mailerFor, inject: [AppConfigService] }],
  exports: [MAILER],
})
export class MailModule implements OnApplicationShutdown {
  /**
   * @param mailer - The process's mailer.
   */
  constructor(@Inject(MAILER) private readonly mailer: Mailer) {}

  /** Close the SMTP transport, when there is one. */
  onApplicationShutdown(): void {
    if (this.mailer instanceof SmtpMailer) {
      this.mailer.close();
    }
  }
}
