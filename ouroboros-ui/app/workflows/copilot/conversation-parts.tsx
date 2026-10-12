"use client";

import { type ReactNode, useId, useState, useSyncExternalStore } from "react";

import type { CopilotChoice, CopilotMessage, CopilotToolTrace } from "@/app/api/workflow-copilot";
import { Button, cx } from "@/app/ui";

import {
  ANSWERED_MARK,
  CLOSED_MID_REPLY_NOTE,
  CLOSED_MID_REPLY_TITLE,
  REPLY_FAILED_TITLE,
  RETRY_LABEL,
  type ReplyFailure,
  SESSION_CLOSED_CODE,
  type Segment,
  bounceLine,
  clockOf,
  correctedWords,
  costAffix,
  operationLine,
  ordinalOf,
  parseReply,
  traceLines,
  traceSummary,
  warningLine,
} from "./conversation";
import { SPEAKER_WORDS } from "./copilot-view";

/**
 * The pieces the conversation card is drawn from (CE.2,
 * [#566](https://github.com/NobuData/ouroboros/issues/566)) — mockup 20's bubbles, chip rows and
 * meta lines. Every judgement they show is `conversation.ts`'; nothing here decides.
 */

/** Never changes, so nothing to subscribe to. */
const never = (): (() => void) => () => {};

/**
 * Whether this render is past hydration.
 *
 * A time of day depends on the reader's zone, which the server does not know. The server's
 * render and the hydrating one print it in UTC; the reader's own follows immediately after —
 * so the first paint matches the server's markup instead of mismatching it.
 *
 * @returns False on the server and while hydrating.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    never,
    () => true,
    () => false,
  );
}

/**
 * A message's meta line — *You · 15:02*, *Copilot · 15:02 · $0.12*.
 *
 * Messages carry no author, so the speaker is the frame's own word for each side. The cost is
 * drawn only for a priced exchange: an unpriced one draws nothing, never a zero.
 *
 * @param props.role Which side spoke.
 * @param props.at When, ISO 8601 — omitted for a message the service has not recorded yet.
 * @param props.costCents What the exchange cost, or `null`/`undefined` when unpriced or unknown.
 * @param props.note What stands in for the time while there is none — *Sending…*.
 * @returns The line.
 */
export function MetaLine({
  role,
  at,
  costCents,
  note,
}: Readonly<{ role: CopilotMessage["role"]; at?: string; costCents?: number | null; note?: string }>) {
  const hydrated = useHydrated();
  const cost = costAffix(costCents);

  return (
    <p className={cx("copilot-chat__meta", role === "copilot" && "copilot-chat__meta--bot")}>
      {SPEAKER_WORDS[role]}
      {at !== undefined && (
        <>
          {" · "}
          <time dateTime={at}>{hydrated ? clockOf(at) : clockOf(at, "UTC", "en-GB")}</time>
        </>
      )}
      {note !== undefined && ` · ${note}`}
      {cost !== null && <span className="copilot-chat__cost">{` · ${cost}`}</span>}
    </p>
  );
}

/**
 * A reply's text, in the closed subset `parseReply` reads — paragraphs, line breaks, bold,
 * inline code and fenced blocks, each as an element. No markup is ever injected.
 *
 * @param props.text The text.
 * @returns The blocks.
 */
export function ReplyText({ text }: Readonly<{ text: string }>) {
  return (
    <>
      {parseReply(text).map((block, at) =>
        block.kind === "code" ? (
          <pre className="copilot-chat__pre" key={at}>
            <code>{block.text}</code>
          </pre>
        ) : (
          <p className="copilot-chat__para" key={at}>
            {block.lines.map((line, row) => (
              <span key={row}>
                {row > 0 && <br />}
                {line.map((run, cell) =>
                  run.kind === "bold" ? (
                    <strong className="copilot-chat__strong" key={cell}>
                      {run.text}
                    </strong>
                  ) : run.kind === "code" ? (
                    <code className="copilot-chat__code" key={cell}>
                      {run.text}
                    </code>
                  ) : (
                    run.text
                  ),
                )}
              </span>
            ))}
          </p>
        ),
      )}
    </>
  );
}

/**
 * A quiet line that opens to detail — a real disclosure: a button that says whether it is open,
 * and the detail it controls.
 *
 * @param props.summary The line.
 * @param props.children What it opens to.
 * @returns The disclosure, closed.
 */
function Disclosure({ summary, children }: Readonly<{ summary: string; children: ReactNode }>) {
  const [open, setOpen] = useState(false);
  const detailId = useId();

  return (
    <div className="copilot-chat__trace">
      <button
        aria-controls={detailId}
        aria-expanded={open}
        className="copilot-chat__trace-toggle"
        onClick={() => setOpen((was) => !was)}
        type="button"
      >
        <span aria-hidden className="copilot-chat__trace-caret">
          {open ? "▾" : "▸"}
        </span>
        {summary}
      </button>
      <div className="copilot-chat__trace-detail" hidden={!open} id={detailId}>
        {children}
      </div>
    </div>
  );
}

/**
 * One piece of a reply the card watched arrive.
 *
 * @param props.segment The piece.
 * @returns Text; an operation's marker with any W7 warning under it; the quiet *1 operation
 *   corrected* that opens to the validator's message; or a quiet note.
 */
function SegmentView({ segment }: Readonly<{ segment: Segment }>) {
  switch (segment.kind) {
    case "text":
      return <ReplyText text={segment.text} />;

    case "operation":
      return (
        <>
          <p className={cx("copilot-chat__marker", segment.outcome === "proposed" && "copilot-chat__marker--proposed")}>
            {operationLine(segment.op, segment.outcome)}
          </p>
          {segment.warnings.map((warning, at) => (
            <p className="copilot-chat__warning" key={at}>
              {warningLine(warning)}
            </p>
          ))}
        </>
      );

    case "bounced":
      return (
        <Disclosure summary={correctedWords(segment.bounces.length)}>
          <ul className="copilot-chat__trace-list">
            {segment.bounces.map((bounce, at) => (
              <li className="copilot-chat__trace-line" key={at}>
                {bounceLine(bounce.op, bounce.validatorMessage)}
              </li>
            ))}
          </ul>
        </Disclosure>
      );

    case "note":
      return <p className="copilot-chat__marker">{segment.text}</p>;
  }
}

/**
 * A reply's pieces, in the order they arrived.
 *
 * @param props.segments The pieces.
 * @returns Them.
 */
export function Segments({ segments }: Readonly<{ segments: readonly Segment[] }>) {
  return (
    <>
      {segments.map((segment, at) => (
        <SegmentView key={at} segment={segment} />
      ))}
    </>
  );
}

/**
 * A stored reply's trace: one quiet line — *applied 5 operations · 1 corrected* — that opens to
 * the list. Nothing at all for a reply that proposed no operation and no dry run.
 *
 * @param props.trace The trace.
 * @returns The disclosure, or nothing.
 */
export function StoredTrace({ trace }: Readonly<{ trace: CopilotToolTrace }>) {
  const summary = traceSummary(trace);
  if (summary === null) return null;

  return (
    <Disclosure summary={summary}>
      <ul className="copilot-chat__trace-list">
        {traceLines(trace).map((line, at) => (
          <li
            className={cx("copilot-chat__trace-line", line.tone === "bounced" && "copilot-chat__trace-line--bounced")}
            key={at}
          >
            {line.text}
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

/**
 * A reply's questions — one row of chips each.
 *
 * A chip is a control: a button that posts its option. Each row is a group named by its
 * question, numbered ① ② when the reply asked more than one. Once answered, the chosen chip is
 * marked (pressed, with a ✓) and **every** chip of the row is disabled — not merely styled so —
 * so the transcript does not invite re-answering a question that already changed the draft.
 *
 * @param props.choices The questions.
 * @param props.live Whether an unanswered row may be pressed — one decision for the whole reply.
 * @param props.onAnswer Post an answer.
 * @returns The rows.
 */
export function ChoiceRows({
  choices,
  live,
  onAnswer,
}: Readonly<{
  choices: readonly CopilotChoice[];
  live: boolean;
  onAnswer: (question: number, selected: string) => void;
}>) {
  const baseId = useId();

  return (
    <>
      {choices.map((choice, question) => {
        const promptId = `${baseId}-q${question}`;
        const ordinal = ordinalOf(question, choices.length);
        const pressable = live && choice.selected === null;

        return (
          <div aria-labelledby={promptId} className="copilot-chat__choice-row" key={question} role="group">
            <span className="copilot-chat__question" id={promptId}>
              {ordinal !== "" && `${ordinal} `}
              {choice.prompt}
            </span>
            {choice.options.map((option) => {
              const chosen = choice.selected === option;

              return (
                <button
                  aria-pressed={chosen}
                  className={cx("copilot-chat__chip", chosen && "copilot-chat__chip--selected")}
                  disabled={!pressable}
                  key={option}
                  onClick={() => onAnswer(question, option)}
                  type="button"
                >
                  {option}
                  {chosen && <span aria-hidden>{` ${ANSWERED_MARK}`}</span>}
                </button>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

/**
 * What a reply that did not finish says under its bubble.
 *
 * Two endings, drawn apart. A reply the service stopped because the conversation was promoted
 * or discarded under it is **stated** — nothing went wrong, and there is nothing to retry; the
 * service's own sentence is the reply's last words in the bubble, so it is not repeated. Any
 * other is said in the service's words with a **Retry** that sends the same text again as a new
 * message; the transcript keeps both.
 *
 * @param props.failure Why it did not finish.
 * @param props.onRetry Send again — omitted where a retry would not send.
 * @returns The block.
 */
export function ReplyEnding({ failure, onRetry }: Readonly<{ failure: ReplyFailure; onRetry?: () => void }>) {
  const closed = failure.code === SESSION_CLOSED_CODE;
  const title = closed ? CLOSED_MID_REPLY_TITLE : REPLY_FAILED_TITLE;

  return (
    <div
      aria-label={title}
      className={cx("copilot-chat__ending", closed ? "copilot-chat__ending--closed" : "copilot-chat__ending--failed")}
      role="group"
    >
      <p className="copilot-chat__ending-title">{title}</p>
      <p className="copilot-chat__ending-text">{closed ? CLOSED_MID_REPLY_NOTE : failure.message}</p>
      {!closed && onRetry !== undefined && (
        <Button onClick={onRetry} size="sm">
          {RETRY_LABEL}
        </Button>
      )}
    </div>
  );
}
