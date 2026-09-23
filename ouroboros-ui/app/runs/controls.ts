/**
 * The run controls, as data ([#310](https://github.com/NobuData/ouroboros/issues/310)) —
 * mockup 10's *Pause loop*, *Abort run* and *Take over in IDE*, decided here and drawn by
 * `run-controls.tsx`, `abort-dialog.tsx` and `takeover-dialog.tsx`.
 *
 * **Delivery is shown as it is, never as it is hoped to be.** A control is a row on #306's
 * durable queue, not a call to the executor, so a press moves through `sending` (this page's
 * request is in flight), `sent` (queued), `received` (the executor fetched it) and
 * `acknowledged` (it applied it). One the executor never answers is `expired`, and that reads
 * *"no response — run may be between stages"*: true, actionable, and never a success state.
 *
 * **Paused is what the executor said, not what was asked.** The snapshot carries no paused
 * flag, so the loop is paused exactly when the newest *acknowledged* pause-or-resume is a
 * pause. A pause that is still `sent` has not stopped anything, and the button does not flip
 * to *Resume* until it has.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type { RunControl, RunControlKind, RunControlState } from "@/app/api/runs";
import type { ChipDot, ChipTone } from "@/app/ui";

/** Where a control stands, from this page's point of view: its own request, then the queue's. */
export type ControlPhase = "sending" | RunControlState;

/** The head's pause button, before a pause is acknowledged. */
export const PAUSE_LABEL = "Pause loop";

/** The same button once the executor has acknowledged a pause. */
export const RESUME_LABEL = "Resume";

/** The take-over button. */
export const TAKEOVER_LABEL = "Take over in IDE";

/** The abort button. */
export const ABORT_LABEL = "Abort run";

/** What the controls' group is called, for a screen reader. */
export const CONTROLS_LABEL = "Run controls";

/** Why a control cannot be pressed while this page's own request is in flight. */
export const SENDING_REASON = "Sending — waiting for the service to queue it.";

/** The expiry sentence (#306): what an unanswered control reads, word for word. */
export const NO_RESPONSE = "no response — run may be between stages";

/** What a rejection reads when the service gave no reason of its own. */
export const REJECTED_FALLBACK = "refused";

/** What a submission that never reached the service reads. */
export const SUBMIT_UNREACHABLE = "The control could not be sent. Nothing was queued.";

/** The code a submission the server hop refused itself is answered with. */
export const CONTROL_NOT_ALLOWED_CODE = "control_not_allowed";

/** The sentence beside {@link CONTROL_NOT_ALLOWED_CODE}. */
export const CONTROL_NOT_ALLOWED = "Only pause, resume and abort can be sent from here.";

/** The code a submission that never reached the service is answered with. */
export const CONTROL_UNREACHABLE_CODE = "control_unreachable";

/** Each kind's name on the chip. Steering has its own box (#311) and no chip here. */
export const CONTROL_KIND_LABEL: Readonly<Record<RunControlKind, string>> = {
  pause: "Pause",
  resume: "Resume",
  abort: "Abort",
  steer: "Steer",
};

/** Each phase's word on the chip — the contract's own vocabulary (#306's `RunControlState`). */
export const CONTROL_PHASE_LABEL: Readonly<Record<Exclude<ControlPhase, "rejected">, string>> = {
  sending: "sending",
  pending: "sent",
  delivered: "received",
  acked: "acknowledged",
  expired: NO_RESPONSE,
};

/** The phases in which a control is still on its way — the ones that block a second press. */
const OUTSTANDING: ReadonlySet<RunControlState> = new Set(["pending", "delivered"]);

/** What the head's delivery chip draws. */
export interface DeliveryChip {
  /** `Pause · acknowledged`. */
  readonly label: string;
  /** The hue: accent while moving, ok once acknowledged, warn for no response, err refused. */
  readonly tone: ChipTone;
  /** A pulse only while the control is still moving. */
  readonly dot: ChipDot;
  /** The executor's own words, when it said any — the chip's tooltip. */
  readonly detail: string | null;
}

/** What the queue says about this run's loop, from its recent controls. */
export interface LoopControls {
  /** Whether the newest acknowledged pause-or-resume was a pause. */
  readonly paused: boolean;
  /** The newest pause or resume, whatever its state — the one the toggle's chip reports. */
  readonly latestToggle: RunControl | null;
  /** The newest abort, whatever its state — the one the abort's chip reports. */
  readonly latestAbort: RunControl | null;
  /** A pause or resume still on its way, which a second press must not duplicate. */
  readonly pendingToggle: RunControl | null;
  /** An abort still on its way. */
  readonly pendingAbort: RunControl | null;
}

/** What the head's toggle draws. */
export interface ToggleView {
  /** What a press queues. */
  readonly kind: "pause" | "resume";
  /** *Pause loop* or *Resume*. */
  readonly label: string;
  /** Why it cannot be pressed now, or `undefined` when it can. */
  readonly reason: string | undefined;
}

/**
 * Whether a control is still on its way — queued or fetched, and not yet answered.
 *
 * @param control The control.
 * @returns `true` for `pending` and `delivered`.
 */
export function isOutstanding(control: RunControl): boolean {
  return OUTSTANDING.has(control.state);
}

/**
 * Whether a control is a pause or a resume — the two halves of the head's toggle.
 *
 * @param control The control.
 * @returns `true` for `pause` and `resume`.
 */
function isToggle(control: RunControl): boolean {
  return control.kind === "pause" || control.kind === "resume";
}

/**
 * Read the loop's state out of its recent controls.
 *
 * @param controls The run's controls, newest first — the service's order, which is what
 *   *newest* means here.
 * @returns What the queue says.
 */
export function loopControls(controls: readonly RunControl[]): LoopControls {
  const toggles = controls.filter(isToggle);
  const aborts = controls.filter((control) => control.kind === "abort");
  const lastAnswered = toggles.find((control) => control.state === "acked");

  return {
    paused: lastAnswered?.kind === "pause",
    latestToggle: toggles[0] ?? null,
    latestAbort: aborts[0] ?? null,
    pendingToggle: toggles.find(isOutstanding) ?? null,
    pendingAbort: aborts.find(isOutstanding) ?? null,
  };
}

/**
 * The poll's controls, with the one this page just queued in front until the poll has it.
 *
 * Between the submission answering and the next poll answering, the queue's view is one
 * control short; without this the chip would fall back to the previous control for a moment.
 * Once the poll holds the control, the poll's copy wins — it is the newer of the two.
 *
 * @param polled The poll's controls, newest first, or `null` before its first answer.
 * @param submitted What this page's last submission returned, or `null`.
 * @returns The controls to draw, newest first.
 */
export function mergeControls(
  polled: readonly RunControl[] | null,
  submitted: RunControl | null,
): readonly RunControl[] {
  const list = polled ?? [];
  if (submitted === null || list.some((control) => control.id === submitted.id)) return list;

  return [submitted, ...list];
}

/**
 * The toggle's label, and whether it may be pressed.
 *
 * A pending control disables the button rather than queueing a second one: the service would
 * collapse a repeated pause into the one outstanding anyway, and a button that looked pressable
 * would suggest otherwise.
 *
 * @param loop What the queue says.
 * @param sending Whether this page's own request is in flight.
 * @returns The toggle.
 */
export function toggleView(loop: LoopControls, sending: boolean): ToggleView {
  const kind = loop.paused ? "resume" : "pause";
  const label = loop.paused ? RESUME_LABEL : PAUSE_LABEL;

  if (sending) return { kind, label, reason: SENDING_REASON };
  if (loop.pendingToggle !== null) {
    return { kind, label, reason: pendingReason(loop.pendingToggle.kind) };
  }

  return { kind, label, reason: undefined };
}

/**
 * Why a control is blocked while another of its kind is on its way.
 *
 * @param kind The kind already outstanding.
 * @returns `A pause is already on its way — waiting for the run to answer.`
 */
export function pendingReason(kind: RunControlKind): string {
  const article = kind === "abort" ? "An" : "A";

  return `${article} ${kind} is already on its way — waiting for the run to answer.`;
}

/**
 * The chip for one control, or for this page's own request before the queue has it.
 *
 * @param kind Which control.
 * @param phase Where it stands.
 * @param detail What the ack said, or why it was rejected; `null` when nobody has answered.
 * @returns The chip.
 */
export function deliveryChip(
  kind: RunControlKind,
  phase: ControlPhase,
  detail: string | null = null,
): DeliveryChip {
  const name = CONTROL_KIND_LABEL[kind];

  switch (phase) {
    case "sending":
    case "pending":
    case "delivered":
      return { label: `${name} · ${CONTROL_PHASE_LABEL[phase]}`, tone: "accent", dot: "pulse", detail };
    case "acked":
      return { label: `${name} · ${CONTROL_PHASE_LABEL.acked}`, tone: "ok", dot: "filled", detail };
    case "expired":
      return { label: `${name} · ${NO_RESPONSE}`, tone: "warn", dot: "ring", detail };
    case "rejected":
      return {
        label: `${name} · ${detail ?? REJECTED_FALLBACK}`,
        tone: "err",
        dot: "filled",
        detail,
      };
  }
}

/**
 * The chip for a control the queue holds.
 *
 * @param control The control.
 * @returns The chip.
 */
export function chipOf(control: RunControl): DeliveryChip {
  return deliveryChip(control.kind, control.state, control.detail);
}

/**
 * Whether the take-over dialog has to queue a pause, or one is already there.
 *
 * The R7 hand-over pauses the loop first. A loop already paused needs nothing, and a pause
 * already on its way is the one the dialog reports rather than a second one.
 *
 * @param loop What the queue says.
 * @returns `true` when the dialog should queue a pause on opening.
 */
export function takeoverNeedsPause(loop: LoopControls): boolean {
  if (loop.paused) return false;

  return loop.pendingToggle?.kind !== "pause";
}

/**
 * Whether what was typed into the abort dialog names this run.
 *
 * The same comparison the service makes (`ouroboros-rest`'s `confirmationMatches`): trimmed,
 * one leading `#` allowed. This is the button's courtesy — the service checks again, and a
 * forged confirmation is refused there.
 *
 * @param typed What was typed.
 * @param loopSeq The run's loop number.
 * @returns Whether they agree.
 */
export function confirmationMatches(typed: string, loopSeq: number): boolean {
  return typed.trim().replace(/^#/, "") === String(loopSeq);
}

/**
 * A fresh idempotency key for one press.
 *
 * One per press, not per page: a retry of the same press is the same control, and a second
 * press is a second decision.
 *
 * @returns A key the service accepts.
 */
export function controlKey(): string {
  return globalThis.crypto.randomUUID();
}

/** What the abort dialog's cancel button says. */
export const ABORT_CANCEL = "Keep running";

/** What the abort dialog's button says while its request is in flight. */
export const ABORTING = "Aborting…";

/** Why the abort dialog's button cannot be pressed yet. */
export const ABORT_NEEDS_CONFIRMATION = "Type the loop number to enable the abort.";

/** What is lost — the part of the consequences that does not depend on the run. */
export const ABORT_LOSES =
  "The loop stops at its next safe boundary and any work it has not committed is discarded. " +
  "This cannot be undone.";

/** What is kept, when the run has no branch yet. */
export const ABORT_KEEPS_NOTHING = "The run is marked canceled. It has not pushed a branch yet.";

/**
 * The abort dialog's title — also its accessible name.
 *
 * @param loopSeq The run's loop number.
 * @returns `Abort Loop #1847?`.
 */
export function abortTitle(loopSeq: number): string {
  return `Abort Loop #${loopSeq}?`;
}

/**
 * The abort dialog's danger button.
 *
 * @param loopSeq The run's loop number.
 * @returns `Abort Loop #1847`.
 */
export function abortConfirmLabel(loopSeq: number): string {
  return `Abort Loop #${loopSeq}`;
}

/**
 * The confirmation field's label.
 *
 * @param loopSeq The run's loop number.
 * @returns `Type 1847 to confirm`.
 */
export function abortFieldLabel(loopSeq: number): string {
  return `Type ${loopSeq} to confirm`;
}

/**
 * What is kept after an abort.
 *
 * @param branch The loop's branch, or `null` before it has one.
 * @returns `The run is marked canceled. Its branch loop/482-canbus-flake is preserved.`
 */
export function abortKeeps(branch: string | null): string {
  if (branch === null) return ABORT_KEEPS_NOTHING;

  return `The run is marked canceled. Its branch ${branch} is preserved — nothing is deleted from it.`;
}
