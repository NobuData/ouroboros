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
  LoopPulse,
  QueueEffort,
  QueueItemSummary,
  RunStatus,
  RunSummary,
} from "@/app/api/dashboard";
import type { EngineStatus } from "@/app/api/engine";
import type { DependencyStatus, HealthReport } from "@/app/api/health";
import type { Membership } from "@/app/api/membership";
import type { SessionUser } from "@/app/api/identity";
import {
  compactNumber,
  durationOfMinutes,
  elapsedOfSeconds,
  moneyOfCents,
} from "@/app/format";

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
   * test can pin.
   *
   * The active-loops table is its only reader, and the completions card
   * ([#84](https://github.com/NobuData/ouroboros/issues/84)) is the card that shows why: its
   * *Cycle* column is `finishedAt − startedAt`, two instants the payload already carries, so
   * it needs no clock at all. Only a duration that is still running needs a *now*.
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

/** Milliseconds in a minute, which is the unit a finished run's cycle is drawn in. */
const MS_PER_MINUTE = MS_PER_SECOND * 60;

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
 * What a card's *+N* footer says: how many of a thing there are that it is not showing.
 *
 * Two cards on this page draw a slice of something the aggregate also counts in full — the
 * loops table over `activeRuns`, the queue card over `queueHead` — so both need the same
 * subtraction, and one of them getting it wrong is exactly the kind of drift that would not
 * show up in a screenshot. It is a subtraction rather than a flag because the two figures are
 * separately true: a workspace running twelve loops shows ten and says *2 more*.
 *
 * @param total How many there are, uncapped.
 * @param shown How many the card drew.
 * @returns The remainder, or `0` — which is also what a count that somehow ran behind its own
 *   slice produces, because *−1 more* is not a thing either card will ever say.
 */
function beyondTheSlice(total: number, shown: number): number {
  return Math.max(0, total - shown);
}

/**
 * How many runs are in flight that the table is not showing.
 *
 * The aggregate answers at most ten rows and a count that is not capped, so the two together
 * are what the *+N more* footer says.
 *
 * @param total The workspace's live count — `stats.loopsLive.total`.
 * @param shown How many rows the table drew.
 * @returns The remainder — see {@link beyondTheSlice}.
 */
export function moreActiveLoops(total: number, shown: number): number {
  return beyondTheSlice(total, shown);
}

/* -------------------------------------------------------------------- the loop pulse */

/**
 * Which hue a pulse meter takes.
 *
 * A subset of the design system's meter tones (`app/ui/meter.tsx`), written as its own union
 * so this module stays what its header says it is — pure, and dependent on nothing that
 * draws. The three hues are fixed by the mockup rather than derived from data: a merge rate
 * reports an outcome (`ok`), a cycle time reports progress through a budget (`accent`), and
 * an intervention is by definition something that wanted a person (`warn`). None of them
 * changes with the figure, which is deliberate — a bar that turned red when a number got
 * worse would be this card inventing a threshold nobody has agreed on.
 */
export type PulseTone = "ok" | "accent" | "warn";

/** One row of the pulse card: a caption, a figure, and the bar under them. */
export interface PulseMeter {
  /** Stable identifier, and the React key. */
  readonly id: string;
  /** What the row is called, as the mockup captions it. */
  readonly label: string;
  /** The window it is measured over, in words — the card prints it beside the caption. */
  readonly window: string;
  /** The figure, in the mono treatment the mockup gives it. */
  readonly value: string;
  /**
   * How full the bar is, `0`–`1`.
   *
   * **Rounded to a whole percent.** A proportion measured against a target somebody chose
   * is a gauge, not a measurement, and a bar drawn to a tenth of a percent would claim a
   * precision its own denominator does not have. It also keeps the bar and the figure
   * beside it from ever disagreeing: `92%` printed is `92%` drawn.
   */
  readonly fill: number;
  /** Which hue the bar and the figure take. */
  readonly tone: PulseTone;
  /** What a screen reader hears instead of the bare percentage. */
  readonly valueText: string;
}

/**
 * The window the merge rate is measured over, in words.
 *
 * **Fourteen days, where the two below are seven**, and the card prints it because the head's
 * `7 days` tag would otherwise speak for a figure it does not cover. The contract's own
 * description of `pulse.mergeRate` is where the reason lives: the mockup's `92%`, its `27
 * merged / 7d` and its `2 interventions` cannot all be true of one seven-day window, and over
 * fourteen the seeded rows give 46 merged of 50 closed — `0.92` exactly.
 */
export const MERGE_RATE_WINDOW = "14 days";

/** The window the cycle time and the intervention count are measured over. */
export const PULSE_WINDOW = "7 days";

/**
 * The cycle time a full bar stands for — thirty minutes, in seconds.
 *
 * The mockup draws `14m 20s` at 48% of its track, and this is that number written down: a
 * bar needs a denominator, the payload carries none, and a width nobody can explain is a
 * width nobody can check. Thirty minutes is the round figure closest to what the mockup drew
 * (860 ÷ 1800 = 47.8%, which rounds to the mockup's 48%), and it reads as a target rather
 * than as a limit: **the bar fills as a cycle uses up the half hour**, so less is better and
 * a full bar is a loop taking longer than the workspace hoped.
 *
 * A cycle longer than the target clamps at full rather than overflowing — `app/ui/meter.tsx`
 * refuses to draw past its own track — and the figure beside it is the measurement, always.
 */
export const CYCLE_TIME_TARGET_SECONDS = 30 * 60;

/**
 * The interventions a full bar stands for — a week's budget.
 *
 * The mockup draws `2` at 8%, which is 2 ÷ 25 exactly, and twenty-five is a reasonable week's
 * tolerance for a workspace running the loop continuously. Like the cycle target it is a
 * number this product chose rather than one the service reports, so it is written down here,
 * exported, and covered by a test — and the day a workspace can set its own, this constant is
 * the one thing that changes.
 */
export const INTERVENTION_BUDGET_7D = 25;

/** What the pulse card says when nothing has closed in either window. */
export const PULSE_UNMEASURED =
  "No runs have finished yet, so these three have nothing to measure.";

/**
 * A number the contract promised, or zero.
 *
 * The three pulse figures are `number` in the schema and the service computes each of them
 * from a query that cannot answer anything else — but a card is drawn from a payload, and a
 * `NaN` reaching a meter would draw a bar of `NaN%` rather than fail. Zero is the honest
 * reading of a figure that arrived as no figure at all.
 *
 * @param value Whatever arrived.
 * @returns It, or `0` when it is not a finite number.
 */
function measured(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * A fraction as a whole percent, `0`–`1`.
 *
 * @param part The numerator.
 * @param whole The denominator. A zero or a negative one reads as *nothing to measure*
 *   rather than as a division: an empty bar is the honest drawing of a ratio nobody can take.
 * @returns The fraction, rounded to a whole percent and clamped to the track — so no figure,
 *   however unlikely, can draw a bar past its own end or behind its own start.
 */
function barFill(part: number, whole: number): number {
  if (!(whole > 0)) return 0;

  return Math.min(1, Math.max(0, Math.round((measured(part) / whole) * 100) / 100));
}

/**
 * Whether the pulse has anything to report at all.
 *
 * All three figures are floors rather than measurements when no run has closed in the
 * window — the contract says so of each of them — and a workspace that has never finished a
 * run would otherwise read as one that merges nothing, takes no time and needs no help. The
 * three are checked together because that is the only state in which all three are zero at
 * once: a workspace that has closed runs has a cycle time, and one that closed them badly has
 * interventions.
 *
 * The card draws a note for it. **The designed zero state is
 * [#86](https://github.com/NobuData/ouroboros/issues/86)'s**, which does this for every card
 * at once; this is the sentence that keeps the meters honest until then.
 *
 * @param pulse The aggregate's pulse figures.
 * @returns Whether every one of them is a floor.
 */
export function pulseIsUnmeasured(pulse: LoopPulse): boolean {
  return pulse.mergeRate === 0 && pulse.avgCycleSeconds === 0 && pulse.interventions7d === 0;
}

/**
 * The pulse card's three meters, in the mockup's order.
 *
 * Every width on this card is a ratio against a denominator, and only one of the three
 * denominators comes from the service — the merge rate is already a fraction. The other two
 * are {@link CYCLE_TIME_TARGET_SECONDS} and {@link INTERVENTION_BUDGET_7D}, chosen here,
 * written down, and exported so a test can state the arithmetic rather than a screenshot.
 *
 * @param pulse The aggregate's pulse figures.
 * @returns The three rows, each with its figure and its bar.
 */
export function pulseMeters(pulse: LoopPulse): readonly PulseMeter[] {
  const rate = Math.round(measured(pulse.mergeRate) * 100);
  const interventions = measured(pulse.interventions7d);

  return [
    {
      id: "merge-rate",
      label: "Autonomous merge rate",
      window: MERGE_RATE_WINDOW,
      value: `${rate}%`,
      // The rate is a fraction already, so its bar is the figure itself rather than a
      // proportion of anything this module chose. It is the one meter here that needs no
      // denominator, and the one whose width nobody has to be told how to read.
      fill: barFill(rate, 100),
      tone: "ok",
      valueText: `${rate}% of runs merged without a person, over ${MERGE_RATE_WINDOW}`,
    },
    {
      id: "cycle-time",
      label: "Avg. cycle time",
      window: PULSE_WINDOW,
      value: elapsedOfSeconds(pulse.avgCycleSeconds),
      fill: barFill(pulse.avgCycleSeconds, CYCLE_TIME_TARGET_SECONDS),
      tone: "accent",
      valueText:
        `${elapsedOfSeconds(pulse.avgCycleSeconds)} of the ` +
        `${elapsedOfSeconds(CYCLE_TIME_TARGET_SECONDS)} target, over ${PULSE_WINDOW}`,
    },
    {
      id: "interventions",
      label: "Human interventions",
      window: PULSE_WINDOW,
      // The mockup's own words. A count with no unit beside it would be the one figure on
      // this card that does not say what it is a count of.
      value: `${interventions} this week`,
      fill: barFill(interventions, INTERVENTION_BUDGET_7D),
      tone: "warn",
      valueText:
        `${countOf(interventions, "run")} needed a person, of the ` +
        `${INTERVENTION_BUDGET_7D} this workspace allows for in ${PULSE_WINDOW}`,
    },
  ];
}

/**
 * Why a reader may look at the auto-merge switch and not press it.
 *
 * The design system's § 3.3 permission-limited state in one sentence: the control renders,
 * in its real position, with this as its tooltip and its description. Hiding it from a member
 * would leave a card that looks like it has no setting, and disabling the button would take
 * the explanation out of the tab order along with the control.
 *
 * It is the same fact `app/dashboard/pulse-actions.ts` answers a forged write with, in the
 * same words — the switch's tooltip and the service's refusal should not read as two
 * different rules.
 */
export const AUTO_MERGE_READ_ONLY =
  "Only an owner or an admin can change auto-merge for this workspace.";

/** What the switch says when the service refused and gave nothing a person could read. */
export const AUTO_MERGE_WRITE_FAILURE = "Auto-merge could not be changed.";

/**
 * What the switch's write answers.
 *
 * It describes a Server Action's return value and lives here rather than beside the action
 * for a mechanical reason worth knowing: a `"use server"` module may export nothing but async
 * functions, so a type or a constant declared in one is a build error. Everything about this
 * card that is not the call itself is therefore in this module — which is also where the
 * sentence a refusal carries is written, so the switch's tooltip and the action's answer
 * cannot drift into two different rules.
 */
export type AutoMergeResult =
  /** It persisted. The position is read back from the row, not echoed from the request. */
  | { readonly ok: true; readonly enabled: boolean }
  /** It did not, with the sentence to show for it. */
  | { readonly ok: false; readonly reason: string };

/* --------------------------------------------------------------- recently closed */

/**
 * One run that has stopped, as the *Recently closed* table draws it.
 *
 * Every field is already the thing the cell renders — a pair rather than two numbers, a
 * duration rather than two timestamps, a fraction rather than two counts — so the card holds
 * no arithmetic. `status` is the one exception, for {@link ActiveLoop}'s reason: it decides a
 * hue and a word, and both live where the hues do
 * (`app/dashboard/recently-closed-card.tsx`).
 */
export interface Completion {
  /** The run — the React key, and what the run console will be addressed by. */
  readonly id: string;
  /**
   * The mockup's `#474 → PR #512`, drawn in mono. See {@link issuePair} for the run that
   * stopped before there was a pull request to name.
   */
  readonly pair: string;
  /** The issue's title, as it was when the run started. */
  readonly issueTitle: string;
  /**
   * The model identifier as recorded. **Opaque** (decision F8), exactly as it is in the
   * active table: rendered, never parsed.
   */
  readonly model: string;
  /** How the run ended, which decides its outcome pill. */
  readonly status: RunStatus;
  /** How long the run took, start to finish — {@link NO_VALUE} when it cannot be measured. */
  readonly cycle: string;
  /** The checks that passed over the checks there were — `14/14`, or {@link NO_VALUE}. */
  readonly checks: string;
  /**
   * Whether fewer checks passed than ran, which is what the warn tint on the fraction
   * reports. See {@link checksShortfall}.
   */
  readonly checksShort: boolean;
  /**
   * How many checks did not pass, in words — the tooltip on a short fraction, and `null`
   * when there is nothing short to explain. It is here rather than in the card because it
   * counts, and counting in words is a rule this module owns ({@link countOf}).
   */
  readonly checksNote: string | null;
}

/**
 * How many of the aggregate's `recentRuns` the card draws.
 *
 * **Four of the eight that arrive**, which is the contract's own division of labour: the
 * endpoint answers eight so that a client expanding the card already holds them
 * (`Dashboard.recentRuns`), and the mockup draws four. The active-loops table renders
 * everything it is given because its slice *is* its card; this one is given twice what it
 * shows, so the number it shows is written down here rather than implied by a payload.
 */
export const COMPLETIONS_SHOWN = 4;

/** What separates an issue from its pull request in the mockup's pair. */
const PAIR_ARROW = "→";

/**
 * The no-break space the mockup puts inside `PR&nbsp;#512`.
 *
 * The pair is one value read as one thing, and a column narrow enough to break it would put
 * `PR` at the end of a line and `#512` at the start of the next. The space between the issue
 * and the arrow is an ordinary one, because that break is the honest place for one.
 *
 * Written as an escape rather than as the character itself: a no-break space is invisible
 * in a diff, which is the one property a character carrying a layout rule must not have.
 */
const NBSP = "\u00a0";

/**
 * The mockup's `#474 → PR #512`.
 *
 * **A run with no pull request is drawn as its issue alone.** The contract allows one
 * (`RunSummary.prNumber`) — a run may fail, or stop for a person, before there is anything to
 * open a pull request for — and an arrow pointing at nothing would be the row claiming half a
 * fact. The issue number is the part that is always true, so it is the part that is drawn.
 *
 * @param issueNumber The issue the loop ran against.
 * @param prNumber The pull request it opened, or `null` when it never got that far.
 * @returns The pair, or the issue on its own.
 */
export function issuePair(issueNumber: number, prNumber: number | null): string {
  return prNumber === null
    ? `#${issueNumber}`
    : `#${issueNumber} ${PAIR_ARROW} PR${NBSP}#${prNumber}`;
}

/**
 * How long a run took, start to finish — the mockup's `11m`.
 *
 * **The compact formatter, not the ticking one.** A cycle is over, so it drops its zero parts
 * the way an estimate does (`app/format.ts`): eleven minutes is `11m` rather than `11m 00s`,
 * and the padding that keeps a moving clock from twitching has nothing to keep still here.
 * It is [#81](https://github.com/NobuData/ouroboros/issues/81)'s `durationOfMinutes`, which is
 * also what the stat row's *Queued issues* estimate is drawn with, so two durations on one page
 * cannot be written two ways.
 *
 * @param startedAt When the loop started on the issue.
 * @param finishedAt When it reached a terminal status, or `null` while it has not.
 * @returns The span, rounded to the nearest minute — or {@link NO_VALUE} when there is no
 *   pair of instants to measure between. A run in this table always has both, so that is the
 *   guard rather than the expected case: a row carrying a broken stamp loses its cycle cell
 *   and keeps its other four, which beats `NaNm` and beats a card that throws.
 */
export function cycleTime(startedAt: string, finishedAt: string | null): string {
  if (finishedAt === null) return NO_VALUE;

  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);

  if (Number.isNaN(started) || Number.isNaN(finished)) return NO_VALUE;

  // A run that finished before it started is two clocks disagreeing rather than a negative
  // span, and `durationOfMinutes` already draws that as `0m`.
  return durationOfMinutes((finished - started) / MS_PER_MINUTE);
}

/**
 * The checks a run's pull request finished with — the mockup's `14/14`.
 *
 * The two counts are both present or both `null` in the contract, so one missing means the
 * fraction cannot be drawn at all. **`0/0` is not missing**: it is a repository with no
 * checks configured, which is a fact, and drawing it as an em dash would report a known thing
 * as an unknown one.
 *
 * @param passed Checks that passed, or `null` when nothing is known yet.
 * @param total Checks there were, or `null`.
 * @returns The fraction, or {@link NO_VALUE}.
 */
export function checksLabel(passed: number | null, total: number | null): string {
  return passed === null || total === null ? NO_VALUE : `${passed}/${total}`;
}

/**
 * How many checks did not pass.
 *
 * This is the warn tint on the fraction, and it is deliberately a comparison rather than a
 * reading of the status: `13/14` is short whatever the run went on to be called, and a row
 * that merged with a check outstanding should be as visible as one that stopped for it.
 *
 * @param passed Checks that passed, or `null`.
 * @param total Checks there were, or `null`.
 * @returns The shortfall, or `null` when there is not one — which is also the answer when
 *   either count is missing, so a fraction nobody could read is never tinted, and so is the
 *   answer for `0/0`, a repository with no checks rather than a run that failed them.
 */
export function checksShortfall(passed: number | null, total: number | null): number | null {
  if (passed === null || total === null || passed >= total) return null;

  return total - passed;
}

/**
 * The runs that have stopped, as the table's rows.
 *
 * The order is the payload's — newest first by `finishedAt` — and it is deliberately not
 * re-sorted here, for the reason {@link activeLoops} is not: the endpoint orders the whole
 * table, and a client that re-sorted its four rows would produce a different order from the
 * listing that shows all of them.
 *
 * @param runs The aggregate's `recentRuns`.
 * @returns The first {@link COMPLETIONS_SHOWN} of them, in the order they are drawn.
 */
export function recentCompletions(runs: readonly RunSummary[]): readonly Completion[] {
  return runs.slice(0, COMPLETIONS_SHOWN).map((run) => {
    const shortfall = checksShortfall(run.checksPassed, run.checksTotal);

    return {
      id: run.id,
      pair: issuePair(run.issueNumber, run.prNumber),
      issueTitle: run.issueTitle,
      model: run.model,
      status: run.status,
      cycle: cycleTime(run.startedAt, run.finishedAt),
      checks: checksLabel(run.checksPassed, run.checksTotal),
      checksShort: shortfall !== null,
      checksNote:
        shortfall === null ? null : `${countOf(shortfall, "check")} did not pass.`,
    };
  });
}

/* ------------------------------------------------------------------------- the queue */

/**
 * The five sizes an effort chip comes in, as the chip prints them.
 *
 * Written as its own union rather than imported from the design system, for the reason
 * {@link PulseTone} is: this module is pure and depends on nothing that draws. It is
 * structurally the primitive's own `Effort` (`app/ui/chip.tsx`), so the card assigning one of
 * these to a chip is checked at the boundary — a scale that gained a size on one side and not
 * the other is a build error rather than a chip that quietly renders nothing.
 */
export type EffortSize = "XS" | "S" | "M" | "L" | "XL";

/**
 * What each of the contract's sizes is called on the chip.
 *
 * The contract carries the scale lower-cased and the mockup prints it upper-cased, so this is
 * the whole of the difference — no other transformation, and nothing derived from the
 * estimate beside it. A `Record` over the contract's union rather than a `toUpperCase()`,
 * because a sixth size added to the service should stop the build here rather than reach the
 * card as a letter no chip has a hue for.
 */
const EFFORT_LABEL: Record<QueueEffort, EffortSize> = {
  xs: "XS",
  s: "S",
  m: "M",
  l: "L",
  xl: "XL",
};

/**
 * One issue waiting for a loop, as the *Up next in queue* card draws it.
 *
 * Every field is already the thing the row renders. The queue item carries two more —
 * `position` and `enqueuedAt` — and neither is drawn: the rows are *in* queue order, so a
 * printed position would say twice what the order already says, and *when it joined* is the
 * listing's column ([#73](https://github.com/NobuData/ouroboros/issues/73)) rather than this
 * card's. `estMinutes` is not drawn either; the stat row above already reports the queue's
 * summed estimate, and a per-row minute figure is not in the mockup.
 */
export interface QueuedIssue {
  /** The queue item — the React key, and what a reorder will address. */
  readonly id: string;
  /** The issue's number, drawn in mono. */
  readonly issueNumber: number;
  /** Its title, as the queue recorded it. */
  readonly issueTitle: string;
  /** The size somebody put on it, as the chip prints it. */
  readonly effort: EffortSize;
  /** The workflow's label, as free text — opaque, so it is rendered rather than parsed. */
  readonly workflowTag: string;
}

/**
 * The head of the queue, as the card's rows.
 *
 * The order is the payload's — `position`, `1` first — and it is deliberately not re-sorted
 * here, for the reason {@link activeLoops} and {@link recentCompletions} are not: the endpoint
 * orders the whole queue, and a client that re-sorted its five rows would produce a different
 * order from the listing that shows all of them.
 *
 * **At most five arrive**, because the aggregate caps `queueHead` there
 * (`ouroboros-rest`'s `QUEUE_HEAD_LIMIT`); this renders what it was given rather than capping
 * again, so a cap that changes in one place does not have to be changed in two. What is *not*
 * in the slice is reported by {@link moreQueued}.
 *
 * @param items The aggregate's `queueHead`.
 * @returns The rows, in the order they are drawn.
 */
export function queueRows(items: readonly QueueItemSummary[]): readonly QueuedIssue[] {
  return items.map((item) => ({
    id: item.id,
    issueNumber: item.issueNumber,
    issueTitle: item.issueTitle,
    effort: EFFORT_LABEL[item.effort],
    workflowTag: item.workflowTag,
  }));
}

/**
 * How many issues are queued that the card is not showing.
 *
 * The aggregate answers at most five rows and a count that is not capped, so the two together
 * are what the *+N queued* footer says — the seeded workspace draws five and says *+7 queued*.
 *
 * @param total How many are waiting — `stats.queued.count`.
 * @param shown How many rows the card drew.
 * @returns The remainder — see {@link beyondTheSlice}.
 */
export function moreQueued(total: number, shown: number): number {
  return beyondTheSlice(total, shown);
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
