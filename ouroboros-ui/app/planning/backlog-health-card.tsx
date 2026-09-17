import { Card, CardHead, EmptyState, Meter, Tag } from "@/app/ui";

import {
  DRILL_THROUGH_NOTE,
  ESTIMATOR_FOOTNOTE,
  HEALTH_TITLE,
  HEALTH_TITLE_ID,
  HEALTH_UNREAD,
  LAST_RUN_LABEL,
  type HealthMeter,
  healthMeters,
  lastRunNote,
  lastRunPhrase,
  openTag,
} from "./health";
import { CARD_UNREAD_NOTE } from "./states";
import type { PlanningReadings } from "./view";

import "./planning.css";

/**
 * Mockup 09's **Backlog Health** card, the foot of the side column's `c-5`
 * (AM.3, [#285](https://github.com/NobuData/ouroboros/issues/285)).
 *
 * The `42 open` tag, three captioned meters, and the nightly footnote with its last-run detail.
 * Every figure is AL.5's ([#281](https://github.com/NobuData/ouroboros/issues/281)) and every
 * judgement about how to draw one is [`health.ts`](health.ts)'s.
 *
 * ### An empty workspace shows zeros, not an empty state
 *
 * A workspace with no tickets reads `0 open` with three empty bars, which is the honest answer to
 * *how is the backlog?* — the card still reads as designed. The {@link EmptyState} here is for the
 * different fact that the figures could not be *read* at all, and it carries the service's reason.
 *
 * ### The meters are figures, not links, and the note says why
 *
 * See `health.ts`'s module note: the counts are over the canonical tickets and today's intake list
 * is over the GitHub mirror, so a link would land on the wrong rows. AM.3a
 * ([#968](https://github.com/NobuData/ouroboros/issues/968)) builds the view they will point at.
 */
export function BacklogHealthCard({ readings }: Readonly<{ readings: PlanningReadings }>) {
  const { health } = readings;

  return (
    <Card aria-labelledby={HEALTH_TITLE_ID} as="section" className="planning__region" fill>
      <CardHead
        beside={health.ok ? <Tag>{openTag(health.value.open)}</Tag> : undefined}
        title={HEALTH_TITLE}
        titleId={HEALTH_TITLE_ID}
      />
      {health.ok ? (
        <div className="planning-health">
          <div className="planning-health__meters">
            {healthMeters(health.value).map((meter) => (
              <HealthMeterRow key={meter.id} meter={meter} />
            ))}
          </div>
          <p className="planning-health__note">
            {ESTIMATOR_FOOTNOTE}{" "}
            <span className="planning-health__soon">{DRILL_THROUGH_NOTE}</span>
          </p>
          <p className="planning-health__run">
            <span aria-hidden className="planning-health__info">
              ⓘ
            </span>
            {/* The label names what the phrase is about; the title is the checkable detail. */}
            <span title={lastRunNote(health.value)}>
              <span className="sr-only">{`${LAST_RUN_LABEL} — `}</span>
              {lastRunPhrase(health.value.reestimation.lastRun, new Date(readings.now))}
            </span>
          </p>
        </div>
      ) : (
        <EmptyState fill note={CARD_UNREAD_NOTE} title={HEALTH_UNREAD} />
      )}
    </Card>
  );
}

/**
 * Each tone's figure class — literal, so the stylesheet contract can see them rendered.
 *
 * The same reason `tracker-sync-card.tsx`'s monogram table is a table: a class built by
 * interpolation is one `__tests__/planning/planning-styles.test.ts` cannot find, and the
 * agreement it enforces — that the sheet and the components name the same classes — is worth
 * more than the three lines an interpolation would save.
 */
const VALUE_CLASS: Record<HealthMeter["tone"], string> = {
  accent: "planning-health__value",
  ok: "planning-health__value planning-health__value--ok",
  warn: "planning-health__value planning-health__value--warn",
  err: "planning-health__value planning-health__value--err",
};

/**
 * One captioned meter: the label and its figure, then the bar under them.
 *
 * The bar is announced and the caption is not, which is `app/dashboard/pulse-card.tsx`'s split and
 * for its reason — announcing both would read one measurement twice. The figure's hue matches the
 * bar's, so the two are legibly one statement.
 *
 * @param props.meter The meter, from `health.ts`'s `healthMeters`.
 * @returns The row.
 */
function HealthMeterRow({ meter }: Readonly<{ meter: HealthMeter }>) {
  return (
    <div className="planning-health__meter">
      <div className="planning-health__row">
        <span className="planning-health__label">{meter.label}</span>
        <span aria-hidden className={VALUE_CLASS[meter.tone]}>
          {meter.value}
        </span>
      </div>
      <Meter
        label={meter.label}
        tone={meter.tone}
        value={meter.fill}
        valueText={meter.valueText}
      />
    </div>
  );
}
