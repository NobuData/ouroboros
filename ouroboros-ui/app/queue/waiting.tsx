import Link from "next/link";

import { EXTERNAL_LINK } from "@/app/external";
import { Chip } from "@/app/ui";
import { cx } from "@/app/ui/class-names";

import { type QueueWaiting, waitingCopy } from "./waiting-copy";

import "./queue.css";

/**
 * Why a queued issue is not starting a live run, as a chip — DI.4
 * ([#1312](https://github.com/NobuData/ouroboros/issues/1312)).
 *
 * The label is a few words; the sentence travels as the tooltip **and** as visually hidden
 * text, so a screen reader hears the reason rather than a terse label it cannot hover.
 *
 * @param props.waiting Why the item waits.
 * @param props.className Classes from the page — placement only.
 * @returns The chip.
 */
export function WaitingChip({
  waiting,
  className,
}: Readonly<{ waiting: QueueWaiting; className?: string }>) {
  const copy = waitingCopy(waiting);

  return (
    <span className={cx("queue-waiting-chip", className)} data-reason={waiting.reason}>
      <Chip tone="warn" title={copy.sentence}>
        {copy.label}
      </Chip>
      <span className="sr-only">{` — ${copy.sentence}`}</span>
    </span>
  );
}

/**
 * Why a queued issue — or every one in a list — is not starting, as a line with where to fix
 * it.
 *
 * @param props.waiting Why the item, or the list, waits.
 * @param props.compact Inside a card, under its head: tighter, and no page margin.
 * @returns The notice.
 */
export function WaitingNotice({
  waiting,
  compact = false,
}: Readonly<{ waiting: QueueWaiting; compact?: boolean }>) {
  const { sentence, fix } = waitingCopy(waiting);

  return (
    <p
      className={cx("queue-waiting", compact && "queue-waiting--compact")}
      data-reason={waiting.reason}
      data-scope={waiting.scope}
      role="note"
    >
      <span className="queue-waiting__sentence">{sentence}</span>
      {fix !== null && " "}
      {fix !== null &&
        (fix.external ? (
          <a className="queue-waiting__fix" href={fix.href} {...EXTERNAL_LINK}>
            {fix.label}
          </a>
        ) : (
          <Link className="queue-waiting__fix" href={fix.href}>
            {fix.label}
          </Link>
        ))}
    </p>
  );
}
