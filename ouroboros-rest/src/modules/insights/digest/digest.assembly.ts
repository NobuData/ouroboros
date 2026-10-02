/**
 * What the weekly Insights email says (BJ.4,
 * [#440](https://github.com/NobuData/ouroboros/issues/440), decision **I9**) — assembled from the
 * Insights page's own payload and from nothing else.
 *
 * ```
 * InsightsPageService.read(…, { range: "7d" })  ─▶  assembleDigest(page)  ─▶  DigestAssembly
 *                                                                              ├─▶ digest.html.ts
 *                                                                              ├─▶ digest.text.ts
 *                                                                              └─▶ (chat, #536)
 * ```
 *
 * **Nothing here computes a metric.** Every figure is one the page already answered — a KPI's
 * `value` and `delta`, a card's top bar and its computed `line`, a flaky case's `ratePct`,
 * `usage` — so the mail cannot quote a merge rate the page disagrees with, and it inherits the
 * page's honesty rules without restating them: an unpriced workspace's fourth KPI arrives in
 * tokens and its `usage` has no `costCents`, so there is no dollar figure here to print.
 *
 * **An assembly is the content, not a presentation.** It holds each figure *and* the string a
 * mail prints for it, so the HTML and plain-text parts print the same characters and a chat
 * rendering (#536) can read the same object. It is stored on the digest run (V084), which is
 * why it is plain JSON.
 */

import type { MetricRange } from "../metrics/metrics.window";
import {
  formatCompact,
  formatCount,
  formatDelta,
  formatFigure,
  formatMoney,
  formatPercent,
  type FigureUnit,
} from "../page/page.format";
import type {
  InsightsFlakyCase,
  InsightsKpi,
  InsightsKpiKey,
  InsightsMoney,
  InsightsResource,
} from "../page/page.resources";
import type { Day } from "../rollup/rollup.types";

/**
 * The version of the digest's content. It moves when the assembly's shape or its wording rules
 * change, so the send audit can say which rules a past mail was written under.
 */
export const DIGEST_CONTENT_VERSION = 1;

/** The range a digest covers — the page's seven days. */
export const DIGEST_RANGE: MetricRange = "7d";

/** The most flaky cases a digest lists. */
export const MAX_FLAKY_MOVERS = 5;

/** What the digest says when the week has nothing in it. */
export const NOTHING_TO_REPORT = "Nothing to report this week.";

/** What the interventions section says when nobody stepped in. */
export const NO_INTERVENTIONS = "No loop needed a human this week.";

/** What the flaky section says when no case moved. */
export const NO_FLAKY_MOVERS = "No flaky test moved this week.";

/** What the KPI row calls each card. */
const KPI_LABELS: Readonly<Record<InsightsKpiKey, string>> = {
  autonomous_merge_rate: "Autonomous merge rate",
  merged_untouched_rate: "Merged without human edits",
  cycle_time: "Median cycle",
  cost_per_merged_pr: "Cost per merged PR",
  human_interventions: "Human interventions",
};

/** The fourth card's name when the usage has no price and the card counts tokens instead. */
const TOKENS_PER_MERGED_PR = "Tokens per merged PR";

/** One KPI as the digest prints it. */
export interface DigestKpi {
  readonly key: InsightsKpiKey;
  readonly label: string;
  readonly unit: FigureUnit;
  /** The page's figure. */
  readonly value: number | null;
  /** The page's delta against the prior week. */
  readonly delta: number | null;
  /** The figure, printed: `92%`, `14m 20s`, `$1.87`, `—`. */
  readonly valueText: string;
  /** The move, printed: `▲ 3pts`. Null when there is none to state. */
  readonly deltaText: string | null;
  /** Whether the move is an improvement — the page's judgement. Null when flat or unknown. */
  readonly good: boolean | null;
  /** The registry's flag: the metric is a stated stand-in for what it is named after. */
  readonly proxy: boolean;
}

/** The week's most common reason a loop needed a human. */
export interface DigestTopCause {
  /** The cause's stored id. */
  readonly key: string;
  readonly label: string;
  readonly count: number;
  /** Every intervention in the week. */
  readonly total: number;
  /** `Flaky env / rig — 8 of 12 interventions.` */
  readonly text: string;
  /** The page's own computed insight line for the card, or null. */
  readonly line: string | null;
}

/** One flaky case that moved. */
export interface DigestFlakyMover {
  readonly name: string;
  readonly suite: string | null;
  readonly repository: string;
  readonly state: InsightsFlakyCase["state"];
  readonly ratePct: number | null;
  readonly trend: InsightsFlakyCase["trend"];
  /** What the case did this week: `watching · 40% flaky, rising on qemu_cortex_m3`. */
  readonly text: string;
}

/** The week's usage, under the page's money rule. */
export interface DigestCost {
  readonly pricing: InsightsMoney["pricing"];
  readonly tokens: number;
  readonly unpricedTokens: number;
  /** Present only when the page's `usage` carries it — that is, only for priced usage. */
  readonly costCents?: number;
  /** The cost line. */
  readonly text: string;
}

/** A week of Insights, as a mail (or a chat message) says it. */
export interface DigestAssembly {
  readonly contentVersion: number;
  /** The page's own window: seven UTC days, the last one partial. */
  readonly window: { readonly from: Day; readonly to: Day };
  /** True when the week has nothing in it; the presentations then say so and print no figures. */
  readonly empty: boolean;
  /** *"27 PRs merged this week. 2 needed a human."* */
  readonly headline: string;
  readonly head: { readonly mergedPrs: number; readonly interventions: number };
  readonly kpis: readonly DigestKpi[];
  /** Null when no loop needed a human. */
  readonly topCause: DigestTopCause | null;
  /** Cases that were fixed, or whose flake rate rose or fell inside the week. */
  readonly flaky: readonly DigestFlakyMover[];
  readonly cost: DigestCost;
}

/**
 * `1 PR`, `27 PRs`.
 *
 * @param count - How many.
 * @param noun - The singular.
 * @returns The count and the noun in agreement.
 */
function counted(count: number, noun: string): string {
  return `${formatCount(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The page head's sentence, written for a week.
 *
 * @param mergedPrs - PRs merged in the week.
 * @param interventions - Times a loop needed a human.
 * @returns The sentence.
 */
function headlineOf(mergedPrs: number, interventions: number): string {
  const merged =
    mergedPrs === 0 ? "No PRs merged this week." : `${counted(mergedPrs, "PR")} merged this week.`;
  const humans =
    interventions === 0 ? "None needed a human." : `${formatCount(interventions)} needed a human.`;

  return `${merged} ${humans}`;
}

/**
 * One KPI card, printed.
 *
 * @param kpi - The page's card.
 * @returns The digest's row.
 */
function kpiOf(kpi: InsightsKpi): DigestKpi {
  return {
    key: kpi.key,
    // The page answers this card in tokens when nothing prices the usage; the label follows.
    label:
      kpi.key === "cost_per_merged_pr" && kpi.unit === "tokens"
        ? TOKENS_PER_MERGED_PR
        : KPI_LABELS[kpi.key],
    unit: kpi.unit,
    value: kpi.value,
    delta: kpi.delta,
    valueText: formatFigure(kpi.value, kpi.unit),
    deltaText: formatDelta(kpi.delta, kpi.unit),
    good: kpi.trend.good,
    proxy: kpi.methodology.proxy,
  };
}

/**
 * The interventions card's top bar.
 *
 * @param card - The page's card: bars in its order, the total and the computed line.
 * @returns The top cause, or null when the week had no interventions.
 */
function topCauseOf(card: InsightsResource["hbars"]["interventions"]): DigestTopCause | null {
  const top = card.bars.at(0);
  const total = card.total ?? 0;

  if (top === undefined || total <= 0) {
    return null;
  }

  return {
    key: top.key,
    label: top.label,
    count: top.value,
    total,
    text: `${top.label} — ${formatCount(top.value)} of ${counted(total, "intervention")}.`,
    line: card.line,
  };
}

/**
 * Whether a flaky case did anything this week the digest should mention.
 *
 * The page gives each case a trend — the second half of the window's rate against the first —
 * and a state. A case that was fixed moved; one whose rate rose or fell moved; one that sat
 * where it was did not.
 *
 * @param flaky - The page's case.
 * @returns True for a mover.
 */
function moved(flaky: InsightsFlakyCase): boolean {
  return flaky.state === "fixed" || flaky.trend !== "flat";
}

/**
 * One mover, printed.
 *
 * @param flaky - The page's case.
 * @returns The digest's row.
 */
function moverOf(flaky: InsightsFlakyCase): DigestFlakyMover {
  // A case the report never named is known by its suite, or failing that by its key.
  const name = flaky.name ?? flaky.suite ?? `case ${flaky.caseKey.slice(0, 12)}`;
  const parts: string[] = [];

  if (flaky.state === "fixed") {
    parts.push(
      flaky.resolvedBy === undefined
        ? "fixed"
        : `fixed by loop #${String(flaky.resolvedBy.issueNumber)}`,
    );
  } else {
    parts.push(flaky.state);
  }

  if (flaky.ratePct !== null) {
    const rate = `${formatPercent(flaky.ratePct)} flaky`;

    parts.push(flaky.trend === "flat" ? rate : `${rate}, ${flaky.trend}`);
  }

  const where = flaky.platform === undefined ? "" : ` on ${flaky.platform}`;

  return {
    name,
    suite: flaky.suite,
    repository: flaky.repository,
    state: flaky.state,
    ratePct: flaky.ratePct,
    trend: flaky.trend,
    text: `${parts.join(" · ")}${where}`,
  };
}

/**
 * The cost line, under the page's money rule (decision I8).
 *
 * @param usage - The page's `usage`.
 * @returns The line. A dollar figure appears only when `usage` carries `costCents`.
 */
function costOf(usage: InsightsMoney): DigestCost {
  const tokens = `${formatCompact(usage.tokens)} tokens`;
  let text: string;

  if (usage.pricing === "none") {
    text = "No model usage this week.";
  } else if (usage.costCents === undefined) {
    text = `${tokens} this week. No price is configured for this usage, so there is no dollar figure.`;
  } else if (usage.unpricedTokens > 0) {
    text =
      `${formatMoney(usage.costCents)} this week for priced usage only — ` +
      `${formatCompact(usage.unpricedTokens)} of ${tokens} have no price.`;
  } else {
    text = `${formatMoney(usage.costCents)} this week across ${tokens}.`;
  }

  return {
    pricing: usage.pricing,
    tokens: usage.tokens,
    unpricedTokens: usage.unpricedTokens,
    ...(usage.costCents === undefined ? {} : { costCents: usage.costCents }),
    text,
  };
}

/**
 * Whether the week has anything in it.
 *
 * A workspace that merged nothing, closed nothing, needed nobody, spent nothing, built nothing
 * and ran no tests gets a mail that says so, not a page of zeroes. A flaky case counts only if
 * it ran or was fixed this week: one that has sat quarantined for a month is not this week's
 * news, and would otherwise keep the honest empty mail from ever being sent.
 *
 * @param page - The page.
 * @returns True when there is nothing to report.
 */
function isEmpty(page: InsightsResource): boolean {
  const ran = (key: "builds" | "test_cases_run"): number =>
    page.performance.find((cell) => cell.key === key)?.value ?? 0;
  const closedAny = page.kpis.some(
    (kpi) => kpi.key === "autonomous_merge_rate" && kpi.value !== null,
  );
  const flakyActivity = page.flaky.cases.some(
    (flaky) => flaky.state === "fixed" || flaky.history.some((point) => point.ratePct !== null),
  );

  return (
    page.head.mergedPrs === 0 &&
    page.head.interventions === 0 &&
    !closedAny &&
    page.usage.pricing === "none" &&
    ran("builds") === 0 &&
    ran("test_cases_run") === 0 &&
    !flakyActivity
  );
}

/**
 * Assemble a week's digest from the Insights page.
 *
 * @param page - `InsightsPageService.read(…, { range: "7d" })` for the whole workspace.
 * @returns The assembly.
 * @throws {RangeError} If the page is not the seven-day page: a digest of any other window would
 *   call a month "this week".
 */
export function assembleDigest(page: InsightsResource): DigestAssembly {
  if (page.range !== DIGEST_RANGE) {
    throw new RangeError(`A weekly digest is assembled from the 7d page, not ${page.range}.`);
  }

  const empty = isEmpty(page);

  return {
    contentVersion: DIGEST_CONTENT_VERSION,
    window: page.window,
    empty,
    headline: empty ? NOTHING_TO_REPORT : headlineOf(page.head.mergedPrs, page.head.interventions),
    head: { mergedPrs: page.head.mergedPrs, interventions: page.head.interventions },
    kpis: page.kpis.map(kpiOf),
    topCause: topCauseOf(page.hbars.interventions),
    flaky: page.flaky.cases.filter(moved).slice(0, MAX_FLAKY_MOVERS).map(moverOf),
    cost: costOf(page.usage),
  };
}
