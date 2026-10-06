/**
 * The right column's words and pure rules (BC.5,
 * [#394](https://github.com/NobuData/ouroboros/issues/394), mockup 13's *"Smart Defaults"*
 * card, *"What Happens Next"* timeline and the reassure strip).
 *
 * **Three cards, three ways the page could quietly lie, and each has a rule here.**
 *
 * - **The defaults card draws the rows the service selected, and only those** (decision **O6**).
 *   BB.5 (#388) picks the row set from the deployment's declared capabilities — a self-hosted
 *   install gets *bring your own keys → Providers* and *enroll a runner → Build Farm*, never a
 *   greyed-out trial credit it cannot honour — and this module adds nothing to that set. The
 *   estimator row's affix is the **real** nightly job's last run ({@link estimatorAffix}); the
 *   Slack row says what it waits for and links nothing until its surface exists.
 * - **The timeline is a projection, labelled on every row** (decision **O7**). Nothing has been
 *   timed before the first loop runs, so every row the service sends is `projected` and the card
 *   prints the label beside each one. {@link timelineRows} is also the live-upgrade slot: BD.1
 *   (#396) hands it measured rows and the label drops from those — same card, now measured.
 * - **No aggregate statistic renders anywhere** (decision **O8**). The mockup's *"Average
 *   first-loop time across teams: 4m 10s"* has no counterpart: nothing in this system measures
 *   across teams. {@link FABRICATED_AGGREGATE} is the shape of such a claim, and the suite scans
 *   this module's copy, the fixtures and the rendered column for it — a review gate, not a
 *   comment.
 * - **Each reassure claim links the surface that proves it** (decision **O9**). The service sends
 *   only the claims whose mechanism this workspace has; this module prints each with its
 *   mechanism named and never invents a fourth.
 *
 * Framework-free and pure.
 */

import type {
  OnboardingDefaultRow,
  OnboardingDefaults,
  OnboardingReassureClaim,
  OnboardingTimeline,
  OnboardingTimelineRow,
  PlanningReestimationStatus,
} from "@/app/api/onboarding";
import { lastRunPhrase } from "@/app/planning/health";

/** The right column's accessible name — it is a landmark beside the step cards. */
export const COLUMN_LABEL = "What is set up, what happens next, and why it is safe";

/* ------------------------------------------------------------------ the defaults card */

/** The card's title and its tag, as the mockup sets them. */
export const DEFAULTS_TITLE = "Smart defaults";
export const ZERO_CONFIG_TAG = "zero config";

/** The rows' accessible name. */
export const DEFAULTS_ROWS_LABEL = "What is set up for you";

/** What the tag's tooltip says about why these rows and not others — the O6 rule, stated. */
export const DEPLOYMENT_NOTES: Readonly<Record<OnboardingDefaults["deployment"], string>> = {
  self_hosted:
    "Rows selected for a self-hosted deployment: nothing here promises a managed pool this install does not run.",
  saas: "Rows selected for a deployment that declares a managed key pool, a hosted runner pool, or both.",
};

/** The marks each row status draws — the mockup's ✓ and its dim ○. */
export const ROW_GLYPHS: Readonly<Record<OnboardingDefaultRow["status"], string>> = {
  ready: "✓",
  optional: "○",
};

/** How a screen reader hears each mark. */
export const ROW_MARK_NAMES: Readonly<Record<OnboardingDefaultRow["status"], string>> = {
  ready: "Ready",
  optional: "Optional",
};

/**
 * What joins a row's sentence to its link. The mockup's SaaS rows read *managed keys with $5
 * trial credit — bring your own keys anytime*; the self-hosted rows the ticket writes read
 * *bring your own keys → Providers*. A destination takes the arrow, a phrase the dash.
 */
export const LINK_JOINERS: Readonly<Record<OnboardingDefaultRow["variant"], string>> = {
  managed_keys: " — ",
  hosted_runner: " — ",
  bring_your_own_keys: " → ",
  enroll_runner: " → ",
  nightly_estimator: " → ",
  slack_future: " → ",
};

/** What the Slack row's affix starts with — *arrives with ChatOps*. */
export const ARRIVES_WITH = "arrives with";

/**
 * The estimator row's affix — the real nightly job (AL.5, #281): its last run as the Backlog
 * Health footnote says it, and when it runs. *Not run yet* is the honest empty row.
 *
 * @param estimator The job's schedule and last run.
 * @param now The instant the page was read.
 * @returns `last run 10h ago ✓ · nightly at 02:00 UTC`, or `not run yet · nightly at 02:00 UTC`.
 */
export function estimatorAffix(estimator: PlanningReestimationStatus, now: Date): string {
  const hour = String(estimator.schedule.hourUtc).padStart(2, "0");

  return `${lastRunPhrase(estimator.lastRun, now)} · nightly at ${hour}:00 UTC`;
}

/**
 * A row's mono affix: the estimator row's real status, the Slack row's *arrives with ChatOps*,
 * nothing for the rest.
 *
 * @param row The row.
 * @param now The clock the estimator's run is aged against.
 * @returns The affix, or null.
 */
export function rowAffix(row: OnboardingDefaultRow, now: Date): string | null {
  if (row.estimator !== undefined) return estimatorAffix(row.estimator, now);
  if (row.arrivesWith !== undefined) return `${ARRIVES_WITH} ${row.arrivesWith}`;

  return null;
}

/**
 * A row's sentence with its link's words, for a test or a screen reader.
 *
 * @param row The row.
 * @returns `Models: bring your own keys → Providers`.
 */
export function rowText(row: OnboardingDefaultRow): string {
  return row.link === null ? row.text : `${row.text}${LINK_JOINERS[row.variant]}${row.link.label}`;
}

/* ------------------------------------------------------------------ the timeline card */

/** The card's title, as the mockup sets it. */
export const TIMELINE_TITLE = "What happens next";

/** The rows' accessible name. */
export const TIMELINE_ROWS_LABEL = "Projected first loop";

/** The label every projected row wears — the service's own word. */
export const PROJECTED_LABEL = "projected";

/** What the label means, as its tooltip. */
export const PROJECTED_NOTE =
  "A projection: nothing has been timed yet. The label drops from a row once the loop runs and it is measured.";

/** The line under the rows — where its one number comes from, and that nothing is measured. */
export const BASIS_LINES: Readonly<Record<OnboardingTimeline["basis"], string>> = {
  issue_estimate: "Times are the picked issue's own estimate. Nothing here has been timed yet.",
  none: "No times yet — they appear once a picked issue has been sized. Nothing here has been timed.",
};

/** What a row's `atMinutes` prints as — the origin, then the mockup's `~N min`. */
export function timelineTime(atMinutes: number | null): string | null {
  if (atMinutes === null) return null;
  if (atMinutes === 0) return "0:00";

  return `~${String(atMinutes)} min`;
}

/** The three treatments the mockup gives rows: the loop's, the person's (warn), the end's (ok). */
export type TimelineTone = "loop" | "you" | "end";

/** Which treatment each row takes — by its place, not its actor, so *merge* stays the end either way. */
export const TIMELINE_TONES: Readonly<Record<OnboardingTimelineRow["key"], TimelineTone>> = {
  loop_starts: "loop",
  plan_posted: "loop",
  draft_pr_opens: "loop",
  you_review: "you",
  merge: "end",
};

/** The node glyph by who acts — the mockup's ● for the loop, ○ for the person. */
export const ACTOR_GLYPHS: Readonly<Record<OnboardingTimelineRow["actor"], string>> = {
  loop: "●",
  you: "○",
};

/** The node glyph of a row that has happened — filled, whoever acted. */
export const MEASURED_GLYPH = "●";

/**
 * A row BD.1 (#396) has measured — what the **live-upgrade slot** takes. Keyed to the projected
 * row it replaces; the printed time stands in for the projection's and the `projected` label
 * drops. The text is the projection's unless the measurement says otherwise.
 */
export interface LiveTimelineRow {
  readonly key: OnboardingTimelineRow["key"];
  /** The measured time, printed — `1:42`. */
  readonly at: string;
  /** The measured sentence, when it differs from the projection. */
  readonly text?: string;
}

/** One row as the card draws it. */
export interface TimelineViewRow {
  readonly key: OnboardingTimelineRow["key"];
  /** The printed time, or null when the row carries none. */
  readonly time: string | null;
  readonly text: string;
  readonly tone: TimelineTone;
  readonly glyph: string;
  /** Whether the row is a projection and wears the label. */
  readonly projected: boolean;
}

/**
 * The rows as drawn — the service's projection, with any measured rows from the live-upgrade
 * slot laid over it. A measured row prints its own time, loses the `projected` label and fills
 * its node; a projected row prints what the estimate gives it and wears the label.
 *
 * @param timeline The service's projection.
 * @param live The measured rows, when BD.1 has any. Defaults to none.
 * @returns The rows, in the projection's order.
 */
export function timelineRows(
  timeline: Pick<OnboardingTimeline, "rows">,
  live: readonly LiveTimelineRow[] = [],
): readonly TimelineViewRow[] {
  return timeline.rows.map((row) => {
    const measured = live.find((one) => one.key === row.key);

    if (measured !== undefined) {
      return {
        key: row.key,
        time: measured.at,
        text: measured.text ?? row.text,
        tone: TIMELINE_TONES[row.key],
        glyph: MEASURED_GLYPH,
        projected: false,
      };
    }

    return {
      key: row.key,
      time: timelineTime(row.atMinutes),
      text: row.text,
      tone: TIMELINE_TONES[row.key],
      glyph: ACTOR_GLYPHS[row.actor],
      projected: row.kind === "projected",
    };
  });
}

/**
 * The line under the rows: where the projection's one number comes from — or nothing, once every
 * row has been measured and there is no projection left to explain.
 *
 * @param timeline The projection.
 * @param rows The rows as drawn.
 * @returns The line, or null.
 */
export function basisLine(timeline: Pick<OnboardingTimeline, "basis">, rows: readonly TimelineViewRow[]): string | null {
  return rows.some((row) => row.projected) ? BASIS_LINES[timeline.basis] : null;
}

/* ------------------------------------------------------------------ the reassure strip */

/** The strip's accessible name, and the mockup's glyph. */
export const REASSURE_LABEL = "Why this is safe to try";
export const REASSURE_GLYPH = "◈";

/**
 * A claim's mechanism, named — the tooltip and the screen reader's aside, so the sentence cannot
 * stand without what makes it true.
 *
 * @param claim The claim.
 * @returns `Because: The dry-run policy is on … (#382)`.
 */
export function claimNote(claim: Pick<OnboardingReassureClaim, "mechanism">): string {
  return `Because: ${claim.mechanism.description} (#${String(claim.mechanism.issue)})`;
}

/* ------------------------------------------------------------------ the states */

/** What the column says while its first read is in flight. */
export const LOADING_DEFAULTS = "Reading this deployment's defaults…";

/** What the column says when it could not be read. */
export const UNREACHABLE_DEFAULTS = "The defaults could not be reached. They will be read again shortly.";
export const UNREADABLE_DEFAULTS = "The defaults answered with something that could not be read.";

/* ------------------------------------------------------------------ the O8 gate */

/**
 * The shape of an aggregate claim this column may never print (decision **O8**): a percent sign,
 * an average, a share of teams. Nothing in this system measures across teams, so a match is a
 * fabrication — the suite scans this module's copy, the fixtures and the rendered column for it.
 */
export const FABRICATED_AGGREGATE = /%|\b(?:average|avg|across teams|of teams|most teams|typical(?:ly)?)\b/i;

/**
 * Whether a sentence is free of aggregate claims.
 *
 * @param text The sentence.
 * @returns True when nothing in it is shaped like a cross-team figure.
 */
export function isAggregateFree(text: string): boolean {
  return !FABRICATED_AGGREGATE.test(text);
}
