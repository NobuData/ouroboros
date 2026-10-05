"use client";

import Link from "next/link";
import { useId, useState } from "react";

import type { InboxResolved, InboxResolvedRow } from "@/app/api/inbox";
import { Button, Tag } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import {
  DAY_NOT_READ,
  EARLIER_LABEL,
  LATER_LABEL,
  NO_EARLIER_DAY,
  PAGER_LABEL,
  POLICY_CONFIGURE,
  POLICY_NOTE_LABEL,
  POLICY_RULE_LEAD,
  READING_DAY,
  RESOLVED_LABEL,
  RESOLVED_MARK,
  RESOLVED_MARK_LABEL,
  TODAY_LABEL,
  type PolicyNote,
  channelNote,
  emptyDayLine,
  isToday,
  policyNote,
  resolvedHeading,
  summarySegments,
} from "./resolved-view";
import { Segments } from "./segments";

/** What {@link ResolvedList} takes. */
export interface ResolvedListProps {
  /** The day on screen, or `null` while it has not been read. */
  readonly resolved: InboxResolved | null;
  /** The day asked for — `null` for today. What the heading names until the day is read. */
  readonly day: string | null;
  /** Why the latest read failed, or `null`. */
  readonly failure: string | null;
  /** Whether this reader keeps the list folded. */
  readonly collapsed: boolean;
  /** Fold or open the list. */
  readonly onCollapse: (collapsed: boolean) => void;
  /** Page to another day — `null` for today. */
  readonly onDay: (day: string | null) => void;
  /** How an instant is printed — `09:12`. */
  readonly clock: (atMs: number) => string;
}

/**
 * The note beside an auto-accepted row: the rule that fired, and where it is configured.
 *
 * A tooltip cannot hold a link, so this is a small disclosure that behaves like one: it shows on
 * hover and while focus is anywhere inside it (so the link can be tabbed to), and a press pins it
 * open for a reader with neither a pointer that hovers nor a keyboard. The control is described
 * by the note, so a screen reader hears the rule on focus without opening anything.
 *
 * @param props.note What to name.
 * @returns The control and its note.
 */
function PolicyNoteTip({ note }: Readonly<{ note: PolicyNote }>) {
  const id = useId();
  const [pinned, setPinned] = useState(false);

  return (
    <span
      className={cx("inbox-resolved__policy", pinned && "inbox-resolved__policy--pinned")}
      onKeyDown={(event) => {
        if (event.key === "Escape") setPinned(false);
      }}
    >
      <button
        aria-describedby={id}
        aria-expanded={pinned}
        aria-label={POLICY_NOTE_LABEL}
        className="inbox-resolved__policy-toggle"
        onClick={() => setPinned(!pinned)}
        type="button"
      >
        <span aria-hidden>ⓘ</span>
      </button>
      <span className="inbox-resolved__policy-note" id={id} role="note">
        <span>
          {POLICY_RULE_LEAD} <span className="inbox-resolved__mono">{note.rule}</span>
          {note.version !== null && ` · org policy v${String(note.version)}`}
        </span>{" "}
        <Link className="inbox-resolved__policy-link" href={note.href}>
          {POLICY_CONFIGURE} →
        </Link>
      </span>
    </span>
  );
}

/**
 * One resolved decision: a tick, the composed line with its resolver affix, where it was answered
 * from when that was not here, and when.
 *
 * @param props.row The row, as served.
 * @param props.clock How an instant is printed.
 * @returns The row.
 */
function ResolvedRow({ row, clock }: Readonly<{ row: InboxResolvedRow; clock: (atMs: number) => string }>) {
  const byPolicy = row.resolver === "policy";
  const channel = channelNote(row);
  const note = policyNote(row);

  return (
    <li className="inbox-resolved__row">
      <span aria-hidden className="inbox-resolved__tick">
        {RESOLVED_MARK}
      </span>
      <span className="sr-only">{RESOLVED_MARK_LABEL}: </span>
      <span className="inbox-resolved__line">
        <Segments monoClassName="inbox-resolved__mono" segments={summarySegments(row.subject)} />
        {" — "}
        <span className={cx("inbox-resolved__verdict", byPolicy && "inbox-resolved__verdict--policy")}>
          {row.verdict}
        </span>
      </span>
      {note !== null && <PolicyNoteTip note={note} />}
      {channel !== null && (
        <Tag className="inbox-resolved__channel" title={channel.title}>
          {channel.label}
        </Tag>
      )}
      <time className="inbox-resolved__when" dateTime={row.resolvedAt}>
        {clock(Date.parse(row.resolvedAt))}
      </time>
    </li>
  );
}

/**
 * The **Resolved today** list (BO.3, [#468](https://github.com/NobuData/ouroboros/issues/468),
 * mockup 16): what was decided, by whom or by what, and from where.
 *
 * - **The heading folds the list**, and says the day and its count either way. Whether it is
 *   folded is the reader's own choice, kept by the page (`resolved-collapse.ts`).
 * - **A policy's answer is drawn apart** from a person's, and a rule that fired carries a note
 *   naming it with a link to where it is configured — the system decided this, and here is who
 *   told it to.
 * - **An answer from mail or GitHub says so**, quietly: that is answer-from-anywhere, evidenced.
 * - **The pager walks history**: *Earlier* jumps to the last day that had any resolution, *Later*
 *   steps a day forward, *Today* comes back.
 * - **A day with nothing resolved is one quiet line**, never an empty box.
 *
 * @param props See {@link ResolvedListProps}.
 * @returns The section.
 */
export function ResolvedList({ resolved, day, failure, collapsed, onCollapse, onDay, clock }: ResolvedListProps) {
  const body = useId();
  const today = resolved === null ? day === null : isToday(resolved);

  return (
    <section aria-label={RESOLVED_LABEL} className="inbox-resolved">
      <div className="inbox-resolved__head">
        <button
          aria-controls={body}
          aria-expanded={!collapsed}
          className="inbox-resolved__toggle"
          onClick={() => onCollapse(!collapsed)}
          type="button"
        >
          <span aria-hidden className="inbox-resolved__caret">
            {collapsed ? "▸" : "▾"}
          </span>
          {resolvedHeading(resolved, day)}
        </button>
        {!collapsed && (
          <div aria-label={PAGER_LABEL} className="inbox-resolved__pager" role="group">
            <Button
              onClick={() => onDay(resolved?.previousDay ?? null)}
              reason={resolved === null ? DAY_NOT_READ : resolved.previousDay === null ? NO_EARLIER_DAY : undefined}
              size="sm"
              tone="ghost"
            >
              ‹ {EARLIER_LABEL}
            </Button>
            {!today && (
              <>
                {resolved !== null && resolved.nextDay !== null && (
                  <Button onClick={() => onDay(resolved.nextDay)} size="sm" tone="ghost">
                    {LATER_LABEL} ›
                  </Button>
                )}
                <Button onClick={() => onDay(null)} size="sm" tone="ghost">
                  {TODAY_LABEL}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="inbox-resolved__body" hidden={collapsed} id={body}>
        {!collapsed &&
          (resolved === null ? (
            <p className="inbox-resolved__quiet">{failure ?? READING_DAY}</p>
          ) : resolved.rows.length === 0 ? (
            <p className="inbox-resolved__quiet">{emptyDayLine(resolved)}</p>
          ) : (
            <ul className="inbox-resolved__rows">
              {resolved.rows.map((row) => (
                <ResolvedRow clock={clock} key={row.itemId} row={row} />
              ))}
            </ul>
          ))}
      </div>
    </section>
  );
}
