/**
 * What the digest routes refuse, and with which code (#440).
 */

import { ConflictError } from "../../errors/error.envelope";

/** The codes the digest routes answer with. */
export const DIGEST_ERRORS = {
  /** Subscribing was asked of a deployment that has no mail server. */
  mailUnconfigured: "insights_digest_mail_unconfigured",
} as const;

/**
 * Nobody can be promised an email by a deployment that cannot send one.
 *
 * @returns The `409`.
 */
export function digestMailUnconfigured(): ConflictError {
  return new ConflictError(
    DIGEST_ERRORS.mailUnconfigured,
    "This deployment has no mail server configured, so it cannot send the weekly digest. " +
      "An operator sets OURO_SMTP_URL and OURO_MAIL_FROM to turn it on.",
  );
}
