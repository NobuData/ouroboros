/**
 * A stage that is not live, said where the reader meets it — DG.3
 * ([#1301](https://github.com/NobuData/ouroboros/issues/1301)).
 *
 * The designed unavailable state: the reason in one sentence and the link that fixes it. Not a
 * spinner, not a blank and not a dismissible banner — it stays as long as the report says the
 * stage is off, and disappears the moment it is on.
 */

import Link from "next/link";

import { EXTERNAL_LINK } from "@/app/external";
import { cx } from "@/app/ui/class-names";

import type { StageNotice } from "./capability-copy";

import "./loop.css";

/**
 * The notice.
 *
 * @param props.notice What `stageNotice` decided.
 * @param props.compact True inside a card, where it sits under a head rather than above a page.
 * @param props.className Extra classes, for placement.
 * @returns The note.
 */
export function CapabilityNotice({
  notice,
  compact = false,
  className,
}: Readonly<{ notice: StageNotice; compact?: boolean; className?: string }>) {
  const { fix } = notice;

  return (
    <p
      className={cx("loop-notice", compact && "loop-notice--compact", className)}
      data-reason={notice.reason}
      data-stage={notice.stage}
      role="note"
    >
      <span className="loop-notice__sentence">{notice.sentence}</span>{" "}
      {fix.external ? (
        <a className="loop-notice__fix" href={fix.href} {...EXTERNAL_LINK}>
          {fix.label}
        </a>
      ) : (
        <Link className="loop-notice__fix" href={fix.href}>
          {fix.label}
        </Link>
      )}
    </p>
  );
}
