"use client";

import { Fragment, useState } from "react";

import type { Reading } from "@/app/api/reading";
import type { RegressionWatchCard, RegressionWatchItem } from "@/app/api/research";
import { Card, CardHead, Chip, type ChipTone, EmptyState, Tag, cx } from "@/app/ui";

import {
  CAPTURE_READ_ONLY,
  NO_BASELINES_NOTE,
  NO_BASELINES_TITLE,
  NO_DRIFT,
  WATCH_CAPTION,
  WATCH_TITLE,
  WATCH_UNREADABLE,
  type WatchFragment,
  isOpen,
  needsRepro,
  watchFragments,
  watchRows,
  watchTitle,
} from "./side";
import { regionTitleId } from "./view";
import { CaptureBaseline, DismissItem } from "./watch-dialogs";

/**
 * The regression watch card (CN.3, [#629](https://github.com/NobuData/ouroboros/issues/629)) —
 * mockup 22's side column, under the tools.
 *
 * A row is a drift against a release's baseline: its severity dot, the metric with its signed
 * drift, and a sub-line composed across four planes — the bisect's commit, the fix's run, its
 * ticket and the pull request that merged it — **each fragment a link to what it names**, so the
 * row is a way in rather than a status string. The pill and the words are the service's.
 *
 * An item the watch could not bisect is drawn as the row it is, with the service's explanation
 * (`needs repro: …`), never hidden. A dismissed item leaves the card at once; the next read
 * agrees. A workspace with no baseline is offered one to capture.
 */

/** The class for each severity dot — literals, so the style suite can see every one. */
const SEVERITY_CLASS: Record<RegressionWatchItem["severity"], string> = {
  err: "research__dot research__dot--err",
  warn: "research__dot research__dot--warn",
  ok: "research__dot research__dot--ok",
};

/** What each severity says to a reader who cannot see its colour. */
const SEVERITY_LABEL: Record<RegressionWatchItem["severity"], string> = {
  err: "Past the error threshold",
  warn: "Past the warning threshold",
  ok: "Within thresholds",
};

/** The chip tone of each pill tone the service names. */
const PILL_TONE: Record<RegressionWatchItem["pill"]["tone"], ChipTone> = {
  run: "accent",
  warn: "warn",
  ok: "ok",
  idle: "neutral",
};

/** What the card takes. */
export interface WatchCardProps {
  /** The watch, or why it could not be read. */
  readonly reading: Reading<RegressionWatchCard>;
  /** Whether the reader may dismiss an item and capture a baseline. */
  readonly mayAdminister: boolean;
  /** Called once an item is dismissed or a baseline captured, so the page re-reads. */
  readonly onChanged: () => void;
}

/**
 * The card.
 *
 * @param props See {@link WatchCardProps}.
 * @returns The watch items, or what to do while there are none.
 */
export function WatchCard({ reading, mayAdminister, onChanged }: WatchCardProps) {
  const titleId = regionTitleId("watch");
  // Rows dismissed here, until the next read stops returning them as open.
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const rows = reading.ok ? watchRows(reading.value).filter((item) => !dismissed.includes(item.id)) : [];

  return (
    <Card aria-labelledby={titleId} as="section">
      <CardHead
        title={WATCH_TITLE}
        titleId={titleId}
        trailing={reading.ok && reading.value.headline !== null ? <Tag>{reading.value.headline}</Tag> : undefined}
      />

      {!reading.ok && <EmptyState note={reading.reason} title={WATCH_UNREADABLE} variant="flush" />}

      {reading.ok && reading.value.baselines === 0 && (
        <EmptyState note={NO_BASELINES_NOTE} title={NO_BASELINES_TITLE} variant="flush">
          <CaptureBaseline
            onCaptured={onChanged}
            reason={mayAdminister ? undefined : CAPTURE_READ_ONLY}
          />
          {!mayAdminister && <p className="research__side-sub">{CAPTURE_READ_ONLY}</p>}
        </EmptyState>
      )}

      {reading.ok && reading.value.baselines > 0 && rows.length === 0 && (
        <EmptyState note={NO_DRIFT} variant="flush" />
      )}

      {rows.length > 0 && (
        <ul className="research__side-list">
          {rows.map((item) => (
            <li className={cx("research__side-row", needsRepro(item) && "research__side-row--repro")} key={item.id}>
              <span
                aria-label={SEVERITY_LABEL[item.severity]}
                className={SEVERITY_CLASS[item.severity]}
                role="img"
              />
              <span className="research__side-text">
                <span className="research__side-name">{watchTitle(item)}</span>
                <span className="research__side-sub">
                  <SubLine fragments={watchFragments(item)} />
                </span>
              </span>
              <Chip dot={item.pill.tone === "run" ? "pulse" : undefined} tone={PILL_TONE[item.pill.tone]}>
                {item.pill.label}
              </Chip>
              {isOpen(item) && (
                <DismissItem
                  item={item}
                  mayAdminister={mayAdminister}
                  onDismissed={(id) => {
                    setDismissed((held) => [...held, id]);
                    onChanged();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {reading.ok && <p className="research__watch-caption">{WATCH_CAPTION}</p>}
    </Card>
  );
}

/**
 * A row's sub-line: the parts joined by ` · `, each fragment drawn as words or as the link it is.
 *
 * @param props.fragments The parts, each a list of fragments.
 * @returns The line.
 */
function SubLine({ fragments }: Readonly<{ fragments: readonly (readonly WatchFragment[])[] }>) {
  return fragments.map((part, index) => (
    <Fragment key={part.map((fragment) => fragment.text).join("")}>
      {index > 0 && " · "}
      {part.map((fragment) =>
        fragment.href === null ? (
          <span className={fragment.mono ? "research__side-ref" : undefined} key={fragment.text}>
            {fragment.text}
          </span>
        ) : (
          <a
            className="research__side-link"
            href={fragment.href}
            key={fragment.text}
            {...(fragment.external ? { rel: "noreferrer", target: "_blank" } : {})}
          >
            {fragment.text}
          </a>
        ),
      )}
    </Fragment>
  ));
}
