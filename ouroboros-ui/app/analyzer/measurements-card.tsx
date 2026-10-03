"use client";

import type { Measurement, Measurements } from "@/app/api/analyzer";
import { Card, CardHead, EmptyState, Tag } from "@/app/ui";

import { useAnalyzer } from "./analyzer-store";
import {
  CONFOUNDED_MARK,
  CONFOUNDS_HEADING,
  type ConfoundItem,
  DELIVERED_MARK,
  LINE_LABELS,
  MEASUREMENTS_ANCHOR,
  MEASUREMENTS_TAG,
  MEASUREMENTS_TITLE,
  NO_MEASUREMENTS,
  NO_RECALIBRATION,
  PENDING_CONFOUNDS_HEADING,
  RECALIBRATION_HEADING,
  RECALIBRATION_LEDE,
  RETRAINS_WORD,
  type VerdictTone,
  appliedLabel,
  captionParts,
  confoundItems,
  measuredText,
  measurementAnchor,
  measurementRows,
  predictedText,
  recalibrationCells,
  rowNote,
  verdictTone,
  verdictWord,
  windowDays,
} from "./measurements-view";
import { StripPopover } from "./strip-popover";

/** The measured figure's classes, by how its verdict is treated. */
const VALUE_CLASS: Record<VerdictTone, string> = {
  ok: "analyzer-pv__value analyzer-pv__value--ok",
  warn: "analyzer-pv__value analyzer-pv__value--warn",
  confounded: "analyzer-pv__value analyzer-pv__value--confounded",
  pending: "analyzer-pv__value analyzer-pv__value--pending",
};

/**
 * Mockup 18's **Predicted vs measured** (BW.5,
 * [#520](https://github.com/NobuData/ouroboros/issues/520)) — the accountability card: what each
 * applied suggestion predicted, beside what was then measured.
 *
 * Every measurement is a row, oldest apply first, and **a miss is drawn exactly like a win**: the
 * same name, the same two mono lines at the same weight. Only the measured figure's hue and the
 * line under the row differ — `✓` for delivered, the warning hue and the service's composed note
 * for an under- or over-delivery. A **confounded** measurement is none of those: it is marked so
 * and lists what interfered, each dated and linked to where it is on the page. A **pending** one
 * shows `day N of 14` and names the metric being measured.
 *
 * The caption's *retrains* opens the recalibration popover: the formula the service states, and
 * each calibration cell's factor with the updates and measurements that moved it.
 *
 * Its heading answers to `#predicted-vs-measured`, where an applied suggestion's row links.
 *
 * @returns The card.
 */
export function MeasurementsCard() {
  const { page } = useAnalyzer();
  const measurements = page?.measurements ?? null;
  const rows = measurements === null ? [] : measurementRows(measurements);

  return (
    <Card
      aria-busy={measurements === null || undefined}
      aria-labelledby={MEASUREMENTS_ANCHOR}
      as="section"
      className="analyzer-pv"
    >
      <CardHead
        title={MEASUREMENTS_TITLE}
        titleId={MEASUREMENTS_ANCHOR}
        // The mockup's tag describes the rows, so it is drawn with them and never over an empty card.
        trailing={rows.length === 0 ? undefined : <Tag>{MEASUREMENTS_TAG}</Tag>}
      />
      {measurements === null ? (
        <div aria-hidden="true" className="analyzer-pv__skeleton" />
      ) : rows.length === 0 ? (
        <EmptyState note={NO_MEASUREMENTS.note} title={NO_MEASUREMENTS.title} />
      ) : (
        <>
          <ul className="analyzer-pv__rows">
            {rows.map((measurement) => (
              <MeasurementRow
                interfering={confoundItems(measurement, rows, page?.duration ?? null)}
                key={measurement.id}
                measurement={measurement}
              />
            ))}
          </ul>
          <Caption measurements={measurements} />
        </>
      )}
    </Card>
  );
}

/**
 * One measurement — the mockup's `.pv`: the suggestion's name with when it was applied, the
 * predicted and measured lines, and under them whatever the outcome needs said.
 *
 * The verdict is always in the text as well as in the hue: a check for delivered, a mark for
 * confounded, and for every verdict a word a screen reader hears.
 *
 * @param props.measurement The measurement.
 * @param props.interfering What interfered with it, named and linked — none for a clean one.
 * @returns The row.
 */
function MeasurementRow({
  measurement,
  interfering,
}: Readonly<{ measurement: Measurement; interfering: readonly ConfoundItem[] }>) {
  const tone = verdictTone(measurement.verdict);
  const note = rowNote(measurement);

  return (
    <li className="analyzer-pv__row" id={measurementAnchor(measurement.id)}>
      <p className="analyzer-pv__name">
        {measurement.title} <span className="analyzer-pv__applied">{appliedLabel(measurement)}</span>
      </p>
      <p className="analyzer-pv__line">
        <span className="analyzer-pv__key">{LINE_LABELS.predicted}</span>
        <span className="analyzer-pv__value">{predictedText(measurement)}</span>
      </p>
      <p className="analyzer-pv__line">
        <span className="analyzer-pv__key">{LINE_LABELS.measured}</span>
        <span className={VALUE_CLASS[tone]}>
          {measuredText(measurement)}
          {tone === "ok" && ` ${DELIVERED_MARK}`}
          {tone === "confounded" && (
            <>
              {" "}
              <span className="analyzer-pv__flag">{CONFOUNDED_MARK}</span>
            </>
          )}
          {tone !== "confounded" && <span className="sr-only"> — {verdictWord(measurement.verdict)}</span>}
        </span>
      </p>
      {note !== null && <p className="analyzer-pv__note">{note}</p>}
      {interfering.length > 0 && (
        <>
          <p className="analyzer-pv__interfering">
            {tone === "pending" ? PENDING_CONFOUNDS_HEADING : CONFOUNDS_HEADING}
          </p>
          <ul className="analyzer-pv__confounds">
            {interfering.map((item) => (
              <li className="analyzer-pv__confound" key={item.key}>
                {item.href === null ? (
                  item.text
                ) : (
                  <a className="analyzer-pv__link" href={item.href}>
                    {item.text}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </li>
  );
}

/**
 * The card's caption, verbatim from the mockup — with *retrains* a control that opens what the
 * word means here: one multiplier per analyzer and kind of impact, the formula that recomputes
 * it, and the cells as the service holds them.
 *
 * @param props.measurements The page's measurements and calibration.
 * @returns The caption.
 */
function Caption({ measurements }: Readonly<{ measurements: Measurements }>) {
  const { before, after } = captionParts(windowDays(measurements));
  const cells = recalibrationCells(measurements);

  return (
    <p className="analyzer-pv__caption">
      {before}
      <StripPopover
        title={RECALIBRATION_HEADING}
        trigger={
          <span>
            {RETRAINS_WORD} <span aria-hidden="true">ⓘ</span>
          </span>
        }
        triggerClassName="analyzer-pv__retrains"
      >
        <span className="analyzer-pop__text">{RECALIBRATION_LEDE}</span>
        <span className="analyzer-pv__formula">{measurements.formula}</span>
        {cells.length === 0 ? (
          <span className="analyzer-pop__text">{NO_RECALIBRATION}</span>
        ) : (
          cells.map((cell) => (
            <span className="analyzer-pv__cell" key={cell.key}>
              <span className="analyzer-pv__cell-name">{cell.heading}</span>
              <span className="analyzer-pop__text">{cell.factor}</span>
              {cell.history.map((line) => (
                <span className="analyzer-pop__text" key={line}>
                  {line}
                </span>
              ))}
            </span>
          ))
        )}
      </StripPopover>
      {after}
    </p>
  );
}
