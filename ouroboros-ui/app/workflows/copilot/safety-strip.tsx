"use client";

import { type KeyboardEvent, useId, useState } from "react";

import type { DryRunSafety } from "@/app/api/workflow-dry-runs";
import { Card, CardHead, Tag, cx } from "@/app/ui";

import { COPILOT_SEATS, seatElementId } from "./copilot-view";
import {
  HARNESS_TERM,
  MECHANISM_TERM,
  type SafetyColumnView,
  mechanismButtonName,
  safetyColumns,
  withheldNote,
} from "./safety";

import "./safety.css";

/**
 * The copilot's safety strip (CE.5, [#569](https://github.com/NobuData/ouroboros/issues/569)) —
 * mockup 20's *WHY DRY RUNS ARE SAFE* card, under the dry run.
 *
 * It draws what `safety.ts` composed from the service's payload and nothing else: one column per
 * claim the installed harness backs, each with an ⓘ that opens — in the flow of the card, the
 * way the stage list's warnings do — the mechanism behind the claim. A claim the payload does
 * not assert has no column; when that leaves the strip short, one sentence says so without
 * repeating the claim.
 *
 * One trace is open at a time. Escape closes it and returns focus to the ⓘ that opened it.
 *
 * @param props.safety The strip, as the route read it.
 * @returns The card.
 */
export function SafetyStrip({ safety }: Readonly<{ safety: DryRunSafety }>) {
  const ids = useId();
  const [open, setOpen] = useState<string | null>(null);

  const columns = safetyColumns(safety);
  const shown = columns.find((column) => column.id === open) ?? null;
  const withheld = withheldNote(columns.length);

  const element = seatElementId("safety");
  const titleId = `${element}-title`;
  const traceId = `${ids}-trace`;

  /**
   * A column's ⓘ's element id, which is how Escape finds the control to give focus back to.
   *
   * @param column The column.
   * @returns The id.
   */
  const toggleId = (column: SafetyColumnView): string => `${ids}-info-${column.id}`;

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>): void {
    if (event.key !== "Escape" || shown === null) return;

    event.stopPropagation();
    setOpen(null);
    document.getElementById(toggleId(shown))?.focus();
  }

  return (
    <Card
      aria-labelledby={titleId}
      as="section"
      className={cx("copilot-view__seat", "copilot-safety")}
      id={element}
    >
      <CardHead
        title={COPILOT_SEATS.safety.title}
        titleId={titleId}
        trailing={<Tag>{`${HARNESS_TERM}: ${safety.harness}`}</Tag>}
      />

      {columns.length > 0 && (
        // The ⓘs are inside the list, so an Escape pressed on one arrives here.
        <ul className="copilot-safety__columns" onKeyDown={onKeyDown}>
          {columns.map((column) => (
            <li className="copilot-safety__column" data-claim={column.id} key={column.id}>
              <p className="copilot-safety__key">
                {column.key}
                <button
                  aria-controls={traceId}
                  aria-expanded={open === column.id}
                  aria-label={mechanismButtonName(column.key)}
                  className="copilot-safety__info"
                  id={toggleId(column)}
                  onClick={() => setOpen(open === column.id ? null : column.id)}
                  type="button"
                >
                  <span aria-hidden="true">ⓘ</span>
                </button>
              </p>
              <p className="copilot-safety__sentence">{column.sentence}</p>
            </li>
          ))}
        </ul>
      )}

      {/* In the tree whenever a column is drawn, so the ⓘ's `aria-controls` names something. */}
      {columns.length > 0 && (
        <div className="copilot-safety__trace" hidden={shown === null} id={traceId} role="note">
          {shown !== null && (
            <>
              <p className="copilot-safety__trace-title">
                {`${shown.key} — ${MECHANISM_TERM.toLowerCase()}: ${shown.mechanism}`}
              </p>
              <p className="copilot-safety__trace-detail">{shown.detail}</p>
              {shown.facts.length > 0 && (
                <dl className="copilot-safety__facts">
                  {shown.facts.map((fact) => (
                    <div className="copilot-safety__fact" key={fact.term}>
                      <dt>{fact.term}</dt>
                      <dd className={cx(fact.mono && "copilot-safety__fact-value--mono")}>{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          )}
        </div>
      )}

      {withheld !== null && (
        <p
          className={cx("copilot-safety__withheld", columns.length === 0 && "copilot-safety__withheld--alone")}
          role="status"
        >
          {withheld}
        </p>
      )}
    </Card>
  );
}
