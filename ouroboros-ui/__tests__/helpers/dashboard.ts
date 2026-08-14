import type { Dashboard, DashboardActivity } from "@/app/api/dashboard";
import type { EngineStatus } from "@/app/api/engine";
import type { DependencyStatus, HealthReport } from "@/app/api/health";
import type { Member, MemberPage } from "@/app/api/members";
import type { Role } from "@/app/api/membership";
import type { DashboardReadings, Reading } from "@/app/dashboard/view";

import { TENANT_ID, enablement, membership, org, repo, sessionUser } from "./login";

/**
 * The seeded world as the dashboard reads it.
 *
 * `helpers/login.ts` builds the half of it the login screen needed — the workspace, the
 * person, the organisation and its repository. This adds the four the dashboard also asks
 * about: the aggregate, the members listing, the readiness probe and the engine's status,
 * and then the one object the screen takes.
 *
 * It is the same world on purpose (`ouroboros-db/migrations/R__dev_seed.sql` and
 * `R__dev_seed_dashboard.sql`): three members in `acme-robotics`, one organisation, one
 * repository, both enabled, three loops in flight and twelve issues queued. The acceptance
 * criteria are written against those numbers, so a case that changes one says so by passing
 * an override and every other case reads as the seed.
 */

/** The seeded people, in the roles the seed gives them. */
const SEEDED_MEMBERS: readonly (readonly [string, string, Role])[] = [
  ["5eed0003-0000-4000-8000-000000000001", "Ken Suenobu", "owner"],
  ["5eed0003-0000-4000-8000-000000000002", "Maya Chen", "admin"],
  ["5eed0003-0000-4000-8000-000000000003", "Jorge Reyes", "member"],
];

/**
 * One member of the workspace.
 *
 * @param over The fields this case is about.
 * @returns A complete member.
 */
export function member(over: Partial<Member> = {}): Member {
  return {
    orgId: TENANT_ID,
    userId: "5eed0003-0000-4000-8000-000000000001",
    email: "ken@acme-robotics.dev",
    displayName: "Ken Suenobu",
    avatarUrl: null,
    role: "owner",
    // One timestamp where `tenant_members` kept two: the organization plugin writes the
    // member row at acceptance, so *invited* and *joined* are no longer separable.
    joinedAt: "2026-08-11T10:20:23.114Z",
    ...over,
  };
}

/**
 * A page of members.
 *
 * @param items The rows it carries. Defaults to the seed's three.
 * @param total How many the workspace has. Defaults to the number of rows — pass a larger
 *   one for the case where the window did not cover the workspace.
 * @returns The page.
 */
export function memberPage(items: readonly Member[] = seededMembers(), total?: number): MemberPage {
  return {
    items: [...items],
    total: total ?? items.length,
    limit: 100,
    offset: 0,
  };
}

/**
 * The seed's three members: an owner, an admin and a member.
 *
 * @returns The rows, in the order the service returns them (by name).
 */
export function seededMembers(): Member[] {
  return SEEDED_MEMBERS.map(([userId, displayName, role]) =>
    member({
      userId,
      displayName,
      role,
      email: `${displayName.split(" ")[0]?.toLowerCase()}@acme-robotics.dev`,
    }),
  );
}

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
 * the page head, so `activity` is the part of this payload it reads. The cards of I.2–I.6
 * fill in `activeRuns`, `recentRuns` and `queueHead` as each lands, which is why the
 * factory takes an override rather than being written per suite.
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
      tokensToday: { tokens: 4_200_000, costCents: 1860, providers: 4, unpricedEvents: 0 },
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
    members: read(memberPage()),
    enablement: read(enablement([[org(), [repo()]]])),
    readiness: healthReport(),
    engine: read(engineStatus()),
    ...over,
  };
}
