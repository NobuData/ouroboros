"use client";

import { ShellOverlay } from "@/app/shell/overlay";
import { Eyebrow } from "@/app/ui";

import { evidenceLink } from "./duration-view";
import { EvidenceList } from "./evidence-list";
import { evidenceNote } from "./suggestions-view";
import {
  BODY_SOURCE_NOTE,
  EVIDENCE_EYEBROW,
  NO_EVIDENCE_LINE,
  NO_REFERENCES,
  type TicketEvidence,
  WILL_CARRY_NOTE,
} from "./tickets-view";

/**
 * What a drafted ticket's evidence line opens (BW.4,
 * [#519](https://github.com/NobuData/ouroboros/issues/519)) — the references behind the line, each
 * **a link to the surface it resolves on**: the build farm, a loop's test results, the pull
 * request a waiver was recorded against. A reference whose row is gone keeps its id and opens
 * nothing, exactly as in the other two Details sheets (`evidence-list.tsx`).
 *
 * For a draft it says where the evidence was read from — the draft's own body, which is what a
 * push files — so a reader who edited the body knows the sheet shows their edit. For a suggestion
 * not drafted yet it says the draft's body will carry it.
 *
 * **It follows the row, not a snapshot of it**: the caller passes the live row's evidence, so a
 * sheet left open over a poll shows what the card shows, and closes by itself when the row goes.
 * The modal contract is the shell overlay's.
 *
 * @param props.evidence The evidence of the row whose line was pressed, or `null`.
 * @param props.onClose Called when the reader dismisses the sheet.
 * @returns The sheet while evidence is given; nothing otherwise.
 */
export function TicketEvidenceSheet({
  evidence,
  onClose,
}: Readonly<{ evidence: TicketEvidence | null; onClose: () => void }>) {
  const label = evidence === null ? EVIDENCE_EYEBROW : `${EVIDENCE_EYEBROW} · ${evidence.title}`;

  return (
    <ShellOverlay label={label} onClose={onClose} open={evidence !== null}>
      {evidence !== null && <Evidence evidence={evidence} />}
    </ShellOverlay>
  );
}

/**
 * The sheet's content, for one ticket.
 *
 * @param props.evidence The ticket's evidence.
 * @returns The line, the references and where they were read from.
 */
function Evidence({ evidence }: Readonly<{ evidence: TicketEvidence }>) {
  const more = evidenceNote(evidence);

  return (
    <div className="analyzer-tixev">
      <div>
        <Eyebrow>
          {evidence.localKey === null ? EVIDENCE_EYEBROW : `${EVIDENCE_EYEBROW} · ${evidence.localKey}`}
        </Eyebrow>
        <h2 className="shell-overlay__title">{evidence.title}</h2>
      </div>
      {evidence.line === null ? (
        <p className="analyzer-tixev__note">{NO_EVIDENCE_LINE}</p>
      ) : (
        <p className="analyzer-tixev__line">{evidence.line}</p>
      )}
      {evidence.evidence.length === 0 ? (
        <p className="analyzer-tixev__note">{NO_REFERENCES}</p>
      ) : (
        <EvidenceList links={evidence.evidence.map(evidenceLink)} />
      )}
      {more !== null && <p className="analyzer-tixev__note">{more}</p>}
      <p className="analyzer-tixev__source">
        {evidence.localKey === null ? WILL_CARRY_NOTE : BODY_SOURCE_NOTE}
      </p>
    </div>
  );
}
