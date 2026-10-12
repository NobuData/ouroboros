/**
 * Leg 28's facts — the Research page ([#634](https://github.com/NobuData/ouroboros/issues/634),
 * CN.8): what mockup 22 draws from the CK seeds (#613), the words the page uses when it refuses,
 * the reads the leg makes beneath the browser, and the one fixture it plants — a release baseline
 * a real nightly comparison then finds drift against.
 *
 * ## What is seeded, and what is planted
 *
 * Everything the parity, citation, export and pipeline tests assert is `acme-robotics`'s seed:
 * four investigations, RS-127's brief with its 44-record ledger, RS-124's roadmap and its six
 * filed issues, three watch items. Nothing here restates a figure the page computes — the tests
 * compare the page with the service, and the service with the tracker.
 *
 * The watch test plants **one row**: a baseline for a HIL metric the seed measures but never
 * baselined ({@link DRIFT}). The comparison that follows is the product's own — the telemetry
 * tool reads the seeded measurements, the drift rule judges them, the scheduler's next pass moves
 * the item. A baseline is planted rather than captured because a captured one would equal the
 * measurements it was captured from, and nothing would have drifted.
 */

import { type BrowserContext, type Locator, type Page, expect } from "@playwright/test";

import { psql } from "./insights";
import { requestAs } from "./rest";
import { SEED_TENANT } from "./seed";

/** Where the page lives. */
export const RESEARCH_PATH = "/research";

/** The page's `<h1>`. */
export const RESEARCH_TITLE =
  "Ask a hard question. Get an evidenced answer — and the tickets to act on it.";

/** The sidebar entry the page lights. */
export const SIDEBAR_ENTRY = "Research";

/**
 * Mockup 22's seven regions: the head, and the six seats of the frame (#627), by the `id` each
 * seat lands on. `slug` names the region's screenshot.
 */
export const REGIONS = [
  { slug: "head", selector: ".research__head" },
  { slug: "composer", selector: "#composer" },
  { slug: "tools", selector: "#tools" },
  { slug: "watch", selector: "#watch" },
  { slug: "brief", selector: "#brief" },
  { slug: "pipeline", selector: "#pipeline" },
  { slug: "investigations", selector: "#investigations" },
] as const;

/** The seeded investigations the leg names. */
export const SEEDED = {
  /** The featured brief — gap analysis, 44 sources. */
  brief: { id: "5eed0084-0000-4000-8000-000000000127", displayId: "RS-127", sources: 44 },
  /** The roadmap investigation the pipeline card draws. */
  roadmap: { displayId: "RS-124", issues: 6, version: "v1" },
  /** The watch card's seeded rows, in order. */
  watchRows: [
    /Hover drift \+14% since v2\.0\.4/,
    /Boot time \+230 ms since v2\.1\.0-rc1/,
    /Soc error/,
  ],
  /** The drafts *Draft epic from gaps* composes from RS-127's proposal. */
  gapDrafts: ["DOCK-1", "DOCK-2", "DOCK-3", "DOCK-4", "DOCK-5"],
  /** The first open suggestion on RS-124's roadmap. */
  suggestion: /^Pull #744 into the M1 MVP set/,
} as const;

/** What the page says, where a test asserts the sentence rather than its presence. */
export const COPY = {
  gatewayTitle: "Research needs the invocation gateway",
  gatewayReason: "Research needs the invocation gateway — see Providers.",
  gatewayStill: /The regression watch still detects and bisects/,
  applyRefused:
    /The create-roadmap skill could not be run: the invocation gateway could not be reached/,
  nothingChanged: /Nothing was changed\./,
  dismissReadOnly: "Dismissing a watch item is for workspace owners and admins.",
  suggestionReadOnly: "Only an owner or an admin can apply or dismiss a suggestion.",
  trackerDialog: "Which tracker are the drafts for?",
  noRepro:
    "needs repro: no replayable test is configured for this metric, so it cannot be bisected",
} as const;

/* ------------------------------------------------------------------ failure messages */

/** The page did not finish drawing. */
export const NOT_READY = "the Research page did not draw its six cards";

/** A marker stopped resolving to its source. */
export const CITATION_BROKE =
  "a citation marker no longer resolves to its source row — the brief's claims and its ledger have come apart";

/** The document and the tracker disagree. */
export const WRITEBACK_BROKE =
  "ROADMAP.md and the tracker disagree — the writeback and the issues it filed have drifted";

/** The comparison found nothing. */
export const DRIFT_BROKE =
  "the nightly comparison opened no item for the planted baseline — the watch did not detect the drift";

/** The chain did not move the item. */
export const CHAIN_BROKE =
  "the watch item was never moved by the scheduler's pass — the chain did not reach its honest stop";

/** The engine did not refuse the re-run for the reason the page promises. */
export const APPLY_BROKE =
  "the re-run was not refused by the engine for want of a model — the engine did not answer, or answered something else";

/** The enabled tool did not report healthy. */
export const TOOL_BROKE =
  "the fixture tool's dot did not turn healthy — the deployment's SearXNG did not answer the adapter";

/** The hand-off filed something. */
export const FILED_BROKE =
  "drafting an epic from the gaps filed an issue on the tracker — it must only draft";

/* ------------------------------------------------------------------ the page */

/**
 * Open the Research page and wait until it has drawn everything a test may read: the six seats,
 * the composer's estimate (a read of its own) and the pipeline's caption (the last card's last
 * line).
 *
 * @param page - A signed-in page.
 * @param path - The address; the library and an opened investigation are the same page.
 * @returns When the page is drawn.
 */
export async function openResearch(page: Page, path: string = RESEARCH_PATH): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: RESEARCH_TITLE })).toBeVisible();
  await expect(page.locator(".research__seat"), NOT_READY).toHaveCount(REGIONS.length - 1);
  await expect(page.locator(".research__skeleton, [class*='research__sk-']")).toHaveCount(0);
  await expect(page.locator("#composer .research__estimate[aria-busy='true']")).toHaveCount(0);
}

/** One of the seven regions. */
export function region(page: Page, slug: (typeof REGIONS)[number]["slug"]): Locator {
  const found = REGIONS.find((candidate) => candidate.slug === slug)!;

  return page.locator(found.selector);
}

/** A control the page drew inert, by the reason it gives. */
export async function expectInert(control: Locator, reason: string): Promise<void> {
  await expect(control).toHaveAttribute("aria-disabled", "true");
  await expect(control).toHaveAttribute("title", reason);
}

/* ------------------------------------------------------------------ beneath the browser */

/** One row of the ledger, as the brief's panel and the service both name it. */
export interface BriefSource {
  readonly sourceId: string;
  readonly label: string;
  readonly title: string;
}

/** The part of a brief the leg reads. */
export interface Brief {
  readonly sources: { readonly cited: number; readonly panel: readonly BriefSource[] };
}

/**
 * The service's own reading of an investigation's brief.
 *
 * @param context - A signed-in context.
 * @param investigationId - The investigation.
 * @returns The brief.
 */
export async function briefOf(context: BrowserContext, investigationId: string): Promise<Brief> {
  return (await requestAs<Brief>(
    context,
    "GET",
    `/api/v1/research/investigations/${investigationId}/brief`,
    null,
    "reading the brief",
  ))!;
}

/* ------------------------------------------------------------------ the watch */

/** The watch's REST prefix. */
const WATCH = "/api/v1/research/regression-watch";

/**
 * The synthetic drift: the seeded `overshoot_pct` measurements of run #482 (2.4 %, three times,
 * and 1.7 %) against a baseline planted well below them. `key` is the case's durable key (V051)
 * and the measurement's name.
 */
export const DRIFT = {
  repository: "acme-robotics/helios-firmware",
  key: "a7ee68b68b6e533f32d3be7b75e4ea550bb860bfaf04e02fde18b55dd4f946d0:overshoot_pct",
  release: "v2.1.0-e2e",
  /** The row's computed title on the card. */
  row: /Overshoot .*since v2\.1\.0-e2e/,
} as const;

/** One watch item, as far as the leg reads it. */
export interface WatchItem {
  readonly id: string;
  readonly releaseTag: string;
  readonly status: string;
  readonly note: string | null;
}

/** What a comparison concluded for one metric. */
interface Comparison {
  readonly results: readonly {
    readonly metric: string;
    readonly outcome: string;
    readonly reason: string | null;
  }[];
}

/**
 * Plant the baseline, name the metric as watched — with **no replay test** — and run the nightly
 * comparison now.
 *
 * The accuracy class asks for ten samples and the seed holds four, so the metric's own threshold
 * lowers the floor; every other number is the class default.
 *
 * @param context - The owner's context.
 * @returns What the comparison concluded for the planted metric.
 */
export async function plantDrift(context: BrowserContext): Promise<string> {
  await psql(
    `insert into ouroboros.regression_baselines
       (organization_id, repo_ref, release_tag, metric_source, metric_key, metric_class, "window", captured_via)
     values ('${SEED_TENANT.id}', '${DRIFT.repository}', '${DRIFT.release}', 'case_metric', '${DRIFT.key}',
             'accuracy',
             jsonb_build_object('n', 20, 'median', 1.2, 'spread', 0.1, 'spread_kind', 'iqr', 'unit', '%',
                                'from', '2026-09-01T00:00:00Z', 'to', '2026-09-08T00:00:00Z'),
             'release')`,
  );
  await requestAs(
    context,
    "PUT",
    `${WATCH}/settings`,
    {
      metrics: [
        {
          repository: DRIFT.repository,
          source: "case_metric",
          key: DRIFT.key,
          class: "accuracy",
          windowDays: 7,
          replay: null,
        },
      ],
      thresholds: { metrics: { [DRIFT.key]: { minSamples: 3 } } },
    },
    "watching the planted metric",
  );

  const compared = (await requestAs<Comparison>(
    context,
    "POST",
    `${WATCH}/comparisons`,
    null,
    "running the nightly comparison",
  ))!;
  const mine = compared.results.find((result) => result.metric === DRIFT.key);

  return mine === undefined
    ? "not compared"
    : `${mine.outcome}${mine.reason === null ? "" : ` — ${mine.reason}`}`;
}

/**
 * The planted item, if the watch holds one.
 *
 * @param context - A signed-in context.
 * @returns The item, or `undefined`.
 */
export async function plantedItem(context: BrowserContext): Promise<WatchItem | undefined> {
  const card = (await requestAs<{ items: WatchItem[] }>(
    context,
    "GET",
    WATCH,
    null,
    "reading the watch",
  ))!;

  return card.items.find((item) => item.releaseTag === DRIFT.release);
}

/**
 * Take the fixture back out: the metric is no longer watched, and the planted baseline and what
 * was opened against it are deleted. A baseline is immutable by trigger (V115), which is the
 * product's rule and not this fixture's — so the delete is the migration owner's, with triggers
 * off for the one statement.
 *
 * @param context - The owner's context.
 * @returns When the watch is the seed's again.
 */
export async function removeDrift(context: BrowserContext): Promise<void> {
  await requestAs(
    context,
    "PUT",
    `${WATCH}/settings`,
    { metrics: [], thresholds: { metrics: {} } },
    "un-watching the planted metric",
  );
  await psql(
    `begin;
     set local session_replication_role = replica;
     delete from ouroboros.regression_watch_items
      where baseline_id in (select id from ouroboros.regression_baselines where release_tag = '${DRIFT.release}');
     delete from ouroboros.regression_baselines where release_tag = '${DRIFT.release}';
     commit`,
  );
}

/* ------------------------------------------------------------------ the tools */

/**
 * The tool the leg enables in the personal workspace: web search, whose health is the
 * deployment's own SearXNG answering — so its dot turns on a workspace that holds nothing.
 */
export const FIXTURE_TOOL = {
  slug: "web",
  name: "Web search & page reader",
  /** The first field its schema declares, and the value the schema defaults it to. */
  field: { label: "Search provider", value: "searxng" },
  /** The dot once it is enabled: the adapter's own answer. */
  healthy: /^Healthy — SearXNG/,
} as const;

/**
 * Switch a tool back off. Enabling is a row (V127) and no route deletes one, so the row is
 * removed the way it could only otherwise be by a migration.
 *
 * @param organizationId - The workspace.
 * @param slug - The tool.
 * @returns When the row is gone.
 */
export async function disableTool(organizationId: string, slug: string): Promise<void> {
  await psql(
    `delete from ouroboros.research_tool_settings where organization_id = '${organizationId}' and tool_slug = '${slug}'`,
  );
}
