/**
 * What the analyzer leg ([#518](https://github.com/NobuData/ouroboros/issues/518)) arranges, reads
 * and puts back — mockup 18's two suggestion cards against
 * `R__dev_seed_workspace_metrics_analyzer.sql`.
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
 * | one analysis run | nothing | a run is history |
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
 */

import type { BrowserContext } from "@playwright/test";

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
 * Have the page open on `helios-firmware`, as the tenant chip's menu would leave it.
 *
 * @param context - The context whose pages should open on it. Call it before the first `goto`.
 * @returns When every later page of the context will start with the choice made.
 */
export async function focusHelios(context: BrowserContext): Promise<void> {
  await context.addInitScript(
    ([key, choices]) => window.localStorage.setItem(key, choices),
    [
      FOCUS_REPO_STORAGE_KEY,
      JSON.stringify({ [SEED_TENANT.id]: { id: HELIOS.id, name: HELIOS.name } }),
    ],
  );
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

/**
 * The repository's newest analysis run.
 *
 * @param context - A signed-in context.
 * @returns Its id and status, or `null` before any.
 */
export async function latestRun(
  context: BrowserContext,
): Promise<{ id: string; status: string } | null> {
  const answer = await requestAs<{ run: { id: string; status: string } | null }>(
    context,
    "GET",
    `/api/v1/analyzer/runs/latest?repo=${encodeURIComponent(HELIOS.ref)}`,
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
