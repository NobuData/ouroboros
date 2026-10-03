"use client";

import { Button, Eyebrow } from "@/app/ui";

import { DigestAction } from "./digest-sheet";
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
 * **The actions are honest.** *Email weekly digest* opens its subscribe sheet (BK.6,
 * [#447](https://github.com/NobuData/ouroboros/issues/447), `app/insights/digest-sheet.tsx`);
 * *✦ Build Analyzer* links to the analyzer (BW.1,
 * [#516](https://github.com/NobuData/ouroboros/issues/516)); the one with nothing to open yet is
 * an inert button carrying a *soon* mark, its tooltip naming the issue that builds it
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
        {INSIGHTS_ACTIONS.map((action) =>
          action.href !== null ? (
            <Button href={action.href} key={action.id} tone="ghost">
              {action.label}
            </Button>
          ) : action.id === "digest" ? (
            <DigestAction key={action.id} label={action.label} />
          ) : (
            <Button key={action.id} reason={action.soonNote ?? undefined} tone="ghost">
              {/* The space keeps the accessible name words apart — "Send to Slack soon". */}
              {action.label}{" "}
              <span className="insights__soon">{SOON_MARK}</span>
            </Button>
          ),
        )}
      </div>
    </div>
  );
}
