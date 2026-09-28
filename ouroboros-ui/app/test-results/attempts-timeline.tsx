"use client";

import { useEffect, useId, useRef } from "react";

import { Card, CardHead, Tag } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import {
  type AttemptCardView,
  type AttemptTone,
  type FutureCardView,
  NEXT_LABEL,
  TIMELINE_LIST_LABEL,
  TIMELINE_TITLE,
  type TimelineView,
  scrollToReveal,
} from "./timeline";

/** The modifier each hue adds to a card. */
const TONE_CLASS: Readonly<Record<AttemptTone, string>> = {
  err: "tests-timeline__card--err",
  warn: "tests-timeline__card--warn",
  ok: "tests-timeline__card--ok",
  live: "tests-timeline__card--live",
  neutral: "tests-timeline__card--neutral",
};

/**
 * One attempt's card.
 *
 * The button is the card's label and result, and its hit area is stretched over the whole card
 * (`tests.css`), so a click anywhere selects. The sha's link is a sibling drawn above that area
 * rather than a child — a link inside a button is not reachable by keyboard. The space between
 * the two lines is for the button's accessible name (`Build 2 61/63 · 2 failed`); the column
 * layout draws none of it.
 *
 * @param props.card The card, from `timelineView`.
 * @param props.onSelect Read this attempt.
 * @returns The card, as a list item.
 */
function AttemptCard({
  card,
  onSelect,
}: Readonly<{ card: AttemptCardView; onSelect: (attemptSeq: number) => void }>) {
  return (
    <li
      className={cx("tests-timeline__card", TONE_CLASS[card.tone])}
      data-selected={card.selected ? "true" : undefined}
    >
      <button
        aria-pressed={card.selected}
        className="tests-timeline__select"
        onClick={() => onSelect(card.attemptSeq)}
        type="button"
      >
        <span className="tests-timeline__label">{card.label}</span>{" "}
        <span className="tests-timeline__result">
          {card.tone === "live" && <span aria-hidden className="tests-timeline__pulse" />}
          {card.result}
        </span>
      </button>
      <span className="tests-timeline__meta">
        {card.time !== null && <time dateTime={card.startedAt}>{card.time}</time>}
        {card.time !== null && card.commit !== null && " · "}
        {card.commit !== null &&
          (card.commit.href === null ? (
            <span>{card.commit.shortSha}</span>
          ) : (
            <a
              className="tests-timeline__sha"
              href={card.commit.href}
              rel="noopener noreferrer"
              target="_blank"
            >
              {card.commit.shortSha}
            </a>
          ))}
      </span>
    </li>
  );
}

/**
 * The dashed *Next* card — what has not happened yet, so it selects nothing.
 *
 * @param props.card The card, from `futureCard`.
 * @returns The card, as a list item.
 */
function FutureCard({ card }: Readonly<{ card: FutureCardView }>) {
  return (
    <li className="tests-timeline__card tests-timeline__card--future" data-variant={card.variant}>
      <span className="tests-timeline__label">{NEXT_LABEL}</span>
      <span className="tests-timeline__result">{card.result}</span>
      <span className="tests-timeline__meta">{card.meta}</span>
    </li>
  );
}

/**
 * The build attempts timeline ([#336](https://github.com/NobuData/ouroboros/issues/336)) —
 * mockup 11's strip: one card per attempt, coloured by how it went, the running build pulsing,
 * and the dashed *Next* card in its honest or activated variant (T8).
 *
 * **It is the page's attempt selector.** Selecting a card calls `onSelect`, and the screen — which
 * owns the attempt and its `?attempt=` — redraws every region from the one it answers.
 *
 * **It scrolls inside its own wrapper**, so a long loop never widens the content pane, and the
 * selected card is brought into view when the strip is drawn and when the selection moves. Only
 * the strip is scrolled — never the pane.
 *
 * Every value is `timeline.ts`'s; this file only draws.
 *
 * @param props.view The timeline, from `timelineView`.
 * @param props.onSelect Read another attempt.
 * @returns The card.
 */
export function AttemptsTimeline({
  view,
  onSelect,
}: Readonly<{ view: TimelineView; onSelect: (attemptSeq: number) => void }>) {
  const titleId = useId();
  const strip = useRef<HTMLDivElement>(null);
  const selectedId = view.attempts.find((card) => card.selected)?.id ?? null;

  useEffect(() => {
    const wrapper = strip.current;
    const card = wrapper?.querySelector<HTMLElement>('[data-selected="true"]');
    if (wrapper === null || card === null || card === undefined) return;

    const left = scrollToReveal(
      { start: card.offsetLeft, size: card.offsetWidth },
      wrapper.scrollLeft,
      wrapper.clientWidth,
    );
    if (left !== null) wrapper.scrollLeft = left;
  }, [selectedId]);

  return (
    <Card aria-labelledby={titleId} as="section" className="tests-timeline">
      <CardHead
        beside={view.branch !== null && <Tag>{view.branch}</Tag>}
        title={TIMELINE_TITLE}
        titleId={titleId}
        trailing={<span className="tests-timeline__loop">{view.loop}</span>}
      />
      <div className="tests-timeline__scroll" ref={strip}>
        <ol aria-label={TIMELINE_LIST_LABEL} className="tests-timeline__list">
          {view.attempts.map((card) => (
            <AttemptCard card={card} key={card.id} onSelect={onSelect} />
          ))}
          <FutureCard card={view.next} />
        </ol>
      </div>
    </Card>
  );
}
