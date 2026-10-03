/**
 * What the analyzer legs ([#518](https://github.com/NobuData/ouroboros/issues/518),
 * [#519](https://github.com/NobuData/ouroboros/issues/519),
 * [#520](https://github.com/NobuData/ouroboros/issues/520),
 * [#521](https://github.com/NobuData/ouroboros/issues/521)) arrange, read and put back — mockup
 * 18's seven regions against `R__dev_seed_workspace_metrics_analyzer.sql`, and the states of the
 * page that mockup does not draw.
 *
 * ## The repository is the tenant chip's
 *
 * `/analyzer` analyses the chip's focus repository, else the workspace's first enabled one — which
 * in `acme-robotics` is `atlas-scheduler`, a repository nothing was ever analysed in. The seed's
 * page is `helios-firmware`'s, so {@link focusHelios} writes the chip's own preference (browser
 * storage, per workspace) before the page loads: the same value a person choosing it in the chip's
 * menu leaves behind.
 *
 * ## What this leg writes, and what it puts back
 *
 * | Write | Undone by | Why / why not |
 * |---|---|---|
 * | a farm pool window (`forge-02` → `pool-a`) | **deleted** in teardown | the farm leg's pool card is drawn from the same table |
 * | `standard-fix`'s draft, re-wired | **restored** to the seeded document in teardown | the studio and code-editor legs open that document; the proposed change note stays on the draft, and both of those legs publish with a note of their own |
 * | two suggestions `applied`, one `dismissed` | nothing | a resolution is terminal by design (V081) — that it cannot be undone is the product's promise |
 * | two measurement rows, their audit events | nothing | append-only |
 * | analysis runs — two of `helios-firmware` around the dismissal, one more that reproduces the chips, one of `helios-telemetry` | nothing | a run is history |
 * | a drafted ticket's checkbox (leg 23) | **ticked again** in teardown | the push leg pushes what is ticked |
 * | the seeded analyzer batch, edited and **pushed** (leg 24) | nothing | a pushed batch is closed by design; its tracker issues are reset with the sandbox |
 *
 * So the leg is **green from a cold volume only**, as the planning, knowledge and PR legs are: a
 * second run finds the rows already resolved. Its first block's `beforeAll` says so in words.
 *
 * ## The assertions made beneath the browser, and why this leg makes them
 *
 * `support/rest.ts` says reading in order to *assert* is the browser's job in this directory. The
 * issue asks for three things no page shows: that the farm's configuration holds **exactly** the
 * window the preview named, that the workflow's draft **cites the suggestion** in its change
 * note, and that a dismissal is still a dismissal after a real re-analysis. Each is read after the
 * browser has done its half, and none of them replaces what the page is asserted to show.
 *
 * ## What is intercepted, and why that is honest (#521)
 *
 * A seeded stack cannot hold every state of the page: an analysis takes two seconds, so *running*
 * is over before a browser can look; nothing seeded has failed or stopped at its budget; and no
 * seeded repository has ninety days of builds and no analysis. {@link rewriteAnalyzerPoll} — leg
 * 20's method — answers the page's own poll with **the service's real answer, changed**: every
 * field the change does not name is what the stack holds, and anything but a `200` passes through
 * untouched. Those tests prove what the *page* draws for such an answer. That the service produces
 * such answers — a run's phases, a failure's reason, what a budget stop kept — is asserted where
 * it can be made to happen: the REST suites. The **insufficient** state needs no rewrite: two
 * seeded repositories really are that thin.
 *
 * {@link onMockupDay} is the same tool used for a different reason: the seed is dated relative to
 * the day it ran, and a chip's width and row follow from its date's text, so a screenshot of
 * today's page would differ from tomorrow's. For the parity screenshots only, the answer's day
 * strings are shifted so the seed day reads as the mockup's — and the real dates are asserted, as
 * text, by the test beside it.
 */

import type { BrowserContext, Page, Route } from "@playwright/test";

import { quietly, requestAs } from "./rest";
import { SEED_TENANT } from "./seed";
import { SESSION_COOKIE, sessionTokenOf } from "./session";
import { REST_URL } from "./stack";
import { STANDARD_FIX_ID } from "./studio";

/** The page's route. */
export const ANALYZER_PATH = "/analyzer";

/** The seeded repository mockup 18 is drawn for. */
export const HELIOS = {
  /** `github_repos.id` — literal in the seed, and what the chip's preference holds. */
  id: "5eed0006-0000-4000-8000-000000000001",
  /** Its name within its GitHub organisation — what the chip draws. */
  name: "helios-firmware",
  /** `owner/name` — what the analyzer routes take. */
  ref: "acme-robotics/helios-firmware",
} as const;

/**
 * A seeded repository with builds on three days and no analysis: the *insufficient corpus* state,
 * for real (#521).
 */
export const TELEMETRY = {
  id: "5eed0006-0000-4000-8000-000000000003",
  name: "helios-telemetry",
  ref: "acme-robotics/helios-telemetry",
} as const;

/**
 * The workspace's first enabled repository — what the page opens on when the chip has no focus —
 * and one with no build at all (#521).
 */
export const ATLAS = { name: "atlas-scheduler", ref: "acme-robotics/atlas-scheduler" } as const;

/** `app/shell/focus-repo.ts`'s storage key — the chip's choice, by workspace. */
const FOCUS_REPO_STORAGE_KEY = "ouro-focus-repo";

/** The two cards, by the names their regions carry. */
export const CARDS = {
  process: "Suggested build-process changes",
  workflow: "Suggested workflow changes",
} as const;

/** One seeded row, as mockup 18 draws it. */
export interface SeededRow {
  readonly card: keyof typeof CARDS;
  readonly title: string;
  /** The mono evidence line, after its `Evidence` label. */
  readonly evidence: string;
  /** The impact pill. */
  readonly impact: string;
  /**
   * The mockup's confidence — or `null` for the one row whose seeded sample depends on the day
   * the seed is applied (see {@link ROWS}).
   */
  readonly confidence: number | null;
}

/**
 * The six seeded rows, in the order the page draws them: the build-process card's four, most
 * confident first, then the workflow card's two.
 *
 * **One confidence is read from the service rather than written down.** The runner move's sample
 * is the count of pool-a jobs queued in the last fourteen weekday windows, and another seed's
 * build lands in one of those windows on some days of the week — fourteen becomes fifteen and the
 * mockup's `84%` reads `85%`. That is the seed's day-dependence (`tests/seed.sql` trips on it
 * too), not this page's, so the leg asserts the page shows what the service composed.
 */
export const ROWS: readonly SeededRow[] = [
  {
    card: "process",
    title: "Split the test gate: native_sim every build, QEMU + HIL only before merge",
    evidence:
      "qemu_cortex_m3 caught 0 unique failures in 214 builds; HIL caught 9 — all at merge gates",
    impact: "−3m 40s per loop",
    confidence: 91,
  },
  {
    card: "process",
    title: "Re-warm ccache right after deps-refresh merges",
    evidence:
      "cache hit rate drops 78%→31% for ~6h after every deps-refresh merge (14 occurrences)",
    impact: "−1m 50s on ~20% of builds",
    confidence: 88,
  },
  {
    card: "process",
    title: "Move forge-02 to pool-a during 14:00–16:00 UTC",
    evidence:
      "pool-a queue exceeds 5 min in that window on 11 of last 14 weekdays; pool-b sits idle 82% of it",
    impact: "−4m queue p95",
    confidence: null,
  },
  {
    card: "process",
    title: "Link zephyr.elf incrementally (partial link cache)",
    evidence: "link step grew from 18% to 42% of build time since v2.3 (LTO enabled)",
    impact: "−55s per build",
    confidence: 72,
  },
  {
    card: "workflow",
    title: "standard-fix: run self-review BEFORE the build stage",
    evidence:
      "34% of failed builds in standard-fix loops contained defects the later self-review flagged anyway — reordering catches them pre-build",
    impact: "−2m 05s per failed attempt",
    confidence: 89,
  },
  {
    card: "workflow",
    title: "Loops touching drivers/can/: add a 'flake-retry under load profile' test stage",
    evidence:
      "merges touching drivers/can are 3.1× more likely to flake the telemetry suite within 7 days (21 cases)",
    impact: "−1 intervention/wk projected",
    confidence: 77,
  },
];

/** The rows the writing tests act on, by what each is about. */
export const TITLES = {
  gate: ROWS[0].title,
  ccache: ROWS[1].title,
  move: ROWS[2].title,
  spike: ROWS[3].title,
  review: ROWS[4].title,
  flake: ROWS[5].title,
} as const;

/** The pool move's preview, as the service writes it from the payload it would hand the farm. */
export const MOVE_PREVIEW = {
  summary:
    "forge-02 joins pool-a between 14:00–16:00 UTC on weekdays (Mon–Fri); outside that window it stays in its own pool.",
  lands: "Build farm · pool windows",
  /** The window the farm must hold once it is applied — the preview's own fields. */
  window: {
    runner: "forge-02",
    pool: "pool-a",
    daysOfWeek: [1, 2, 3, 4, 5],
    startsAt: "14:00",
    endsAt: "16:00",
  },
} as const;

/** What a stack that has already run this leg is told. */
export const NOT_COLD =
  "This stack is not cold: the analyzer leg resolves seeded suggestions, and a resolution is " +
  "final. Run it against a fresh volume (`docker compose down -v`).";

/** One suggestion, as `GET /api/v1/analyzer/suggestions` answers it — the fields this leg reads. */
export interface SuggestionRow {
  readonly id: string;
  readonly kind: "build_process" | "workflow";
  readonly title: string;
  readonly confidence: number;
  readonly status: "open" | "applied" | "dismissed" | "drafted";
  readonly workflow: { readonly slug: string; readonly nextVersion: number } | null;
}

/** One farm pool window, as `GET /api/v1/farm/pool-windows` answers it. */
export interface PoolWindow {
  readonly id: string;
  readonly runner: { readonly name: string };
  readonly pool: { readonly name: string };
  readonly daysOfWeek: readonly number[];
  readonly startsAt: string;
  readonly endsAt: string;
  readonly enabled: boolean;
}

/**
 * Have the page open on a repository, as the tenant chip's menu would leave it.
 *
 * @param context - The context whose pages should open on it. Call it before the first `goto`.
 * @param repo - The repository: its `github_repos.id` and its name.
 * @returns When every later page of the context will start with the choice made.
 */
export async function focusRepo(
  context: BrowserContext,
  repo: { readonly id: string; readonly name: string },
): Promise<void> {
  await context.addInitScript(
    ([key, choices]) => window.localStorage.setItem(key, choices),
    [
      FOCUS_REPO_STORAGE_KEY,
      JSON.stringify({ [SEED_TENANT.id]: { id: repo.id, name: repo.name } }),
    ],
  );
}

/**
 * Have the page open on `helios-firmware`, as the tenant chip's menu would leave it.
 *
 * @param context - The context whose pages should open on it. Call it before the first `goto`.
 * @returns When every later page of the context will start with the choice made.
 */
export function focusHelios(context: BrowserContext): Promise<void> {
  return focusRepo(context, HELIOS);
}

/**
 * The suggestion cards' rows, as the service answers them.
 *
 * @param context - A signed-in context.
 * @returns The rows, most confident first.
 */
export async function suggestions(context: BrowserContext): Promise<readonly SuggestionRow[]> {
  const answer = await requestAs<{ suggestions: SuggestionRow[] }>(
    context,
    "GET",
    `/api/v1/analyzer/suggestions?repo=${encodeURIComponent(HELIOS.ref)}`,
    null,
    "reading the analyzer's suggestions",
  );

  return answer?.suggestions ?? [];
}

/**
 * One suggestion, by its title.
 *
 * @param context - A signed-in context.
 * @param title - The suggestion's title.
 * @returns The row.
 * @throws {Error} If the service lists no such suggestion.
 */
export async function suggestion(context: BrowserContext, title: string): Promise<SuggestionRow> {
  const row = (await suggestions(context)).find((candidate) => candidate.title === title);

  if (row === undefined) throw new Error(`the analyzer lists no suggestion titled ${title}`);

  return row;
}

/**
 * The farm's pool windows.
 *
 * @param context - A signed-in context.
 * @returns Every window of the workspace.
 */
export async function poolWindows(context: BrowserContext): Promise<readonly PoolWindow[]> {
  return (
    (await requestAs<PoolWindow[]>(
      context,
      "GET",
      "/api/v1/farm/pool-windows",
      null,
      "reading the farm's pool windows",
    )) ?? []
  );
}

/**
 * The windows that put {@link MOVE_PREVIEW}'s runner in its pool — what the apply must have made.
 *
 * @param windows - The farm's windows.
 * @returns The ones naming that runner and that pool.
 */
export function moveWindows(windows: readonly PoolWindow[]): readonly PoolWindow[] {
  return windows.filter(
    (window) =>
      window.runner.name === MOVE_PREVIEW.window.runner &&
      window.pool.name === MOVE_PREVIEW.window.pool,
  );
}

/**
 * Take the pool move's window out of the farm again.
 *
 * @param context - The context to act for. Its person must be an `owner` or an `admin`.
 * @returns When the removal has been attempted. It never throws — see `support/rest.ts`.
 */
export function removeMoveWindows(context: BrowserContext): Promise<void> {
  return quietly(async () => {
    for (const window of moveWindows(await poolWindows(context))) {
      await requestAs(
        context,
        "DELETE",
        `/api/v1/farm/pool-windows/${window.id}`,
        null,
        "removing the pool window the analyzer leg applied",
      );
    }
  }, "the pool window the analyzer leg applied was not removed — forge-02 joins pool-a every " + "weekday afternoon, which the farm leg's pool card will count.");
}

/**
 * `standard-fix`'s draft, as the workflow's own route answers it.
 *
 * @param context - A signed-in context.
 * @returns The draft's change note and its document's connections.
 */
export async function standardFixDraft(
  context: BrowserContext,
): Promise<{ changeNote: string | null; edges: readonly string[] }> {
  const answer = await requestAs<{
    draft: {
      changeNote: string | null;
      definition: { edges: { from: string; to: string }[] } | null;
    } | null;
  }>(context, "GET", `/api/v1/workflows/${STANDARD_FIX_ID}`, null, "reading standard-fix's draft");

  return {
    changeNote: answer?.draft?.changeNote ?? null,
    edges: (answer?.draft?.definition?.edges ?? []).map((edge) => `${edge.from} → ${edge.to}`),
  };
}

/** An analysis run, as far as these legs read one. */
export interface AnalysisRunRow {
  readonly id: string;
  readonly status: string;
  /** Why it failed or stopped, when it did. */
  readonly failureReason: string | null;
  /** Each analyzer's outcome in it. */
  readonly progress: {
    readonly analyzers: readonly {
      readonly id: string;
      readonly status: string;
      readonly findings: number | null;
      readonly reason: string | null;
    }[];
  };
  /** The corpus it assembled — and the sources the deployment could not give it. */
  readonly manifest: { readonly absent: readonly { source: string; reason: string }[] } | null;
}

/**
 * A repository's newest analysis run.
 *
 * @param context - A signed-in context.
 * @param repo - The repository, `owner/name`. Defaults to `helios-firmware`.
 * @returns Its id, status, progress and corpus manifest, or `null` before any.
 */
export async function latestRun(
  context: BrowserContext,
  repo: string = HELIOS.ref,
): Promise<AnalysisRunRow | null> {
  const answer = await requestAs<{ run: AnalysisRunRow | null }>(
    context,
    "GET",
    `/api/v1/analyzer/runs/latest?repo=${encodeURIComponent(repo)}`,
    null,
    "reading the newest analysis run",
  );

  return answer?.run ?? null;
}

/**
 * Ask the service to apply a suggestion with this context's session, and report its answer.
 *
 * **Not a helper that insists**, unlike `support/rest.ts`'s: the member test calls it to observe
 * a refusal, so the status is the result rather than a reason to throw. No fingerprint is sent —
 * the role gate answers before the plan is looked at.
 *
 * @param context - The context to act for.
 * @param id - The suggestion.
 * @returns The HTTP status the apply route answered.
 */
export async function applyStatusFor(context: BrowserContext, id: string): Promise<number> {
  const token = await sessionTokenOf(context, "applying a suggestion");

  const response = await fetch(`${REST_URL}/api/v1/analyzer/suggestions/${id}/apply`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
    body: JSON.stringify({}),
  });

  return response.status;
}

/* ------------------------------------------------------------------ the drafted-tickets card (#519) */

/** The drafted-tickets card, by the name its region carries. */
export const TICKETS_CARD = "Drafted tickets — from patterns, not people";

/** `R__dev_seed_workspace_metrics_analyzer.sql`'s `analyzer-v1` batch — `BA-1…BA-4`. */
export const SEEDED_TICKET_BATCH_ID = "5eed006a-0000-4000-8000-000000000001";

/** One seeded draft, as mockup 18 draws it. */
export interface SeededTicket {
  /** The batch-local key. */
  readonly key: string;
  /**
   * The title — a pattern for the one draft whose title names a month the seed computes from the
   * day it is applied (the corpus window's first month; the mockup's `May`).
   */
  readonly title: string | RegExp;
  /** The effort chip, as the estimator sized it. */
  readonly effort: string;
  /** The mono evidence line. */
  readonly evidence: string;
}

/** The four seeded drafts, in the order the card draws them. */
export const TICKETS: readonly SeededTicket[] = [
  {
    key: "BA-1",
    title: "Refactor tests/ota fixtures — shared setup times out under load",
    effort: "M",
    evidence: "7.2% of OTA suite failures share one fixture timeout signature (31 builds)",
  },
  {
    key: "BA-2",
    title: "Bump ccache 4.9 → 4.11 — upstream fixes the hash misses in our logs",
    effort: "XS",
    evidence: "cache-miss signature matches ccache issue #1412 in 118 builds",
  },
  {
    key: "BA-3",
    title: "Add thermal chamber to rig helios-rig-02",
    effort: "L",
    evidence: "3 verification waivers in 60 days cite missing thermal coverage",
  },
  {
    key: "BA-4",
    title: /^Delete 12 dead Kconfig options — never set in any build since [A-Z][a-z]+$/,
    effort: "S",
    evidence: "0 of 1,284 builds toggled them; 4 caused config-drift warnings",
  },
];

/**
 * The card's footer for the seeded batch — 660 + 120 + 1,020 + 360 estimator minutes, and what is
 * left of them once `BA-3` (1,020) is unticked.
 */
export const TICKET_TOTALS = {
  all: "est. total ~1.5 days of loop time",
  withoutChamber: "est. total ~0.8 days of loop time",
} as const;

/** What a stack whose seeded batch has already been pushed is told. */
export const TICKETS_NOT_COLD =
  "This stack is not cold: the seeded analyzer batch has already been pushed or changed, and a " +
  "pushed batch is closed for good. Run it against a fresh volume (`docker compose down -v`).";

/** One draft of a batch on the card, as `GET /api/v1/analyzer/tickets` answers it. */
export interface DraftRow {
  readonly localKey: string;
  readonly title: string;
  readonly selected: boolean;
  readonly pushState: "pending" | "pushed" | "failed";
}

/** One batch on the card — the fields the legs read. */
export interface TicketBatch {
  readonly id: string;
  readonly status: string;
  readonly drafts: readonly DraftRow[];
}

/**
 * The seeded analyzer batch, as the drafted-tickets card's read answers it.
 *
 * @param context - A signed-in context.
 * @returns The batch, or `undefined` when the card no longer holds it.
 */
export async function seededTicketBatch(context: BrowserContext): Promise<TicketBatch | undefined> {
  const answer = await requestAs<{ batches: { batch: TicketBatch }[] }>(
    context,
    "GET",
    `/api/v1/analyzer/tickets?repo=${encodeURIComponent(HELIOS.ref)}`,
    null,
    "reading the analyzer's drafted tickets",
  );

  return answer?.batches.find((entry) => entry.batch.id === SEEDED_TICKET_BATCH_ID)?.batch;
}

/**
 * Tick every draft of the seeded batch again — what the selection test unticked.
 *
 * @param context - The context to act for. Its person must be a member or above.
 * @returns When the restore has been attempted. It never throws — see `support/rest.ts`.
 */
export function retickSeededTickets(context: BrowserContext): Promise<void> {
  return quietly(async () => {
    const batch = await seededTicketBatch(context);

    for (const draft of batch?.drafts ?? []) {
      if (draft.selected || draft.pushState === "pushed") continue;

      await requestAs(
        context,
        "PATCH",
        `/api/v1/planning/batches/${SEEDED_TICKET_BATCH_ID}/drafts/${draft.localKey}`,
        { selected: true },
        `ticking ${draft.localKey} again`,
      );
    }
  }, "a seeded analyzer draft was left unticked — the card's parity and the push leg both count four ticked drafts.");
}

/**
 * Ask the service to push the seeded analyzer batch with this context's session, and report its
 * answer.
 *
 * **Not a helper that insists** — the member test and the idempotency check call it to observe a
 * refusal, so the status is the result rather than a reason to throw.
 *
 * @param context - The context to act for.
 * @returns The HTTP status the push route answered, and the refusal's code when it refused.
 */
export async function pushSeededTickets(
  context: BrowserContext,
): Promise<{ status: number; code: string | null }> {
  const token = await sessionTokenOf(context, "pushing the analyzer's batch");

  const response = await fetch(
    `${REST_URL}/api/v1/analyzer/batches/${SEEDED_TICKET_BATCH_ID}/push`,
    { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${token}` } },
  );
  const body = (await response.json().catch(() => null)) as { code?: string } | null;

  return { status: response.status, code: response.ok ? null : (body?.code ?? null) };
}

/* ------------------------------------------------------------------ predicted vs measured, how it works (#520) */

/** The predicted-vs-measured card's accessible name. */
export const MEASUREMENTS_CARD = "Predicted vs measured";

/** The how-it-works card's accessible name. */
export const HOW_IT_WORKS_CARD = "How it works";

/** A seeded measurement, as mockup 18 draws it. */
export interface SeededMeasurement {
  /** The applied suggestion's name. */
  readonly title: string;
  /** The mockup's predicted figure. */
  readonly predicted: string;
  /** The mockup's measured figure, with its check where it delivered. */
  readonly measured: string;
  /** Which hue the measured figure wears. */
  readonly tone: "ok" | "warn";
  /** The composed note under the row, or `null` for the one that delivered. */
  readonly note: string | null;
}

/**
 * Mockup 18's pair, oldest apply first. The figures are the mockup's; the *applied* dates are the
 * seed's (37 and 30 days before the day it ran) and are read from the service.
 */
export const MEASUREMENTS: readonly SeededMeasurement[] = [
  {
    title: "Test-suite split",
    predicted: "−3m 40s",
    measured: "−3m 55s ✓",
    tone: "ok",
    note: null,
  },
  {
    title: "ccache warm-up",
    predicted: "−1m 50s",
    measured: "−1m 12s",
    tone: "warn",
    note: "under-delivered — analyzer revised its cache model",
  },
];

/** The calibration cells those two closes moved, as the popover states them. */
export const RECALIBRATION: readonly { cell: string; factor: string; movedBy: string }[] = [
  {
    cell: "cache_window · duration_delta",
    factor: "× 0.6545 now, from 1 closed measurement",
    movedBy: "moved by ccache warm-up",
  },
  {
    cell: "workflow_outcome · duration_delta",
    factor: "× 1.0682 now, from 1 closed measurement",
    movedBy: "moved by Test-suite split",
  },
];

/** Mockup 18's three steps, as the seeded run's corpus has the first one read. */
export const HOW_IT_WORKS: readonly { label: string; line: string }[] = [
  { label: "01 Ingest", line: "build logs, test results, loop transcripts, rig telemetry" },
  { label: "02 Correlate", line: "change-points ↔ merges, configs, infra events" },
  {
    label: "03 Synthesize",
    line: "process changes, workflow drafts, tickets — with evidence attached",
  },
];

/** The footer's sentence, and where its link must land. */
export const LOCALITY = {
  note: "Runs on your build farm's data. Nothing leaves the tenant.",
  link: "How that is enforced ↗",
  href: /\/docs\/SECURITY_MODEL\.md#66-the-build-analyzers-corpus-stays-on-the-tenant$/,
} as const;

/** A measurement, as far as this leg reads one. */
export interface MeasurementRow {
  readonly id: string;
  readonly suggestionId: string;
  readonly title: string;
  readonly appliedOn: string;
  readonly windowEndsOn: string;
  readonly day: number;
  readonly windowDays: number;
  readonly verdict: string;
}

/**
 * The repository's measurements and the formula that recalibrates on them, as the service answers.
 *
 * @param context - A signed-in context.
 * @returns The measurements, newest apply first, and the formula.
 */
export async function measurements(
  context: BrowserContext,
): Promise<{ formula: string; measurements: readonly MeasurementRow[] }> {
  const answer = await requestAs<{ formula: string; measurements: MeasurementRow[] }>(
    context,
    "GET",
    `/api/v1/analyzer/measurements?repo=${encodeURIComponent(HELIOS.ref)}`,
    null,
    "reading the analyzer's measurements",
  );

  return answer ?? { formula: "", measurements: [] };
}

/** The months, as the cards abbreviate them. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A UTC day as the cards write it.
 *
 * @param day - An ISO date — `2026-08-27`.
 * @returns `Aug 27`.
 */
export function dayLabel(day: string): string {
  const [, month, date] = day.split("-").map(Number);

  return `${MONTHS[(month ?? 1) - 1] ?? ""} ${String(date ?? "")}`;
}

/* ------------------------------------------------------------------ the page's states and the chart (#521) */

/** The meta strip's accessible name. */
export const STRIP_REGION = "Analysis summary";

/** The duration chart's accessible name over the seeded ninety-day window. */
export const CHART_REGION = "Build duration · 90 days, with detected change-points";

/** The progress panel's accessible name. */
export const PROGRESS_REGION = "Analysis progress";

/** The insufficient-corpus panel's accessible name. */
export const INSUFFICIENT_REGION = "The analyzer needs more history";

/** The never-run panel's accessible name. */
export const NEVER_RUN_REGION = "No analysis has run here yet";

/** The never-run panel's call to action. */
export const FIRST_RUN_ACTION = "Run the first analysis";

/** The mockup's seven regions, in page order — what the parity screenshots are taken of. */
export const REGIONS: readonly { readonly slug: string; readonly name: string }[] = [
  { slug: "strip", name: STRIP_REGION },
  { slug: "chart", name: CHART_REGION },
  { slug: "process", name: CARDS.process },
  { slug: "workflow", name: CARDS.workflow },
  { slug: "tickets", name: TICKETS_CARD },
  { slug: "measured", name: MEASUREMENTS_CARD },
  { slug: "how", name: HOW_IT_WORKS_CARD },
];

/**
 * The three shifts the seed plants in `zephyr build`'s daily medians, oldest first, as mockup 18
 * draws their chips: how many days before the corpus window's last day each one lands, its top
 * candidate and its delta. The dates themselves are the seed day's and are read from the service.
 */
export const PLANTED_SHIFTS: readonly {
  readonly daysBeforeWindowEnd: number;
  readonly candidate: string;
  readonly delta: string;
  readonly deltaSeconds: number;
}[] = [
  {
    daysBeforeWindowEnd: 81,
    candidate: "Zephyr 4.1 migration",
    delta: "+1m 30s",
    deltaSeconds: 90,
  },
  { daysBeforeWindowEnd: 46, candidate: "ccache enabled", delta: "−2m 10s", deltaSeconds: -130 },
  { daysBeforeWindowEnd: 8, candidate: "twister suite growth", delta: "+40s", deltaSeconds: 40 },
];

/** The seven analyzers of `deterministic analyzers v1`, in the set's order. */
export const ANALYZERS: readonly string[] = [
  "cache_window",
  "change_point",
  "config_usage",
  "log_signature",
  "queue_correlation",
  "waiver_cite",
  "workflow_outcome",
];

/** The analyzers a live corpus has the inputs for; the other four are skipped, saying which it lacks. */
export const LIVE_ANALYZERS: readonly string[] = ["change_point", "log_signature", "waiver_cite"];

/** A repository's corpus state, as `GET /api/v1/analyzer/corpus` answers it. */
export interface CorpusState {
  readonly builds: number;
  readonly daysWithBuilds: number;
  readonly sufficient: boolean;
  readonly minimumDaysWithBuilds: number;
  readonly window: { readonly from: string; readonly to: string; readonly days: number };
  readonly analyzed: {
    readonly runId: string;
    readonly builds: number;
    readonly daysWithBuilds: number;
    readonly sufficient: boolean;
  } | null;
}

/**
 * A repository's corpus state.
 *
 * @param context - A signed-in context.
 * @param repo - The repository, `owner/name`. Defaults to `helios-firmware`.
 * @returns How much history it holds, the floor, and what the newest ended analysis read.
 * @throws {Error} If the service answers nothing.
 */
export async function corpus(
  context: BrowserContext,
  repo: string = HELIOS.ref,
): Promise<CorpusState> {
  const answer = await requestAs<CorpusState>(
    context,
    "GET",
    `/api/v1/analyzer/corpus?repo=${encodeURIComponent(repo)}`,
    null,
    "reading the analyzer's corpus state",
  );

  if (answer === null) throw new Error("the analyzer answered no corpus state");

  return answer;
}

/** One change-point of the duration chart, as far as these legs read one. */
export interface ChangePointRow {
  readonly date: string;
  readonly deltaSeconds: number;
  readonly candidates: readonly { readonly label: string }[];
}

/** The duration chart's read, as far as these legs read it. */
export interface DurationRead {
  /** The run whose findings annotate the series. */
  readonly runId: string | null;
  readonly window: { readonly from: string; readonly to: string; readonly days: number } | null;
  readonly series: readonly unknown[];
  readonly changePoints: readonly ChangePointRow[];
}

/**
 * The duration chart, as the service answers it.
 *
 * @param context - A signed-in context.
 * @param repo - The repository, `owner/name`. Defaults to `helios-firmware`.
 * @returns The annotated run, its window, its series and its change-points, oldest first.
 * @throws {Error} If the service answers nothing.
 */
export async function durationChart(
  context: BrowserContext,
  repo: string = HELIOS.ref,
): Promise<DurationRead> {
  const answer = await requestAs<DurationRead>(
    context,
    "GET",
    `/api/v1/analyzer/duration?repo=${encodeURIComponent(repo)}`,
    null,
    "reading the analyzer's duration chart",
  );

  if (answer === null) throw new Error("the analyzer answered no duration chart");

  return answer;
}

/**
 * What the chart's chips must say for these change-points, in the chart's own words.
 *
 * @param chart - The duration read.
 * @returns One line per change-point — `Jul 13 · Zephyr 4.1 migration +1m 30s`.
 */
export function chipTexts(chart: DurationRead): string[] {
  return chart.changePoints.map((point, index) => {
    const planted = PLANTED_SHIFTS[index];

    return `${dayLabel(point.date)} · ${point.candidates[0]?.label ?? ""} ${planted?.delta ?? ""}`;
  });
}

/**
 * Whole days from one UTC day to a later one.
 *
 * @param from - The earlier day, `YYYY-MM-DD`.
 * @param to - The later day.
 * @returns The difference in days.
 */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * The ticket suggestions of the drafted-tickets card, as titles: the ones nobody has drafted, and
 * the drafts of every batch on the card.
 *
 * @param context - A signed-in context.
 * @returns Both lists. A suggestion composed twice — under two identities — would be in the first
 *   while its drafted twin is in the second.
 */
export async function ticketTitles(
  context: BrowserContext,
): Promise<{ undrafted: string[]; drafted: string[] }> {
  const answer = await requestAs<{
    undrafted: { title: string }[];
    batches: { batch: { drafts: { title: string }[] } }[];
  }>(
    context,
    "GET",
    `/api/v1/analyzer/tickets?repo=${encodeURIComponent(HELIOS.ref)}`,
    null,
    "reading the analyzer's drafted tickets",
  );

  return {
    undrafted: (answer?.undrafted ?? []).map((entry) => entry.title),
    drafted: (answer?.batches ?? []).flatMap((entry) =>
      entry.batch.drafts.map((draft) => draft.title),
    ),
  };
}

/** One analyzer's progress entry in a page payload. */
interface ProgressPayload {
  id: string;
  version: number;
  status: string;
  findings: number | null;
  elapsedSeconds: number | null;
  reason: string | null;
}

/** The analyzer page's poll payload — the fields these legs change; the rest rides along. */
export interface AnalyzerPagePayload {
  repo: string;
  run:
    | ({
        id: string;
        trigger: string;
        status: string;
        phase: string;
        progress: { analyzers: ProgressPayload[] };
        finishedAt: string | null;
        computeSeconds: number | null;
        confidenceNote: string | null;
        failureReason: string | null;
      } & Record<string, unknown>)
    | null;
  duration: Record<string, unknown>;
  suggestions: Record<string, unknown>;
  tickets: Record<string, unknown>;
  measurements: Record<string, unknown>;
  corpus: Record<string, unknown> & { analyzed: Record<string, unknown> | null };
  [region: string]: unknown;
}

/** The page's own poll, on the UI's origin. A regular expression: the query is part of the address. */
const ANALYZER_POLL = /\/api\/analyzer\?repo=/;

/**
 * Answer the browser's poll for one repository with the service's own page, changed.
 *
 * `if-none-match` is dropped so the hop always answers with a body — a `304` has nothing to
 * rewrite. Anything but a `200` is passed through untouched, and so is **another repository's**
 * page: before the chip's focus applies the screen may ask for the workspace's first repository,
 * and that answer is not the one being changed.
 *
 * @param page - The page about to open the analyzer.
 * @param change - What to change. It is handed a fresh copy of what the service answered.
 * @param repo - The repository whose page is changed. Defaults to `helios-firmware`.
 * @returns When the route is installed — before the navigation, so the first poll is caught.
 */
export async function rewriteAnalyzerPoll(
  page: Page,
  change: (payload: AnalyzerPagePayload) => AnalyzerPagePayload,
  repo: string = HELIOS.ref,
): Promise<void> {
  await page.route(ANALYZER_POLL, async (route: Route) => {
    const headers = { ...route.request().headers() };
    delete headers["if-none-match"];

    const response = await route.fetch({ headers });
    if (response.status() !== 200) return route.fulfill({ response });

    const body = (await response.json()) as AnalyzerPagePayload;
    await route.fulfill({
      response,
      json: body.repo === repo ? change(structuredClone(body)) : body,
    });
  });
}

/** The day mockup 18 is drawn on — its corpus window ends the day before. */
const MOCKUP_WINDOW_END = "2026-08-07";

/** A UTC calendar day, and nothing else. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A month's name, as the seed writes one into a ticket's title. */
const SINCE_MONTH =
  /since (January|February|March|April|May|June|July|August|September|October|November|December)/g;

/**
 * Move a UTC day by whole days.
 *
 * @param day - `YYYY-MM-DD`.
 * @param days - How far, in days.
 * @returns The moved day.
 */
function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The page's answer with its calendar pinned to the mockup's: every UTC **day** in it is moved by
 * the distance from the chart's own window to the mockup's, so the chips read May 18, Jun 22 and
 * Jul 30 and the two measurements Jul 2 and Jul 9 whatever day the stack was seeded on — and the
 * one month the seed writes into a ticket's title (*…since July*) reads as the mockup's.
 *
 * Instants are left alone: nothing drawn from one is in a screenshot unmasked. Used for the
 * parity screenshots only; the real dates are asserted as text.
 *
 * @param payload - The page's answer.
 * @returns It, pinned.
 */
export function onMockupDay(payload: AnalyzerPagePayload): AnalyzerPagePayload {
  const window = payload.duration.window as { to: string } | null;
  if (window === null) return payload;

  const days = daysBetween(window.to, MOCKUP_WINDOW_END);
  const pin = (value: unknown): unknown => {
    if (typeof value === "string") {
      return DAY.test(value) ? shiftDay(value, days) : value.replace(SINCE_MONTH, "since May");
    }
    if (Array.isArray(value)) return value.map(pin);
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, pin(entry)]));
    }

    return value;
  };

  return pin(payload) as AnalyzerPagePayload;
}

/**
 * A repository with its history and no analysis of it: no run, nothing any card could hold, and a
 * corpus nothing has analysed. No seeded repository is in this state — the one with ninety days
 * of builds was analysed by the seed.
 *
 * @param payload - The page's answer.
 * @returns It, as before the first analysis.
 */
export function asNeverRun(payload: AnalyzerPagePayload): AnalyzerPagePayload {
  const { repo } = payload;

  return {
    ...payload,
    run: null,
    duration: {
      repo,
      runId: null,
      analyzedAt: null,
      durationLabel: null,
      window: null,
      series: [],
      changePoints: [],
    },
    suggestions: { repo, runId: null, analyzedAt: null, suggestions: [], calibration: [] },
    tickets: { repo, undrafted: [], batches: [] },
    measurements: { ...payload.measurements, measurements: [], calibration: [] },
    corpus: { ...payload.corpus, analyzed: null },
  };
}

/** The id the rewritten runs carry — not the seeded run's, so the cards are plainly another run's. */
const REWRITTEN_RUN_ID = "0e2e0521-0000-4000-8000-000000000001";

/** The service's reason for a run whose engine went away (`RUN_REASONS.engineUnavailable`). */
export const ENGINE_UNAVAILABLE =
  "The analysis engine could not be reached, or its answer broke off.";

/** The service's reason for a budget stop that kept five analyzers' findings. */
export const BUDGET_REASON =
  "The compute ceiling of 60 s was reached. Kept the findings of 5 analyzer(s); did not finish: waiver_cite, workflow_outcome.";

/**
 * A newer run in flight over the page's results: analyzing, two analyzers done, one running, the
 * rest waiting. Everything but the run is what the service answered.
 *
 * @param payload - The page's answer, with a run.
 * @returns It, with an analysis running.
 */
export function asRunning(payload: AnalyzerPagePayload): AnalyzerPagePayload {
  const { run } = payload;
  if (run === null) return payload;

  return {
    ...payload,
    run: {
      ...run,
      id: REWRITTEN_RUN_ID,
      trigger: "manual",
      status: "running",
      phase: "analyzing",
      finishedAt: null,
      computeSeconds: 0,
      confidenceNote: null,
      failureReason: null,
      progress: {
        analyzers: run.progress.analyzers.map((entry, index) => ({
          ...entry,
          status: index < 2 ? "completed" : index === 2 ? "running" : "pending",
          findings: index < 2 ? entry.findings : null,
          reason: null,
        })),
      },
    },
  };
}

/**
 * A newer run that failed over the page's results: the engine went away after two analyzers, and
 * the rest never ran — as the orchestrator records it.
 *
 * @param payload - The page's answer, with a run.
 * @returns It, with the newest analysis failed.
 */
export function asFailed(payload: AnalyzerPagePayload): AnalyzerPagePayload {
  const running = asRunning(payload).run;
  if (running === null) return payload;

  return {
    ...payload,
    run: {
      ...running,
      status: "failed",
      phase: "composing",
      finishedAt: new Date().toISOString(),
      failureReason: ENGINE_UNAVAILABLE,
      progress: {
        analyzers: running.progress.analyzers.map((entry) =>
          entry.status === "completed"
            ? entry
            : { ...entry, status: "not_run", findings: null, reason: ENGINE_UNAVAILABLE },
        ),
      },
    },
  };
}

/**
 * The page's own run, stopped at its budget: five analyzers' findings kept, one stopped at the
 * ceiling and one never started — the engine's and the orchestrator's own reasons.
 *
 * @param payload - The page's answer, with a run.
 * @returns It, with the newest analysis stopped at its budget.
 */
export function asBudgetExceeded(payload: AnalyzerPagePayload): AnalyzerPagePayload {
  const { run } = payload;
  if (run === null) return payload;

  const last = run.progress.analyzers.length - 1;

  return {
    ...payload,
    run: {
      ...run,
      status: "budget_exceeded",
      failureReason: BUDGET_REASON,
      progress: {
        analyzers: run.progress.analyzers.map((entry, index) =>
          index < last - 1
            ? entry
            : index === last - 1
              ? {
                  ...entry,
                  status: "timed_out",
                  findings: null,
                  reason: "stopped at the run's compute ceiling",
                }
              : {
                  ...entry,
                  status: "not_run",
                  findings: null,
                  reason: "the run's compute ceiling was reached",
                },
        ),
      },
    },
  };
}
