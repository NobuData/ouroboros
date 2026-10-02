"use client";

import { Button, Eyebrow } from "@/app/ui";

import { useInsights } from "./insights-store";
import { RangeSegment } from "./range-segment";
import {
  INSIGHTS_ACTIONS,
  INSIGHTS_EYEBROW,
  INSIGHTS_SUBLINE,
  SOON_MARK,
  insightsHeadline,
} from "./view";

/**
 * The insights page head — mockup 15's eyebrow, composed headline, subline, range segment and
 * three actions (BK.2, [#443](https://github.com/NobuData/ouroboros/issues/443)).
 *
 * **The `h1` is live.** `27 PRs merged this week. 2 needed a human.` is two numbers from BJ.2's
 * head payload, read from the store like the cards under it; how it pluralizes and degrades is
 * `insightsHeadline`'s (`app/insights/view.ts`).
 *
 * **The actions are honest.** None of the three has anything to open yet, so each is an inert
 * button carrying a *soon* mark, and its tooltip names the issue that builds it
 * (`INSIGHTS_ACTIONS`).
 *
 * @returns The head.
 */
export function InsightsHead() {
  const { page } = useInsights();

  return (
    <div className="insights__head">
      <div className="insights__headings">
        <Eyebrow>{INSIGHTS_EYEBROW}</Eyebrow>
        <h1 className="insights__title">{insightsHeadline(page?.head ?? null)}</h1>
        <p className="insights__sub">{INSIGHTS_SUBLINE}</p>
      </div>
      <RangeSegment />
      <div className="insights__actions">
        {INSIGHTS_ACTIONS.map((action) => (
          <Button key={action.id} reason={action.soonNote} tone="ghost">
            {/* The space keeps the accessible name words apart — "Send to Slack soon". */}
            {action.label}{" "}
            <span className="insights__soon">{SOON_MARK}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
