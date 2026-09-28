/**
 * The test-results frame, as data ([#335](https://github.com/NobuData/ouroboros/issues/335)) —
 * mockup 11's page head, its three actions and its five-stat strip, decided here and drawn by
 * `tests-head.tsx`, `tests-actions.tsx` and `summary-strip.tsx`.
 *
 * **One attempt is the page's state.** Every function here takes the attempt the page reads —
 * {@link selectedAttempt}'s answer — and nothing reads "the latest" on its own, so the eyebrow,
 * the meta row, the strip and the gate cannot come to describe two different builds.
 *
 * **It formats; it derives nothing.** `▲ 12 vs build 1` is the payload's `passedDelta`, the
 * wall-time split is the payload's `wallTime`, and the re-run's `N` is the gate's `failedCases`
 * (AT.5, [#333](https://github.com/NobuData/ouroboros/issues/333)). No count is subtracted and no
 * duration is summed in the browser; the one judgement drawn here is the pass-ratio pill's hue,
 * which is presentation of two numbers the payload states.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type { PullRequestRef } from "@/app/api/pull-requests";
import type {
  RerunAvailability,
  RerunScope,
  Rerun,
  TestAttempt,
  TestRunTimeline,
  TestStrip,
} from "@/app/api/test-results";
import { spanOfMs } from "@/app/format";
import { prPath } from "@/app/paths";
import { runHeadline, workflowCaption } from "@/app/runs/view";
import type { ChipDot, ChipTone, StatTone, StatValueTone } from "@/app/ui";

/** The eyebrow's first words — the mockup's `Test Results`. */
export const TESTS_EYEBROW = "Test Results";

/** The breadcrumb's current page. */
export const TESTS_CRUMB = "Test results";

/** The summary strip's accessible name. */
export const STRIP_LABEL = "Summary";

/** The actions' accessible name. */
export const ACTIONS_LABEL = "Test actions";

/** The banner's headline when the first read failed and nothing is on screen. */
export const UNREAD_HEADLINE = "These test results could not be read.";

/** The banner's headline when a refresh failed and the last answer is still on screen. */
export const STALE_HEADLINE = "These test results could not be refreshed.";

/** What an unreported figure is drawn as. */
export const NOT_REPORTED = "—";

/** The *Re-run full suite* label — its count is the gate's, said in the reason when it matters. */
export const RERUN_FULL_LABEL = "Re-run full suite";

/** The primary action — a navigation to Mark & Route, never a dispatch. */
export const SEND_BACK_LABEL = "Send failures back to loop ⟳";

/** Why the re-runs wait before the gate has answered for this attempt. */
export const GATE_CHECKING = "Checking whether a runner could take the build…";

/** Why the re-runs are off for a reader who may not start a build. */
export const VIEWER_REASON = "A viewer cannot start a build — ask a member of this workspace.";

/** Why the re-runs are off while one is being queued. */
export const RERUN_PENDING = "A re-run is being queued.";

/**
 * The fraction of cases passed at or above which a partly-failing attempt is `warn` rather than
 * `err` — Build 3's `61/63` (97 %) is the mockup's warn pill; Build 1's `49/63` (78 %) reads as
 * the failure it is.
 */
export const PASS_RATIO_WARN_FLOOR = 0.9;

// --- the attempt --------------------------------------------------------------------------

/**
 * Read the `?attempt=` parameter.
 *
 * @param value The raw parameter as Next.js hands it over, or as `URLSearchParams` reads it.
 * @returns The attempt's ordinal — a whole number from 1 — or `null` for anything else, which
 *   means *the latest*.
 */
export function attemptParam(value: string | readonly string[] | null | undefined): number | null {
  const first = typeof value === "string" ? value : value?.[0];
  if (first === undefined || !/^[1-9]\d{0,5}$/.test(first)) return null;

  return Number(first);
}

/**
 * The attempt the page reads.
 *
 * @param attempts The run's attempts, oldest first.
 * @param requested The ordinal the URL asked for, or `null`.
 * @returns That attempt; the latest when none was asked for or the one asked for does not exist;
 *   `null` before any attempt has reported.
 */
export function selectedAttempt(
  attempts: readonly TestAttempt[],
  requested: number | null,
): TestAttempt | null {
  return (
    (requested === null ? undefined : attempts.find((each) => each.attemptSeq === requested)) ??
    attempts.at(-1) ??
    null
  );
}

// --- the head -----------------------------------------------------------------------------

/**
 * The eyebrow, composing run and attempt.
 *
 * @param loopSeq The run's loop number.
 * @param attemptSeq The attempt's ordinal, or `null` before there is one.
 * @returns `Test Results · Run #1847 · Build 3`, or without the build before any.
 */
export function testsEyebrow(loopSeq: number, attemptSeq: number | null): string {
  const run = `${TESTS_EYEBROW} · Run #${loopSeq}`;

  return attemptSeq === null ? run : `${run} · ${buildLabel(attemptSeq)}`;
}

/**
 * An attempt's name.
 *
 * @param attemptSeq Its ordinal.
 * @returns `Build 3`.
 */
export function buildLabel(attemptSeq: number): string {
  return `Build ${attemptSeq}`;
}

/** The pass-ratio pill. */
export interface PassPill {
  /** `61/63 passed`. */
  readonly label: string;
  readonly tone: ChipTone;
  /** A pulse while the attempt is still running, so a moving count says it is moving. */
  readonly dot: ChipDot | undefined;
}

/**
 * The pass-ratio pill, coloured by ratio.
 *
 * @param attempt The attempt.
 * @returns `ok` when every case passed, `warn` at or above {@link PASS_RATIO_WARN_FLOOR}, `err`
 *   below it, and `neutral` for an attempt with no cases yet. A running attempt says so.
 */
export function passPill(attempt: TestAttempt): PassPill {
  const { passed, total } = attempt.strip;
  const running = attempt.status === "running";
  const label = total === 0 ? "no cases reported" : `${passed}/${total} passed`;
  const dot: ChipDot | undefined = running ? "pulse" : undefined;

  if (running) return { label: `${label} · running`, tone: "accent", dot };
  if (total === 0) return { label, tone: "neutral", dot };
  if (passed === total) return { label, tone: "ok", dot };

  return { label, tone: passed / total >= PASS_RATIO_WARN_FLOOR ? "warn" : "err", dot };
}

/**
 * The attempt's ordinal within its loop.
 *
 * @param attemptSeq The attempt's ordinal.
 * @param loopSeq The run's loop number.
 * @returns `build 3 of loop #1847`.
 */
export function attemptOrdinal(attemptSeq: number, loopSeq: number): string {
  return `build ${attemptSeq} of loop #${loopSeq}`;
}

/**
 * What ran the attempt, and for how long.
 *
 * @param attempt The attempt.
 * @returns `forge-01 + rig helios-rig-02 · 6m 12s`; either half alone when the other is
 *   unknown; `null` when neither is.
 */
export function machineLine(attempt: TestAttempt): string | null {
  const machines = [
    ...(attempt.build?.runner ? [attempt.build.runner] : []),
    ...attempt.rigs.map((rig) => `rig ${rig}`),
  ].join(" + ");
  const wall = attempt.strip.wallTime;
  const duration = wall === null ? "" : spanOfMs(wall.wallMs);

  if (machines === "" && duration === "") return null;
  if (machines === "") return duration;

  return duration === "" ? machines : `${machines} · ${duration}`;
}

/** The head, ready to draw. */
export interface TestsHeadView {
  /** `Test Results · Run #1847 · Build 3`. */
  readonly eyebrow: string;
  /** `#482 — Fix flaky CAN-bus telemetry test`. */
  readonly headline: string;
  /** The ticket on its tracker, or `null` — the headline is then plain text. */
  readonly trackerUrl: string | null;
  /** `standard-fix v14`. */
  readonly workflow: string;
  /** The pill, or `null` before any attempt. */
  readonly pass: PassPill | null;
  /** `build 3 of loop #1847`, or `null` before any attempt. */
  readonly ordinal: string | null;
  /** `forge-01 + rig helios-rig-02 · 6m 12s`, or `null`. */
  readonly machine: string | null;
  /** The run's PR verification page (#363), or `null` for a run that opened no pull request. */
  readonly pullRequest: PullRequestLink | null;
}

/** The head's link to the run's PR verification page. */
export interface PullRequestLink {
  /** `PR #514`. */
  readonly label: string;
  /** The PR's page. */
  readonly href: string;
}

/**
 * The link to the run's PR verification page.
 *
 * @param pullRequest The run's pull request — its id and the host's number — or `null`.
 * @param originId The module the page was opened from, which the PR page keeps lit.
 * @returns `PR #514`, linked to the PR's page; `null` for a run that opened none.
 */
export function pullRequestLink(
  pullRequest: PullRequestRef | null,
  originId?: string,
): PullRequestLink | null {
  return pullRequest === null
    ? null
    : { label: `PR #${pullRequest.number}`, href: prPath(pullRequest.id, originId) };
}

/**
 * The head for one attempt of a run.
 *
 * @param timeline The run's timeline.
 * @param attempt The attempt the page reads, or `null` before any.
 * @param trackerUrl The ticket's page on its tracker, or `null` when there is none to build.
 * @param pullRequest The link to the run's PR verification page, or `null`.
 * @returns The head.
 */
export function testsHead(
  timeline: TestRunTimeline,
  attempt: TestAttempt | null,
  trackerUrl: string | null,
  pullRequest: PullRequestLink | null = null,
): TestsHeadView {
  const { run } = timeline;

  return {
    eyebrow: testsEyebrow(run.loopSeq, attempt?.attemptSeq ?? null),
    headline: runHeadline(run.issueNumber, run.issueTitle),
    trackerUrl,
    workflow: workflowCaption(run.workflowTag, run.workflowVersionPin),
    pass: attempt === null ? null : passPill(attempt),
    ordinal: attempt === null ? null : attemptOrdinal(attempt.attemptSeq, run.loopSeq),
    machine: attempt === null ? null : machineLine(attempt),
    pullRequest,
  };
}

// --- the strip ----------------------------------------------------------------------------

/** One stat card, ready to draw. */
export interface StatView {
  readonly label: string;
  readonly value: string;
  readonly valueTone?: StatValueTone;
  /** The line under the figure, or `null`. The flaky card adds its link beside it. */
  readonly delta: string | null;
  readonly tone: StatTone;
}

/** The flaky card: its stat, and the `watching` count its link carries. */
export interface FlakyStatView extends StatView {
  /**
   * Flaky cases whose score is `watching` — the payload's states, counted — or `null` when the
   * attempt has no flaky case, and so nothing for the quarantine to be watching.
   */
  readonly watching: number | null;
}

/** The five cards. */
export interface StripView {
  readonly total: StatView;
  readonly passed: StatView;
  readonly failed: StatView;
  readonly flaky: FlakyStatView;
  readonly wall: StatView;
}

/**
 * A count and its noun.
 *
 * @param count How many.
 * @param noun The singular.
 * @returns `1 suite`, `5 suites`.
 */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The *Passed* card's line — the payload's delta, said.
 *
 * @param strip The attempt's strip.
 * @returns `▲ 12 vs build 1` (good news), `▼ 3 vs build 2` (bad), or no line when the payload has
 *   no delta — the count has not moved since the first report.
 */
export function passedDelta(strip: TestStrip): { delta: string | null; tone: StatTone } {
  const moved = strip.passedDelta;
  if (moved === null) return { delta: null, tone: "muted" };

  const versus = `vs build ${moved.versusAttemptSeq}`;
  if (moved.value > 0) return { delta: `▲ ${moved.value} ${versus}`, tone: "up" };
  if (moved.value < 0) return { delta: `▼ ${Math.abs(moved.value)} ${versus}`, tone: "down" };

  return { delta: `no change ${versus}`, tone: "muted" };
}

/**
 * The *Failed* card's line — its headline case.
 *
 * @param strip The attempt's strip.
 * @returns `pid_overshoot_under_load · HIL`, `… + 2 more` for several, `nothing failed` for none.
 */
export function failedCaption(strip: TestStrip): string {
  const [first, ...rest] = strip.failedCases;
  if (first === undefined) return strip.failed === 0 ? "nothing failed" : counted(strip.failed, "case");

  const headline = first.physical ? `${first.name} · HIL` : first.name;

  return rest.length === 0 ? headline : `${headline} + ${rest.length} more`;
}

/**
 * The *Flaky* card's line, before its link.
 *
 * @param strip The attempt's strip.
 * @returns `passed on retry 2/3` for one flaky case, `3 passed on retry` for several, `none` for
 *   none.
 */
export function flakyCaption(strip: TestStrip): string {
  const [only, ...rest] = strip.flakyCases;
  if (only === undefined) return strip.flaky === 0 ? "none" : `${strip.flaky} passed on retry`;
  if (rest.length > 0) return `${strip.flakyCases.length} passed on retry`;

  return `passed on retry ${only.passedOnRetry}/${only.attempts}`;
}

/**
 * The strip for one attempt.
 *
 * @param strip The attempt's strip, as the payload states it.
 * @returns The five cards.
 */
export function stripView(strip: TestStrip): StripView {
  const passed = passedDelta(strip);
  const wall = strip.wallTime;

  return {
    total: {
      label: "Total tests",
      value: String(strip.total),
      delta: `across ${counted(strip.suiteCount, "suite")}`,
      tone: "muted",
    },
    passed: {
      label: "Passed",
      value: String(strip.passed),
      valueTone: "ok",
      delta: passed.delta,
      tone: passed.tone,
    },
    failed: {
      label: "Failed",
      value: String(strip.failed),
      ...(strip.failed > 0 ? { valueTone: "err" as const } : {}),
      delta: failedCaption(strip),
      tone: "muted",
    },
    flaky: {
      label: "Flaky",
      value: String(strip.flaky),
      ...(strip.flaky > 0 ? { valueTone: "warn" as const } : {}),
      delta: flakyCaption(strip),
      tone: "muted",
      watching:
        strip.flaky === 0
          ? null
          : strip.flakyCases.filter((each) => each.flakeState === "watching").length,
    },
    wall: {
      label: "Wall time",
      value: wall === null ? NOT_REPORTED : spanOfMs(wall.wallMs),
      delta:
        wall === null
          ? "not reported yet"
          : `${spanOfMs(wall.simMs)} sim · ${spanOfMs(wall.physicalMs)} physical`,
      tone: "muted",
    },
  };
}

/**
 * The flaky card's link text.
 *
 * @param watching How many flaky cases the quarantine is watching.
 * @returns `quarantine watching (1)`.
 */
export function watchingLabel(watching: number): string {
  return `quarantine watching (${watching})`;
}

// --- the actions --------------------------------------------------------------------------

/** One action: its label, and why it is off — `null` when it is on. */
export interface ActionView {
  readonly label: string;
  readonly reason: string | null;
}

/** The head's three actions. */
export interface ActionsView {
  readonly rerunFailed: ActionView;
  readonly rerunFull: ActionView;
  readonly sendBack: ActionView;
  /**
   * The sentence printed under the actions: the reason the re-runs are off, said once, since it
   * is the same reason for both. `null` when both are on.
   */
  readonly note: string | null;
}

/** What the actions are decided from. */
export interface ActionsInput {
  /** The attempt the page reads. */
  readonly attempt: TestAttempt;
  /** The gate's last answer, or `null` while it has none. */
  readonly gate: RerunAvailability | null;
  /** Why the gate could not be read, or `null`. */
  readonly gateError: string | null;
  /** Whether the reader may start a build — owner, admin or member. */
  readonly mayContribute: boolean;
  /** The scope being queued right now, or `null`. */
  readonly pending: RerunScope | null;
}

/**
 * Why a re-run cannot be placed, as the gate states it.
 *
 * @param gate The gate's answer for the attempt.
 * @param attemptSeq The attempt's ordinal, for the sentence.
 * @returns The reason, or `null` when a runner is available.
 */
export function readinessReason(gate: RerunAvailability, attemptSeq: number): string | null {
  const pool = gate.pool === null ? "its pool" : `pool ${gate.pool}`;

  switch (gate.readiness) {
    case "runner_available":
      return null;
    case "no_eligible_runner":
      return `No runner in ${pool} can take a build right now — each is offline, drained, full or without its executor.`;
    case "pool_disabled":
      return `${pool.charAt(0).toUpperCase()}${pool.slice(1)} is disabled, so a build cannot be queued.`;
    case "no_source_build":
      return `No farm build produced ${buildLabel(attemptSeq)}, so there is nothing to re-run.`;
  }
}

/**
 * The head's actions, honestly gated.
 *
 * The re-runs are off, with the reason, for a viewer, while the gate has not answered **for this
 * attempt**, when it could not be read, when it says no runner could take the build, and while a
 * re-run is being queued; *Re-run failed* also when nothing failed. *Send failures back to loop*
 * is a navigation, so only an attempt with nothing failed switches it off.
 *
 * @param input See {@link ActionsInput}.
 * @returns The three actions and the note under them.
 */
export function actionsView(input: ActionsInput): ActionsView {
  const { attempt, gate, gateError, mayContribute, pending } = input;
  const current = gate !== null && gate.testRunId === attempt.id ? gate : null;
  const nothingFailed = `Nothing failed in ${buildLabel(attempt.attemptSeq)}.`;

  const shared = !mayContribute
    ? VIEWER_REASON
    : pending !== null
      ? RERUN_PENDING
      : current === null
        ? (gateError ?? GATE_CHECKING)
        : readinessReason(current, attempt.attemptSeq);
  const failedCount = current?.failedCases ?? attempt.strip.failed;
  const failedReason = shared ?? (failedCount === 0 ? nothingFailed : null);

  return {
    rerunFailed: { label: `Re-run failed (${failedCount})`, reason: failedReason },
    rerunFull: { label: RERUN_FULL_LABEL, reason: shared },
    sendBack: {
      label: SEND_BACK_LABEL,
      reason: attempt.strip.failedCases.length === 0 ? nothingFailed : null,
    },
    note: shared ?? failedReason,
  };
}

/**
 * What became of a re-run, said once it has been queued.
 *
 * @param rerun The service's answer.
 * @returns `Build job #483 queued — …`, with the honest queue state.
 */
export function rerunOutcome(rerun: Rerun): string {
  const queued = `Build job #${rerun.job.number} queued with ${counted(rerun.caseKeys.length, "case")}`;

  switch (rerun.queueState) {
    case "offered":
      return `${queued} — offered to a runner.`;
    case "queued_runner_available":
      return `${queued} — a runner is available and dispatch will place it.`;
    case "queued_no_eligible_runner":
      return `${queued} — no runner is eligible yet, so it waits in pool ${rerun.job.pool}.`;
  }
}
