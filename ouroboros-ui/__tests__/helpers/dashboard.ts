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
    tenantId: TENANT_ID,
    userId: "5eed0003-0000-4000-8000-000000000001",
    email: "ken@acme-robotics.dev",
    displayName: "Ken Suenobu",
    avatarUrl: null,
    role: "owner",
    invitedAt: "2026-08-11T10:20:23.114Z",
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
