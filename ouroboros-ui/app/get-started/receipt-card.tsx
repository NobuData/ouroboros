"use client";

import Link from "next/link";
import { useId } from "react";

import { SOURCES_PATH } from "@/app/paths";
import { Card, CardHead, Chip } from "@/app/ui";

import {
  RECEIPT_CONSOLE_LABEL,
  RECEIPT_CONSOLE_PENDING,
  RECEIPT_DASHBOARD_LABEL,
  RECEIPT_LINKS_LABEL,
  RECEIPT_PILL,
  RECEIPT_QUEUE_LABEL,
  RECEIPT_REENTER_LINE,
  RECEIPT_REENTER_MORE,
  RECEIPT_REENTER_NONE,
  RECEIPT_REENTER_TITLE,
  RECEIPT_RUNS_LABEL,
  RECEIPT_TITLE,
  type ReceiptView,
  positionLine,
} from "./view";

import "./get-started.css";

/**
 * The completion state (BC.6, [#395](https://github.com/NobuData/ouroboros/issues/395)) — the
 * receipt card that leads the step content once *Run my first loop →* has queued the issue, and
 * on every visit after.
 *
 * **It says what the service answered and no more.** Fresh from the press, the launch's receipt
 * carries the queue position and the dry-run note; after a reload the rail's derived evidence is
 * what remains — `#488 · queued`, or `run started` once a loop has claimed it — and the card
 * prints that, with no position it did not read. The console link is the receipt's when there
 * is a run to open and the Runs page until then, said in words rather than a dead link.
 *
 * **Re-enter.** The wizard is per repository, so the card ends with the workspace's other
 * mirrored repositories, each the address of its own rail.
 *
 * @param props.view The card, decided by `receiptView`.
 * @returns The card.
 */
export function ReceiptCard({ view }: Readonly<{ view: ReceiptView }>) {
  const titleId = useId();

  return (
    <Card aria-labelledby={titleId} as="section" className="wizard-receipt" tone="ground">
      <CardHead beside={<Chip tone="ok">{RECEIPT_PILL}</Chip>} title={RECEIPT_TITLE} titleId={titleId} />

      <p className="wizard-receipt__headline">
        <span className="wizard-receipt__issue">{view.headline}</span>
        {view.position !== null && <span className="wizard-receipt__position"> · {positionLine(view.position)}</span>}
      </p>
      {view.dryRunNote !== null && <p className="wizard-receipt__note">{view.dryRunNote}</p>}

      <ul aria-label={RECEIPT_LINKS_LABEL} className="wizard-receipt__links">
        <li>
          <Link className="wizard-receipt__link" href={view.dashboardHref}>
            {RECEIPT_DASHBOARD_LABEL}
          </Link>
        </li>
        <li>
          <Link className="wizard-receipt__link" href={view.queueHref}>
            {RECEIPT_QUEUE_LABEL}
          </Link>
        </li>
        <li>
          {view.consoleHref !== null ? (
            <Link className="wizard-receipt__link" href={view.consoleHref}>
              {RECEIPT_CONSOLE_LABEL}
            </Link>
          ) : (
            <span className="wizard-receipt__pending">
              {RECEIPT_CONSOLE_PENDING}{" "}
              <Link className="wizard-receipt__link" href={view.runsHref}>
                {RECEIPT_RUNS_LABEL}
              </Link>
            </span>
          )}
        </li>
      </ul>

      <h3 className="wizard-receipt__reenter-title">{RECEIPT_REENTER_TITLE}</h3>
      {view.others.length === 0 ? (
        <p className="wizard-receipt__reenter-none">
          {RECEIPT_REENTER_NONE}{" "}
          <Link className="wizard-receipt__link" href={SOURCES_PATH}>
            {RECEIPT_REENTER_MORE}
          </Link>
        </p>
      ) : (
        <>
          <p className="wizard-receipt__reenter-line">{RECEIPT_REENTER_LINE}</p>
          <ul aria-label={RECEIPT_REENTER_TITLE} className="wizard-receipt__others">
            {view.others.map((other) => (
              <li key={other.repo}>
                <Link className="wizard-receipt__link wizard-receipt__other" href={other.href}>
                  {other.repo} →
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
