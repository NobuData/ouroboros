"use client";

import Link from "next/link";
import { Fragment, useId } from "react";

import type {
  OnboardingDefaultRow,
  OnboardingDefaults,
  OnboardingReassureClaim,
  OnboardingTimeline,
} from "@/app/api/onboarding";
import type { Reading } from "@/app/api/reading";
import { useKeyedPoll } from "@/app/issues/use-keyed-poll";
import { Card, CardHead, Tag } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import { type DefaultsPollOptions, createDefaultsPoll, defaultsEndpoint } from "./defaults-poll";
import {
  DEFAULTS_ROWS_LABEL,
  DEFAULTS_TITLE,
  DEPLOYMENT_NOTES,
  LINK_JOINERS,
  LOADING_DEFAULTS,
  type LiveTimelineRow,
  PROJECTED_LABEL,
  PROJECTED_NOTE,
  REASSURE_GLYPH,
  REASSURE_LABEL,
  ROW_GLYPHS,
  ROW_MARK_NAMES,
  TIMELINE_ROWS_LABEL,
  TIMELINE_TITLE,
  type TimelineTone,
  ZERO_CONFIG_TAG,
  basisLine,
  claimNote,
  rowAffix,
  timelineRows,
} from "./defaults-view";

/** What {@link DefaultsColumn} takes. */
export interface DefaultsColumnProps {
  /** The repository. */
  readonly repo: string;
  /** The first paint's read of the column. */
  readonly initial: Reading<OnboardingDefaults> | null;
  /**
   * The **live-upgrade slot** (BD.1, #396): rows the first loop has actually reached, keyed to
   * the projection's. Each one prints its measured time and loses the `projected` label. Nothing
   * fills it in the MVP.
   */
  readonly live?: readonly LiveTimelineRow[] | null;
  /** Test seams for the column's poll. */
  readonly poll?: DefaultsPollOptions;
  /** The clock the estimator's last run is aged against — a test seam. */
  readonly now?: () => number;
}

/** The class each row status adds — a literal map, so the style suite sees every class. */
const ROW_CLASS: Readonly<Record<OnboardingDefaultRow["status"], string>> = {
  ready: "defaults__row--ready",
  optional: "defaults__row--optional",
};

/** The class each timeline treatment adds — the mockup's `.you` and `.end`. */
const TONE_CLASS: Readonly<Record<TimelineTone, string>> = {
  loop: "timeline__row--loop",
  you: "timeline__row--you",
  end: "timeline__row--end",
};

/** How many bones each skeleton draws — the mockup's row counts. */
const DEFAULTS_BONES = 4;
const TIMELINE_BONES = 5;

/**
 * A card body while its first read is in flight: dim bars where the rows will be, and one status
 * line for the screen reader.
 *
 * @param props.rows How many bars.
 * @param props.className The list's class — the card's own row list, so the bars sit where the rows will.
 * @returns The skeleton.
 */
function Skeleton({ rows, className }: Readonly<{ rows: number; className: string }>) {
  return (
    <ul aria-busy className={cx(className, "defaults-skeleton")}>
      <li className="sr-only" role="status">
        {LOADING_DEFAULTS}
      </li>
      {Array.from({ length: rows }, (_, index) => (
        <li aria-hidden className="defaults-skeleton__row" key={index}>
          <span className="defaults-skeleton__bone" />
        </li>
      ))}
    </ul>
  );
}

/**
 * The *Smart Defaults* card: the rows the service selected for this deployment — mark, sentence,
 * link to the subsystem — the estimator row carrying the real nightly job's last run and the
 * Slack row dim, saying what it waits for.
 *
 * @param props.defaults The column as read, or null before any read.
 * @param props.failure Why it could not be read, when that is why there is nothing to draw.
 * @param props.now The clock.
 * @returns The card.
 */
export function DefaultsCard({
  defaults,
  failure,
  now,
}: Readonly<{ defaults: OnboardingDefaults | null; failure: string | null; now: () => number }>) {
  const titleId = useId();

  return (
    <Card aria-labelledby={titleId} as="section" className="defaults-card">
      <CardHead
        beside={<Tag title={defaults === null ? undefined : DEPLOYMENT_NOTES[defaults.deployment]}>{ZERO_CONFIG_TAG}</Tag>}
        title={DEFAULTS_TITLE}
        titleId={titleId}
      />
      {defaults !== null ? (
        <ul aria-label={DEFAULTS_ROWS_LABEL} className="defaults">
          {defaults.rows.map((row) => {
            const affix = rowAffix(row, new Date(now()));

            return (
              <li className={cx("defaults__row", ROW_CLASS[row.status])} data-key={row.key} key={row.key}>
                <span aria-hidden className="defaults__mark">
                  {ROW_GLYPHS[row.status]}
                </span>
                <span className="defaults__text">
                  <span className="sr-only">{ROW_MARK_NAMES[row.status]}: </span>
                  {row.text}
                  {row.link !== null && (
                    <>
                      {LINK_JOINERS[row.variant]}
                      <Link className="defaults__link" href={row.link.path}>
                        {row.link.label}
                      </Link>
                    </>
                  )}
                  {affix !== null && <span className="defaults__affix">{affix}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      ) : failure !== null ? (
        <p className="defaults__failure" role="alert">
          {failure}
        </p>
      ) : (
        <Skeleton className="defaults" rows={DEFAULTS_BONES} />
      )}
    </Card>
  );
}

/**
 * The *What Happens Next* card: the mono timeline, every projected row wearing its label, the
 * *you review* row in the warn treatment and the *merge* row in the end's — its words the
 * service's, so under dry-run it reads as the flip-required state rather than an inevitability.
 * **No average-time footer**: the line under the rows says where the one number comes from.
 *
 * @param props.timeline The projection, or null before any read.
 * @param props.failure Why the column could not be read, when that is why there is nothing to draw.
 * @param props.live The live-upgrade slot's measured rows, when BD.1 has any.
 * @returns The card.
 */
export function TimelineCard({
  timeline,
  failure,
  live,
}: Readonly<{ timeline: OnboardingTimeline | null; failure: string | null; live?: readonly LiveTimelineRow[] | null }>) {
  const titleId = useId();
  const rows = timeline === null ? [] : timelineRows(timeline, live ?? []);
  const basis = timeline === null ? null : basisLine(timeline, rows);

  return (
    <Card aria-labelledby={titleId} as="section" className="timeline-card">
      <CardHead
        beside={
          rows.some((row) => row.projected) ? (
            <Tag className="timeline__tag" title={PROJECTED_NOTE}>
              {PROJECTED_LABEL}
            </Tag>
          ) : undefined
        }
        title={TIMELINE_TITLE}
        titleId={titleId}
      />
      {timeline !== null ? (
        <>
          <ol aria-label={TIMELINE_ROWS_LABEL} className="timeline">
            {rows.map((row) => (
              <li className={cx("timeline__row", TONE_CLASS[row.tone])} data-key={row.key} key={row.key}>
                <span className="timeline__time">{row.time ?? ""}</span>
                <span aria-hidden className="timeline__node">
                  {row.glyph}
                </span>
                <span className="timeline__what">{row.text}</span>
                {row.projected && (
                  <Tag className="timeline__tag" title={PROJECTED_NOTE}>
                    {PROJECTED_LABEL}
                  </Tag>
                )}
              </li>
            ))}
          </ol>
          {basis !== null && <p className="timeline__basis">{basis}</p>}
        </>
      ) : failure !== null ? (
        <p className="timeline__failure">{failure}</p>
      ) : (
        <Skeleton className="timeline" rows={TIMELINE_BONES} />
      )}
    </Card>
  );
}

/**
 * The reassure strip — the page's closing argument: each claim the service found a mechanism for,
 * linked to the surface that proves it, with the mechanism named for the tooltip and the screen
 * reader. Nothing is drawn when no claim holds.
 *
 * @param props.claims The claims, in strip order.
 * @returns The strip, or null.
 */
export function ReassureStrip({ claims }: Readonly<{ claims: readonly OnboardingReassureClaim[] }>) {
  if (claims.length === 0) return null;

  return (
    <Card aria-label={REASSURE_LABEL} as="section" className="reassure" tone="inset">
      <span aria-hidden className="reassure__glyph">
        {REASSURE_GLYPH}
      </span>
      <p className="reassure__line">
        {claims.map((claim, index) => {
          const note = claimNote(claim);

          return (
            <Fragment key={claim.key}>
              {index > 0 && " "}
              {claim.mechanism.path !== null ? (
                <Link className="reassure__claim" data-key={claim.key} href={claim.mechanism.path} title={note}>
                  {claim.text}
                </Link>
              ) : (
                <span className="reassure__claim" data-key={claim.key} title={note}>
                  {claim.text}
                </span>
              )}
              <span className="sr-only"> ({note})</span>
            </Fragment>
          );
        })}
      </p>
    </Card>
  );
}

/**
 * The wizard's right column (BC.5, [#394](https://github.com/NobuData/ouroboros/issues/394),
 * mockup 13) — the defaults card, the timeline card and the reassure strip, drawn from one read
 * and kept true by one poll.
 *
 * **Live.** The column is re-read on the I.8 poll: the dry-run policy flipped in Settings changes
 * the merge row's words and drops or restores the draft-only claim; the nightly estimator's run
 * lands on its row; a pick stored in the first-issue card names itself in the timeline.
 *
 * @param props See {@link DefaultsColumnProps}.
 * @returns The three cards.
 */
export function DefaultsColumn({ repo, initial, live, poll, now = Date.now }: DefaultsColumnProps) {
  const { snapshot } = useKeyedPoll(defaultsEndpoint(repo), (endpoint) => createDefaultsPoll(endpoint, poll));

  const polled = snapshot.data ?? (initial?.ok === true ? initial.value : null);
  const failure = polled === null ? (snapshot.error ?? (initial?.ok === false ? initial.reason : null)) : null;

  return (
    <>
      <DefaultsCard defaults={polled} failure={failure} now={now} />
      <TimelineCard failure={failure} live={live} timeline={polled?.timeline ?? null} />
      <ReassureStrip claims={polled?.reassure.claims ?? []} />
    </>
  );
}
