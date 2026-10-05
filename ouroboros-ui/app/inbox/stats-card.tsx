"use client";

import type { InboxStats } from "@/app/api/inbox";
import { StatCard } from "@/app/ui";

import { InfoTip } from "./info-tip";
import {
  MEDIAN_LEAD,
  STATS_JOIN,
  STATS_METHOD_LABEL,
  STATS_NONE,
  STATS_TITLE,
  UNREADABLE_STATS,
  WAIT_LEAD,
  decisionsSuffix,
  statsMethod,
} from "./stats-view";

/**
 * **This week** (BO.5, [#470](https://github.com/NobuData/ouroboros/issues/470), mockup 16) — the
 * page's closing argument: how many decisions were answered, the median answer time, and the
 * longest any loop waited, all three from BN.4's weekly figures (#464).
 *
 * **It prints and computes nothing.** Each figure is the service's own `display` string, so the
 * card is the service's arithmetic verbatim — `11 decisions`, `41s`, `6m` from the seeds, and the
 * service's em dashes on a workspace that answered nothing this week (`— decisions`), never a
 * zero. The two durations sit in mono, as the mockup sets them, and the ⓘ beside the caption
 * says how each is measured and that they are **different measures**: one is how long a person
 * took, the other how long a run sat blocked.
 *
 * A failed read is a designed state rather than a gap in the column: the caption stays, the
 * figure is an em dash, and the line under it is why, in the stat tile's `failed` tone. A later
 * read that fails keeps the figures already on screen — the page's own banner is the queue's.
 *
 * @param props.stats The week, as served; `null` while it could not be read.
 * @param props.failure Why it could not be read, or `null`.
 * @returns The card.
 */
export function StatsCard({ stats, failure }: Readonly<{ stats: InboxStats | null; failure: string | null }>) {
  // The ⓘ ends the caption and its note opens under it, across the card's width — four
  // sentences beside a two-word caption would not fit a column a third of the page wide.
  const caption =
    stats === null ? (
      <span className="inbox-stat__caption">{STATS_TITLE}</span>
    ) : (
      <InfoTip
        frame={(control) => (
          <span className="inbox-stat__caption">
            {STATS_TITLE}
            {control}
          </span>
        )}
        label={STATS_METHOD_LABEL}
      >
        {statsMethod(stats.week).map((sentence) => (
          <span className="inbox-stat__method" key={sentence}>
            {sentence}
          </span>
        ))}
      </InfoTip>
    );

  if (stats === null) {
    return (
      <StatCard
        caption={caption}
        className="inbox-stat"
        delta={failure ?? UNREADABLE_STATS}
        label={STATS_TITLE}
        tone="failed"
        value={STATS_NONE}
      />
    );
  }

  return (
    <StatCard
      caption={caption}
      className="inbox-stat"
      delta={
        <>
          {MEDIAN_LEAD} <span className="inbox-stat__figure">{stats.display.medianAnswer}</span>
          {STATS_JOIN}
          {WAIT_LEAD} <span className="inbox-stat__figure">{stats.display.maxLoopWait}</span>
        </>
      }
      label={STATS_TITLE}
      value={stats.display.decisions}
      valueSuffix={decisionsSuffix(stats)}
    />
  );
}
