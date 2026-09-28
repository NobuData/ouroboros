"use client";

import { useId } from "react";

import type { PrGateRow } from "@/app/api/pull-requests";
import { Button, Card, CardHead, Chip, type ChipDot, type ChipTone } from "@/app/ui";

import { FOLLOW_LATEST, GATES_TITLE, type GatesScope, NO_GATES, VERDICT_WORDS } from "./strip";

/** The element id the gates sit at — AY.3's card keeps it (#365). */
export const GATES_ID = "gates";

/** What the slot says about itself until AY.3 draws the card. */
export const GATES_PENDING_CARD =
  "The revision's snapshot, as recorded. Evidence links and waivers arrive with the " +
  "Verification gates card (#365).";

/** The hue each verdict's chip takes. */
const VERDICT_TONE: Record<PrGateRow["verdict"], ChipTone> = {
  green: "ok",
  red: "err",
  pending: "accent",
  waived: "warn",
  not_required: "neutral",
  unavailable: "neutral",
};

/** The dot each verdict's chip carries — a ring for a verdict nobody could give. */
const VERDICT_DOT: Record<PrGateRow["verdict"], ChipDot> = {
  green: "filled",
  red: "filled",
  pending: "filled",
  waived: "filled",
  not_required: "ring",
  unavailable: "ring",
};

/** What the slot is told. */
export interface GatesSlotProps {
  /** The gates on screen, from `gatesScope`. */
  readonly scope: GatesScope;
  /** Follow the latest revision again. */
  readonly onFollowLatest: () => void;
}

/**
 * Where the verification gates sit ([#364](https://github.com/NobuData/ouroboros/issues/364)) —
 * what a revision step of the strip scopes.
 *
 * The card with every verdict's treatment, its evidence links and its waivers is AY.3's
 * ([#365](https://github.com/NobuData/ouroboros/issues/365)). Until it is drawn, this is the
 * honest slot: it names the revision whose snapshot is on screen and lists that snapshot's rows
 * as they were recorded — so pressing revision 1 shows what was actually wrong, not a re-render
 * of today's state. AY.3 replaces the body and keeps {@link GATES_ID} and the `scope` prop.
 *
 * @param props See {@link GatesSlotProps}.
 * @returns The slot.
 */
export function GatesSlot({ scope, onFollowLatest }: GatesSlotProps) {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="prv-gates" id={GATES_ID}>
      <Card>
        <CardHead
          title={GATES_TITLE}
          titleId={titleId}
          trailing={
            scope.scoped ? (
              <Button onClick={onFollowLatest} size="sm" tone="ghost">
                {FOLLOW_LATEST}
              </Button>
            ) : undefined
          }
        />
        <p className="prv-gates__scope">{scope.heading}</p>

        {scope.rows.length === 0 ? (
          <p className="prv-gates__note">{NO_GATES}</p>
        ) : (
          <ul className="prv-gates__rows">
            {scope.rows.map((row) => (
              <li className="prv-gates__row" key={row.key}>
                <span className="prv-gates__name">{row.label}</span>
                <Chip dot={VERDICT_DOT[row.verdict]} tone={VERDICT_TONE[row.verdict]}>
                  {VERDICT_WORDS[row.verdict]}
                </Chip>
                {row.evidence !== null && (
                  <span className="prv-gates__evidence">{row.evidence}</span>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="prv-gates__note">{GATES_PENDING_CARD}</p>
      </Card>
    </section>
  );
}
