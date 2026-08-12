/**
 * What the dashboard draws, decided from what was read.
 *
 * **Framework-free and pure**, the same way `app/login/view.ts` is, and for the same
 * reason: every decision on this screen — whether a pill is green, what a count's caption
 * says, which card is empty rather than merely zero — is then a function with an input and
 * an output, covered by a unit test rather than by driving a route. Nothing here reads a
 * cookie, a header or the network, and nothing here imports `next/*`.
 *
 * The rules it encodes come from the design system's honesty clause
 * (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.5): **a computed number or an em dash.** There is
 * no loop engine producing runs yet, so nothing on this screen invents one — a panel with
 * no source is drawn as a designed empty state naming what will fill it, and a number that
 * could not be read is an em dash beside the reason, never a zero.
 */

import type { Enablement } from "@/app/api/enablement";
import type { EngineStatus } from "@/app/api/engine";
import type { DependencyStatus, HealthReport } from "@/app/api/health";
import type { MemberPage } from "@/app/api/members";
import type { Membership, Role } from "@/app/api/membership";
import type { SessionUser } from "@/app/api/session";

/**
 * One read that was attempted: what it returned, or why it did not.
 *
 * The dashboard issues four independent reads and draws four independent cards, so a
 * failure is per card rather than per page — a members listing that failed must not blank
 * the enablement counts beside it. Making that explicit in the type is what stops a card
 * being written to treat *absent* and *zero* as the same thing, which is the specific way
 * this screen could lie.
 */
export type Reading<T> =
  /** The read succeeded. */
  | { readonly ok: true; readonly value: T }
  /** It failed, with the message the service gave for it. */
  | { readonly ok: false; readonly reason: string };

/**
 * Everything the dashboard was able to read, and why it could not read the rest.
 *
 * It lives in this pure module rather than beside the calls that produce it
 * (`app/dashboard/data.ts`, which is server-only) so that the screen and its tests can name
 * the shape without pulling `server-only`, `next/headers` and a configured environment in
 * behind it. The reader produces one of these; the components consume one; neither needs
 * the other's dependencies.
 */
export interface DashboardReadings {
  /** The active workspace, from the gate. Present by construction — the page has one. */
  readonly workspace: Membership;
  /** The signed-in person, from the gate. Present by construction. */
  readonly user: SessionUser;
  /** The workspace's members, or why the listing failed. */
  readonly members: Reading<MemberPage>;
  /** Its organisations and their repositories, or why the read failed. */
  readonly enablement: Reading<Enablement>;
  /**
   * The readiness probe's answer, or `null` when it could not be read. Not a
   * {@link Reading}: that route's failure *is* its answer and it never throws
   * (`app/api/health.ts`), so there is no reason to carry.
   */
  readonly readiness: HealthReport | null;
  /** What the engine reported, or why the call did not reach it. */
  readonly engine: Reading<EngineStatus>;
}

/** What is drawn in place of a number that could not be read. */
export const NO_VALUE = "—";

/* ------------------------------------------------------------------ system status */

/** What a dependency is reporting: answering, not answering, or not known. */
export type SystemState = "up" | "down" | "unknown";

/** One row of the system card: a dependency, its state, and a line about it. */
export interface SystemRow {
  /** Stable identifier, and the React key. */
  readonly id: string;
  /** What the row is called. */
  readonly label: string;
  /** What it is reporting. */
  readonly state: SystemState;
  /** One line of detail — a build number, or the reason it is down. */
  readonly note: string;
}

/** The dependency keys `/health/ready` reports (`app/api/health.ts`). */
const DATABASE = "database";
const ENGINE = "engine";

/**
 * The three rows of the system card, from the two operations that can report on them.
 *
 * Which source decides what is deliberate and one-directional, because the two can
 * disagree — they are separate round trips, and a service can stop between them:
 *
 * - **The readiness probe decides every state.** It is the only operation that reports on
 *   the database at all, it reports both dependencies from one answer, and it is the one
 *   that changes when a container stops. `stop the engine → the pill degrades` is this
 *   line.
 * - **`GET /api/v1/engine/status` supplies the engine's build**, and its state only when
 *   the probe does not name the engine at all. It is the operation that knows the version;
 *   it is not a second opinion on reachability.
 *
 * @param report The readiness probe's answer, or `null` when it could not be read.
 * @param engine What the engine-status call returned, or why it did not.
 * @returns The rows, in the order the card draws them: the service, then its dependencies.
 */
export function systemRows(
  report: HealthReport | null,
  engine: Reading<EngineStatus>,
): readonly SystemRow[] {
  return [
    restRow(report),
    dependencyRow(DATABASE, "Database", report?.details[DATABASE], "Accepting queries."),
    engineRow(report?.details[ENGINE], engine),
  ];
}

/**
 * The row for `ouroboros-rest` itself.
 *
 * A report with `status: "error"` still means the service is up: `error` is its verdict on
 * its *dependencies*, and reading it as the service being down would take the row that
 * explains the outage down with it. The one status that is about the process is
 * `shutting_down`, which says it should neither be sent traffic nor counted live.
 *
 * @param report The probe's answer, or `null`.
 * @returns The row.
 */
function restRow(report: HealthReport | null): SystemRow {
  if (report === null) {
    return {
      id: "rest",
      label: "REST API",
      state: "down",
      note: "The readiness probe did not answer.",
    };
  }

  if (report.status === "shutting_down") {
    return { id: "rest", label: "REST API", state: "down", note: "Shutting down." };
  }

  return { id: "rest", label: "REST API", state: "up", note: "Serving requests." };
}

/**
 * One dependency's row, straight from what the probe said about it.
 *
 * @param id The dependency's key in the report, which is also the row's id.
 * @param label What the row is called.
 * @param status What the probe reported for it, or `undefined` when it did not.
 * @param upNote The line to show when it is up — what *answering* proved, per dependency.
 * @returns The row.
 */
function dependencyRow(
  id: string,
  label: string,
  status: DependencyStatus | undefined,
  upNote: string,
): SystemRow {
  if (status === undefined) {
    return { id, label, state: "unknown", note: "The readiness probe did not report it." };
  }

  if (status.status === "up") {
    return { id, label, state: "up", note: upNote };
  }

  // The probe's own message classifies the failure without naming a host, a port or a role
  // — it answers unauthenticated, so it is written to be shown. It is optional in the
  // contract, hence the fallback.
  return { id, label, state: "down", note: status.message ?? "Not answering." };
}

/**
 * The engine's row: the probe's state, and the build from the status call.
 *
 * @param status What the probe reported for the engine, or `undefined` when it did not.
 * @param engine What the engine-status call returned, or why it did not.
 * @returns The row.
 */
function engineRow(
  status: DependencyStatus | undefined,
  engine: Reading<EngineStatus>,
): SystemRow {
  const row = dependencyRow(
    ENGINE,
    "Engine",
    status,
    engine.ok ? `Build ${engine.value.version}.` : "Answering; its build could not be read.",
  );

  // The probe is silent about the engine only if the service stopped reporting it. The
  // status call is then the sole evidence either way, so it decides rather than being
  // discarded — every way it can fail is one `502` (`app/api/engine.ts`), which is exactly
  // "the engine did not serve this".
  if (status === undefined) {
    return engine.ok
      ? { ...row, state: "up", note: `Build ${engine.value.version}.` }
      : { ...row, state: "down", note: engine.reason };
  }

  return row;
}

/**
 * The whole system in one word, for the card's summary pill.
 *
 * The worst row wins, and *unknown* is worse than *up*: a card headed "operational" above a
 * row nobody could read would be the screen making a claim on evidence it does not have.
 *
 * @param rows The rows {@link systemRows} produced.
 * @returns `down` if anything is down, `unknown` if anything is unknown, else `up`.
 */
export function overallState(rows: readonly SystemRow[]): SystemState {
  if (rows.some((row) => row.state === "down")) return "down";
  if (rows.some((row) => row.state === "unknown")) return "unknown";
  return "up";
}

/** What each state is called in the summary pill. */
export const STATE_LABEL: Record<SystemState, string> = {
  up: "operational",
  down: "degraded",
  unknown: "unknown",
};

/* ------------------------------------------------------------------ the stat row */

/** One card in the stat row: a caption, a figure, and a line under it. */
export interface Stat {
  /** Stable identifier, and the React key. */
  readonly id: string;
  /** The caption above the figure. */
  readonly label: string;
  /** The figure, already formatted — {@link NO_VALUE} when it could not be read. */
  readonly value: string;
  /** The line under it: what the figure is made of, or why there is not one. */
  readonly delta: string;
  /** Whether {@link Stat.delta} is reporting a failure rather than describing a figure. */
  readonly failed: boolean;
}

/**
 * The members card: how many people are in this workspace, and in what roles.
 *
 * `total` is the workspace's whole membership; the roles are counted from the rows that
 * came back, which is a page. When the two differ the caption says so rather than
 * describing a hundred people as though they were all of them.
 *
 * @param members The members listing, or why it failed.
 * @returns The card.
 */
export function memberStat(members: Reading<MemberPage>): Stat {
  if (!members.ok) return failedStat("members", "Members", members.reason);

  const page = members.value;
  const roles = roleBreakdown(page.items.map((member) => member.role));
  const partial = page.items.length < page.total;

  return {
    id: "members",
    label: "Members",
    value: String(page.total),
    delta:
      roles === ""
        ? "Nobody has joined yet."
        : partial
          ? `${roles} — of the first ${page.items.length}`
          : roles,
    failed: false,
  };
}

/** The roles a workspace can hold, in the order a breakdown lists them. */
const ROLE_ORDER: readonly Role[] = ["owner", "admin", "member", "viewer"];

/**
 * Count roles into a phrase — `2 owners · 1 member`.
 *
 * Ordered by seniority rather than by count, so the same workspace reads the same way from
 * one render to the next.
 *
 * @param roles One role per member, in any order.
 * @returns The phrase, or `""` when there are no members to count.
 */
export function roleBreakdown(roles: readonly Role[]): string {
  return ROLE_ORDER.filter((role) => roles.includes(role))
    .map((role) => {
      const count = roles.filter((held) => held === role).length;
      return `${count} ${count === 1 ? role : `${role}s`}`;
    })
    .join(" · ");
}

/**
 * The organisations card: how many are switched on, out of how many are recorded.
 *
 * A row records that an organisation is *known*; its flag records that somebody
 * deliberately turned it on (`app/api/orgs.ts`), so those are two different numbers and
 * both are shown.
 *
 * @param enablement The workspace's organisations and their repositories, or why it failed.
 * @returns The card.
 */
export function orgStat(enablement: Reading<Enablement>): Stat {
  if (!enablement.ok) return failedStat("orgs", "Organisations", enablement.reason);

  const { orgs, orgTotal } = enablement.value;
  const enabled = orgs.filter((entry) => entry.org.enabled).length;

  return {
    id: "orgs",
    label: "Organisations",
    value: String(enabled),
    delta:
      orgTotal === 0
        ? "None recorded — enable one on the sign-in screen."
        : `of ${orgTotal} recorded${orgs.length < orgTotal ? `, ${orgs.length} read` : ""}`,
    failed: false,
  };
}

/**
 * The repositories card: how many Ouroboros may actually work in.
 *
 * "In scope" is both flags, not one: a repository is in scope only when its own `enabled`
 * **and** its organisation's are true (`app/api/repos.ts`). Counting only the repository's
 * flag would report repositories as live while the switch above them is off, which is the
 * trap that rule exists to name — so the ones held back are counted separately and said out
 * loud.
 *
 * @param enablement The workspace's organisations and their repositories, or why it failed.
 * @returns The card.
 */
export function repoStat(enablement: Reading<Enablement>): Stat {
  if (!enablement.ok) return failedStat("repos", "Repositories", enablement.reason);

  const { orgs } = enablement.value;
  const total = orgs.reduce((sum, entry) => sum + entry.repoTotal, 0);
  const live = orgs
    .filter((entry) => entry.org.enabled)
    .reduce((sum, entry) => sum + entry.repos.filter((repo) => repo.enabled).length, 0);
  const held = orgs
    .filter((entry) => !entry.org.enabled)
    .reduce((sum, entry) => sum + entry.repos.filter((repo) => repo.enabled).length, 0);

  return {
    id: "repos",
    label: "Repositories",
    value: String(live),
    delta:
      total === 0
        ? "None recorded yet."
        : held === 0
          ? `of ${total} recorded`
          : `of ${total} recorded · ${held} held by a disabled organisation`,
    failed: false,
  };
}

/**
 * The loops card, which has no source to read.
 *
 * Nothing produces a loop yet — the engine gateway reports that the engine is *up*, not
 * what it is doing — so this is an em dash rather than a zero. "Zero loops are running" and
 * "nothing can tell you how many are running" are different facts, and only one of them is
 * true here.
 *
 * @returns The card.
 */
export function loopStat(): Stat {
  return {
    id: "loops",
    label: "Loops live",
    value: NO_VALUE,
    delta: "No run data yet — the loop engine arrives with mockup 10.",
    failed: false,
  };
}

/**
 * A card standing in for a figure that could not be read.
 *
 * @param id The card's identifier.
 * @param label Its caption.
 * @param reason What the service said. Shown as-is: every message in the contract's
 *   envelope is written for a person and names nothing about the service's internals
 *   (`app/api/errors.ts`).
 * @returns The card, carrying an em dash rather than a zero.
 */
function failedStat(id: string, label: string, reason: string): Stat {
  return { id, label, value: NO_VALUE, delta: reason, failed: true };
}

/**
 * Every card of the stat row, in the order the mockup's four columns take.
 *
 * @param members The members listing, or why it failed.
 * @param enablement The enablement list, or why it failed.
 * @returns The four cards.
 */
export function statRow(
  members: Reading<MemberPage>,
  enablement: Reading<Enablement>,
): readonly Stat[] {
  return [loopStat(), memberStat(members), orgStat(enablement), repoStat(enablement)];
}

/* ------------------------------------------------------------------ the page head */

/**
 * The line under the page's heading: who is looking, and at what.
 *
 * The workspace's own lifecycle is named only when it is not `active`, because a heading
 * that says "active" on every screen it can be reached from says nothing — and a suspended
 * one is the case somebody needs to be told about.
 *
 * @param workspace The active workspace, as the gate resolved it.
 * @param displayName The signed-in person's name.
 * @returns The subline.
 */
export function pageSubline(workspace: Membership, displayName: string): string {
  const lifecycle = workspace.status === "active" ? "" : ` · workspace ${workspace.status}`;
  return `${displayName} · ${workspace.role} of ${workspace.slug}${lifecycle}`;
}
