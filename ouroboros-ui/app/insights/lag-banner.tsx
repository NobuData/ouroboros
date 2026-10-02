"use client";

import { useInsights } from "./insights-store";
import { lagBanner } from "./states-view";

/**
 * The rollup-lag banner (BK.6, [#447](https://github.com/NobuData/ouroboros/issues/447)) — the
 * DASH-I.7 ([#86](https://github.com/NobuData/ouroboros/issues/86)) stale-data pattern, for the
 * rollups rather than the read.
 *
 * The page's figures come from daily rollups that fill hourly. When they are behind, the page
 * could be read perfectly and still be old; this says through which day the figures run and when
 * they were last filled — the payload's real `freshness`, never an estimate — so old numbers are
 * not presented as current. It is a status, not an alert: there is nothing for the reader to do
 * but read the figures knowing their age, and the poll picks up the next fill on its own.
 *
 * @returns The banner, or nothing while the rollups are current, before a read, and in a cold
 *   workspace (whose cards say *not enough data* themselves).
 */
export function LagBanner() {
  const { page, dataAt } = useInsights();

  if (page === null || dataAt === null) return null;

  const view = lagBanner(page, new Date(dataAt));

  if (view === null) return null;

  return (
    <div className="insights-lag" role="status">
      <strong className="insights-lag__headline">{view.headline}</strong>{" "}
      {view.detail}
    </div>
  );
}
