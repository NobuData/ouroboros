import { StatusPill } from "./status-pill";
import { type SystemRow, overallState } from "./view";

/**
 * The system card: what `ouroboros-rest` says about itself and its two dependencies.
 *
 * This is the card the acceptance criterion is written against — *stop the engine and the
 * pill degrades* — and it is the only surface in the product that reports on the database
 * at all. Every state it draws is read, never assumed: the rows come from
 * `app/dashboard/view.ts`, which composes them from the readiness probe and the engine
 * status call, and a dependency nobody could ask about is drawn *unknown* rather than
 * quietly green.
 *
 * The rows are a description list because that is what they are — a term and its value —
 * and it is what makes each pill announced with the dependency it belongs to.
 *
 * @param props.rows The dependencies to report on, in order.
 * @returns The card.
 */
export function SystemCard({ rows }: Readonly<{ rows: readonly SystemRow[] }>) {
  const overall = overallState(rows);

  return (
    <section className="dash-card dash-col--4" aria-labelledby="dash-system-title">
      <header className="dash-card__head">
        <h2 className="dash-card__title" id="dash-system-title">
          System
        </h2>
        <span className="dash-card__spacer" />
        <StatusPill state={overall} />
      </header>

      <dl className="dash-system">
        {rows.map((row) => (
          <div className="dash-system__row" key={row.id}>
            <dt className="dash-system__label">{row.label}</dt>
            <dd className="dash-system__value">
              <StatusPill state={row.state}>{row.state}</StatusPill>
            </dd>
            {/*
              The note repeats inside the same row rather than becoming a second `dd` of its
              own, so the term it belongs to is unambiguous — a `dl` with two values per term
              reads as two answers to one question.
            */}
            <dd className="dash-system__note">{row.note}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
