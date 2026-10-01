/**
 * The *What Happens Next* card's data — a projection, and labelled as one
 * ([#388](https://github.com/NobuData/ouroboros/issues/388), BB.5, decisions **O7**, **O8**).
 *
 * The card is drawn before the first loop has run, so nothing on it can have been measured.
 * Every row therefore carries `kind: "projected"`, the only number on it is the picked issue's
 * own estimate (the first-issue card's `est. 4 min`), and no figure is an average across teams —
 * the mockup's *"Average first-loop time across teams: 4m 10s"* has no counterpart here.
 *
 * The same projection serves the card before launch (`GET /api/v1/onboarding/defaults`) and the
 * receipt after it (`POST /api/v1/onboarding/launch`). BD.1 (#396) replaces it with run telemetry
 * when execution exists.
 *
 * Pure.
 */

import { loopMinutesOf } from "./first-issue.score";

/** How a timeline row is known. Only one value: nothing here is measured. */
export const PROJECTED = "projected";

/** A timeline row's place. */
export type TimelineRowKey =
  "loop_starts" | "plan_posted" | "draft_pr_opens" | "you_review" | "merge";

/** One row of *What Happens Next*. */
export interface TimelineRowResource {
  readonly key: TimelineRowKey;
  /** Who acts: the loop, or the person. */
  readonly actor: "loop" | "you";
  /** The row's sentence. */
  readonly text: string;
  /** Always `projected` — the label the card must draw. */
  readonly kind: typeof PROJECTED;
  /**
   * Minutes after the loop starts, where this issue's own estimate gives one; `null` otherwise.
   * Never a measured or cross-team figure.
   */
  readonly atMinutes: number | null;
}

/** The *What Happens Next* card's data. */
export interface TimelineResource {
  /** Always `projected`: the whole card is a projection. */
  readonly kind: typeof PROJECTED;
  /** Where the one number comes from, or `none` when the issue carries no estimate. */
  readonly basis: "issue_estimate" | "none";
  /** Whether the review and merge rows were written for an active dry-run policy. */
  readonly dryRun: boolean;
  readonly rows: readonly TimelineRowResource[];
}

/** What the timeline is projected from. */
export interface TimelineFacts {
  /** `#488`, or null when no issue is picked yet. */
  readonly issueKey: string | null;
  /** The picked issue's estimate cycle range, in minutes, or null when it has none. */
  readonly cycle: { readonly min: number; readonly max: number } | null;
  /** Whether dry-run is (or, before launch, will be) active for the loop. */
  readonly dryRun: boolean;
}

/**
 * Project *What Happens Next* for one issue.
 *
 * @param facts - The issue, its estimate's cycle range, and the dry-run state.
 * @returns Five rows, each labelled `projected`. The draft-PR row carries the estimate's printed
 *   minutes — the same number the first-issue card prints — and no other row carries a time
 *   beyond the origin.
 */
export function projectTimeline(facts: TimelineFacts): TimelineResource {
  const subject = facts.issueKey ?? "your first issue";
  const loopMinutes = facts.cycle === null ? null : loopMinutesOf(facts.cycle.min, facts.cycle.max);
  const row = (
    key: TimelineRowKey,
    actor: TimelineRowResource["actor"],
    text: string,
    atMinutes: number | null = null,
  ): TimelineRowResource => ({ key, actor, text, kind: PROJECTED, atMinutes });

  return {
    kind: PROJECTED,
    basis: loopMinutes === null ? "none" : "issue_estimate",
    dryRun: facts.dryRun,
    rows: [
      row("loop_starts", "loop", `loop starts on ${subject}`, 0),
      row("plan_posted", "loop", "draft plan posted to the issue"),
      row(
        "draft_pr_opens",
        "loop",
        facts.dryRun ? "draft PR opens" : "pull request opens",
        loopMinutes,
      ),
      row("you_review", "you", "you review"),
      facts.dryRun
        ? row("merge", "you", "merge — only when you say so; dry-run never merges")
        : row("merge", "loop", "merge — as the workflow's final step decides"),
    ],
  };
}
