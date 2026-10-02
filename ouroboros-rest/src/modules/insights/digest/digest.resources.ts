/**
 * `/api/v1/insights/digest` — the weekly email's contract with the page head's subscribe flow
 * (#447) and the settings surface, exactly as `openapi.yaml`'s `InsightsDigest*` schemas promise
 * it (BJ.4, [#440](https://github.com/NobuData/ouroboros/issues/440)).
 */

import type { MailTransport } from "../../mail/mailer";
import type { Day } from "../rollup/rollup.types";

/** A workspace's weekly slot. */
export interface InsightsDigestSchedule {
  /** ISO day of week, 1 = Monday … 7 = Sunday. */
  readonly weeklyDay: number;
  /** Time of day, `HH:MM`, in {@link timezone}. */
  readonly weeklyTime: string;
  /** Slots are stored and stated in UTC. */
  readonly timezone: "UTC";
  /** The next slot after now, ISO 8601. */
  readonly nextRunAt: string;
}

/** `GET /api/v1/insights/digest` — the caller's subscription and the workspace's schedule. */
export interface InsightsDigestResource {
  /** Whether the caller receives this workspace's digest. Opt-in: false until they ask. */
  readonly subscribed: boolean;
  /** Where the caller's digest goes — their account's address. */
  readonly recipient: string;
  readonly schedule: InsightsDigestSchedule;
  /**
   * How this deployment sends mail. `none` means it cannot: the digest is off, and subscribing
   * is refused rather than accepted into silence.
   */
  readonly mail: { readonly transport: MailTransport };
}

/** `GET /api/v1/insights/digest/preview` — what the digest would say if it were sent now. */
export interface InsightsDigestPreviewResource {
  readonly subject: string;
  /** The HTML part — a complete document, for a sandboxed frame. */
  readonly html: string;
  /** The plain-text part. */
  readonly text: string;
  /** The seven UTC days the figures cover. */
  readonly window: { readonly from: Day; readonly to: Day };
  /** The content rules it was written under. */
  readonly contentVersion: number;
}
