"use client";

import { useState, useTransition } from "react";

import type { SlackConnection } from "@/app/api/chatops";
import { Button } from "@/app/ui";

import { retryDelivery } from "./chatops-actions";
import {
  DELIVERY_AUDIT_LABEL,
  DELIVERY_AUDIT_PATH,
  DELIVERY_LABEL,
  DELIVERY_RETRYING_LABEL,
  DELIVERY_RETRY_FAILED,
  DELIVERY_RETRY_LABEL,
  DELIVERY_ROLE_NOTE,
  type DeliveryBannerView,
  refusalText,
  refused,
} from "./view";

/** What the banner takes. */
export interface DeliveryBannerProps {
  /** What to say — `deliveryBanner`'s answer, which the screen has already found non-null. */
  readonly banner: DeliveryBannerView;
  /** Whether this reader may retry — an owner or an admin. */
  readonly mayAdminister: boolean;
  /**
   * Called with the connection as a retry left it.
   *
   * @param connection The connection, its dead letters pending again.
   */
  readonly onRetried: (connection: SlackConnection) => void;
}

/**
 * The publish-health banner (CA.5, [#545](https://github.com/NobuData/ouroboros/issues/545)) —
 * under the health strip while a message was not delivered, or keeps failing.
 *
 * **Failure here is invisible by construction.** A build-failure card that never reached its
 * channel leaves the channel quiet, and quiet reads as *no failures*. This is the one place the
 * app says the integration stopped delivering: how many messages, on which routes, and Slack's
 * own last answer.
 *
 * **It comes with what to do.** An owner or an admin can queue the undelivered messages again;
 * everyone else is told who can. Either way the audit log is one link away. A retry draws the
 * service's answer at once, and the banner goes when the page's poll reads a drained queue — it
 * is never dismissed by hand.
 *
 * @param props See {@link DeliveryBannerProps}.
 * @returns The banner.
 */
export function DeliveryBanner({ banner, mayAdminister, onRetried }: DeliveryBannerProps) {
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Queue the dead letters again, and hand the answer up. */
  function retry(): void {
    if (pending) return;

    setFailure(null);

    startTransition(async () => {
      try {
        const outcome = await retryDelivery();

        if (refused(outcome)) setFailure(refusalText(outcome.error, DELIVERY_RETRY_FAILED));
        else onRetried(outcome);
      } catch {
        setFailure(DELIVERY_RETRY_FAILED);
      }
    });
  }

  return (
    <section aria-label={DELIVERY_LABEL} className="chatops__delivery" role="status">
      <div className="chatops__delivery-text">
        <p className="chatops__delivery-headline">{banner.headline}</p>
        {banner.detail !== null && <p className="chatops__delivery-detail">{banner.detail}</p>}
        {banner.retryable && !mayAdminister && <p className="chatops__delivery-detail">{DELIVERY_ROLE_NOTE}</p>}
        {failure !== null && (
          <p className="chatops__refusal" role="alert">
            {failure}
          </p>
        )}
      </div>
      <div className="chatops__delivery-actions">
        {banner.retryable && mayAdminister && (
          <Button
            aria-busy={pending || undefined}
            onClick={retry}
            reason={pending ? DELIVERY_RETRYING_LABEL : undefined}
            size="sm"
            tone="ghost"
          >
            {pending ? DELIVERY_RETRYING_LABEL : DELIVERY_RETRY_LABEL}
          </Button>
        )}
        <a className="chatops__link" href={DELIVERY_AUDIT_PATH}>
          {DELIVERY_AUDIT_LABEL}
        </a>
      </div>
    </section>
  );
}
