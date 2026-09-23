/**
 * The stage timeline, as data ([#311](https://github.com/NobuData/ouroboros/issues/311)) —
 * mockup 10's `c-12` stepper, decided here and drawn by `run-stepper.tsx`.
 *
 * **Read from stage history, never narrated.** Every node is one entry of AP.2's `timeline`
 * (#304), in the pinned workflow's order; the caption is the service's duration or its attempt
 * count; and the warn note is the transition's own `note`, composed by the database when the
 * attempt was opened (decision **R1**). Nothing here writes a sentence about what happened —
 * a stepper that narrated for itself would eventually narrate something that did not.
 *
 * **Five treatments.** The mockup draws three — done `✓`, active `●` (pulsing), pending `○` —
 * and two more are needed to tell the truth about a run the mockup does not show: `failed`
 * (`✕`, the error hue) for a stage whose attempt failed, and for the stage a failed or
 * canceled run stopped on, so a dead loop never reads as merely paused; and `skipped` (`–`,
 * muted) for a branch the loop did not take.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type { RunStatus } from "@/app/api/dashboard";
import type { RunConsole } from "@/app/api/runs";
import { elapsedOfSeconds } from "@/app/format";

/** One stage, as the timeline payload carries it. */
export type RunTimelineStage = RunConsole["timeline"]["stages"][number];

/** How a node is drawn. */
export type StepTone = "done" | "active" | "pending" | "failed" | "skipped";

/** The query parameter that names the stage the transcript is filtered to (#312). */
export const STAGE_PARAM = "stage";

/** The card's title — the mockup's `STAGE TIMELINE`. */
export const STEPPER_TITLE = "Stage timeline";

/** The strip's accessible name. */
export const STEPPER_LABEL = "Stages";

/** What the card says when the run has reported no stages yet. */
export const NO_STAGES = "No stage has been reported for this run yet.";

/** Each treatment's glyph — the mockup's, plus the two it does not draw. */
export const STEP_GLYPH: Readonly<Record<StepTone, string>> = {
  done: "✓",
  active: "●",
  pending: "○",
  failed: "✕",
  skipped: "–",
};

/** Each treatment, said in words for a screen reader — the glyph alone is decoration. */
export const STEP_STATE_LABEL: Readonly<Record<StepTone, string>> = {
  done: "done",
  active: "in progress",
  pending: "pending",
  failed: "failed",
  skipped: "skipped",
};

/** The failed-terminal caption for the stage a canceled run stopped on. */
export const CANCELED_CAPTION = "canceled";

/** The caption of a stage whose attempt failed. */
export const FAILED_CAPTION = "failed";

/** The caption of a skipped stage. */
export const SKIPPED_CAPTION = "skipped";

/** Treatments the loop has reached — the ones a glowing segment may lead into. */
const REACHED: ReadonlySet<StepTone> = new Set(["done", "active", "failed"]);

/** Run statuses that end a run badly — the stage they stopped on is drawn failed. */
const FAILED_TERMINAL: ReadonlySet<RunStatus> = new Set(["failed", "canceled"]);

/** One node, ready to draw. */
export interface StepView {
  /** The DSL node id — the filter's value and the React key. */
  readonly key: string;
  /** The node's title as the pinned version had it. */
  readonly label: string;
  /** How it is drawn. */
  readonly tone: StepTone;
  /** `✓`, `●`, `○`, `✕` or `–`. */
  readonly glyph: string;
  /** `1m 12s`, `attempt 2/3`, `failed` — or `null` for a node with nothing to say. */
  readonly caption: string | null;
  /** The stored warn note, verbatim, or `null`. */
  readonly note: string | null;
  /**
   * Whether the segment leading *into* this node glows: the node before it is done and the loop
   * has reached this one — the mockup's glow runs up to the active node, not past it.
   */
  readonly doneSegment: boolean;
  /** `Implement, in progress, attempt 2/3` — the node's name for a screen reader. */
  readonly accessibleName: string;
}

/** The whole card, ready to draw. */
export interface StepperView {
  /** `workflow: standard-fix v14`. */
  readonly tag: string;
  /** The nodes, in the pinned workflow's order. */
  readonly steps: readonly StepView[];
  /** Whether the active node pulses — only while the run is moving. */
  readonly live: boolean;
  /** The stage the view should scroll into sight on load: the active one, else the last failed. */
  readonly focusKey: string | null;
}

/**
 * The attempt caption.
 *
 * @param attempt The `2` of `attempt 2/3`.
 * @param maxAttempts The `3`, or `null` for a stage type with no limit.
 * @returns `attempt 2/3`, or `attempt 2` when there is no limit to state.
 */
export function attemptCaption(attempt: number, maxAttempts: number | null): string {
  return maxAttempts === null ? `attempt ${attempt}` : `attempt ${attempt}/${maxAttempts}`;
}

/**
 * How one stage is drawn.
 *
 * A stage still `active` on a run that has ended badly is where the loop died, and is drawn
 * failed; on a run that ended any other way (`needs_human`) it is still the stage the run is
 * holding at, and keeps its active treatment without the pulse.
 *
 * @param stage The stage.
 * @param runStatus The run's status.
 * @returns The treatment.
 */
export function stepTone(stage: RunTimelineStage, runStatus: RunStatus): StepTone {
  switch (stage.status) {
    case "succeeded":
      return "done";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    case "pending":
      return "pending";
    case "active":
      return FAILED_TERMINAL.has(runStatus) ? "failed" : "active";
  }
}

/**
 * The caption under one node.
 *
 * @param stage The stage.
 * @param tone Its treatment.
 * @param runStatus The run's status.
 * @returns The duration for a done node, the attempt count for an active one, the outcome for
 *   a failed or skipped one, and `null` for a pending node or a done one with no duration.
 */
export function stepCaption(
  stage: RunTimelineStage,
  tone: StepTone,
  runStatus: RunStatus,
): string | null {
  switch (tone) {
    case "done":
      return stage.durationSeconds === null ? null : elapsedOfSeconds(stage.durationSeconds);
    case "active":
      return attemptCaption(stage.attempt, stage.maxAttempts);
    case "failed":
      return stage.status === "active" && runStatus === "canceled" ? CANCELED_CAPTION : FAILED_CAPTION;
    case "skipped":
      return SKIPPED_CAPTION;
    case "pending":
      return null;
  }
}

/**
 * A node's name for a screen reader: the label, the state in words, and the caption.
 *
 * @param label The stage's label.
 * @param tone Its treatment.
 * @param caption Its caption, or `null`.
 * @returns `Implement, in progress, attempt 2/3` — a caption that merely repeats the state
 *   (`Build, failed`) is said once.
 */
export function stepName(label: string, tone: StepTone, caption: string | null): string {
  const state = STEP_STATE_LABEL[tone];
  const parts = caption === null || caption === state ? [label, state] : [label, state, caption];

  return parts.join(", ");
}

/**
 * The workflow tag in the card's head.
 *
 * @param tag The workflow's label.
 * @param version The pinned version, or `null`.
 * @returns `workflow: standard-fix v14`, or without the version when none was pinned.
 */
export function stepperTag(tag: string, version: number | null): string {
  return version === null ? `workflow: ${tag}` : `workflow: ${tag} v${version}`;
}

/**
 * The whole stepper from one snapshot.
 *
 * @param snapshot The run console snapshot.
 * @returns What `run-stepper.tsx` draws.
 */
export function runStepper(snapshot: RunConsole): StepperView {
  const { timeline, run, head } = snapshot;
  const ordered = [...timeline.stages].sort((a, b) => a.position - b.position);

  let previousDone = false;
  const steps = ordered.map((stage): StepView => {
    const tone = stepTone(stage, run.status);
    const caption = stepCaption(stage, tone, run.status);
    const view: StepView = {
      key: stage.stageKey,
      label: stage.label,
      tone,
      glyph: STEP_GLYPH[tone],
      caption,
      note: stage.note,
      doneSegment: previousDone && REACHED.has(tone),
      accessibleName: stepName(stage.label, tone, caption),
    };
    previousDone = tone === "done";
    return view;
  });

  const active = steps.find((step) => step.tone === "active");
  const failed = [...steps].reverse().find((step) => step.tone === "failed");

  return {
    tag: stepperTag(timeline.workflowTag, timeline.workflowVersion),
    steps,
    live: head.live,
    focusKey: active?.key ?? failed?.key ?? null,
  };
}

/**
 * The stage the URL names, if the run has it.
 *
 * @param value The `?stage=` value, as the page or the browser read it.
 * @param steps The run's stages.
 * @returns The key, or `null` for no filter — which covers a key this run does not have.
 */
export function selectedStage(
  value: string | string[] | null | undefined,
  steps: readonly { readonly key: string }[],
): string | null {
  const key = Array.isArray(value) ? value[0] : value;
  if (key === undefined || key === null || key === "") return null;

  return steps.some((step) => step.key === key) ? key : null;
}

/**
 * The address with the stage filter set or cleared, everything else kept.
 *
 * @param search The current query string, `?` and all or none.
 * @param stage The stage to filter to, or `null` to clear the filter.
 * @returns The new query string, `?`-prefixed, or `""` when nothing is left.
 */
export function withStage(search: string, stage: string | null): string {
  const params = new URLSearchParams(search);
  if (stage === null) params.delete(STAGE_PARAM);
  else params.set(STAGE_PARAM, stage);

  const next = params.toString();
  return next === "" ? "" : `?${next}`;
}
