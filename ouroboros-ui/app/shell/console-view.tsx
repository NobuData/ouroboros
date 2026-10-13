"use client";

import Link from "next/link";

import type { ConsoleCompletion, ConsoleLink } from "@/app/api/console";
import { cx } from "@/app/ui/class-names";

import {
  ASYNC_NOTE,
  CONFIRM_NOTE,
  CONSOLE_MARKS,
  type ConsoleEntry,
  type ConsoleReplyView,
  type ConsoleTone,
  V2_LABEL,
  confirmLabel,
  runningLabel,
} from "./console";

import "./shell.css";

/**
 * What command mode draws inside the palette (BZ.5,
 * [#539](https://github.com/NobuData/ouroboros/issues/539)): a command's row, a completion's
 * row, the command a line names, and the boxed reply.
 *
 * Kept out of `app/shell/command-palette.tsx` so that file stays what its own comment says it
 * is — the frame, the listbox and the keyboard — and none of these decides anything: each is
 * handed what to draw by `app/shell/use-console.ts` and what a press means by the palette.
 *
 * The treatment is mockup 19's: the command in the mono face and the accent ink with its
 * summary beside it (the COMMANDS card), and the reply in a bordered, inset mono box (the
 * status reply in the conversation above that card).
 */

/** The mark's class for each tone. Written out rather than built from the tone, because a
 *  class assembled from a template is one no search of the source will ever find. */
const MARK_CLASSES: Readonly<Record<ConsoleTone, string>> = {
  ok: "shell-console__mark--ok",
  error: "shell-console__mark--error",
  denied: "shell-console__mark--denied",
  pending: "shell-console__mark--pending",
  preview: "shell-console__mark--preview",
};

/**
 * How a command came out, as a word.
 *
 * The hue is an addition to the word, never a replacement for it (design system § 3.5): a
 * reader who cannot tell the red from the green reads *Denied* either way.
 *
 * @param props.tone The outcome.
 * @returns The mark.
 */
export function ConsoleMark({ tone }: Readonly<{ tone: ConsoleTone }>) {
  return (
    <span className={cx("shell-console__mark", MARK_CLASSES[tone])}>{CONSOLE_MARKS[tone]}</span>
  );
}

/** What every row of the palette's listbox is told, whatever it draws. */
interface RowProps {
  /** Its element id, which `aria-activedescendant` points at. */
  readonly id: string;
  /** Whether it is the highlighted row. */
  readonly active: boolean;
  /** Called when it is chosen by a press. */
  readonly onChoose: () => void;
  /** Called when the pointer moves onto it. */
  readonly onPoint: () => void;
}

/**
 * One command, as a row of the list.
 *
 * The palette's own row in every respect the keyboard cares about — `role="option"`, never
 * focused, the press caught on `mousedown` so it does not pull focus out of the box — and it
 * wears the palette's own classes for that reason. What it adds is what the row says.
 *
 * **A command the caller may not run is drawn dimmed with its reason and is still in the
 * ring.** That is the one difference from a screen nobody has built, which the palette skips:
 * the issue asks that a denied command *teach*, and a row the arrows cannot land on is a row a
 * keyboard reader cannot read. It carries `aria-disabled`, so it is announced as unavailable,
 * and choosing it says why instead of doing anything.
 *
 * @param props The entry, and the row's wiring.
 * @returns The row.
 */
export function ConsoleEntryOption({
  entry,
  id,
  active,
  onChoose,
  onPoint,
}: RowProps & Readonly<{ entry: ConsoleEntry }>) {
  return (
    <div
      className={cx(
        "shell-palette__option",
        "shell-console__row",
        active && "shell-palette__option--active",
        !entry.allowed && "shell-console__row--denied",
      )}
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={entry.allowed ? undefined : true}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onChoose}
      onMouseEnter={onPoint}
    >
      <code className="shell-console__usage">{entry.usage}</code>
      <EntryTags entry={entry} />
      <span className="shell-console__summary">{entry.summary}</span>
    </div>
  );
}

/**
 * What a command is marked with: its stage, and why the caller may not run it.
 *
 * @param props.entry The entry.
 * @returns The tags, or nothing for a command that is available and allowed.
 */
function EntryTags({ entry }: Readonly<{ entry: ConsoleEntry }>) {
  return (
    <>
      {entry.v2 && <span className="shell-console__tag">{V2_LABEL}</span>}
      {entry.deniedReason !== null && (
        <span className="shell-console__tag shell-console__tag--denied">{entry.deniedReason}</span>
      )}
    </>
  );
}

/**
 * One completion, as a row of the list.
 *
 * @param props The completion, and the row's wiring.
 * @returns The row: what would be inserted, and what the service says of it.
 */
export function ConsoleCompletionOption({
  completion,
  id,
  active,
  onChoose,
  onPoint,
}: RowProps & Readonly<{ completion: ConsoleCompletion }>) {
  return (
    <div
      className={cx(
        "shell-palette__option",
        "shell-console__row",
        active && "shell-palette__option--active",
      )}
      id={id}
      role="option"
      aria-selected={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onChoose}
      onMouseEnter={onPoint}
    >
      <code className="shell-console__usage">{completion.value}</code>
      {completion.label !== "" && completion.label !== completion.value && (
        <span className="shell-console__summary">{completion.label}</span>
      )}
    </div>
  );
}

/**
 * The command a line names, above whatever completes its next argument.
 *
 * Not a row: there is nothing to choose once the command is named, and a row here would be one
 * Enter landed on instead of running the line. It says what each position takes — the
 * grammar's own syntax line — and carries the same marks the row did.
 *
 * @param props.entry The command.
 * @returns The line.
 */
export function ConsoleNamed({ entry }: Readonly<{ entry: ConsoleEntry }>) {
  return (
    <p className={cx("shell-console__named", !entry.allowed && "shell-console__named--denied")}>
      <code className="shell-console__usage">{entry.syntax}</code>
      <EntryTags entry={entry} />
      <span className="shell-console__summary">{entry.summary}</span>
    </p>
  );
}

/**
 * A reply's link.
 *
 * A path of this application goes through the router — and closes the palette behind it, as
 * running any row does; an address outside it is an ordinary link.
 *
 * @param props.link Where the reply points.
 * @param props.onFollow Called when a link into this application is followed.
 * @returns The link.
 */
function ReplyLink({ link, onFollow }: Readonly<{ link: ConsoleLink; onFollow: () => void }>) {
  return link.url.startsWith("/") ? (
    <Link className="shell-console__link" href={link.url} onClick={onFollow}>
      {link.label}
    </Link>
  ) : (
    <a className="shell-console__link" href={link.url}>
      {link.label}
    </a>
  );
}

/** What the reply's seat is told. */
export interface ConsoleReplySeatProps {
  /** The line that is out, without the prefix. Null while nothing is. */
  readonly pending: string | null;
  /** The last reply. Null before the first. */
  readonly reply: ConsoleReplyView | null;
  /**
   * Called to put a confirming command in the box. It only fills: the reader still runs it.
   *
   * @param query The box content that really does it.
   */
  readonly onFill: (query: string) => void;
  /** Called when a link into this application is followed. */
  readonly onFollow: () => void;
}

/**
 * Where a command's reply is drawn, inside the palette.
 *
 * **Always mounted while the palette is in command mode**, empty until there is something to
 * say — a live region has to exist before its content does, or the first reply is the one a
 * screen reader does not announce. `role="status"`, which is polite: a reply answers a key the
 * reader just pressed and does not need to interrupt anything.
 *
 * A reply that is the confirm rule's preview carries one action, and what it does is put the
 * confirming command in the box. It does not run it — `abort` and `pause all` need the reader
 * to send the word `confirm` themselves, here exactly as in Slack.
 *
 * @param props See {@link ConsoleReplySeatProps}.
 * @returns The seat.
 */
export function ConsoleReplySeat({ pending, reply, onFill, onFollow }: ConsoleReplySeatProps) {
  return (
    <div className="shell-console__seat" role="status">
      {pending !== null && <p className="shell-console__running">{runningLabel(pending)}</p>}

      {pending === null && reply !== null && (
        <div className="shell-console__reply">
          <p className="shell-console__line">
            <ConsoleMark tone={reply.tone} />{" "}
            <code className="shell-console__ran">{reply.line}</code>
          </p>
          <p className="shell-console__text">{reply.text}</p>

          {reply.link !== null && <ReplyLink link={reply.link} onFollow={onFollow} />}

          {reply.tone === "pending" && <p className="shell-console__aside">{ASYNC_NOTE}</p>}

          {reply.confirmWith !== null && (
            <div className="shell-console__confirm">
              <button
                type="button"
                className="shell-console__fill"
                onClick={() => {
                  if (reply.confirmWith !== null) onFill(reply.confirmWith);
                }}
              >
                {confirmLabel(reply.confirmWith)}
              </button>
              <p className="shell-console__aside">{CONFIRM_NOTE}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
