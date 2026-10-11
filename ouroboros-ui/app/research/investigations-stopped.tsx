"use client";

import { useEffect, useState } from "react";

import type { InvestigationDetail } from "@/app/api/research";
import { Chip } from "@/app/ui";

import type { LedgerOutcome } from "./brief";
import { readBriefLedger } from "./brief-actions";
import { LedgerRows } from "./brief-sources";
import { PILL_TONES } from "./investigations";
import {
  PARTIAL_LEDGER_EMPTY,
  PARTIAL_LEDGER_LOADING,
  PARTIAL_LEDGER_UNAVAILABLE,
  STOPPED_KEPT_NOTE,
  STOPPED_REASON_LABEL,
  sourcesReached,
  stoppedReason,
} from "./states";

/** What the stopped view takes. */
export interface StoppedInvestigationProps {
  /** The investigation — `failed` or `cancelled`. */
  readonly detail: InvestigationDetail;
  /** How its ledger is read. A test hands in a fake; the page uses the server action. */
  readonly readLedger?: (investigationId: string) => Promise<LedgerOutcome>;
}

/**
 * A stopped investigation, opened (CN.7,
 * [#633](https://github.com/NobuData/ouroboros/issues/633)): **why it stopped, how far it got,
 * and everything it read on the way**.
 *
 * A failed investigation still cost money, and a cancelled one was stopped by somebody who had
 * seen enough — in both cases the ledger is real evidence. So this is not an error banner: it is
 * the status pill, the reason in the page's words with the loop's own detail after it
 * (`stoppedReason`), the count of sources reached from the investigation's own ledger summary —
 * known before the records are — and then the records themselves, drawn by the same rows the
 * ledger sheet uses. A ledger that could not be read says so in its own place and takes nothing
 * else with it.
 *
 * @param props See {@link StoppedInvestigationProps}.
 * @returns The reason, the count and the partial ledger.
 */
export function StoppedInvestigation({ detail, readLedger = readBriefLedger }: StoppedInvestigationProps) {
  // The ledger as read, with the investigation it was read for — so an answer for an
  // investigation the reader has left is never drawn under another.
  const [read, setRead] = useState<{ readonly id: string; readonly outcome: LedgerOutcome } | null>(null);
  const ledger = read !== null && read.id === detail.id ? read.outcome : null;

  useEffect(() => {
    let current = true;

    void readLedger(detail.id).then((outcome) => {
      if (current) setRead({ id: detail.id, outcome });
    });

    return () => {
      current = false;
    };
  }, [detail.id, readLedger]);

  return (
    <div className="research__stopped">
      <p className="research__progress-line">
        <Chip dot="filled" tone={PILL_TONES[detail.pill.tone]}>
          {detail.pill.label}
        </Chip>
        <span className="research__progress-figures">{sourcesReached(detail.ledger.total)}</span>
      </p>
      <p className="research__stopped-reason">
        <span className="research__stopped-label">{STOPPED_REASON_LABEL}</span> {stoppedReason(detail)}
      </p>
      <p className="research__inv-note">{STOPPED_KEPT_NOTE}</p>

      {ledger === null && <p className="research__ledger-note">{PARTIAL_LEDGER_LOADING}</p>}
      {ledger?.ok === false && (
        <p className="research__ledger-note" role="alert">
          {PARTIAL_LEDGER_UNAVAILABLE} {ledger.refusal.message}
        </p>
      )}
      {ledger?.ok === true && ledger.items.length === 0 && (
        <p className="research__ledger-note">{PARTIAL_LEDGER_EMPTY}</p>
      )}
      {ledger?.ok === true && ledger.items.length > 0 && (
        <LedgerRows focus={null} items={ledger.items} panel={[]} />
      )}
    </div>
  );
}
