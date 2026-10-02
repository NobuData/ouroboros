import Link from "next/link";
import type { ReactNode } from "react";

import { SEEDED_NAV_ENTRIES } from "@/app/shell/nav-modules";
import { navStatus, type NavEntry } from "@/app/shell/nav";
import { StatCard } from "@/app/ui";

import { STRIP_LABEL, type StatView, type StripView, watchingLabel } from "./view";

/** The insights module's sidebar entry — where the flaky card's link goes (mockup 15). */
const INSIGHTS: NavEntry | undefined = SEEDED_NAV_ENTRIES.find((entry) => entry.id === "insights");

/**
 * The flaky card's onward link — to insights, **honestly**.
 *
 * Insights is mockup 15, live since #443. While an entry is `soon`, the words are drawn as the
 * sidebar draws that entry — said, carrying the note as their tooltip, and not a link to a page
 * that does not exist. The entry went live and this became a link to it with no edit here,
 * because it reads the entry rather than a copy of it.
 *
 * @param props.watching How many flaky cases the quarantine is watching — zero included, which is
 *   a count the reader is owed as much as one.
 * @param props.entry The insights entry. Replaced in tests.
 * @returns The link, or the words and the reason they are not one yet.
 */
export function InsightsLink({
  watching,
  entry = INSIGHTS,
}: Readonly<{ watching: number; entry?: NavEntry }>) {
  const label = watchingLabel(watching);

  if (entry === undefined || navStatus(entry) === "soon") {
    return (
      <span className="tests-strip__soon" title={entry?.soonNote}>
        {label}
      </span>
    );
  }

  return (
    <Link className="tests-strip__link" href={entry.route}>
      {label} ↗
    </Link>
  );
}

/**
 * One card of the strip.
 *
 * @param props.stat The card, from `stripView`.
 * @param props.wide Whether it takes the mockup's `c-4` rather than `c-2`.
 * @param props.children What follows the line — the flaky card's link.
 * @returns The card.
 */
function Stat({
  stat,
  wide = false,
  children,
}: Readonly<{ stat: StatView; wide?: boolean; children?: ReactNode }>) {
  return (
    <StatCard
      className={wide ? "tests-strip__stat tests-strip__stat--wide" : "tests-strip__stat"}
      delta={
        stat.delta === null && children === undefined ? null : (
          <>
            {stat.delta}
            {children}
          </>
        )
      }
      label={stat.label}
      tone={stat.tone}
      value={stat.value}
      valueTone={stat.valueTone}
    />
  );
}

/**
 * The summary strip ([#335](https://github.com/NobuData/ouroboros/issues/335)) — mockup 11's five
 * stat cards over the shared `StatCard`: total with its suite count, passed with the delta the
 * payload states, failed with its headline case, flaky with the quarantine's `watching` count, and
 * wall time with its sim/physical split.
 *
 * Every figure and line is `stripView`'s, from one attempt's strip; this file only draws.
 *
 * @param props.view The strip, from `stripView`.
 * @param props.insights The insights entry the flaky link reads. Replaced in tests.
 * @returns The strip.
 */
export function SummaryStrip({
  view,
  insights,
}: Readonly<{ view: StripView; insights?: NavEntry }>) {
  return (
    <section aria-label={STRIP_LABEL} className="tests-strip">
      <Stat stat={view.total} />
      <Stat stat={view.passed} />
      <Stat stat={view.failed} />
      <Stat stat={view.flaky}>
        {view.flaky.watching !== null && (
          <>
            {" · "}
            <InsightsLink entry={insights ?? INSIGHTS} watching={view.flaky.watching} />
          </>
        )}
      </Stat>
      <Stat stat={view.wall} wide />
    </section>
  );
}
