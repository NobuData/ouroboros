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

import type { Dashboard, DashboardActivity } from "@/app/api/dashboard";
import type { Enablement } from "@/app/api/enablement";
import type { EngineStatus } from "@/app/api/engine";
import type { DependencyStatus, HealthReport } from "@/app/api/health";
import type { MemberPage } from "@/app/api/members";
import type { Membership, Role } from "@/app/api/membership";
import type { SessionUser } from "@/app/api/identity";

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
  /**
   * The dashboard aggregate ([#70](https://github.com/NobuData/ouroboros/issues/70)), or why
   * it could not be read — every number, list and switch mockup 02 draws, in one payload.
   *
   * The page head reads its `activity`; the cards of I.2–I.6 read the rest. It is one
   * {@link Reading} rather than six because it is one request: the endpoint is decision F5's
   * single round trip, so its failure is single too.
   */
  readonly aggregate: Reading<Dashboard>;
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
 * Count something, in words that agree with the number.
 *
 * Exported because the page head is not the last place on this screen that has to say
 * *1 issue* and *12 issues* without a second copy of the rule — the queue card and the
 * completions card both count rows — and because "correct pluralization" is an acceptance
 * criterion, which makes it worth a test of its own rather than one inferred from a
 * sentence.
 *
 * @param count How many.
 * @param singular The noun for exactly one.
 * @param plural The noun for any other number. Defaults to `singular` with an `s`, which
 *   is right for every noun this screen counts; pass one for the day it is not.
 * @returns The number and the noun — `1 issue`, `12 issues`, `0 issues`.
 */
export function countOf(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Which part of the day it is where the reader is.
 *
 * A named part rather than an hour, because that is all the greeting needs and it makes the
 * boundaries something a test can name.
 */
export type Daypart = "morning" | "afternoon" | "evening";

/** The hour the morning starts. Before it, the night is still the evening's. */
const MORNING_FROM = 5;

/** The hour the afternoon starts — noon, which is what the word means. */
const AFTERNOON_FROM = 12;

/** The hour the evening starts, and runs to the following {@link MORNING_FROM}. */
const EVENING_FROM = 18;

/**
 * The daypart an hour falls in.
 *
 * The hours before {@link MORNING_FROM} are the *evening's* rather than a fourth part: the
 * mockup's greeting has three, and somebody working at two in the morning is at the end of
 * a long evening rather than at the start of a night that would need its own word.
 *
 * @param hour The reader's local hour, `0`–`23`, as `Date.getHours()` reports it.
 * @returns Which part of the day it is.
 */
export function daypartAt(hour: number): Daypart {
  if (hour >= MORNING_FROM && hour < AFTERNOON_FROM) return "morning";
  if (hour >= AFTERNOON_FROM && hour < EVENING_FROM) return "afternoon";
  return "evening";
}

/** What each daypart is greeted with. */
const DAYPART_GREETING: Record<Daypart, string> = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
};

/**
 * The greeting for a render that does not know what time it is where the reader is.
 *
 * The server is one such render and so is the hydration pass that has to match it
 * (`app/shell/client-value.ts`), so this is what the heading says for the moment between
 * the two. It is a greeting rather than a blank or a skeleton because the heading is the
 * page's `h1`: a title that appears after hydration is a page with no outline until then.
 */
export const NEUTRAL_GREETING = "Hello";

/**
 * The first name to greet somebody by.
 *
 * The mockup says *Ken*, not *Ken Suenobu* — a greeting uses the name a person is called,
 * and the session carries the one they registered with. Everything after the first
 * whitespace is dropped rather than parsed: a display name has no reliable structure, and
 * the first word is the only part of one that is usually a given name.
 *
 * @param displayName The signed-in person's name, as the session reports it.
 * @returns The first word of it, or `""` when there is no name to use — a session may
 *   carry an empty one, and *Good afternoon, .* would be worse than no name at all.
 */
export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/, 1)[0] ?? "";
}

/**
 * What the loop is doing, as the greeting's closing clause.
 *
 * @param activity The aggregate's activity, or `null` when it could not be read.
 * @returns The clause, or `null` when nothing can say — in which case the greeting ends
 *   after the name rather than making a claim about a loop nobody could ask about.
 */
function loopClause(activity: DashboardActivity | null): string | null {
  if (activity === null) return null;
  return activity.inFlight > 0 ? "the loop is turning" : "the loop is idle";
}

/**
 * The page's heading — *"Good afternoon, Ken — the loop is turning."*
 *
 * **The daypart is the client's** (decision F7): it comes from the browser's clock, because
 * a server rendering somebody's afternoon renders it in the wrong hemisphere, and it is
 * `null` on the server render and on the hydration pass that must match it.
 *
 * **The closing clause is the server's**, and it is a fact rather than a flourish. The
 * mockup's *"the loop is turning"* is true of a workspace with three runs in flight and
 * false of a workspace with none, so it is read from the aggregate; a workspace that could
 * not be read gets no clause at all rather than an optimistic one.
 *
 * @param daypart Which part of the day it is where the reader is, or `null` where nothing
 *   knows yet.
 * @param displayName The signed-in person's name, as the session reports it.
 * @param activity The aggregate's activity, or `null` when it could not be read.
 * @returns One sentence, complete in every combination of the three.
 */
export function greeting(
  daypart: Daypart | null,
  displayName: string,
  activity: DashboardActivity | null,
): string {
  const word = daypart === null ? NEUTRAL_GREETING : DAYPART_GREETING[daypart];
  const name = firstName(displayName);
  const clause = loopClause(activity);

  return `${word}${name === "" ? "" : `, ${name}`}${clause === null ? "" : ` — ${clause}`}.`;
}

/**
 * What a workspace with nothing in it says instead of three zeros.
 *
 * The acceptance criterion asks that the line "read sensibly for an empty organization",
 * and *0 issues in flight, 0 queued behind them* is sensible only in the sense of being
 * arithmetically true. A fresh workspace has not failed at anything; it has not started,
 * and the honest quiet version of the sentence says what would make it start.
 */
export const QUIET_SUBLINE =
  "Nothing is running yet — the loop starts when an issue reaches the queue.";

/**
 * What is in flight and what is behind it — the subline's first sentence.
 *
 * @param inFlight Runs in flight.
 * @param queued Issues waiting.
 * @returns The sentence, in whichever of its four shapes the two numbers call for.
 */
function flightSentence(inFlight: number, queued: number): string {
  const behind = inFlight === 1 ? "it" : "them";

  if (inFlight === 0) {
    return queued === 0
      ? "Nothing in flight, and the queue is empty."
      : `Nothing in flight; ${countOf(queued, "issue")} waiting for a loop.`;
  }

  return queued === 0
    ? `${countOf(inFlight, "issue")} in flight, and nothing queued behind ${behind}.`
    : `${countOf(inFlight, "issue")} in flight, ${queued} queued behind ${behind}.`;
}

/**
 * What has merged since the day began — the subline's second sentence.
 *
 * **It names the boundary rather than saying "this morning".** The mockup's prose is
 * *"merged 6 pull requests since this morning"*, and the figure behind it is counted from
 * **midnight UTC** — the same boundary the day's token spend uses, so the sentence and the
 * card cannot mean different mornings. For a reader thirteen hours away that is not this
 * morning, and a page whose whole argument is that its numbers are real should not round a
 * timezone off the only figure on it that has one.
 *
 * @param merged Runs merged since midnight UTC.
 * @returns The sentence.
 */
function mergedSentence(merged: number): string {
  return merged === 0
    ? "Nothing has merged since midnight UTC."
    : `Ouroboros merged ${countOf(merged, "pull request")} since midnight UTC.`;
}

/** The page head's subline, and whether it is reporting a failure rather than an activity. */
export interface Subline {
  /** The line itself. */
  readonly text: string;
  /** Whether {@link Subline.text} is why the aggregate could not be read. */
  readonly failed: boolean;
}

/**
 * The line under the greeting: what the loop is doing right now.
 *
 * @param aggregate The dashboard aggregate, or why it could not be read.
 * @returns The line, marked as a failure when it is the service's reason rather than a
 *   description of the workspace. A failed read is *never* rendered as an empty workspace:
 *   "nothing is running" and "nobody could ask what is running" are different facts, which
 *   is the same rule the stat row's em dash is written under.
 */
export function pageSubline(aggregate: Reading<Dashboard>): Subline {
  if (!aggregate.ok) return { text: aggregate.reason, failed: true };

  const { inFlight, queued, mergedSinceMorning } = aggregate.value.activity;

  if (inFlight === 0 && queued === 0 && mergedSinceMorning === 0) {
    return { text: QUIET_SUBLINE, failed: false };
  }

  return {
    text: `${flightSentence(inFlight, queued)} ${mergedSentence(mergedSinceMorning)}`,
    failed: false,
  };
}
