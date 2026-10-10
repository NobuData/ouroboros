/**
 * The regression watch's published shapes (CM.4,
 * [#623](https://github.com/NobuData/ouroboros/issues/623)) — the card's rows, the settings,
 * and what a capture and a comparison answer.
 *
 * **A row's words are derived from its state.** `pill` and `detail` are computed here from the
 * item's status and references, so the card reads `bisected → a41f2c9 · fix ticket drafted ·
 * #517` because the item holds a bisect result and a fix ticket — not because someone typed it.
 */

import { type MetricClass, type ThresholdRule, type WindowStats, tidy } from "./watch.drift";
import { metricLabel } from "./watch.inbox";
import type {
  BaselineRow,
  FixTicketRef,
  MetricSource,
  PrRef,
  ReplayTest,
  StoredMetric,
  StoredThresholds,
  ThresholdOverride,
  WatchItemRow,
  WatchSettingsRow,
  WatchStatus,
} from "./watch.repository";

/** V115's `regression_threshold_defaults()`, mirrored so the settings can show them. */
export const THRESHOLD_DEFAULTS: Readonly<Record<MetricClass, ThresholdRule>> = {
  timing: {
    direction: "higher_is_worse",
    warn_pct: 5,
    err_pct: 15,
    min_spread_multiple: 2,
    min_samples: 5,
  },
  accuracy: {
    direction: "higher_is_worse",
    warn_pct: 5,
    err_pct: 10,
    min_spread_multiple: 2,
    min_samples: 10,
  },
  resource: {
    direction: "higher_is_worse",
    warn_pct: 10,
    err_pct: 25,
    min_spread_multiple: 2,
    min_samples: 5,
  },
  rate: {
    direction: "lower_is_worse",
    warn_pct: 2,
    err_pct: 5,
    min_spread_multiple: 2,
    min_samples: 10,
  },
};

/** A threshold rule on the wire. */
export interface ThresholdResource {
  readonly direction?: ThresholdRule["direction"];
  readonly warnPct?: number;
  readonly errPct?: number;
  readonly minSpreadMultiple?: number;
  readonly minSamples?: number;
}

/** A watched metric on the wire. */
export interface WatchedMetricResource {
  /** `owner/name`. */
  readonly repository: string;
  readonly source: MetricSource;
  readonly key: string;
  readonly class: MetricClass;
  readonly windowDays: number;
  /** The replayable test a bisect runs, or null: such a metric is never bisected. */
  readonly replay: ReplayTest | null;
  /** The ref a bisect treats as bad. */
  readonly nightlyRef: string;
}

/** `GET/PUT /research/regression-watch/settings`. */
export interface WatchSettingsResource {
  readonly metrics: readonly WatchedMetricResource[];
  readonly thresholds: {
    /** The built-in rule of each metric class. */
    readonly defaults: Readonly<Record<MetricClass, Required<ThresholdResource>>>;
    /** The workspace's overrides per class. */
    readonly classes: Readonly<Partial<Record<MetricClass, ThresholdResource>>>;
    /** The workspace's overrides per metric key. */
    readonly metrics: Readonly<Record<string, ThresholdResource>>;
  };
  /** Whether a detected drift is bisected without asking. */
  readonly autoBisect: boolean;
  /** Whether a drafted fix is filed and queued without asking — the opt-in. */
  readonly autoFile: boolean;
  /** The ticket source fix drafts are composed for; null for the workspace's only one. */
  readonly fixSourceId: string | null;
  readonly lastComparedAt: string | null;
}

/** A measurement window on the wire. */
export interface WindowResource {
  readonly n: number;
  readonly median: number;
  readonly spread: number;
  readonly spreadKind: WindowStats["spread_kind"];
  readonly unit: string;
  readonly from: string;
  readonly to: string;
}

/** A captured baseline. */
export interface BaselineResource {
  readonly id: string;
  readonly repository: string;
  readonly releaseTag: string;
  readonly metric: string;
  readonly metricLabel: string;
  readonly source: MetricSource;
  readonly class: MetricClass;
  readonly window: WindowResource;
  readonly capturedAt: string;
  readonly capturedVia: "release" | "manual";
}

/** The lifecycle pill of a row — mockup 22's `fixing`, `queued`, `✓ merged`. */
export interface WatchPillResource {
  readonly label: string;
  readonly tone: "run" | "warn" | "ok" | "idle";
}

/** One row of the regression watch card. */
export interface WatchItemResource {
  readonly id: string;
  readonly repository: string;
  readonly metric: string;
  readonly metricLabel: string;
  readonly releaseTag: string;
  readonly severity: "err" | "warn" | "ok";
  readonly status: WatchStatus;
  /** `+14%`, `+230 ms`. */
  readonly drift: string;
  readonly driftValue: number;
  readonly driftUnit: string;
  readonly baseline: WindowResource;
  readonly current: WindowResource;
  /** The row's second line, composed from what the item holds. */
  readonly detail: string;
  readonly pill: WatchPillResource;
  /** Why the item rests where it is — `needs repro: …` — or null. */
  readonly note: string | null;
  readonly bisect: {
    readonly id: string | null;
    readonly culpritSha: string;
    /** The first seven characters, as the card prints it. */
    readonly culprit: string;
    readonly steps: number;
    readonly farmJobIds: readonly string[];
  } | null;
  readonly investigation: { readonly id: string; readonly displayId: string | null } | null;
  readonly fixTicket: FixTicketRef | null;
  /** The pull request that merged the fix; `key` is its number as shown — `#641`. */
  readonly pullRequest: { readonly id: string; readonly key: string } | null;
  readonly detectedAt: string;
  readonly statusChangedAt: string;
}

/** `GET /research/regression-watch`. */
export interface WatchCardResource {
  /** `nightly vs. v2.0.4 baseline`, or null before any baseline is captured. */
  readonly headline: string | null;
  /** The releases the newest baselines belong to, newest capture first. */
  readonly releases: readonly string[];
  readonly counts: { readonly open: number; readonly err: number; readonly warn: number };
  readonly items: readonly WatchItemResource[];
  readonly baselines: number;
  readonly lastComparedAt: string | null;
}

/** What a capture answers. */
export interface CaptureResource {
  readonly repository: string;
  readonly releaseTag: string;
  readonly captured: readonly BaselineResource[];
  readonly skipped: readonly { readonly metric: string; readonly reason: string }[];
}

/** What a comparison answers. */
export interface ComparisonResource {
  readonly comparedAt: string;
  readonly results: readonly {
    readonly repository: string;
    readonly metric: string;
    /**
     * `opened` a new item; `refreshed` an open one; `cleared` an open one whose drift is gone;
     * `within` thresholds (nothing opened); `no_data` (nothing to compare).
     */
    readonly outcome: "opened" | "refreshed" | "cleared" | "within" | "no_data";
    readonly reason: string | null;
    readonly itemId: string | null;
  }[];
}

/** The pill of each status. */
const PILLS: Readonly<Record<WatchStatus, WatchPillResource>> = {
  detected: { label: "detected", tone: "warn" },
  bisecting: { label: "bisecting", tone: "run" },
  bisected: { label: "bisected", tone: "warn" },
  investigation_open: { label: "investigating", tone: "run" },
  fix_drafted: { label: "queued", tone: "warn" },
  fix_running: { label: "fixing", tone: "run" },
  fixed_merged: { label: "✓ merged", tone: "ok" },
  dismissed: { label: "dismissed", tone: "idle" },
};

/**
 * A window, published.
 *
 * @param window - The stored window.
 * @returns It, camel-cased.
 */
export function windowResource(window: WindowStats): WindowResource {
  return {
    n: window.n,
    median: window.median,
    spread: window.spread,
    spreadKind: window.spread_kind,
    unit: window.unit,
    from: window.from,
    to: window.to,
  };
}

/**
 * A baseline, published.
 *
 * @param baseline - The row.
 * @returns The resource.
 */
export function baselineResource(baseline: BaselineRow): BaselineResource {
  return {
    id: baseline.id,
    repository: baseline.repo,
    releaseTag: baseline.releaseTag,
    metric: baseline.metricKey,
    metricLabel: metricLabel(baseline.metricKey),
    source: baseline.metricSource,
    class: baseline.metricClass,
    window: windowResource(baseline.window),
    capturedAt: baseline.capturedAt.toISOString(),
    capturedVia: baseline.capturedVia,
  };
}

/**
 * A row's second line — what happened, in the mockup's own shape.
 *
 * @param item - The item.
 * @returns `bisected → a41f2c9 · fix loop running · #512` and its siblings.
 */
export function detailOf(item: WatchItemRow): string {
  const culprit =
    item.bisectResult === null ? null : `bisected → ${item.bisectResult.culprit_sha.slice(0, 7)}`;
  const ticket = item.fixTicketRef?.key ?? null;
  const parts: (string | null)[] = (() => {
    switch (item.status) {
      case "detected":
        return [item.note ?? "detected"];
      case "bisecting":
        return ["bisecting on the build farm"];
      case "bisected":
        return [culprit];
      case "investigation_open":
        return [culprit, `forensics ${item.investigationDisplayId ?? "open"}`];
      case "fix_drafted":
        // Mockup 22's words for a fix that exists and has no loop on it yet — a draft shows its
        // local key, a filed ticket its number.
        return [culprit, "fix ticket drafted", ticket];
      case "fix_running":
        return [culprit, "fix loop running", ticket];
      case "fixed_merged":
        return ["root-caused, fixed & merged", item.prRef === null ? null : `PR ${item.prRef.key}`];
      case "dismissed":
        return ["dismissed"];
    }
  })();

  return parts.filter((part): part is string => part !== null && part !== "").join(" · ");
}

/**
 * A watch item, published.
 *
 * @param item - The row.
 * @returns The card's row.
 */
export function watchItemResource(item: WatchItemRow): WatchItemResource {
  return {
    id: item.id,
    repository: item.baseline.repo,
    metric: item.baseline.metricKey,
    metricLabel: metricLabel(item.baseline.metricKey),
    releaseTag: item.baseline.releaseTag,
    severity: item.severity,
    status: item.status,
    drift: item.driftDisplay,
    driftValue: tidy(item.driftValue),
    driftUnit: item.driftUnit,
    baseline: windowResource(item.baseline.window),
    current: windowResource(item.current),
    detail: detailOf(item),
    pill: PILLS[item.status],
    note: item.note,
    bisect:
      item.bisectResult === null
        ? null
        : {
            id: item.bisectId,
            culpritSha: item.bisectResult.culprit_sha,
            culprit: item.bisectResult.culprit_sha.slice(0, 7),
            steps: item.bisectResult.steps,
            farmJobIds: [...item.bisectResult.farm_job_ids],
          },
    investigation:
      item.investigationId === null
        ? null
        : { id: item.investigationId, displayId: item.investigationDisplayId },
    fixTicket: item.fixTicketRef,
    pullRequest: prResource(item.prRef),
    detectedAt: item.detectedAt.toISOString(),
    statusChangedAt: item.statusChangedAt.toISOString(),
  };
}

/**
 * A PR reference, published.
 *
 * @param ref - The stored reference.
 * @returns Its id and key, or null.
 */
function prResource(ref: PrRef | null): { readonly id: string; readonly key: string } | null {
  return ref === null ? null : { id: ref.pull_request_id, key: ref.key };
}

/**
 * The card.
 *
 * @param items - The workspace's items, open ones first.
 * @param baselines - The newest baseline of each repository and metric.
 * @param settings - The workspace's settings.
 * @returns The card: its headline names the release when there is one, the releases when
 *   repositories are on different ones.
 */
export function cardResource(
  items: readonly WatchItemRow[],
  baselines: readonly BaselineRow[],
  settings: WatchSettingsRow,
): WatchCardResource {
  const releases = [
    ...new Set(
      [...baselines]
        .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
        .map((baseline) => baseline.releaseTag),
    ),
  ];
  const open = items.filter(
    (item) => item.status !== "fixed_merged" && item.status !== "dismissed",
  );

  return {
    headline:
      releases.length === 0
        ? null
        : releases.length === 1
          ? `nightly vs. ${releases[0]} baseline`
          : `nightly vs. ${releases.length.toString()} release baselines`,
    releases,
    counts: {
      open: open.length,
      err: open.filter((item) => item.severity === "err").length,
      warn: open.filter((item) => item.severity === "warn").length,
    },
    items: items.map(watchItemResource),
    baselines: baselines.length,
    lastComparedAt: settings.lastComparedAt?.toISOString() ?? null,
  };
}

/**
 * A stored threshold override, published.
 *
 * @param rule - The stored rule, whole or partial.
 * @returns It, camel-cased, with only the fields it has.
 */
export function thresholdResource(rule: ThresholdOverride): ThresholdResource {
  return {
    ...(rule.direction === undefined ? {} : { direction: rule.direction }),
    ...(rule.warn_pct === undefined ? {} : { warnPct: rule.warn_pct }),
    ...(rule.err_pct === undefined ? {} : { errPct: rule.err_pct }),
    ...(rule.min_spread_multiple === undefined
      ? {}
      : { minSpreadMultiple: rule.min_spread_multiple }),
    ...(rule.min_samples === undefined ? {} : { minSamples: rule.min_samples }),
  };
}

/**
 * A threshold override as it is stored.
 *
 * @param rule - The wire rule.
 * @returns It, snake-cased.
 */
export function storedThreshold(rule: ThresholdResource): ThresholdOverride {
  return {
    ...(rule.direction === undefined ? {} : { direction: rule.direction }),
    ...(rule.warnPct === undefined ? {} : { warn_pct: rule.warnPct }),
    ...(rule.errPct === undefined ? {} : { err_pct: rule.errPct }),
    ...(rule.minSpreadMultiple === undefined
      ? {}
      : { min_spread_multiple: rule.minSpreadMultiple }),
    ...(rule.minSamples === undefined ? {} : { min_samples: rule.minSamples }),
  };
}

/**
 * Stored thresholds from the wire's two maps.
 *
 * @param classes - Overrides per class.
 * @param metrics - Overrides per metric key.
 * @returns What `regression_watch_settings.thresholds` stores; an empty override is dropped.
 */
export function storedThresholds(
  classes: Readonly<Partial<Record<MetricClass, ThresholdResource>>>,
  metrics: Readonly<Record<string, ThresholdResource>>,
): StoredThresholds {
  const kept = <K extends string>(map: Readonly<Partial<Record<K, ThresholdResource>>>) =>
    Object.fromEntries(
      Object.entries(map)
        .map(([key, rule]) => [key, storedThreshold(rule as ThresholdResource)] as const)
        .filter(([, rule]) => Object.keys(rule).length > 0),
    );

  return { classes: kept(classes), metrics: kept(metrics) };
}

/**
 * A watched metric, published.
 *
 * @param metric - The stored entry.
 * @returns The resource.
 */
export function metricResource(metric: StoredMetric): WatchedMetricResource {
  return {
    repository: metric.repo,
    source: metric.source,
    key: metric.key,
    class: metric.class,
    windowDays: metric.window_days,
    replay: metric.replay,
    nightlyRef: metric.nightly_ref,
  };
}

/**
 * The settings, published.
 *
 * @param settings - The stored settings.
 * @returns Overrides beside the defaults they sit over.
 */
export function settingsResource(settings: WatchSettingsRow): WatchSettingsResource {
  const map = <K extends string>(rules: Readonly<Partial<Record<K, ThresholdOverride>>>) =>
    Object.fromEntries(
      Object.entries(rules).map(([key, rule]) => [
        key,
        thresholdResource(rule as ThresholdOverride),
      ]),
    );

  return {
    metrics: settings.metrics.map(metricResource),
    thresholds: {
      defaults: Object.fromEntries(
        Object.entries(THRESHOLD_DEFAULTS).map(([name, rule]) => [name, thresholdResource(rule)]),
      ) as Record<MetricClass, Required<ThresholdResource>>,
      classes: map(settings.thresholds.classes),
      metrics: map(settings.thresholds.metrics),
    },
    autoBisect: settings.autoBisect,
    autoFile: settings.autoFile,
    fixSourceId: settings.fixSourceId,
    lastComparedAt: settings.lastComparedAt?.toISOString() ?? null,
  };
}
