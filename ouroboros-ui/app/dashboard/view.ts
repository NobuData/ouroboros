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

import type {
  Dashboard,
  DashboardActivity,
  DashboardStats,
  RunStatus,
  RunSummary,
} from "@/app/api/dashboard";
import type { EngineStatus } from "@/app/api/engine";
import type { DependencyStatus, HealthReport } from "@/app/api/health";
import type { Membership } from "@/app/api/membership";
import type { SessionUser } from "@/app/api/identity";
import { compactNumber, durationOfMinutes, moneyOfCents } from "@/app/format";

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
   * When the page was read, in milliseconds since the epoch.
   *
   * One reading for the whole render, taken beside the reads themselves
   * (`app/dashboard/data.ts`), because two cards measuring *now* separately are two cards
   * that can disagree about it — and because a clock read inside a component is a clock no
   * test can pin. Today the active-loops table is its only reader; the completions card's
   * cycle times ([#84](https://github.com/NobuData/ouroboros/issues/84)) are the next.
   */
  readonly readAt: number;
  /**
   * The dashboard aggregate ([#70](https://github.com/NobuData/ouroboros/issues/70)), or why
   * it could not be read — every number, list and switch mockup 02 draws, in one payload.
   *
   * The page head reads its `activity` and the stat row its `stats`; the cards of I.3–I.6
   * read the rest. It is one {@link Reading} rather than six because it is one request: the
   * endpoint is decision F5's single round trip, so its failure is single too.
   */
  readonly aggregate: Reading<Dashboard>;
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

/**
 * How the line under a figure is drawn.
 *
 * It is a *tone* rather than a colour, because the sheet decides the colour and this
 * decides what the line is saying. The two directional ones are the mockups' own `up` and
 * `down` classes, and those name **goodness rather than direction** — mockup 15 draws
 * *"▼ 2m faster"* as `up`, because a cycle time that fell is good news. What is drawn on
 * this screen happens to agree in both directions, and the distinction is worth keeping in
 * the name so that the next card to use it does not read `up` as *the number went up*.
 */
export type DeltaTone =
  /** The default: a line describing what the figure is made of. */
  | "muted"
  /** Good news — the mockups' `--ok`. */
  | "up"
  /** Bad news — the mockups' `--err`. */
  | "down"
  /** Not news at all: the reason the figure could not be read. */
  | "failed";

/** One card in the stat row: a caption, a figure, and a line under it. */
export interface Stat {
  /** Stable identifier, and the React key. */
  readonly id: string;
  /** The caption above the figure. */
  readonly label: string;
  /** The figure, already formatted — {@link NO_VALUE} when it could not be read. */
  readonly value: string;
  /**
   * Whether the figure is drawn in the accent colour. The mockup gives exactly one card of
   * the four that treatment — *Loops live*, the one thing on the page that is happening
   * right now.
   */
  readonly accent: boolean;
  /**
   * The line under the figure: what it is made of, or why there is not one — or `null` for
   * a card that has nothing it can honestly say. {@link tokensStat} is the one case, and it
   * is there rather than a `$0.00` for a cost nobody has priced.
   */
  readonly delta: string | null;
  /** How that line is drawn. */
  readonly tone: DeltaTone;
}

/**
 * The active run statuses, in lifecycle order, and the word each one takes in the subline.
 *
 * The contract carries **every** active status as a key with a zero rather than omitting
 * the empty ones (`LoopsLive.byStatus`), precisely so this list is the only place that has
 * to know which statuses exist. `review` reads *in review* because the mockup's sentence
 * does — *"2 coding · 1 in review"* — and because *1 review* would count reviews rather
 * than runs.
 */
const LOOP_STATUSES: readonly (readonly [
  key: keyof DashboardStats["loopsLive"]["byStatus"],
  word: string,
])[] = [
  ["coding", "coding"],
  ["building", "building"],
  ["review", "in review"],
];

/** What the loops card says when the number under it is zero. */
export const NO_LOOPS = "Nothing is running right now.";

/**
 * *Loops live* — how many runs are in flight, and what each of them is doing.
 *
 * The figure is accented because this is the card the page is named after: everything else
 * in the row is a measurement of the past day or week, and this one is the present tense.
 *
 * **The subline is composed from `byStatus`, which is the run table's own arithmetic.** The
 * mockup prints *"2 coding · 1 in review"* over a table holding one run in each of three
 * statuses; decision F.5 settled that disagreement in favour of the table, so the seeded
 * workspace reads *"1 coding · 1 building · 1 in review"* here. Statuses holding nothing are
 * left out rather than printed as zeros — a queue of three should not read *"3 coding · 0
 * building · 0 in review"*.
 *
 * @param live The aggregate's `stats.loopsLive`.
 * @returns The card.
 */
export function loopsLiveStat(live: DashboardStats["loopsLive"]): Stat {
  const breakdown = LOOP_STATUSES.filter(([key]) => live.byStatus[key] > 0)
    .map(([key, word]) => `${live.byStatus[key]} ${word}`)
    .join(" · ");

  return {
    id: "loops",
    label: "Loops live",
    value: String(live.total),
    accent: true,
    delta: breakdown === "" ? NO_LOOPS : breakdown,
    tone: "muted",
  };
}

/** What the queue card says when nothing is waiting. */
export const EMPTY_QUEUE = "Nothing is waiting for a loop.";

/** What it says when there are issues waiting but nobody has sized any of them. */
export const UNSIZED_QUEUE = "None of them has been sized yet.";

/**
 * *Queued issues* — how many are waiting, and how long they are expected to take.
 *
 * **`estMinutes` skips the issues carrying no estimate rather than counting them as zero**
 * (`QueuedWork.estMinutes`), so the count can speak for more issues than the estimate does.
 * The line says *est.* for that reason and does not try to name the gap: the payload
 * carries the sum, not how many rows went into it, and a sentence that guessed would be the
 * one dishonest thing on the card. A queue where *nothing* is sized has no estimate at all,
 * which is a sentence rather than `est. 0m`.
 *
 * @param queued The aggregate's `stats.queued`.
 * @returns The card.
 */
export function queuedStat(queued: DashboardStats["queued"]): Stat {
  return {
    id: "queued",
    label: "Queued issues",
    value: String(queued.count),
    accent: false,
    delta:
      queued.count === 0
        ? EMPTY_QUEUE
        : queued.estMinutes === 0
          ? UNSIZED_QUEUE
          : `est. ${durationOfMinutes(queued.estMinutes)} of autonomous work`,
    tone: "muted",
  };
}

/** The glyph on a week that merged more than the one before it. */
const UP_ARROW = "▲";

/** The glyph on a week that merged less. */
const DOWN_ARROW = "▼";

/** What the merged card says when the two weeks came out the same. */
export const LEVEL_WITH_LAST_WEEK = "Level with last week";

/**
 * *PRs merged · 7d* — the count, and how it compares with the week before.
 *
 * `deltaVsPrior` is signed (`MergedSevenDays.deltaVsPrior`), so the direction is read from
 * the sign and nothing else. Three cases, and the third is the one that is easy to get
 * wrong: a week that matched the one before is **not** an up week with a zero on it, so it
 * takes neither an arrow nor a colour.
 *
 * **The arrow is the direction, not the colour.** A reader who cannot separate green from
 * red still has a glyph that points, which is the design system's rule about never carrying
 * meaning in hue alone (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.4) applied to a line of text.
 *
 * @param merged The aggregate's `stats.merged7d`.
 * @returns The card.
 */
export function mergedStat(merged: DashboardStats["merged7d"]): Stat {
  const change = merged.deltaVsPrior;
  const rose = change > 0;

  return {
    id: "merged",
    label: "PRs merged · 7d",
    value: String(merged.count),
    accent: false,
    delta:
      change === 0
        ? LEVEL_WITH_LAST_WEEK
        : `${rose ? UP_ARROW : DOWN_ARROW} ${Math.abs(change)} vs last week`,
    tone: change === 0 ? "muted" : rose ? "up" : "down",
  };
}

/** What the token card says on a day nothing has been spent on. */
export const NO_USAGE_TODAY = "No usage recorded today.";

/**
 * *Token spend · today* — the day's tokens, and what they cost.
 *
 * The figure is the compacted token count (`4.2M`); the line under it is the money, and it
 * is the one line on this row that can be **absent**. See {@link costLine}.
 *
 * @param today The aggregate's `stats.tokensToday`.
 * @returns The card.
 */
export function tokensStat(today: DashboardStats["tokensToday"]): Stat {
  return {
    id: "tokens",
    label: "Token spend · today",
    value: compactNumber(today.tokens),
    accent: false,
    delta: costLine(today),
    tone: "muted",
  };
}

/**
 * What the day cost, or nothing at all.
 *
 * Three states, and the middle one is this card's whole reason for existing:
 *
 * - **Nothing was recorded.** No provider was called today, so there is no cost and no
 *   lower bound either — a sentence, not `$0.00 across 0 providers`.
 * - **Nothing that was recorded has a price.** `costCents` is a sum over the events that
 *   carry one (`TokensToday.costCents`), so a day of purely unpriced usage — local
 *   inference on a workstation is the honest case of it — sums to zero while having cost
 *   *something unknown*. **The line is hidden rather than drawn as `$0`**, which is the
 *   ticket's own acceptance criterion and the rule
 *   [#92](https://github.com/NobuData/ouroboros/issues/92) is being written to satisfy
 *   properly: it makes the cost explicitly null and gives the card a *cost unavailable*
 *   line to draw. Until then, saying nothing beats saying zero.
 * - **Something was priced.** The amount, with `≈` in front of it whenever
 *   `unpricedEvents` is non-zero — that is exactly what the `≈` in the mockup means, and it
 *   is what makes *"≈ $18.60"* an honest floor rather than a rounded total. A day where
 *   every event is priced gets no `≈`, because the figure is then exact.
 *
 * @param today The aggregate's `stats.tokensToday`.
 * @returns The line, or `null` when there is no honest one to draw.
 */
function costLine(today: DashboardStats["tokensToday"]): string | null {
  if (today.providers === 0) return NO_USAGE_TODAY;
  if (today.costCents === 0 && today.unpricedEvents > 0) return null;

  const approximately = today.unpricedEvents > 0 ? "≈ " : "";

  return `${approximately}${moneyOfCents(today.costCents)} across ${countOf(today.providers, "provider")}`;
}

/**
 * The four cards, in the order the mockup's columns take them.
 *
 * **The stat row is one read, so it fails as one.** Every figure on it comes from the
 * aggregate — decision F5's single round trip — and a refused aggregate leaves all four
 * carrying an em dash and the service's reason rather than four zeros. That is the same
 * rule the page head's subline is written under: *nothing is running* and *nobody could ask
 * what is running* must not render alike. The per-card treatment of that state — a banner
 * rather than four repetitions of one sentence — is
 * [#86](https://github.com/NobuData/ouroboros/issues/86)'s.
 *
 * @param aggregate The dashboard aggregate, or why it could not be read.
 * @returns The four cards.
 */
export function statRow(aggregate: Reading<Dashboard>): readonly Stat[] {
  if (!aggregate.ok) {
    return FAILED_ROW.map(([id, label]) => failedStat(id, label, aggregate.reason));
  }

  const { stats } = aggregate.value;

  return [
    loopsLiveStat(stats.loopsLive),
    queuedStat(stats.queued),
    mergedStat(stats.merged7d),
    tokensStat(stats.tokensToday),
  ];
}

/**
 * The row's four identities, for the render where no figure could be read.
 *
 * The captions still come from here rather than from the payload, so a page whose aggregate
 * was refused keeps its shape and its labels — four named cards holding em dashes, which is
 * a page reporting a failure rather than a page that lost its stat row.
 */
const FAILED_ROW: readonly (readonly [id: string, label: string])[] = [
  ["loops", "Loops live"],
  ["queued", "Queued issues"],
  ["merged", "PRs merged · 7d"],
  ["tokens", "Token spend · today"],
];

/**
 * A card standing in for a figure that could not be read.
 *
 * @param id The card's identifier.
 * @param label Its caption.
 * @param reason What the service said. Shown as-is: every message in the contract's
 *   envelope is written for a person and names nothing about the service's internals
 *   (`app/api/errors.ts`).
 * @returns The card, carrying an em dash rather than a zero — and never the accent, which
 *   is reserved for a figure that is actually reporting something.
 */
function failedStat(id: string, label: string, reason: string): Stat {
  return { id, label, value: NO_VALUE, accent: false, delta: reason, tone: "failed" };
}

/* ------------------------------------------------------------------ active loops */

/**
 * One run in flight, as the *Active loops* table draws it.
 *
 * Every field is already the thing the cell renders — a caption rather than three numbers, a
 * percentage rather than a division — so the component holds no arithmetic and every rule
 * below is a unit test on a function. The two exceptions are `status`, which decides two
 * different hues and so is mapped where the hues live
 * (`app/dashboard/active-loops-card.tsx`), and the pair of clock readings, which is the one
 * value on this page that keeps changing after the render.
 */
export interface ActiveLoop {
  /** The run — the React key, and what the run console will be addressed by. */
  readonly id: string;
  /** The issue's number, drawn in mono. */
  readonly issueNumber: number;
  /** Its title, as it was when the run started. */
  readonly issueTitle: string;
  /** The workflow's label, as free text — opaque, so it is rendered rather than parsed. */
  readonly workflowTag: string;
  /**
   * The model identifier as recorded — `claude-fable-5`, `ollama/qwen3-coder`. **Opaque**
   * (decision F8): there is no model catalogue in this product yet, so nothing here splits
   * it on a slash, shortens it or maps it to a prettier name.
   */
  readonly model: string;
  /** What the run is doing, which decides its pill and its meter. */
  readonly status: RunStatus;
  /** The caption over the meter — `Implementing · 4/6`. */
  readonly stageCaption: string;
  /** How far through its workflow it is, `0`–`100`. See {@link stagePercent}. */
  readonly stagePercent: number;
  /**
   * When the run started, in whole seconds since the epoch, or `null` when the timestamp
   * could not be read. The origin the elapsed column counts from — see {@link ActiveLoop.elapsedSeconds}.
   */
  readonly startedAtSeconds: number | null;
  /**
   * How long it had been running when this render was made, or `null` when there is no
   * start to measure from.
   *
   * It is *the server's* reading, and the client keeps counting from the origin rather than
   * from this figure (`app/dashboard/elapsed.tsx`), which is what makes the column tick
   * between polls without a poll ever being able to move it backwards.
   */
  readonly elapsedSeconds: number | null;
}

/** Milliseconds in a second, for the two conversions below. */
const MS_PER_SECOND = 1000;

/**
 * The caption over a stage meter — `Implementing · 4/6`.
 *
 * The workflow's own word for the step, then where in the workflow it is. Both come from the
 * run: there is no workflow catalogue in this product (decision F8's sibling), so a run that
 * reports `Build farm · 5/7` is drawn saying that whatever any workflow definition says
 * today.
 *
 * @param label The workflow's word for the current step.
 * @param index Which step it is on.
 * @param total How many steps the workflow has.
 * @returns The caption.
 */
export function stageCaption(label: string, index: number, total: number): string {
  return `${label} · ${index}/${total}`;
}

/**
 * How full a stage meter is drawn, as a whole percentage.
 *
 * **Rounded down, never up.** A run four steps into six is `66%`, not `67%`: a progress bar
 * is a claim about work that has finished, and the only honest way to round one is towards
 * the work that certainly has. It also means `100%` is reachable only by a run that has
 * actually reached its last step — a bar that read *full* one step early would be the
 * clearest possible way for this card to lie.
 *
 * @param index Which step the run is on. Clamped into `0…total`, so a run reporting a step
 *   past the end of its own workflow draws a full bar rather than one past its track.
 * @param total How many steps the workflow has. The contract guarantees at least one so that
 *   a meter never divides by zero; a payload that broke that promise is drawn empty rather
 *   than crashing the card.
 * @returns The percentage, `0`–`100`.
 */
export function stagePercent(index: number, total: number): number {
  if (!Number.isFinite(index) || !Number.isFinite(total) || total <= 0) return 0;

  return Math.floor((Math.min(Math.max(index, 0), total) / total) * 100);
}

/**
 * When a run started, in whole seconds since the epoch.
 *
 * @param startedAt The contract's `date-time`.
 * @returns The instant, or `null` when the string is not one — every timestamp in the
 *   contract is required and well formed, so this is the guard rather than the expected
 *   case: a row carrying a broken stamp loses its elapsed cell and keeps its other five,
 *   which beats a card that renders `NaNm NaNs` and beats one that throws.
 */
function startedAtSeconds(startedAt: string): number | null {
  const parsed = Date.parse(startedAt);

  return Number.isNaN(parsed) ? null : Math.floor(parsed / MS_PER_SECOND);
}

/**
 * The runs in flight, as the table's rows.
 *
 * The order is the payload's — lifecycle order, oldest first within a stage, so the run that
 * has been stuck longest is at the top of its group — and it is deliberately not re-sorted
 * here: the endpoint sorts over the whole table, and a client that sorted its ten rows again
 * would produce a different order from the drill-in that shows all of them.
 *
 * **At most ten arrive**, because the aggregate caps the slice there; this renders what it
 * was given rather than capping again, so a cap that changes in one place does not have to be
 * changed in two. What is *not* in the slice is reported by {@link moreActiveLoops}.
 *
 * @param runs The aggregate's `activeRuns`.
 * @param nowMs What time it is, as one reading taken by the caller — one for the whole
 *   table, so two rows of the same render can never be measured against two different
 *   instants. It is a parameter rather than a `Date.now()` inside this module because this
 *   module is pure, and because a duration nobody can pin is a duration nobody can test.
 * @returns The rows, in the order they are drawn.
 */
export function activeLoops(
  runs: readonly RunSummary[],
  nowMs: number,
): readonly ActiveLoop[] {
  const now = Math.floor(nowMs / MS_PER_SECOND);

  return runs.map((run) => {
    const started = startedAtSeconds(run.startedAt);

    return {
      id: run.id,
      issueNumber: run.issueNumber,
      issueTitle: run.issueTitle,
      workflowTag: run.workflowTag,
      model: run.model,
      status: run.status,
      stageCaption: stageCaption(run.stageLabel, run.stageIndex, run.stageTotal),
      stagePercent: stagePercent(run.stageIndex, run.stageTotal),
      startedAtSeconds: started,
      // Clamped at zero: a run whose start is in the future is a clock disagreeing with
      // another clock, and `-3s` on the page would report that as a fact about the run.
      elapsedSeconds: started === null ? null : Math.max(0, now - started),
    };
  });
}

/**
 * How many runs are in flight that the table is not showing.
 *
 * The aggregate answers at most ten rows and a count that is not capped, so the two together
 * are what the *+N more* footer says. It is a subtraction rather than a flag because the two
 * figures are separately true: a workspace running twelve loops shows ten and says *2 more*.
 *
 * @param total The workspace's live count — `stats.loopsLive.total`.
 * @param shown How many rows the table drew.
 * @returns The remainder, or `0` — which is also what a count that somehow ran behind its own
 *   slice produces, because *−1 more* is not a thing this card will ever say.
 */
export function moreActiveLoops(total: number, shown: number): number {
  return Math.max(0, total - shown);
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
