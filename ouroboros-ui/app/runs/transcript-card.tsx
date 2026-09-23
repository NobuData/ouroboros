"use client";

import {
  type CSSProperties,
  type UIEvent,
  memo,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { RunControl } from "@/app/api/runs";
import { useKeyedPoll } from "@/app/issues/use-keyed-poll";
import { Button, Card, CardHead, Chip } from "@/app/ui";

import { type HeadControl, type SubmitOutcome, submitRunControl } from "./control-actions";
import { type DeliveryChip, controlKey } from "./controls";
import { type ControlsPollOptions, controlsUrl, createControlsPoll } from "./controls-poll";
import { transcriptUrl } from "./handoff";
import { SteerBox } from "./steer-box";
import {
  ENTRIES_LABEL,
  type EntryView,
  JUMP_TO_LATEST,
  LOADING_ENTRIES,
  NO_ENTRIES,
  RAW_JSONL,
  SHOW_ALL,
  STEER_ENDED,
  STEER_READ_ONLY,
  STREAMING,
  type SentSteer,
  TRANSCRIPT_TITLE,
  announcement,
  droppedText,
  entryView,
  filterEntries,
  filterNote,
  liveSeq,
  placeSteers,
  steerChip,
} from "./transcript";
import type { TranscriptStreamOptions } from "./transcript-stream";
import { useTranscript } from "./use-transcript";

/** How close to the end, in pixels, still counts as the end — a fractional scroll is not a leave. */
export const TAIL_SLACK_PX = 24;

/** How a steer is sent. Production sends through the Server Action; tests replace it. */
export type SteerSender = (runId: string, control: HeadControl) => Promise<SubmitOutcome>;

/** What the card is told. */
export interface TranscriptCardProps {
  /** The run. */
  readonly runId: string;
  /** Whether the run is still moving — the snapshot's `head.live`, which closes steering. */
  readonly runLive: boolean;
  /** Whether the reader may steer — owner, admin or member. */
  readonly mayContribute: boolean;
  /** The stage the stepper filtered to (#311), or `null`. */
  readonly stage: string | null;
  /** That stage's label, for the filter's note. */
  readonly stageLabel: string | null;
  /** Clear the stage filter. */
  readonly onClearStage: () => void;
  /** Test seams for the transcript's stream. */
  readonly stream?: TranscriptStreamOptions;
  /** Test seams for the steers' controls poll. */
  readonly controlsPoll?: ControlsPollOptions;
  /** How to send a steer. Defaults to the Server Action. */
  readonly send?: SteerSender;
}

/** Each actor's chip class — written out, so the sheet's audit can see every one rendered. */
const ACTOR_CLASS: Readonly<Record<EntryView["actor"], string>> = {
  plan: "run-entry__actor run-entry__actor--plan",
  tool: "run-entry__actor run-entry__actor--tool",
  model: "run-entry__actor run-entry__actor--model",
  gate: "run-entry__actor run-entry__actor--gate",
  user: "run-entry__actor run-entry__actor--user",
  system: "run-entry__actor run-entry__actor--system",
};

/** Each body style's class. */
const BODY_CLASS: Readonly<Record<EntryView["bodyStyle"], string>> = {
  plain: "run-entry__body",
  faint: "run-entry__body run-entry__body--faint",
  reason: "run-entry__body run-entry__body--reason",
  mono: "run-entry__body run-entry__body--mono",
  warn: "run-entry__body run-entry__body--warn",
};

/** Each diff line's class. */
const DIFF_CLASS: Readonly<Record<NonNullable<EntryView["diff"]>[number]["kind"], string>> = {
  ctx: "run-entry__line run-entry__line--ctx",
  del: "run-entry__line run-entry__line--del",
  add: "run-entry__line run-entry__line--add",
};

/** Each result tone's class. */
const RESULT_CLASS: Readonly<Record<NonNullable<EntryView["result"]>["tone"], string>> = {
  ok: "run-entry__result run-entry__result--ok",
  warn: "run-entry__result run-entry__result--warn",
  err: "run-entry__result run-entry__result--err",
  neutral: "run-entry__result",
};

/**
 * Mockup 10's agent transcript and its steering box
 * ([#312](https://github.com/NobuData/ouroboros/issues/312)).
 *
 * **Streams without fighting the reader** — the farm's live log pattern (#261). While the reader
 * is at the end, every page is drawn scrolled to it; the moment they scroll up the card stops
 * following and offers *Jump to latest*, and appended entries land below them without moving
 * what they are reading. Entries leaving the head of a long transcript (the stream holds at most
 * `MAX_HELD_ENTRIES`) are compensated by the browser's scroll anchoring. The box scrolls
 * on its own — the pane never does, and a wide diff scrolls inside its own block.
 *
 * **Honest about liveness.** The `streaming` pill is the page's `live` flag and nothing else, so
 * it goes quiet with the run; the live entry's meter pulses only while the run is live. A screen
 * reader hears one polite sentence per poll counting what arrived — never the entries read out.
 *
 * **Steering** posts a `steer` control and draws the reader's words at once as a `USER` entry
 * carrying the delivery chip; the service's mirror of the steer replaces it when it arrives, and
 * the chip moves with it to *acknowledged — steering applied to attempt N*.
 *
 * @param props See {@link TranscriptCardProps}.
 * @returns The card.
 */
export function TranscriptCard({
  runId,
  runLive,
  mayContribute,
  stage,
  stageLabel,
  onClearStage,
  stream,
  controlsPoll,
  send = submitRunControl,
}: TranscriptCardProps) {
  const titleId = useId();
  const { view, refresh } = useTranscript(runId, stream);

  const [steers, setSteers] = useState<readonly SentSteer[]>([]);
  const nextLocal = useRef(-1);

  // The steers' delivery, read only once there is a steer to read about.
  const watching = steers.some((steer) => steer.control !== null);
  const { snapshot: controls, refresh: refreshControls } = useKeyedPoll(watching ? runId : null, (id) =>
    createControlsPoll(controlsUrl(id), controlsPoll),
  );

  const live = view.live ?? runLive;
  const shown = filterEntries(view.entries, stage);
  const liveKey = liveSeq(view.entries);

  const chips = useMemo(() => {
    const polled = new Map<string, RunControl>((controls.data?.controls ?? []).map((control) => [control.id, control]));
    const map = new Map<number, DeliveryChip>();
    for (const steer of steers) {
      map.set(steer.localId, steerChip(steer, steer.control === null ? undefined : polled.get(steer.control.id)));
    }
    return map;
  }, [controls.data, steers]);

  const entries = placeSteers(
    shown.map((entry) => entryView(entry, entry.seq === liveKey)),
    view.entries,
    steers,
    chips,
    stage === null,
  );

  // ---- following the tail -------------------------------------------------------------------

  const scroller = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);

  useLayoutEffect(() => {
    const box = scroller.current;
    if (box !== null && following) box.scrollTop = box.scrollHeight;
  }, [entries.length, view.entries, following]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const box = event.currentTarget;
    setFollowing(box.scrollHeight - box.scrollTop - box.clientHeight <= TAIL_SLACK_PX);
  }, []);

  /** Go back to the end, and follow it. */
  function jump(): void {
    const box = scroller.current;
    if (box !== null) box.scrollTop = box.scrollHeight;
    setFollowing(true);
  }

  // ---- steering -----------------------------------------------------------------------------

  /**
   * Send a steer: draw it at once, then record what the queue said.
   *
   * @param text The steer, trimmed.
   * @returns Whether it was queued.
   */
  async function steer(text: string): Promise<boolean> {
    const localId = nextLocal.current;
    nextLocal.current -= 1;

    const sent: SentSteer = {
      localId,
      text,
      sentAt: new Date().toISOString(),
      afterSeq: view.entries.at(-1)?.seq ?? 0,
      control: null,
      failure: null,
    };
    setSteers((held) => [...held, sent]);
    setFollowing(true);

    const outcome = await send(runId, { kind: "steer", payload: text, idempotencyKey: controlKey() });

    setSteers((held) =>
      held.map((one) =>
        one.localId !== localId
          ? one
          : outcome.ok
            ? { ...one, control: outcome.control }
            : { ...one, failure: outcome.reason },
      ),
    );

    if (outcome.ok) {
      // The mirror is already stored, and the ack is on its way: ask for both now.
      refresh();
      refreshControls();
    }

    return outcome.ok;
  }

  const closedReason = !live || !runLive ? STEER_ENDED : mayContribute ? null : STEER_READ_ONLY;

  return (
    <Card aria-labelledby={titleId} as="section" className="run-transcript">
      <CardHead
        beside={
          live ? (
            <Chip dot="pulse" tone="accent">
              {STREAMING}
            </Chip>
          ) : undefined
        }
        title={TRANSCRIPT_TITLE}
        titleId={titleId}
        trailing={
          <Button href={transcriptUrl(runId)} rel="noopener noreferrer" size="sm" target="_blank" tone="ghost">
            {RAW_JSONL}
          </Button>
        }
      />

      {stage !== null && (
        <p className="run-transcript__filter">
          {filterNote(stageLabel ?? stage, shown.length, view.entries.length)}{" "}
          <button className="run-transcript__clear" onClick={onClearStage} type="button">
            {SHOW_ALL}
          </button>
        </p>
      )}

      {view.error !== null && (
        <p className="run-transcript__error" role="alert">
          {view.error}
        </p>
      )}

      <div className="run-transcript__frame">
        <div
          aria-label={ENTRIES_LABEL}
          className="run-transcript__scroll"
          onScroll={onScroll}
          ref={scroller}
          role="region"
          tabIndex={0}
        >
          {view.dropped > 0 && <p className="run-transcript__dropped">{droppedText(view.dropped)}</p>}
          {entries.length === 0 ? (
            <p className="run-transcript__empty">{view.loaded ? NO_ENTRIES : LOADING_ENTRIES}</p>
          ) : (
            <ol className="run-transcript__list">
              {entries.map((entry) => (
                <Entry entry={entry} key={entry.key} pulsing={entry.live && live} />
              ))}
            </ol>
          )}
        </div>

        {!following && (
          <button className="run-transcript__jump" onClick={jump} type="button">
            {JUMP_TO_LATEST}
          </button>
        )}
      </div>

      <p aria-live="polite" className="sr-only" role="status">
        {view.loaded ? announcement(view.added) : ""}
      </p>

      <SteerBox closedReason={closedReason} onSend={steer} />
    </Card>
  );
}

/**
 * Whether an entry needs drawing again.
 *
 * An entry is immutable once stored — its `seq` names its content — so what can change is only
 * whether it is the live one, whether it pulses, and a steer's chip.
 *
 * @param before The previous props.
 * @param after The next props.
 * @returns `true` when nothing it draws has changed.
 */
export function sameEntry(
  before: Readonly<{ entry: EntryView; pulsing: boolean }>,
  after: Readonly<{ entry: EntryView; pulsing: boolean }>,
): boolean {
  const a = before.entry;
  const b = after.entry;

  return (
    before.pulsing === after.pulsing &&
    a.key === b.key &&
    a.live === b.live &&
    a.chip?.label === b.chip?.label &&
    a.chip?.tone === b.chip?.tone &&
    a.chip?.detail === b.chip?.detail
  );
}

/**
 * One entry. Memoised on {@link sameEntry}: a poll appends, and the entries already drawn do not
 * re-render.
 *
 * @param props.entry The entry.
 * @param props.pulsing Whether its meter pulses — the live entry, on a live run.
 * @returns The list item.
 */
const Entry = memo(function Entry({ entry, pulsing }: Readonly<{ entry: EntryView; pulsing: boolean }>) {
  const className = entry.elision !== null
    ? "run-entry run-entry--elision"
    : entry.live
      ? "run-entry run-entry--live"
      : entry.key < 0
        ? "run-entry run-entry--optimistic"
        : "run-entry";

  return (
    <li className={className}>
      <article aria-label={entry.accessibleName}>
        <div className="run-entry__head">
          <time className="run-entry__time" dateTime={entry.dateTime}>
            {entry.time}
          </time>
          <span className={ACTOR_CLASS[entry.actor]}>{entry.actorLabel}</span>
          {entry.tag !== null && <span className="run-entry__tag">{entry.tag}</span>}
          {entry.headNote !== null && <span className="run-entry__note">{entry.headNote}</span>}
          {entry.chip !== null && (
            <Chip dot={entry.chip.dot} title={entry.chip.detail ?? undefined} tone={entry.chip.tone}>
              {entry.chip.label}
            </Chip>
          )}
        </div>

        {entry.elision !== null ? (
          <p className="run-entry__elision">{entry.elision}</p>
        ) : (
          entry.body !== null && <p className={BODY_CLASS[entry.bodyStyle]}>{entry.body}</p>
        )}

        {entry.diff !== null && (
          <pre className="run-entry__diff">
            {entry.diff.map((line, index) => (
              <span className={DIFF_CLASS[line.kind]} key={index}>
                {line.mark} {line.text}
              </span>
            ))}
          </pre>
        )}

        {entry.result !== null && <p className={RESULT_CLASS[entry.result.tone]}>{entry.result.text}</p>}

        {entry.progress !== null && (
          <>
            <p className="run-entry__body run-entry__body--mono">{entry.progress.text}</p>
            <div
              aria-label={entry.progress.text}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={entry.progress.percent}
              className={pulsing ? "run-entry__meter run-entry__meter--live" : "run-entry__meter"}
              role="progressbar"
            >
              <span
                className="run-entry__fill"
                // The one number the sheet cannot know: the fraction, as a custom property it reads.
                style={{ "--run-entry-progress": `${entry.progress.percent}%` } as CSSProperties}
              />
            </div>
          </>
        )}
      </article>
    </li>
  );
}, sameEntry);
