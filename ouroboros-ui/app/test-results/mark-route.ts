/**
 * The Mark & Route card, as data ([#340](https://github.com/NobuData/ouroboros/issues/340)) —
 * mockup 11's classify radios, correction note, PR toggles and routing actions, decided here and
 * drawn by `mark-route-card.tsx`.
 *
 * This is the page's only surface that changes what an agent does next, and three of its elements
 * are claims that have to be earned:
 *
 * **The radio affix is decided by the answer's `actor`, not by copy** (`mark-route-pick.ts`). The
 * mockup prints `AI pick · 84%`; until AV.1 ([#343](https://github.com/NobuData/ouroboros/issues/343))
 * the pre-selection is a deterministic rule's, so the affix reads `heuristic` and names the rule.
 *
 * **The note's promise is proved by a receipt** (`mark-route-decision.ts`). *"Injected into
 * attempt 4's planning context"* is true because the service composes a steer carrying the text;
 * the card shows what was dispatched rather than a toast. The attempt a press *would* open is
 * advice, read from the run console's stages when the page was served ({@link nextAttemptOf}); the
 * receipt's is the service's.
 *
 * **The Block-PR toggle states where enforcement stands** ({@link togglesView}), from the
 * timeline's `activation`: armed, it names the gate that holds the PR; otherwise it says the
 * toggle is a stored intent and when it starts to hold. Decision T8's label, kept true now that
 * the PR plane ([#358](https://github.com/NobuData/ouroboros/issues/358),
 * [#360](https://github.com/NobuData/ouroboros/issues/360)) has shipped.
 *
 * **The card classifies one failure at a time** — the one on the failure-detail card. The service
 * classifies per case and each classification dispatches its own correction round, so a staged
 * failed set is a worklist ({@link worklistView}), never one decision applied to many.
 *
 * This file is the form, the toggles and the staged worklist; the pick and the classes are
 * `mark-route-pick.ts`'s, and the receipt, the recorded decision and the waiver
 * `mark-route-decision.ts`'s.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type {
  Classification,
  FailureClass,
  TestNextStep,
  TestStrip,
} from "@/app/api/test-results";

import { CLASSES, type PickView, classLabel, isCorrection } from "./mark-route-pick";

/** The element id *Send failures back to loop* lands on (#335). */
export const MARK_ROUTE_ID = "mark-route";

/** The card's title — the mockup's `MARK & ROUTE`. */
export const MARK_ROUTE_TITLE = "Mark & Route";

/** What the card says while the attempt's page has not been read. */
export const READING_TARGET = "Reading the failures…";

/** What the card says when the attempt has no failure to decide. */
export const NOTHING_TO_CLASSIFY = "This build has no failure to classify.";

/** The radios' legend — the mockup's label. */
export const CLASSIFY_LEGEND = "Classify this failure";

/** The note's label — the mockup's. */
export const NOTE_LABEL = "Correction note to the loop";

/** The longest note or reason the service stores (V055). */
export const MAX_NOTE_LENGTH = 4096;

/** The waive action — the mockup's. */
export const WAIVE_LABEL = "Waive & annotate PR";

/** The affordance over a recorded decision. */
export const RECLASSIFY_LABEL = "Re-classify";

/** How the form over a recorded decision is left without deciding again. */
export const KEEP_DECISION_LABEL = "Keep the recorded decision";

/** The recorded decision's heading. */
export const RECORDED_EYEBROW = "Recorded decision";

/** The receipt's heading. */
export const RECEIPT_EYEBROW = "Routed receipt";

/** The receipt's accessible name. */
export const RECEIPT_LABEL = "What was dispatched";

/** The staged worklist's accessible name. */
export const STAGED_LABEL = "Staged failures";

/** What the worklist says above its rows. */
export const STAGED_NOTE =
  "Staged from this build's failed set. Each failure is decided on its own — choose one to classify it.";

/** What a staged failure with no failure detail says in place of a button. */
export const STAGED_UNOPENABLE = "reported no failure detail, so it cannot be opened here";

/** Why the form waits while a decision is being sent. */
export const CLASSIFY_SENDING = "The decision is being sent.";

/** Why the primary action waits before a class is chosen. */
export const CLASS_REQUIRED = "Choose what this failure is.";

/** Why the primary action waits while a correction round has no correction. */
export const NOTE_REQUIRED =
  "Write the correction first — a correction round with no correction is not one.";

/** Why a note is refused for its length. */
export const NOTE_TOO_LONG = `The note is longer than ${MAX_NOTE_LENGTH} characters.`;

/** What the card says to a reader who may read decisions and not make them. */
export const VIEWER_NOTE =
  "A viewer can read decisions and cannot make them — ask a member of this workspace.";

/** Why a toggle is read-only for a viewer. */
export const VIEWER_TOGGLE_REASON = "A viewer cannot set this — ask a member of this workspace.";

/** Why a toggle waits while one is being stored. */
export const TOGGLE_SENDING = "The toggle is being stored.";

/** The primary action before any class is chosen. */
export const RECORD_LABEL = "Record decision";

/** The two toggles, by the field each stores. */
export type ToggleField = "blockUntilGreen" | "autoRerunPhysical";

// --- the staged worklist ----------------------------------------------------------------------------

/** A failed set handed to Mark & Route — which attempt it is, and its cases. */
export interface StagedFailures {
  readonly testRunId: string;
  readonly cases: TestStrip["failedCases"];
}

/** One staged failure. */
export interface WorklistRow {
  readonly caseId: string;
  /** `PHYSICAL · HIL rig › overshoot_under_load`. */
  readonly text: string;
  /** What it has been classified as — `Product bug` — or `null` while undecided. */
  readonly decided: string | null;
  /** Whether it is the failure on the card. */
  readonly bound: boolean;
  /**
   * Whether it can be put on the card: `openable` when it has a failure to open, `unopenable`
   * when it reported none, and `unread` while the attempt's page has not said which.
   */
  readonly state: "openable" | "unopenable" | "unread";
}

/**
 * The staged failed set, as a worklist.
 *
 * @param staged The staged set, or `null` when nothing is staged for the attempt on screen.
 * @param openable The ids of the attempt's failures that have a failure to open, or `null`
 *   while the attempt's page has not been read.
 * @param classifications The attempt's current decisions.
 * @param boundCaseId The failure on the card, or `null`.
 * @returns One row per staged case, in the set's order — or `null` when nothing is staged.
 */
export function worklistView(
  staged: StagedFailures | null,
  openable: ReadonlySet<string> | null,
  classifications: readonly Classification[],
  boundCaseId: string | null,
): WorklistRow[] | null {
  if (staged === null) return null;

  return staged.cases.map((each) => {
    const decision = classifications.find((one) => one.testCaseId === each.caseId);

    return {
      caseId: each.caseId,
      text: `${each.suite} › ${each.name}`,
      decided: decision === undefined ? null : classLabel(decision.class),
      bound: each.caseId === boundCaseId,
      state: openable === null ? "unread" : openable.has(each.caseId) ? "openable" : "unopenable",
    };
  });
}

// --- the form ---------------------------------------------------------------------------------------

/** One radio. */
export interface RadioView {
  readonly value: FailureClass;
  readonly label: string;
  readonly checked: boolean;
  /** The pick's affix, on the radio it picked — or `null`. */
  readonly affix: string | null;
  /** Why the rule picked it, as the affix's tooltip — or `null`. */
  readonly affixTitle: string | null;
}

/** The form, decided. */
export interface FormView {
  readonly radios: readonly RadioView[];
  /** The class the radios hold — the reader's choice, else the pick's — or `null`. */
  readonly selected: FailureClass | null;
  /** Whether the selected class carries a note. */
  readonly noteRequired: boolean;
  /** What the note says beneath it. */
  readonly noteHint: string;
  /** What is wrong with the note as typed, or `null`. */
  readonly noteError: string | null;
  /** The primary action's words. */
  readonly primary: string;
  /** Why the primary action waits, or `null` when it can be pressed. */
  readonly reason: string | null;
}

/**
 * What the note says beneath it.
 *
 * @param selected The selected class, or `null`.
 * @param nextAttempt The attempt a correction round would open, or `null` when unknown.
 * @returns The mockup's *Injected into attempt 4's planning context.* for a correction round; what
 *   the note is kept with for the two classes that do not queue one.
 */
export function noteHint(selected: FailureClass | null, nextAttempt: number | null): string {
  if (selected === "flake_retry") return "Optional — kept with the decision.";
  if (selected === "infra_rig") return "Optional — written on the rig's runner as its health note.";

  return nextAttempt === null
    ? "Injected into the next attempt's planning context."
    : `Injected into attempt ${nextAttempt}'s planning context.`;
}

/**
 * The primary action's words.
 *
 * @param selected The selected class, or `null`.
 * @param nextAttempt The attempt a correction round would open, or `null` when unknown.
 * @returns What pressing it does — the mockup's *Queue correction round → attempt 4* for the two
 *   classes that queue one, and each other route in its own words.
 */
export function primaryLabel(selected: FailureClass | null, nextAttempt: number | null): string {
  if (selected === null) return RECORD_LABEL;
  if (selected === "flake_retry") return "Mark as flake & re-run the case";
  if (selected === "infra_rig") return "Flag the rig's runner";

  return nextAttempt === null
    ? "Queue correction round"
    : `Queue correction round → attempt ${nextAttempt}`;
}

/**
 * The form.
 *
 * @param input.pick What pre-selects a radio.
 * @param input.chosen The radio the reader pressed, or `null` while they have pressed none.
 * @param input.note The note as typed.
 * @param input.nextAttempt The attempt a correction round would open, or `null`.
 * @param input.sending Whether a decision is in flight.
 * @returns The radios, the note's hint and what is wrong with it, and the primary action with
 *   the reason it waits.
 */
export function formView(input: {
  readonly pick: PickView;
  readonly chosen: FailureClass | null;
  readonly note: string;
  readonly nextAttempt: number | null;
  readonly sending: boolean;
}): FormView {
  const { pick, chosen, note, nextAttempt, sending } = input;
  const picked = pick.kind === "none" ? null : pick.class;
  const selected = chosen ?? picked;
  const noteRequired = isCorrection(selected);
  const noteError = note.length > MAX_NOTE_LENGTH ? NOTE_TOO_LONG : null;

  return {
    radios: CLASSES.map((each) => ({
      value: each.value,
      label: each.label,
      checked: each.value === selected,
      affix: pick.kind !== "none" && each.value === picked ? pick.affix : null,
      affixTitle: pick.kind === "heuristic" && each.value === picked ? pick.reason : null,
    })),
    selected,
    noteRequired,
    noteHint: noteHint(selected, nextAttempt),
    noteError,
    primary: primaryLabel(selected, nextAttempt),
    reason: sending
      ? CLASSIFY_SENDING
      : selected === null
        ? CLASS_REQUIRED
        : noteRequired && note.trim() === ""
          ? NOTE_REQUIRED
          : noteError,
  };
}

// --- the toggles ------------------------------------------------------------------------------------

/** One toggle's row. */
export interface ToggleView {
  readonly field: ToggleField;
  /** The row's words — the mockup's `Block PR #514 until green`. */
  readonly text: string;
  /** The switch's accessible name: what pressing it would do. */
  readonly label: string;
  readonly checked: boolean;
  /** Why it cannot be pressed, or `null`. */
  readonly reason: string | null;
  /** Where enforcement stands — the tooltip, and the switch's description. */
  readonly note: string;
}

/**
 * The Block-PR row's words.
 *
 * @param next The timeline's next step.
 * @returns `Block PR #514 until green`, or without the number before the run has opened a PR.
 */
export function blockText(next: Pick<TestNextStep, "pullRequest">): string {
  return next.pullRequest === null
    ? "Block PR until green"
    : `Block PR #${next.pullRequest.number} until green`;
}

/**
 * Where the Block-PR toggle's enforcement stands — decision T8's label.
 *
 * @param next The timeline's next step.
 * @returns For an armed gate, the gate that holds the PR and where it comes from; otherwise that
 *   the toggle is a stored intent, and the point at which it starts to hold.
 */
export function activationNote(
  next: Pick<TestNextStep, "activation" | "pullRequest" | "gate">,
): string {
  if (next.activation === "gate_armed" && next.pullRequest !== null) {
    const source = next.gate === null ? "" : ` (${next.gate.source})`;

    return `Enforced now: PR #${next.pullRequest.number}'s test-suite gate is required${source}, and the merge re-checks it.`;
  }

  return next.pullRequest === null
    ? "Stored as an intent. Enforcement activates with the PR plane: once this run opens a pull request, its test-suite gate becomes required."
    : `Stored as an intent. Enforcement activates with the PR plane: PR #${next.pullRequest.number}'s test-suite gate becomes required when its gates are next evaluated.`;
}

/** Where the auto re-run toggle stands: stored, and acted on by nothing yet (#332). */
export const AUTO_RERUN_NOTE =
  "Stored as an intent. Nothing re-runs the physical suite on its own yet — use Re-run failed or Re-run full suite.";

/**
 * The two toggles.
 *
 * @param input.next The timeline's next step — the stored values, and where enforcement stands.
 * @param input.held A value just set and not yet on the timeline, by field; it is drawn until
 *   the timeline agrees.
 * @param input.mayClassify Whether the reader may set them — owner, admin or member.
 * @param input.sending Whether a toggle is being stored.
 * @returns *Block PR until green* and *Auto re-run physical suite after fix*, in the mockup's
 *   order — drawn read-only, never hidden, for a reader who may not set them.
 */
export function togglesView(input: {
  readonly next: TestNextStep;
  readonly held: Partial<Record<ToggleField, boolean>>;
  readonly mayClassify: boolean;
  readonly sending: boolean;
}): ToggleView[] {
  const { next, held, mayClassify, sending } = input;
  const reason = !mayClassify ? VIEWER_TOGGLE_REASON : sending ? TOGGLE_SENDING : null;
  const block = held.blockUntilGreen ?? next.intents.blockUntilGreen;
  const rerun = held.autoRerunPhysical ?? next.intents.autoRerunPhysical;
  const blockWords = blockText(next);
  const rerunWords = "Auto re-run physical suite after fix";

  return [
    {
      field: "blockUntilGreen",
      text: blockWords,
      label: `${block ? "Switch off" : "Switch on"}: ${blockWords}`,
      checked: block,
      reason,
      note: activationNote(next),
    },
    {
      field: "autoRerunPhysical",
      text: rerunWords,
      label: `${rerun ? "Switch off" : "Switch on"}: ${rerunWords}`,
      checked: rerun,
      reason,
      note: AUTO_RERUN_NOTE,
    },
  ];
}

// --- the attempt a correction round would open ------------------------------------------------------

/** A run stage, as far as {@link nextAttemptOf} reads it. */
export interface StageAttempt {
  readonly status: string;
  /** The stage's current attempt — the `2` of `attempt 2/3`. */
  readonly attempt: number;
  /** When its latest attempt started, or `null`. */
  readonly startedAt: string | null;
}

/** The stage statuses a correction round can retry (#332's `currentStage`). */
const RETRIABLE = ["active", "failed", "succeeded"];

/**
 * The attempt a correction round would open, as far as the run's stages say — the `4` of
 * *Queue correction round → attempt 4*. Advice for the label; the receipt's is the service's.
 *
 * @param stages The run's stages, or `null` when they could not be read.
 * @returns One more than the attempt of the stage the service would retry — the active stage, or
 *   else the one that started most recently — or `null` when no stage has started or the stages
 *   are not known.
 */
export function nextAttemptOf(stages: readonly StageAttempt[] | null): number | null {
  const started = (stages ?? []).filter((stage) => RETRIABLE.includes(stage.status));
  if (started.length === 0) return null;

  const active = started.find((stage) => stage.status === "active");
  const current =
    active ??
    started.reduce((latest, stage) => (startedMs(stage) > startedMs(latest) ? stage : latest));

  return current.attempt + 1;
}

/**
 * When a stage's latest attempt started, for ordering.
 *
 * @param stage The stage.
 * @returns Epoch milliseconds — or `-Infinity` for a stage that states no start, so any stage
 *   that does is later.
 */
function startedMs(stage: StageAttempt): number {
  const at = Date.parse(stage.startedAt ?? "");

  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
}
