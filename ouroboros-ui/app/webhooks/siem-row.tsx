"use client";

import { useState } from "react";

import type { WebhookList } from "@/app/api/settings-webhooks";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, cx } from "@/app/ui";

import { DeliveryLog } from "./delivery-log";
import { WebhookSheet } from "./webhook-sheet";
import { SIEM_LABEL, SIEM_SHEET_NOTE, deliveryLogTitle, siemHint, siemStatus } from "./view";

import "./webhooks.css";

/**
 * The Audit card's **Stream to SIEM** row
 * (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)).
 *
 * **It is a status claim, not a decoration.** *Stream to SIEM ✓* asserts that the customer's
 * security log has a complete copy, so the ✓ is drawn only when the service calls the SIEM
 * endpoint `streaming`; with events dead-lettered the row is a warning that says deliveries are
 * failing and how many are waiting, and every other case — paused, retrying, nothing delivered
 * yet, not set up, unreadable — says so in words (`app/webhooks/view.ts`'s `siemStatus`).
 *
 * **The evidence is one press away.** With a SIEM endpoint the row opens its delivery log —
 * attempts, codes, latencies, and the dead-letter queue with **Redeliver**. With none it opens
 * the webhook endpoints, which is where one is made the SIEM stream.
 *
 * Mounted only for owners and admins: the endpoints are theirs alone to read.
 *
 * @param props.webhooks The endpoints as the page read them, or `null` when it could not.
 * @returns The row's button, and the sheet behind it.
 */
export function SiemRow({ webhooks }: Readonly<{ webhooks: WebhookList | null }>) {
  const [open, setOpen] = useState(false);
  const status = siemStatus(webhooks);
  const hint = siemHint(status);

  return (
    <>
      <Button
        aria-haspopup="dialog"
        aria-label={`${SIEM_LABEL}. ${hint}`}
        className={cx("webhooks-siem", status.state === "warning" && "webhooks-siem--warn")}
        onClick={() => setOpen(true)}
        size="sm"
        title={hint}
        tone="ghost"
      >
        {SIEM_LABEL}
        {status.mark !== null && (
          <span
            aria-hidden
            className={cx(
              "webhooks-siem__mark",
              status.state === "streaming" && "webhooks-siem__mark--ok",
              status.state === "warning" && "webhooks-siem__mark--warn",
            )}
          >
            {status.mark}
          </span>
        )}
        <span className="webhooks-siem__detail">{status.detail}</span>
      </Button>

      {status.endpointId !== null && status.endpointName !== null ? (
        <ShellOverlay
          label={deliveryLogTitle(status.endpointName)}
          onClose={() => setOpen(false)}
          open={open}
          wide
        >
          <div className="webhooks-sheet">
            <div>
              <h2 className="shell-overlay__title">{deliveryLogTitle(status.endpointName)}</h2>
              <p className="shell-overlay__note">{SIEM_SHEET_NOTE}</p>
            </div>
            <DeliveryLog endpointId={status.endpointId} endpointName={status.endpointName} />
          </div>
        </ShellOverlay>
      ) : (
        <WebhookSheet initial={webhooks} onClose={() => setOpen(false)} open={open} />
      )}
    </>
  );
}
