import type { EngineStatus } from "@/app/api/engine";
import type { DependencyStatus, HealthReport } from "@/app/api/health";
import type { Member, MemberPage } from "@/app/api/members";
import type { Role } from "@/app/api/membership";
import type { DashboardSummary } from "@/app/dashboard/summary";
import type { DashboardReadings, Reading } from "@/app/dashboard/view";

import { TENANT_ID, enablement, membership, org, repo, sessionUser } from "./login";

/**
 * The seeded world as the dashboard reads it.
 *
 * `helpers/login.ts` builds the half of it the login screen needed — the workspace, the
 * person, the organisation and its repository. This adds the three the dashboard also asks
 * about: the members listing, the readiness probe and the engine's status, and then the one
 * object the screen takes.
 *
 * It is the same world on purpose (`ouroboros-db/migrations/R__dev_seed.sql`): three
 * members in `acme-robotics`, one organisation, one repository, both enabled. The
 * acceptance criterion is written against those numbers, so a case that changes one says so
 * by passing an override and every other case reads as the seed.
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
 * The seeded organization's dashboard aggregate, number for number
 * ([#87](https://github.com/NobuData/ouroboros/issues/87)).
 *
 * The same figures `ouroboros-rest`'s own `MOCKUP_02` fixture asserts against the seed
 * (`ouroboros-rest/src/testing/dashboard.fixture.ts`): three loops live, twelve queued,
 * twenty-seven merged in seven days, two human interventions. A suite whose subject is one
 * of those numbers passes an override and every other case reads as the seed — so a
 * disagreement between what this application draws and what the service seeds is a failing
 * assertion rather than a fixture quietly copied out of date.
 *
 * The rows are left empty on purpose. Nothing that reads this fixture today draws a table —
 * the pills and the freshness store read `stats` and `pulse` — and a fabricated run row
 * would be a fixture inviting a card to be written against it rather than against the
 * contract.
 *
 * @param over The parts this case is about — anything not named is the seed's own.
 * @returns The payload, exactly as `GET /api/v1/dashboard` answers it.
 */
export function summary(over: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    stats: {
      loopsLive: { total: 3, byStatus: { coding: 1, building: 1, review: 1 } },
      queued: { count: 12, estMinutes: 580 },
      merged7d: { count: 27, deltaVsPrior: 8 },
      tokensToday: { tokens: 4_200_000, costCents: 1860, providers: 4, unpricedEvents: 3 },
    },
    pulse: { mergeRate: 0.92, avgCycleSeconds: 860, interventions7d: 2, autoMerge: true },
    activeRuns: [],
    recentRuns: [],
    queueHead: [],
    activity: { inFlight: 3, queued: 12, mergedSinceMorning: 6 },
    ...over,
  };
}

/**
 * The same payload for an organization with nothing in it — the seed's personal workspace,
 * which `R__dev_seed_dashboard.sql` leaves deliberately empty as the zero-state fixture.
 *
 * Zeros and empty arrays, never nulls and never absent keys: that is the endpoint's promise
 * about an empty workspace, and it is what lets a consumer read `0` as *nothing is live*
 * rather than as *nobody has said*.
 *
 * @returns The payload an empty workspace answers with.
 */
export function emptySummary(): DashboardSummary {
  return summary({
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
 * Everything the dashboard read, in the seeded world.
 *
 * @param over The parts this case is about — anything not named is the seed's own.
 * @returns The readings the screen takes.
 */
export function readings(over: Partial<DashboardReadings> = {}): DashboardReadings {
  return {
    workspace: membership(),
    user: sessionUser(),
    members: read(memberPage()),
    enablement: read(enablement([[org(), [repo()]]])),
    readiness: healthReport(),
    engine: read(engineStatus()),
    ...over,
  };
}
