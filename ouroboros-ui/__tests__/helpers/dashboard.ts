import type {
  Dashboard,
  DashboardActivity,
  QueueItemSummary,
  RunSummary,
} from "@/app/api/dashboard";
import type { EngineStatus } from "@/app/api/engine";
import type { DependencyStatus, HealthReport } from "@/app/api/health";
import type { DashboardReadings, Reading } from "@/app/dashboard/view";

import { membership, sessionUser } from "./login";

/**
 * The seeded world as the dashboard reads it.
 *
 * `helpers/login.ts` builds the half of it the login screen needed — the workspace, the
 * person, the organisation and its repository. This adds the three the dashboard also asks
 * about: the aggregate, the readiness probe and the engine's status, and then the one
 * object the screen takes.
 *
 * It is the same world on purpose (`ouroboros-db/migrations/R__dev_seed.sql` and
 * `R__dev_seed_dashboard.sql`): `acme-robotics` with one organisation and one repository,
 * three loops in flight and twelve issues queued. The acceptance criteria are written
 * against those numbers, so a case that changes one says so by passing an override and
 * every other case reads as the seed.
 */

/**
 * A readiness report, from what each dependency is doing.
 *
 * The three sections of the real body are the same rows seen three ways, so building them
 * from one map is what keeps a fixture from disagreeing with itself — `info` holding a
 * dependency that `error` also holds is not a report `ouroboros-rest` can produce.
 *
 * @param dependencies What each dependency reported, keyed by name. Defaults to both up.
 * @param status The overall status. Defaults to the one the dependencies imply.
 * @returns The report.
 */
export function healthReport(
  dependencies: Readonly<Record<string, DependencyStatus>> = {
    database: { status: "up" },
    engine: { status: "up" },
  },
  status?: HealthReport["status"],
): HealthReport {
  const entries = Object.entries(dependencies);
  const partition = (want: DependencyStatus["status"]) =>
    Object.fromEntries(entries.filter(([, one]) => one.status === want));

  return {
    status: status ?? (entries.every(([, one]) => one.status === "up") ? "ok" : "error"),
    info: partition("up"),
    error: partition("down"),
    details: { ...dependencies },
  };
}

/**
 * What the engine reported.
 *
 * @param version The build that answered. Defaults to the checked-in engine's.
 * @returns The status.
 */
export function engineStatus(version = "0.3.1"): EngineStatus {
  return { engine: "up", version };
}

/**
 * The seeded workspace's activity, as `R__dev_seed_dashboard.sql` writes it and the mockup's
 * page head prints it: three runs in flight, twelve issues behind them, six merged today.
 *
 * `mergedSinceMorning` is the one figure of the three the seed does **not** pin — "since
 * this morning" is a wall-clock boundary a seed whose windows are relative to `now()` cannot
 * fix, as the seed file says at length — so six is the mockup's number rather than a
 * guaranteed row count. Nothing here depends on it being exact; the cases that care pass
 * their own.
 *
 * @param over The fields this case is about.
 * @returns A complete activity object.
 */
export function activity(over: Partial<DashboardActivity> = {}): DashboardActivity {
  return { inFlight: 3, queued: 12, mergedSinceMorning: 6, ...over };
}

/**
 * The instant every fixture in this file is measured from — `2026-08-14T18:20:00Z`.
 *
 * A duration that is still running needs a *now* as well as a start, and a fixture that
 * called `Date.now()` would make every assertion about the elapsed column depend on when the
 * suite ran. So the readings carry the clock (`DashboardReadings.readAt`) and this is what
 * they carry: the three seeded runs below start at this instant less the elapsed the mockup
 * prints, so the table reads `12m 40s`, `38m 05s` and `7m 12s` exactly, the way it does the
 * moment the seeded stack comes up.
 */
export const READ_AT = Date.parse("2026-08-14T18:20:00.000Z");

/**
 * The three runs the mockup's `c-8` table draws, as `R__dev_seed_dashboard.sql` seeds them.
 *
 * Row for row the same fiction, in the same lifecycle order — coding, building, review — with
 * `startedAt` at {@link READ_AT} less the mockup's own elapsed, and `finishedAt` null on all
 * three, which is what puts them in this card rather than the completions one.
 *
 * The four fields a running run has nothing to say about are null, exactly as the contract
 * requires: no pull request, and no checks.
 */
export const SEEDED_RUNS: readonly RunSummary[] = [
  activeRun({
    id: "5eed0009-0000-4000-8000-000000000482",
    issueNumber: 482,
    issueTitle: "Fix flaky CAN-bus telemetry test",
    workflowTag: "standard-fix",
    model: "claude-fable-5",
    status: "coding",
    stageLabel: "Implementing",
    stageIndex: 4,
    stageTotal: 6,
    startedAt: startedSecondsAgo(760),
  }),
  activeRun({
    id: "5eed0009-0000-4000-8000-000000000479",
    issueNumber: 479,
    issueTitle: "Add OTA rollback on failed checksum",
    workflowTag: "feature-loop",
    model: "claude-sonnet-5",
    status: "building",
    stageLabel: "Build farm",
    stageIndex: 5,
    stageTotal: 7,
    startedAt: startedSecondsAgo(2285),
  }),
  activeRun({
    id: "5eed0009-0000-4000-8000-000000000476",
    issueNumber: 476,
    issueTitle: "Bump MQTT client, migrate deprecated API",
    workflowTag: "deps-refresh",
    model: "ollama/qwen3-coder",
    status: "review",
    stageLabel: "Self-review",
    stageIndex: 6,
    stageTotal: 6,
    startedAt: startedSecondsAgo(432),
  }),
];

/**
 * A timestamp that many seconds before {@link READ_AT}.
 *
 * @param seconds How long the run has been going.
 * @returns The `date-time` the contract carries.
 */
export function startedSecondsAgo(seconds: number): string {
  return new Date(READ_AT - seconds * 1000).toISOString();
}

/**
 * One run in flight.
 *
 * Everything a *running* run cannot have is null by default — it has not finished, so it has
 * no `finishedAt`, and the active table draws no pull request or checks — and everything else
 * is the first seeded row, so a case that is about one field says so by passing that field
 * alone.
 *
 * @param over The fields this case is about.
 * @returns A complete run summary.
 */
export function activeRun(over: Partial<RunSummary> = {}): RunSummary {
  return {
    id: "5eed0009-0000-4000-8000-000000000482",
    issueNumber: 482,
    issueTitle: "Fix flaky CAN-bus telemetry test",
    workflowTag: "standard-fix",
    model: "claude-fable-5",
    status: "coding",
    stageLabel: "Implementing",
    stageIndex: 4,
    stageTotal: 6,
    startedAt: startedSecondsAgo(760),
    finishedAt: null,
    prNumber: null,
    checksPassed: null,
    checksTotal: null,
    ...over,
  };
}

/**
 * One run that has stopped.
 *
 * Everything a *closed* run has that a running one does not is filled in by default — it
 * finished, so it has a `finishedAt`, a pull request and a pair of check counts — and
 * everything else is the first seeded completion, so a case that is about one field says so
 * by passing that field alone.
 *
 * The two instants are the pair the *Cycle* column measures between: `finishedAt` is
 * {@link READ_AT} less `closedSecondsAgo`, and `startedAt` is that less `cycleSeconds`,
 * exactly as `R__dev_seed_dashboard.sql` writes them. A cycle is therefore the arithmetic of
 * a row's own timestamps here as well as in the database, and no fixture carries a duration.
 *
 * @param over The fields this case is about.
 * @param spans How long the run took, and how long ago it closed. Defaults to `#474`'s.
 * @returns A complete run summary.
 */
export function closedRun(
  over: Partial<RunSummary> = {},
  spans: Readonly<{ cycleSeconds?: number; closedSecondsAgo?: number }> = {},
): RunSummary {
  const { cycleSeconds = 660, closedSecondsAgo = 2520 } = spans;

  return {
    id: "5eed0009-0000-4000-8000-000000000474",
    issueNumber: 474,
    issueTitle: "Debounce e-stop interrupt handler",
    workflowTag: "standard-fix",
    model: "claude-fable-5",
    status: "merged",
    stageLabel: "Merged",
    stageIndex: 6,
    stageTotal: 6,
    startedAt: startedSecondsAgo(closedSecondsAgo + cycleSeconds),
    finishedAt: startedSecondsAgo(closedSecondsAgo),
    prNumber: 512,
    checksPassed: 14,
    checksTotal: 14,
    ...over,
  };
}

/**
 * The four runs the mockup's `c-7` table draws, as `R__dev_seed_dashboard.sql` seeds them.
 *
 * Row for row the same fiction, in the same order — newest first by `finishedAt` — with the
 * cycles that make the column read `11m`, `19m`, `6m` and `42m`, and `#465`'s `13/14`, which
 * is the reason that run is `needs_human` rather than `merged`.
 *
 * **Four, where the aggregate carries eight.** The endpoint answers eight so that a client
 * expanding the card already holds them, and the card draws four (`Dashboard.recentRuns`);
 * these are that head, which is what the acceptance criterion is written about. The case for
 * the cap itself builds its own longer slice.
 */
export const SEEDED_COMPLETIONS: readonly RunSummary[] = [
  closedRun(),
  closedRun(
    {
      id: "5eed0009-0000-4000-8000-000000000471",
      issueNumber: 471,
      issueTitle: "Unit tests for motor PID edge cases",
      model: "copilot/gpt-5-codex",
      prNumber: 509,
    },
    { cycleSeconds: 1140, closedSecondsAgo: 8100 },
  ),
  closedRun(
    {
      id: "5eed0009-0000-4000-8000-000000000468",
      issueNumber: 468,
      issueTitle: "i18n strings for pairing screen",
      workflowTag: "docs-loop",
      model: "ollama/qwen3-coder",
      stageIndex: 5,
      stageTotal: 5,
      prNumber: 507,
      checksPassed: 12,
      checksTotal: 12,
    },
    { cycleSeconds: 360, closedSecondsAgo: 13_800 },
  ),
  closedRun(
    {
      id: "5eed0009-0000-4000-8000-000000000465",
      issueNumber: 465,
      issueTitle: "Refactor telemetry buffer allocation",
      workflowTag: "feature-loop",
      model: "claude-sonnet-5",
      status: "needs_human",
      stageLabel: "Awaiting human",
      stageIndex: 5,
      prNumber: 504,
      checksPassed: 13,
    },
    { cycleSeconds: 2520, closedSecondsAgo: 19_800 },
  ),
];

/**
 * One issue waiting for a loop.
 *
 * Everything is the first seeded row — position 1, `#485` — so a case that is about one field
 * says so by passing that field alone.
 *
 * @param over The fields this case is about.
 * @returns A complete queue item.
 */
export function queueItem(over: Partial<QueueItemSummary> = {}): QueueItemSummary {
  return {
    id: "5eed000a-0000-4000-8000-000000000485",
    issueNumber: 485,
    issueTitle: "Watchdog reset on I²C bus lockup",
    effort: "m",
    workflowTag: "standard-fix",
    position: 1,
    estMinutes: 45,
    enqueuedAt: enqueuedHoursAgo(12),
    ...over,
  };
}

/**
 * A timestamp that many hours before {@link READ_AT}.
 *
 * The seed's own rhythm (`R__dev_seed_dashboard.sql`): position 1 joined twelve hours ago and
 * position 12 an hour ago, so the queue reads as a queue rather than as a list that happens to
 * be ordered.
 *
 * @param hours How long ago the issue joined the queue.
 * @returns The `date-time` the contract carries.
 */
export function enqueuedHoursAgo(hours: number): string {
  return new Date(READ_AT - hours * 3_600_000).toISOString();
}

/**
 * The five rows the mockup's `c-5` card draws, as `R__dev_seed_dashboard.sql` seeds them.
 *
 * Row for row the same fiction, in the same order — `position` 1 first — with the mockup's own
 * effort chips and workflow tags: `#485` M, `#486` L, `#488` XS, `#490` XL, `#491` S. **All
 * five sizes across the five rows**, which is the acceptance criterion this fixture exists for.
 *
 * **Five, where twelve are queued.** The aggregate caps `queueHead` at five
 * (`QUEUE_HEAD_LIMIT`) and `stats.queued.count` speaks for the whole queue, which is what makes
 * the card's footer read *+7 queued*. The seven below the fold are the seed's; nothing here
 * needs them, because the count is what the footer subtracts from.
 */
export const SEEDED_QUEUE: readonly QueueItemSummary[] = [
  queueItem(),
  queueItem({
    id: "5eed000a-0000-4000-8000-000000000486",
    issueNumber: 486,
    issueTitle: "Expose battery health over BLE GATT",
    effort: "l",
    workflowTag: "feature-loop",
    position: 2,
    estMinutes: 90,
    enqueuedAt: enqueuedHoursAgo(11),
  }),
  queueItem({
    id: "5eed000a-0000-4000-8000-000000000488",
    issueNumber: 488,
    issueTitle: "Typo sweep in operator manual",
    effort: "xs",
    workflowTag: "docs-loop",
    position: 3,
    estMinutes: 15,
    enqueuedAt: enqueuedHoursAgo(10),
  }),
  queueItem({
    id: "5eed000a-0000-4000-8000-000000000490",
    issueNumber: 490,
    issueTitle: "Migrate build to Zephyr 4.2",
    effort: "xl",
    workflowTag: "deps-refresh",
    position: 4,
    estMinutes: 180,
    enqueuedAt: enqueuedHoursAgo(9),
  }),
  queueItem({
    id: "5eed000a-0000-4000-8000-000000000491",
    issueNumber: 491,
    issueTitle: "Add CRC to config persistence layer",
    effort: "s",
    workflowTag: "standard-fix",
    position: 5,
    estMinutes: 30,
    enqueuedAt: enqueuedHoursAgo(8),
  }),
];

/**
 * The whole dashboard aggregate, at the mockup's own figures.
 *
 * The numbers are the mockup's, and so are the runs in `activeRuns` and `recentRuns`: I.1
 * (#80) draws the frame and the page head, I.2 (#81) the stat row, I.3 (#82) the active-loops
 * table, I.5 (#84) the completions table and I.6 (#85) the queue card, so `activity`, `stats`,
 * `activeRuns`, `recentRuns` and `queueHead` are the parts of this payload they read.
 *
 * The two window lengths are the contract's: the merge rate is measured over fourteen days
 * (46 merged of 50 closed — `0.92` exactly) while the cycle time and the intervention count
 * are over seven.
 *
 * @param over The fields this case is about.
 * @returns A complete aggregate.
 */
export function dashboardPayload(over: Partial<Dashboard> = {}): Dashboard {
  return {
    stats: {
      loopsLive: { total: 3, byStatus: { coding: 1, building: 1, review: 1 } },
      // `est. 9h 40m of autonomous work`, in the minutes the contract carries.
      queued: { count: 12, estMinutes: 580 },
      merged7d: { count: 27, deltaVsPrior: 8 },
      // The seed leaves `ollama` unpriced (`R__dev_seed_dashboard.sql`), which is what makes
      // the mockup's `≈ $18.60` a lower bound rather than an exact total — three of the
      // day's events carry no cost, and `unpricedEvents` is how the card knows to say `≈`.
      tokensToday: { tokens: 4_200_000, costCents: 1860, providers: 4, unpricedEvents: 3 },
    },
    pulse: { mergeRate: 0.92, avgCycleSeconds: 860, interventions7d: 2, autoMerge: true },
    activeRuns: [...SEEDED_RUNS],
    recentRuns: [...SEEDED_COMPLETIONS],
    queueHead: [...SEEDED_QUEUE],
    activity: activity(),
    ...over,
  };
}

/**
 * The aggregate a workspace with nothing in it answers: zeros and empty arrays throughout.
 *
 * Every field is still present — the contract guarantees it, so a card renders an empty
 * organization without a fallback branch — which is exactly the property this fixture is
 * here to hold the screen to.
 *
 * @returns The empty aggregate.
 */
export function emptyDashboard(): Dashboard {
  return dashboardPayload({
    stats: {
      loopsLive: { total: 0, byStatus: { coding: 0, building: 0, review: 0 } },
      queued: { count: 0, estMinutes: 0 },
      merged7d: { count: 0, deltaVsPrior: 0 },
      tokensToday: { tokens: 0, costCents: 0, providers: 0, unpricedEvents: 0 },
    },
    pulse: { mergeRate: 0, avgCycleSeconds: 0, interventions7d: 0, autoMerge: false },
    activeRuns: [],
    recentRuns: [],
    queueHead: [],
    activity: { inFlight: 0, queued: 0, mergedSinceMorning: 0 },
  });
}

/**
 * A successful read, for building a {@link DashboardReadings} by hand.
 *
 * @param value What was read.
 * @returns The reading.
 */
export function read<T>(value: T): Reading<T> {
  return { ok: true, value };
}

/**
 * A failed read.
 *
 * @param reason What the service said.
 * @returns The reading.
 */
export function failed<T>(reason: string): Reading<T> {
  return { ok: false, reason };
}

/**
 * Everything the dashboard read, in the seeded world.
 *
 * @param over The parts this case is about — anything not named is the seed's own.
 * @returns The readings the screen takes.
 */
export function readings(over: Partial<DashboardReadings> = {}): DashboardReadings {
  return {
    workspace: membership(),
    user: sessionUser(),
    readAt: READ_AT,
    aggregate: read(dashboardPayload()),
    readiness: healthReport(),
    engine: read(engineStatus()),
    ...over,
  };
}
