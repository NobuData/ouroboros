/**
 * The build attempts timeline, as data ([#336](https://github.com/NobuData/ouroboros/issues/336))
 * — mockup 11's err → warn → live → future strip, decided here and drawn by
 * `attempts-timeline.tsx`.
 *
 * **It formats; it derives nothing**, like `view.ts`: a card's counts are the attempt's strip, its
 * hue is `view.ts`'s pass-ratio rule, and the *Next* card is the payload's next-step projection
 * (AT.5, [#333](https://github.com/NobuData/ouroboros/issues/333)).
 *
 * **The *Next* card is honest about what is built** (decision **T8**). It names a pull request
 * only when the projection says one is linked *and* its gate is armed ({@link futureCard});
 * otherwise it prints the gate alone, with a note saying when PR publishing activates.
 *
 * **A sha links only when its source can build the URL** — `commitUrl`'s rule, for a GitHub,
 * GitLab or Bitbucket source alike; otherwise it is plain text rather than a guessed link.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type { TestAttempt, TestRunTimeline } from "@/app/api/test-results";
import { type CommitSource, commitUrl } from "@/app/runs/cards";

import { PASS_RATIO_WARN_FLOOR, buildLabel } from "./view";

/** The card's title — the mockup's `BUILD ATTEMPTS`. */
export const TIMELINE_TITLE = "Build attempts";

/** The strip's accessible name: the list of cards. */
export const TIMELINE_LIST_LABEL = "Build attempts, oldest first";

/** The future card's label. */
export const NEXT_LABEL = "Next";

/** The note the honest *Next* card carries while no PR gate holds the publish (T8). */
export const PR_PLANE_NOTE = "PR publishing activates with the PR plane";

/** The same note when *Block PR until green* is stored and waiting for a PR to hold. */
export const INTENT_STORED_NOTE = `Block PR until green is stored · ${PR_PLANE_NOTE}`;

/** What a running attempt is doing, by what it was asked to run. */
export const ACTIVITY: Readonly<Record<"failed" | "full" | "build", string>> = {
  failed: "running re-run of failed set",
  full: "running full re-run",
  build: "running tests",
};

/** How many characters of a sha are printed — the mockup's `a3f19c2`. */
export const SHORT_SHA_LENGTH = 7;

/** How a card is coloured: the three verdicts, the live build, and one with nothing to judge. */
export type AttemptTone = "err" | "warn" | "ok" | "live" | "neutral";

/** One attempt's card, ready to draw. */
export interface AttemptCardView {
  /** The attempt's id — the card's key. */
  readonly id: string;
  /** The ordinal a click selects. */
  readonly attemptSeq: number;
  /** `Build 1`. */
  readonly label: string;
  /** `49/63 · 14 failed ✗`, or what a running build is doing. */
  readonly result: string;
  readonly tone: AttemptTone;
  /** `13:52:41`, in UTC, or `null` for a start that is not a date. */
  readonly time: string | null;
  /** The start as reported, for the `<time>` element. */
  readonly startedAt: string;
  /** The sha, abbreviated, and its link; `null` when the attempt names no commit. */
  readonly commit: { readonly shortSha: string; readonly href: string | null } | null;
  /** Whether this is the attempt the page reads. */
  readonly selected: boolean;
}

/** The dashed *Next* card, ready to draw. */
export interface FutureCardView {
  /** `activated` names the PR; `honest` does not (T8). */
  readonly variant: "activated" | "honest";
  /** `Publish to PR #514 when green`, or `auto · gated on 63/63`. */
  readonly result: string;
  /** The line under it: the gate when activated, the activation note when honest. */
  readonly meta: string;
}

/** The whole card, ready to draw. */
export interface TimelineView {
  /** `branch loop/482-canbus-flake`, or `null` for a run with no branch. */
  readonly branch: string | null;
  /** `loop #1847 · started 13:50 UTC`. */
  readonly loop: string;
  readonly attempts: readonly AttemptCardView[];
  readonly next: FutureCardView;
}

/**
 * A number, two digits wide.
 *
 * @param value The number.
 * @returns `07`.
 */
function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * A moment's time of day, in UTC — the zone the service reports in, so the server's render and
 * the browser's agree and two readers compare the same digits.
 *
 * @param iso The moment, as the payload states it.
 * @param seconds Whether to print seconds. Defaults to `true`.
 * @returns `13:52:41` or `13:52`; `null` for a value that is not a date.
 */
export function clockOf(iso: string, seconds = true): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;

  const minutes = `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;

  return seconds ? `${minutes}:${pad(at.getUTCSeconds())}` : minutes;
}

/**
 * How an attempt's card is coloured.
 *
 * @param attempt The attempt.
 * @returns `live` while it runs, `err` when the build itself errored, `neutral` when it reported
 *   no case, and otherwise the pass-ratio rule the head's pill uses: `ok` at 100 %, `warn` at or
 *   above {@link PASS_RATIO_WARN_FLOOR}, `err` below it.
 */
export function attemptTone(attempt: TestAttempt): AttemptTone {
  const { passed, total } = attempt.strip;

  if (attempt.status === "running") return "live";
  if (attempt.status === "error") return "err";
  if (total === 0) return "neutral";
  if (passed === total) return "ok";

  return passed / total >= PASS_RATIO_WARN_FLOOR ? "warn" : "err";
}

/**
 * An attempt's result line.
 *
 * @param attempt The attempt.
 * @returns What a running build is doing; `49/63 · 14 failed ✗` (the `✗` on an `err` card only),
 *   `63/63 · all passed ✓`; or that nothing was reported.
 */
export function attemptResult(attempt: TestAttempt): string {
  const { passed, total, failed } = attempt.strip;

  if (attempt.status === "running") return ACTIVITY[attempt.selection ?? "build"];
  if (total === 0) {
    return attempt.status === "error" ? "errored before reporting ✗" : "no cases reported";
  }
  if (attempt.status !== "error" && passed === total) return `${passed}/${total} · all passed ✓`;

  const counts = `${passed}/${total} · ${failed} failed`;

  return attemptTone(attempt) === "err" ? `${counts} ✗` : counts;
}

/**
 * One attempt's card.
 *
 * @param attempt The attempt.
 * @param selected The ordinal the page reads.
 * @param source Where the run's commits live, or `null` when nothing can build a commit's URL.
 * @returns The card.
 */
export function attemptCard(
  attempt: TestAttempt,
  selected: number,
  source: CommitSource | null,
): AttemptCardView {
  const sha = attempt.commitSha;

  return {
    id: attempt.id,
    attemptSeq: attempt.attemptSeq,
    label: buildLabel(attempt.attemptSeq),
    result: attemptResult(attempt),
    tone: attemptTone(attempt),
    time: clockOf(attempt.startedAt),
    startedAt: attempt.startedAt,
    commit:
      sha === null || sha === ""
        ? null
        : { shortSha: sha.slice(0, SHORT_SHA_LENGTH), href: commitUrl(source, sha) },
    selected: attempt.attemptSeq === selected,
  };
}

/**
 * The gate line — the mockup's `auto · gated on 63/63`.
 *
 * @param gatedOn The count the gate waits for, or `null` before any attempt has reported.
 * @returns The line; without a count, `auto · gated on a green build`.
 */
export function gateLine(gatedOn: TestRunTimeline["next"]["gatedOn"]): string {
  return gatedOn === null
    ? "auto · gated on a green build"
    : `auto · gated on ${gatedOn.passed}/${gatedOn.total}`;
}

/**
 * The *Next* card, in its honest or activated variant (decision **T8**).
 *
 * **Activated** only when the projection names a linked pull request *and* says its gate is
 * armed: the card then reads as the mockup does. In every other state — no PR, an intent stored
 * with nothing to hold, or neither — no PR number is printed for a gate nobody holds: the card
 * prints the gate, and the note says when publishing activates.
 *
 * @param next The payload's next-step projection.
 * @returns The card.
 */
export function futureCard(next: TestRunTimeline["next"]): FutureCardView {
  const gate = gateLine(next.gatedOn);

  if (next.activation === "gate_armed" && next.pullRequest !== null) {
    return {
      variant: "activated",
      result: `Publish to PR #${next.pullRequest.number} when green`,
      meta: gate,
    };
  }

  return {
    variant: "honest",
    result: gate,
    meta: next.activation === "intent_stored" ? INTENT_STORED_NOTE : PR_PLANE_NOTE,
  };
}

/**
 * The timeline for one run.
 *
 * @param timeline The run's timeline.
 * @param selected The ordinal the page reads.
 * @param source Where the run's commits live, or `null`.
 * @returns The card: its head, one card per attempt oldest first, and the *Next* card.
 */
export function timelineView(
  timeline: TestRunTimeline,
  selected: number,
  source: CommitSource | null,
): TimelineView {
  const { run } = timeline;
  const started = clockOf(run.startedAt, false);

  return {
    branch: run.branch === null || run.branch === "" ? null : `branch ${run.branch}`,
    loop: started === null ? `loop #${run.loopSeq}` : `loop #${run.loopSeq} · started ${started} UTC`,
    attempts: timeline.attempts.map((attempt) => attemptCard(attempt, selected, source)),
    next: futureCard(timeline.next),
  };
}

/** A box along the strip's scroll axis. */
export interface Extent {
  /** Its leading edge, measured from the strip's own content edge. */
  readonly start: number;
  /** Its width. */
  readonly size: number;
}

/**
 * Where the strip must scroll to for a card to be in view.
 *
 * @param card The card, within the strip's content.
 * @param scrolled How far the strip is scrolled now.
 * @param viewport The strip's visible width.
 * @returns The scroll offset that brings the whole card in — its leading edge when the card is
 *   before the view or wider than it, its trailing edge when it is after — or `null` when the
 *   card is already wholly visible, so a reader's own scroll position is left alone.
 */
export function scrollToReveal(card: Extent, scrolled: number, viewport: number): number | null {
  const end = card.start + card.size;

  if (card.start >= scrolled && end <= scrolled + viewport) return null;
  if (card.start < scrolled || card.size > viewport) return Math.max(0, card.start);

  return Math.max(0, end - viewport);
}
