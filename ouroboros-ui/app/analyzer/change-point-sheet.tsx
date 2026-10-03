"use client";

import { useId } from "react";

import type { ChangePoint } from "@/app/api/analyzer";
import { ShellOverlay } from "@/app/shell/overlay";
import { Eyebrow } from "@/app/ui";

import { EvidenceList, Reference } from "./evidence-list";
import {
  ATTRIBUTED_HEADING,
  RANKING_NOTE,
  SHEET_HEADINGS,
  UNATTRIBUTED_NOTE,
  candidateRows,
  changeSentence,
  changeTone,
  confidenceLines,
  deltaText,
  evidenceLinks,
  segmentLine,
  sheetEyebrow,
  windowLine,
} from "./duration-view";

/** The dialog's name while it is closed and names no change-point. */
const SHEET_LABEL = "Change-point details";

/** The class the delta wears, by its sign — the chip's own rule. */
const DELTA_CLASS: Record<"warn" | "ok", string> = {
  warn: "analyzer-cp__delta analyzer-cp__delta--warn",
  ok: "analyzer-cp__delta analyzer-cp__delta--ok",
};

/**
 * The Details sheet a chip opens — the honest half of the duration chart (BW.2,
 * [#517](https://github.com/NobuData/ouroboros/issues/517)).
 *
 * The chip names one candidate; this shows the finding behind it: the detected day, the delta and
 * the two segment medians it is the difference of, the top candidate under the heading *attributed
 * to (top candidate)*, **every ranked candidate with its score** and the factors the score is the
 * product of, the attribution window, the confidence with its basis, and the evidence — each
 * reference linking to the surface it resolves on (a pull request, the workflow studio, the build
 * farm).
 *
 * **It follows the finding, not a snapshot of it.** The caller passes the live change-point, so a
 * sheet left open over a poll shows what the page shows, and closes by itself if a new analysis no
 * longer has that finding. The modal contract is the shell overlay's.
 *
 * @param props.point The change-point that is open, or `null` when none is.
 * @param props.onClose Called when the reader dismisses the sheet.
 * @returns The sheet while a change-point is given; nothing otherwise.
 */
export function ChangePointSheet({
  point,
  onClose,
}: Readonly<{ point: ChangePoint | null; onClose: () => void }>) {
  const label = point === null ? SHEET_LABEL : `${SHEET_LABEL} · ${sheetEyebrow(point)}`;

  return (
    <ShellOverlay label={label} onClose={onClose} open={point !== null}>
      {point !== null && <ChangePointDetails point={point} />}
    </ShellOverlay>
  );
}

/**
 * The sheet's content, for one change-point.
 *
 * @param props.point The change-point.
 * @returns Its sections.
 */
function ChangePointDetails({ point }: Readonly<{ point: ChangePoint }>) {
  const id = useId();
  const rows = candidateRows(point);
  const top = rows[0];
  const segments = segmentLine(point);
  const basis = confidenceLines(point);
  const method = point.confidenceBasis.method;

  return (
    <div className="analyzer-cp">
      <div>
        <Eyebrow>{sheetEyebrow(point)}</Eyebrow>
        <h2 className="shell-overlay__title">{changeSentence(point)}</h2>
        <p className="analyzer-cp__lede">
          <span className={DELTA_CLASS[changeTone(point.deltaSeconds)]}>{deltaText(point.deltaSeconds)}</span>
          {segments !== null && <span> · {segments}</span>}
        </p>
      </div>

      <section aria-labelledby={`${id}-top`}>
        <h3 className="analyzer-cp__heading" id={`${id}-top`}>
          {ATTRIBUTED_HEADING}
        </h3>
        {top === undefined || top.unattributed ? (
          <p className="analyzer-cp__note">{UNATTRIBUTED_NOTE}</p>
        ) : (
          <>
            <p className="analyzer-cp__top">
              {top.label} <span className="analyzer-cp__score">score {top.score}</span>
            </p>
            <p className="analyzer-cp__note">{RANKING_NOTE}</p>
          </>
        )}
      </section>

      <section aria-labelledby={`${id}-candidates`}>
        <h3 className="analyzer-cp__heading" id={`${id}-candidates`}>
          {SHEET_HEADINGS.candidates}
        </h3>
        <ol className="analyzer-cp__candidates">
          {rows.map((row) => (
            <li className="analyzer-cp__candidate" key={row.rank}>
              <span aria-hidden="true" className="analyzer-cp__rank">
                {row.rank}
              </span>
              <span className="analyzer-cp__name">
                <Reference label={row.label} link={row.link} />
              </span>
              <span className="analyzer-cp__score">score {row.score}</span>
              <span className="analyzer-cp__meta">
                {[row.kind, row.when, row.factors].filter((part) => part !== null).join(" · ")}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <dl className="analyzer-cp__facts">
        <div>
          <dt className="analyzer-cp__heading">{SHEET_HEADINGS.window}</dt>
          <dd className="analyzer-cp__value">{windowLine(point)}</dd>
        </div>
        <div>
          <dt className="analyzer-cp__heading">{SHEET_HEADINGS.confidence}</dt>
          <dd className="analyzer-cp__value">
            <span className="analyzer-cp__top">{point.confidence}%</span>
            {basis.map((line) => (
              <span className="analyzer-cp__basis" key={line}>
                {line}
              </span>
            ))}
            {method !== null && <span className="analyzer-cp__mono">{method}</span>}
          </dd>
        </div>
      </dl>

      <section aria-labelledby={`${id}-evidence`}>
        <h3 className="analyzer-cp__heading" id={`${id}-evidence`}>
          {SHEET_HEADINGS.evidence}
        </h3>
        <EvidenceList links={evidenceLinks(point)} />
      </section>
    </div>
  );
}
