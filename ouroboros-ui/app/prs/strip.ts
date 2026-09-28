/**
 * The revision cycle strip, as data ([#364](https://github.com/NobuData/ouroboros/issues/364)) —
 * mockup 12's `publish → verify → correct → re-publish`, decided here and drawn by
 * `revision-strip.tsx`; the gates it scopes are `gates.ts`'s.
 *
 * ```
 * [Revision 1 · err] → [Correction round · attempt 4] → [● Revision 2 · live] → [╌ Auto-merge]
 *   pr_revisions +        the classification that         pr_revisions +         the merge plan
 *   its red gates         bridged the two (#332)          its snapshot           (#355, #360)
 * ```
 *
 * **Every step is a join (decision V4); none is prose.** A revision's blocking reason is composed
 * from the gates that are red in *its own* snapshot. The correction step exists only when a
 * classification or a loop return bridged the two revisions, and its model pill only when the
 * classification's provenance is a model. The future step is the merge plan's strategy and the
 * loop's policy — dashed while it is what *would* happen, armed once it is what *will*.
 *
 * **The strip is also navigation.** A revision step scopes the gates to that revision's snapshot,
 * and the address carries the scope ({@link PR_REVISION_PARAM}) so the view is linkable.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type {
  PrGateRow,
  PrRevision,
  PullRequestPage,
  PullRequestState,
} from "@/app/api/pull-requests";
import { PR_REVISION_PARAM } from "@/app/paths";
import { clockOf } from "@/app/test-results/timeline";

/** The card's title — the mockup's `REVISION CYCLE`. */
export const STRIP_TITLE = "Revision cycle";

/** The card's tag — the loop the strip draws. */
export const STRIP_TAG = "publish → verify → correct → re-publish";

/** What the strip says before the first push was recorded. */
export const NO_REVISIONS = "No revision has been recorded for this PR yet.";

/** What a scoped revision step says, in words — the hue is never the only signal. */
export const SCOPED_HERE = "gates scoped here";

/** A snapshot's summary when the revision was never evaluated. */
export const NOT_EVALUATED = "not evaluated";

/** The correction step's name. */
export const CORRECTION_LABEL = "Correction round";

/** What the future step is conditional on. */
export const ON_ALL_GREEN = "on all gates green";

/** How many red gates a blocking reason names before it counts the rest. */
export const NAMED_GATES = 2;

/** How many characters of a sha the strip prints — the mockup's `3f9c2ae`. */
export const SHORT_SHA = 7;

// --- the snapshot --------------------------------------------------------------------------

/**
 * The gates blocking a revision — red *and* required, in the card's order.
 *
 * @param revision The revision.
 * @returns The blocking rows of its own snapshot; empty when none is red or it was never
 *   evaluated. A red gate the policy does not require blocks nothing, so it is left out.
 */
export function blockingGates(revision: PrRevision): readonly PrGateRow[] {
  return revision.gates.rows.filter((row) => row.required && row.verdict === "red");
}

/**
 * A revision's blocking reason, composed from its red gates — never a stored sentence.
 *
 * @param gates The blocking gates, from {@link blockingGates}.
 * @returns `blocked: Test suite, Physical HIL ✗`, naming at most {@link NAMED_GATES} and counting
 *   the rest (`+2 more`); `null` when nothing blocks.
 */
export function blockingReason(gates: readonly PrGateRow[]): string | null {
  if (gates.length === 0) return null;

  const named = gates.slice(0, NAMED_GATES).map((gate) => gate.label);
  const rest = gates.length - named.length;

  return `blocked: ${named.join(", ")}${rest > 0 ? ` +${rest} more` : ""} ✗`;
}

/**
 * A snapshot's summary, from the payload's aggregate.
 *
 * @param revision The revision.
 * @returns `2 gates red` while a required gate is red, otherwise `5/7 gates green`;
 *   {@link NOT_EVALUATED} for a revision with no aggregate.
 */
export function snapshotSummary(revision: PrRevision): string {
  const aggregate = revision.gates.aggregate;
  if (aggregate === null) return NOT_EVALUATED;

  if (aggregate.redCount > 0) {
    return `${aggregate.redCount} gate${aggregate.redCount === 1 ? "" : "s"} red`;
  }

  return `${aggregate.greenCount}/${aggregate.requiredCount} gates green`;
}

/**
 * A sha, shortened.
 *
 * @param sha The head sha.
 * @returns Its first {@link SHORT_SHA} characters.
 */
export function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA);
}

// --- the steps -----------------------------------------------------------------------------

/** How a revision step is drawn. */
export type RevisionTreatment =
  /** Its snapshot has a red required gate. */
  | "err"
  /** The current revision, while verification runs. */
  | "live"
  /** Neither — a superseded revision, or one nothing is running on. */
  | "plain";

/** One revision of the strip. */
export interface RevisionStep {
  readonly kind: "revision";
  /** The revision's id — the step's key. */
  readonly id: string;
  /** Its ordinal — what the address carries. */
  readonly seq: number;
  readonly treatment: RevisionTreatment;
  /** `Revision 1 · 14:10 — blocked: Test suite, Physical HIL ✗`. */
  readonly label: string;
  /** `3f9c2ae · 2 gates red`. */
  readonly meta: string;
  /** Whether it is the latest revision — the one scrolled into view. */
  readonly latest: boolean;
}

/** The correction that bridged two revisions. */
export interface CorrectionStep {
  readonly kind: "correction";
  /** The step's key. */
  readonly id: string;
  /** `Correction round · attempt 4`. */
  readonly label: string;
  /** The classification's note, or what was returned to the loop; `null` when neither says. */
  readonly note: string | null;
  /** The model's name — only when the classification's provenance is a model. */
  readonly model: string | null;
}

/** What has not happened yet — the merge the plan describes. */
export interface FutureStep {
  readonly kind: "future";
  /** The step's key. */
  readonly id: string;
  /** `ghosted` for what would happen, `armed` for what will. */
  readonly treatment: "ghosted" | "armed";
  /** `Auto-merge (squash)`, and `— armed` once it is. */
  readonly label: string;
  /** `on all gates green · policy: standard-fix`. */
  readonly meta: string;
}

/** Any step of the strip. */
export type StripStep = RevisionStep | CorrectionStep | FutureStep;

/**
 * Whether verification can still be running on a PR.
 *
 * @param state The PR's state.
 * @returns `true` for `verifying` and `armed` — the states in which the current revision is live.
 */
function verificationRuns(state: PullRequestState): boolean {
  return state === "verifying" || state === "armed";
}

/**
 * What a revision is doing, said after its time.
 *
 * @param treatment How the revision is drawn.
 * @param revision The revision.
 * @param state The PR's state.
 * @param latest Whether it is the latest revision.
 * @returns The blocking reason for an `err` step; `pushed, re-verification running` for a live
 *   one that followed a correction and `pushed, verification running` for a live first push;
 *   otherwise `pushed`, with `verification has not started` on the latest revision of an `open`
 *   PR.
 */
function revisionStatus(
  treatment: RevisionTreatment,
  revision: PrRevision,
  state: PullRequestState,
  latest: boolean,
): string {
  if (treatment === "err") return blockingReason(blockingGates(revision)) ?? "blocked";

  if (treatment === "live") {
    return revision.correction === null
      ? "pushed, verification running"
      : "pushed, re-verification running";
  }

  return latest && state === "open" ? "pushed, verification has not started" : "pushed";
}

/**
 * One revision's step.
 *
 * @param revision The revision.
 * @param state The PR's state.
 * @param latest Whether it is the latest revision.
 * @returns The step: `err` when its own snapshot has a red required gate, `live` when it is the
 *   latest while verification runs, otherwise `plain`.
 */
export function revisionStep(
  revision: PrRevision,
  state: PullRequestState,
  latest: boolean,
): RevisionStep {
  const treatment: RevisionTreatment =
    blockingGates(revision).length > 0
      ? "err"
      : latest && verificationRuns(state)
        ? "live"
        : "plain";
  const clock = clockOf(revision.pushedAt, false);
  const name = `Revision ${revision.seq}${clock === null ? "" : ` · ${clock}`}`;

  return {
    kind: "revision",
    id: revision.id,
    seq: revision.seq,
    treatment,
    label: `${name} — ${revisionStatus(treatment, revision, state, latest)}`,
    meta: `${shortSha(revision.headSha)} · ${snapshotSummary(revision)}`,
    latest,
  };
}

/**
 * The correction that led to a revision.
 *
 * @param revision The revision the correction produced.
 * @param model The loop's model, or `null` for a PR no loop opened.
 * @returns The step, or `null` when nothing recorded bridged the two revisions — a push nobody
 *   classified and no loop return preceded is not called a correction. The attempt is the one the
 *   revision was judged on, else the stage attempt its push is linked to. The model is named only
 *   when the classification's actor is `model`.
 */
export function correctionStep(revision: PrRevision, model: string | null): CorrectionStep | null {
  const correction = revision.correction;
  if (correction === null) return null;

  const { classification, loopReturn } = correction;
  if (classification === null && loopReturn === null) return null;

  const attempt = revision.testAttempt?.attemptSeq ?? revision.stageAttempt?.attempt ?? null;
  const returned =
    loopReturn === null
      ? null
      : `returned to the loop with ${loopReturn.gateKeys.length} ` +
        `gate${loopReturn.gateKeys.length === 1 ? "" : "s"}`;

  return {
    kind: "correction",
    id: `correction-${revision.id}`,
    label: attempt === null ? CORRECTION_LABEL : `${CORRECTION_LABEL} · attempt ${attempt}`,
    note: classification?.note ?? returned,
    model: classification?.actor === "model" ? model : null,
  };
}

/**
 * The step that has not happened — the merge the plan describes.
 *
 * @param page The PR page.
 * @returns The step: `armed` while the plan is armed, otherwise `ghosted`; `null` for a merged or
 *   closed PR, which has no future merge to promise.
 */
export function futureStep(page: PullRequestPage): FutureStep | null {
  const { state, run } = page.pullRequest;
  if (state === "merged" || state === "closed") return null;

  const armed = page.plan.armed;
  const merge = `Auto-merge (${page.plan.strategy})`;

  return {
    kind: "future",
    id: "future",
    treatment: armed ? "armed" : "ghosted",
    label: armed ? `${merge} — armed` : merge,
    meta: run === null ? ON_ALL_GREEN : `${ON_ALL_GREEN} · policy: ${run.workflowTag}`,
  };
}

/**
 * The whole strip for one PR.
 *
 * @param page The PR page.
 * @returns Its steps, oldest first: each revision, preceded by the correction that led to it when
 *   one was recorded, and the future step last. Empty before the first revision.
 */
export function stripSteps(page: PullRequestPage): readonly StripStep[] {
  const { revisions } = page;
  if (revisions.length === 0) return [];

  const { state, run } = page.pullRequest;
  const steps: StripStep[] = [];

  revisions.forEach((revision, index) => {
    const correction = correctionStep(revision, run?.model ?? null);

    if (correction !== null) steps.push(correction);
    steps.push(revisionStep(revision, state, index === revisions.length - 1));
  });

  const future = futureStep(page);
  if (future !== null) steps.push(future);

  return steps;
}

// --- the scope -----------------------------------------------------------------------------

/**
 * The revision an address names.
 *
 * @param value `?rev=`, as the router states it.
 * @returns The ordinal, or `null` when the parameter is absent, repeated or not a positive
 *   integer — the page then follows the latest revision.
 */
export function revisionParam(value: string | readonly string[] | undefined): number | null {
  if (typeof value !== "string" || !/^[1-9]\d{0,8}$/.test(value)) return null;

  return Number(value);
}

/**
 * The revision the gates are scoped to.
 *
 * @param page The PR page.
 * @param scoped The ordinal the reader chose, or `null` to follow the latest.
 * @returns The chosen revision, or `null` when none was chosen or the PR has no such revision.
 */
export function scopedRevision(page: PullRequestPage, scoped: number | null): PrRevision | null {
  if (scoped === null) return null;

  return page.revisions.find((revision) => revision.seq === scoped) ?? null;
}

/**
 * The address with `?rev=` set or removed, everything else kept.
 *
 * @param search The current query, `?…` or empty.
 * @param scoped The scoped revision's ordinal, or `null` for none.
 * @returns The new query, with its `?` — or empty when nothing is left to say.
 */
export function withRevision(search: string, scoped: number | null): string {
  const query = new URLSearchParams(search);

  if (scoped === null) query.delete(PR_REVISION_PARAM);
  else query.set(PR_REVISION_PARAM, String(scoped));

  const next = query.toString();

  return next === "" ? "" : `?${next}`;
}

/** Where a step sits against the strip's scrolling wrapper, in the viewport's own units. */
export interface StripGeometry {
  /** How far the wrapper is scrolled. */
  readonly scrollLeft: number;
  /** The wrapper's left edge. */
  readonly viewLeft: number;
  /** The wrapper's visible width. */
  readonly viewWidth: number;
  /** The step's left edge. */
  readonly stepLeft: number;
  /** The step's width. */
  readonly stepWidth: number;
}

/**
 * Where to scroll the wrapper so a step is in view — the wrapper alone, never the pane.
 *
 * @param geometry See {@link StripGeometry}.
 * @returns The wrapper's new `scrollLeft`: unchanged when the step is already wholly visible;
 *   otherwise the least movement that shows it, leading edge first when the step is wider than
 *   the wrapper. Never negative.
 */
export function scrollTarget(geometry: StripGeometry): number {
  const { scrollLeft, viewLeft, viewWidth, stepLeft, stepWidth } = geometry;
  const offset = stepLeft - viewLeft;

  if (offset >= 0 && offset + stepWidth <= viewWidth) return scrollLeft;

  const leading = scrollLeft + offset;
  if (offset < 0 || stepWidth >= viewWidth) return Math.max(0, leading);

  return Math.max(0, leading - (viewWidth - stepWidth));
}

// --- the gates' scope ----------------------------------------------------------------------

/** The gates on screen, and whose they are — what `gates.ts` draws the card from (#365). */
export interface GatesScope {
  /** The revision's ordinal. */
  readonly seq: number;
  /** Whether the reader chose it — `false` while the page follows the latest. */
  readonly scoped: boolean;
  /** Whether it is the PR's latest revision — the only one an approval can be given on. */
  readonly latest: boolean;
  /** `Revision 1 · 3f9c2ae · 2 gates red`. */
  readonly heading: string;
  /** The revision, with its own snapshot and the attempt it was judged on. */
  readonly revision: PrRevision;
  /** The revision's own rows, in the card's order. */
  readonly rows: readonly PrGateRow[];
}

/**
 * The gates the page shows.
 *
 * @param page The PR page.
 * @param scoped The ordinal the reader chose, or `null` to follow the latest.
 * @returns The chosen revision's snapshot — its rows as they were, not today's — or the latest
 *   revision's when none was chosen or the choice names no revision; `null` before the first
 *   revision.
 */
export function gatesScope(page: PullRequestPage, scoped: number | null): GatesScope | null {
  const chosen = scopedRevision(page, scoped);
  const latest = page.revisions.at(-1) ?? null;
  const revision = chosen ?? latest;
  if (revision === null || latest === null) return null;

  return {
    seq: revision.seq,
    scoped: chosen !== null,
    latest: revision.id === latest.id,
    revision,
    heading:
      `Revision ${revision.seq} · ${shortSha(revision.headSha)} · ${snapshotSummary(revision)}`,
    rows: revision.gates.rows,
  };
}
