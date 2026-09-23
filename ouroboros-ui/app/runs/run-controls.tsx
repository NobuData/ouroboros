"use client";

import { useEffect, useRef, useState } from "react";

import type { RunControl } from "@/app/api/runs";
import { useKeyedPoll } from "@/app/issues/use-keyed-poll";
import { Button, Chip } from "@/app/ui";

import { AbortDialog } from "./abort-dialog";
import { type HeadControl, type SubmitOutcome, submitRunControl } from "./control-actions";
import { type ControlsPollOptions, controlsUrl, createControlsPoll } from "./controls-poll";
import {
  ABORT_LABEL,
  CONTROLS_LABEL,
  type DeliveryChip,
  SENDING_REASON,
  TAKEOVER_LABEL,
  chipOf,
  controlKey,
  deliveryChip,
  loopControls,
  mergeControls,
  pendingReason,
  takeoverNeedsPause,
  toggleView,
} from "./controls";
import { TakeoverDialog } from "./takeover-dialog";

/** How to send a control. Production sends through the Server Action; tests replace it. */
export type ControlSender = (runId: string, control: HeadControl) => Promise<SubmitOutcome>;

/** What the controls are told. */
export interface RunControlsProps {
  /** The run. */
  readonly runId: string;
  /** Its loop number — what the abort dialog asks to be typed. */
  readonly loopSeq: number;
  /** The loop's branch, or `null` before it has one. */
  readonly branch: string | null;
  /** The ticket on its tracker, or `null`. */
  readonly trackerUrl: string | null;
  /** Ask the page for a fresh snapshot — once an abort is acknowledged, the run has ended. */
  readonly onRunChanged: () => void;
  /** Test seams for the controls' poll; production passes none. */
  readonly poll?: ControlsPollOptions;
  /** How to send. Defaults to the Server Action. */
  readonly send?: ControlSender;
}

/** Which control this page has in flight, if any. */
type Sending = HeadControl["kind"] | null;

/**
 * The page head's three actions ([#310](https://github.com/NobuData/ouroboros/issues/310)) —
 * mockup 10's *Pause loop*, *Take over in IDE* and *Abort run*.
 *
 * **Rendered only for an owner or admin, and only while the run is live** — the screen decides
 * both. The service refuses a member's pause, abort or take-over whatever this draws, so
 * hiding the buttons is courtesy and the `403` is the policy.
 *
 * **Delivery is honest.** A press shows `sending` while the request is in flight, then the
 * queue's own state from the controls poll (`sent` → `received` → `acknowledged`), which asks
 * every couple of seconds while anything is on its way. An expired control reads *no response
 * — run may be between stages*. The toggle becomes *Resume* only once a pause is
 * acknowledged, and a control on its way disables re-submission: a double click is one
 * control, held twice over — by a synchronous guard here and by the service's collapse.
 *
 * @param props See {@link RunControlsProps}.
 * @returns The action row, its chips, and the two dialogs.
 */
export function RunControls({
  runId,
  loopSeq,
  branch,
  trackerUrl,
  onRunChanged,
  poll,
  send = submitRunControl,
}: RunControlsProps) {
  const { snapshot, refresh } = useKeyedPoll(runId, (id) =>
    createControlsPoll(controlsUrl(id), poll),
  );
  const [sending, setSending] = useState<Sending>(null);
  const [submitted, setSubmitted] = useState<RunControl | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [abortOpen, setAbortOpen] = useState(false);
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  // The synchronous half of *one press, one control*: set before the first await, so a second
  // click that lands before React has re-rendered finds it taken.
  const inFlight = useRef(false);

  const controls = mergeControls(snapshot.data?.controls ?? null, submitted);
  const loop = loopControls(controls);
  const toggle = toggleView(loop, sending !== null);

  const abortAcked = loop.latestAbort?.state === "acked";
  useEffect(() => {
    if (abortAcked) onRunChanged();
  }, [abortAcked, onRunChanged]);

  /**
   * Send one control, once.
   *
   * @param control What to send.
   * @returns What became of it, or `null` when another press was already in flight.
   */
  async function dispatch(control: HeadControl): Promise<SubmitOutcome | null> {
    if (inFlight.current) return null;

    inFlight.current = true;
    setSending(control.kind);
    setFailure(null);
    try {
      const outcome = await send(runId, { ...control, idempotencyKey: controlKey() });
      if (outcome.ok) {
        setSubmitted(outcome.control);
        refresh();
      } else if (control.kind !== "abort") {
        // The abort dialog draws its own refusal; the head draws the toggle's.
        setFailure(outcome.reason);
      }
      return outcome;
    } finally {
      inFlight.current = false;
      setSending(null);
    }
  }

  /** The toggle: pause, or resume once a pause is acknowledged. */
  function pressToggle(): void {
    void dispatch({ kind: toggle.kind });
  }

  /** The take-over: open the hand-off and, unless the loop is paused or pausing, pause it. */
  function pressTakeover(): void {
    setTakeoverOpen(true);
    if (takeoverNeedsPause(loop)) void dispatch({ kind: "pause" });
  }

  /**
   * The abort dialog's confirmation.
   *
   * @param typed What was typed.
   * @returns What became of it.
   */
  async function confirmAbort(typed: string): Promise<SubmitOutcome> {
    const outcome = await dispatch({ kind: "abort", confirmation: typed });

    return outcome ?? { ok: false, status: 409, code: "control_in_flight", reason: SENDING_REASON };
  }

  const toggleChip: DeliveryChip | null =
    sending === "pause" || sending === "resume"
      ? deliveryChip(sending, "sending")
      : loop.latestToggle === null
        ? null
        : chipOf(loop.latestToggle);
  const abortChip: DeliveryChip | null =
    sending === "abort"
      ? deliveryChip("abort", "sending")
      : loop.latestAbort === null
        ? null
        : chipOf(loop.latestAbort);
  const abortReason =
    sending !== null
      ? SENDING_REASON
      : loop.pendingAbort !== null
        ? pendingReason("abort")
        : undefined;

  return (
    <div className="run-controls">
      <div aria-label={CONTROLS_LABEL} className="run-controls__buttons" role="group">
        <Button onClick={pressToggle} reason={toggle.reason} tone="ghost" type="button">
          {toggle.label}
        </Button>
        <Button
          onClick={pressTakeover}
          reason={sending !== null ? SENDING_REASON : undefined}
          tone="ghost"
          type="button"
        >
          {TAKEOVER_LABEL}
        </Button>
        <Button onClick={() => setAbortOpen(true)} reason={abortReason} tone="danger" type="button">
          {ABORT_LABEL}
        </Button>
      </div>

      <div aria-live="polite" className="run-controls__status" role="status">
        {toggleChip !== null && <ControlChip chip={toggleChip} />}
        {abortChip !== null && <ControlChip chip={abortChip} />}
        {failure !== null && <span className="run-controls__error">{failure}</span>}
      </div>

      <AbortDialog
        branch={branch}
        loopSeq={loopSeq}
        onClose={() => setAbortOpen(false)}
        onConfirm={confirmAbort}
        open={abortOpen}
      />
      <TakeoverDialog
        branch={branch}
        failure={failure}
        onClose={() => setTakeoverOpen(false)}
        open={takeoverOpen}
        pause={toggleChip}
        runId={runId}
        trackerUrl={trackerUrl}
      />
    </div>
  );
}

/**
 * One delivery chip.
 *
 * @param props.chip What to draw.
 * @returns The chip, with the executor's words as its tooltip.
 */
function ControlChip({ chip }: Readonly<{ chip: DeliveryChip }>) {
  return (
    <Chip dot={chip.dot} title={chip.detail ?? undefined} tone={chip.tone}>
      {chip.label}
    </Chip>
  );
}
