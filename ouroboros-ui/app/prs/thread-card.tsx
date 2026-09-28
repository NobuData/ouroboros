"use client";

import { useId } from "react";

import type { PrThreadAuthorKind } from "@/app/api/pull-requests";
import { Button, Card, CardHead, Chip, Tag, cx } from "@/app/ui";

import { OPENS_HOST } from "./criteria";
import {
  NO_ENTRIES,
  RESOLVED_LINE,
  RESOLVE_LABEL,
  RESOLVE_SENDING,
  SIMULATED_MARK,
  SIMULATED_NOTE,
  THREAD_ENTRIES_LABEL,
  THREAD_TITLE,
  type ThreadCardView,
  type ThreadEntryView,
  type ThreadOutcome,
} from "./thread";

/** The element id the thread sits at — what a link to the card is addressed to. */
export const THREAD_ID = "thread";

/** The class each author kind's name takes. */
const AUTHOR_CLASS: Record<PrThreadAuthorKind, string> = {
  model: "prv-entry__author--model",
  policy_bot: "prv-entry__author--policy",
  human: "prv-entry__author--human",
};

/** What one entry is told. */
interface EntryProps {
  /** The entry. */
  readonly row: ThreadEntryView;
  /** Why the entry's button waits, or `undefined` while it does not. */
  readonly waiting: string | undefined;
  /** *Reply & resolve* was pressed. */
  readonly onResolve: (entryId: string) => void;
}

/**
 * One entry: who said it and when, what was said, and how it was answered.
 *
 * The author's kind is said in words as well as in the name's hue, and the watermark is a word,
 * so neither is carried by colour alone. A blocking entry takes the accent rule beside its body.
 *
 * @param props See {@link EntryProps}.
 * @returns The entry.
 */
function Entry({ row, waiting, onResolve }: EntryProps) {
  return (
    <li className={cx("prv-entry", row.blocking && "prv-entry--blocking")}>
      <div className="prv-entry__head">
        <span className={cx("prv-entry__author", AUTHOR_CLASS[row.kind])}>
          <span className="sr-only">{`${row.kindLabel}: `}</span>
          {row.author}
        </span>
        <Tag>{row.tag}</Tag>
        {row.pill !== null && <Chip tone="err">{row.pill.label}</Chip>}
        {row.simulated && (
          <Chip className="prv-entry__watermark" title={SIMULATED_NOTE} tone="model">
            {SIMULATED_MARK}
          </Chip>
        )}
        {row.time !== null && (
          <time className="prv-entry__time" dateTime={row.at}>
            {row.time}
          </time>
        )}
      </div>

      <p className="prv-entry__body">{row.body}</p>

      {row.reply !== null && <p className="prv-entry__reply">{row.reply}</p>}
      {row.resolved && <p className="prv-entry__resolved">{RESOLVED_LINE}</p>}

      {row.resolve && (
        <div className="prv-entry__actions">
          <Button
            aria-haspopup="dialog"
            onClick={() => onResolve(row.id)}
            reason={waiting}
            size="sm"
            tone="ghost"
          >
            {RESOLVE_LABEL}
          </Button>
        </div>
      )}
    </li>
  );
}

/** What the card is told. */
export interface ThreadCardProps {
  /** The card, from `threadCard`. */
  readonly view: ThreadCardView;
  /** *Reply & resolve* was pressed on an entry — the screen opens the dialog. */
  readonly onResolve: (entryId: string) => void;
  /** Whether a resolution is in flight — the entries' buttons wait. */
  readonly sending: boolean;
  /** What became of the last resolution, or `null`. */
  readonly outcome: ThreadOutcome | null;
}

/**
 * The Review thread card ([#368](https://github.com/NobuData/ouroboros/issues/368)) — mockup
 * 12's thread: three author kinds, the blocking → resolved arc, and provenance that never
 * invents a reviewer.
 *
 * Every row is `thread.ts`'s; this file only draws. An entry that does not say who wrote it is
 * not among the rows — the card says how many were withheld instead.
 *
 * A long thread scrolls inside the entries' own wrapper, which takes focus so it can be scrolled
 * from the keyboard; the pane never scrolls for it.
 *
 * @param props See {@link ThreadCardProps}.
 * @returns The card.
 */
export function ThreadCard({ view, onResolve, sending, outcome }: ThreadCardProps) {
  const titleId = useId();
  const waiting = sending ? RESOLVE_SENDING : undefined;

  return (
    <section aria-labelledby={titleId} className="prv-thread" id={THREAD_ID}>
      <Card>
        <CardHead
          title={THREAD_TITLE}
          titleId={titleId}
          trailing={<Tag>{view.header}</Tag>}
        />

        {view.empty && <p className="prv-thread__note">{NO_ENTRIES}</p>}

        {view.rows.length > 0 && (
          // Focusable so a keyboard reader can scroll it: it is a scrolling region with a name.
          <div
            aria-label={THREAD_ENTRIES_LABEL}
            className="prv-thread__scroll"
            role="group"
            tabIndex={0}
          >
            <ul className="prv-thread__rows">
              {view.rows.map((row) => (
                <Entry key={row.id} onResolve={onResolve} row={row} waiting={waiting} />
              ))}
            </ul>
          </div>
        )}

        {view.withheld !== null && (
          <p className="prv-thread__withheld" role="note">
            {view.withheld}
          </p>
        )}

        {outcome !== null && (
          <p
            className={cx("prv-thread__outcome", outcome.failed && "prv-thread__outcome--failed")}
            role="status"
          >
            {outcome.text}
            {outcome.link !== null && (
              <>
                {" · "}
                <a
                  className="prv-criteria__link"
                  href={outcome.link.href}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {outcome.link.label}
                  <span aria-label={OPENS_HOST} role="img">
                    {" ↗"}
                  </span>
                </a>
              </>
            )}
          </p>
        )}
      </Card>
    </section>
  );
}
