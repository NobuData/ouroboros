import type { Dashboard, DashboardActivity } from "@/app/api/dashboard";
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
 * The whole dashboard aggregate, at the mockup's own figures.
 *
 * The row arrays are empty and the numbers are the mockup's: I.1 (#80) draws the frame and
 * the page head and I.2 (#81) the stat row, so `activity` and `stats` are the parts of this
 * payload they read. The cards of I.3–I.6 fill in `activeRuns`, `recentRuns` and
 * `queueHead` as each lands, which is why the factory takes an override rather than being
 * written per suite.
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
    activeRuns: [],
    recentRuns: [],
    queueHead: [],
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
    aggregate: read(dashboardPayload()),
    readiness: healthReport(),
    engine: read(engineStatus()),
    ...over,
  };
}
