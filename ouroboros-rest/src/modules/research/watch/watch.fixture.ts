/**
 * Test fixtures for the regression watch (CM.4, #623): mockup 22's hover-drift baseline and
 * item as rows, and an in-memory {@link WatchStore}.
 */

import type { MetricClass, ThresholdRule, WindowStats } from "./watch.drift";
import {
  DEFAULT_SETTINGS,
  OPEN_STATUSES,
  type BaselineRow,
  type DraftState,
  type FixProgress,
  type ItemChange,
  type ItemReading,
  type NewBaseline,
  type StoredMetric,
  type WatchItemRow,
  type WatchSettingsPatch,
  type WatchSettingsRow,
  type WatchStatus,
  type WatchStore,
} from "./watch.repository";
import { THRESHOLD_DEFAULTS } from "./watch.resources";

export const ORG = "org-acme";
export const REPO = "acme/helios-firmware";
export const CASE_KEY = "29f70bbc9eaa22505445bbf2378dc743e5b177119c5a09cdcde73870d0867560";
export const HOVER = `${CASE_KEY}:hover_drift_cm`;
export const CULPRIT = "a41f2c9".padEnd(40, "0");

/** A window of statistics. */
export function stats(median: number, overrides: Partial<WindowStats> = {}): WindowStats {
  return {
    n: 30,
    median,
    spread: 0.1,
    spread_kind: "iqr",
    unit: "cm",
    from: "2026-10-03T00:00:00.000Z",
    to: "2026-10-10T00:00:00.000Z",
    ...overrides,
  };
}

/** The watched hover-drift metric, with a replay test unless told otherwise. */
export function hoverMetric(overrides: Partial<StoredMetric> = {}): StoredMetric {
  return {
    repo: REPO,
    source: "case_metric",
    key: HOVER,
    class: "accuracy",
    window_days: 7,
    replay: { pool: "hil-rig", command: ["west", "twister"] },
    nightly_ref: "nightly",
    ...overrides,
  };
}

/** The v2.0.4 baseline of hover drift. */
export function baseline(overrides: Partial<BaselineRow> = {}): BaselineRow {
  return {
    id: "ba5e0000-0000-4000-8000-000000000001",
    organizationId: ORG,
    repo: REPO,
    releaseTag: "v2.0.4",
    metricSource: "case_metric",
    metricKey: HOVER,
    metricClass: "accuracy",
    window: stats(5),
    capturedAt: new Date("2026-09-20T00:00:00Z"),
    capturedVia: "release",
    ...overrides,
  };
}

/** A detected +14% hover-drift item. */
export function item(overrides: Partial<WatchItemRow> = {}): WatchItemRow {
  return {
    id: "17e00000-0000-4000-8000-000000000001",
    organizationId: ORG,
    baseline: baseline(),
    current: stats(5.7, { n: 12 }),
    driftValue: 14,
    driftUnit: "%",
    driftDisplay: "+14%",
    severity: "err",
    status: "detected",
    bisectId: null,
    bisectResult: null,
    investigationId: null,
    investigationDisplayId: null,
    fixTicketRef: null,
    prRef: null,
    note: null,
    detectedAt: new Date("2026-10-10T02:00:00Z"),
    statusChangedAt: new Date("2026-10-10T02:00:00Z"),
    ...overrides,
  };
}

/** A bisect result naming {@link CULPRIT}. */
export const BISECT_RESULT = {
  culprit_sha: CULPRIT,
  farm_job_ids: ["10b00000-0000-4000-8000-000000000001", "10b00000-0000-4000-8000-000000000002"],
  steps: 2,
  confidence_basis: { method: "first_parent_bisect", inputs: {} },
};

/** An in-memory watch store. */
export class MemoryWatchStore implements WatchStore {
  stored = new Map<string, WatchSettingsRow>();
  baselines: BaselineRow[] = [];
  rows: WatchItemRow[] = [];
  sources: string[] = ["50000000-0000-4000-8000-000000000001"];
  drafts = new Map<string, DraftState>();
  progress = new Map<string, FixProgress>();
  catalogue = new Set(["merge_rate", "build_duration"]);
  opened: { organizationId: string; question: string; tools: readonly string[] }[] = [];
  hasForensicsKind = true;
  private next = 2;

  /** @inheritdoc */
  settings(organizationId: string): Promise<WatchSettingsRow> {
    return Promise.resolve(this.stored.get(organizationId) ?? DEFAULT_SETTINGS);
  }

  /** @inheritdoc */
  saveSettings(organizationId: string, patch: WatchSettingsPatch): Promise<WatchSettingsRow> {
    const before = this.stored.get(organizationId) ?? DEFAULT_SETTINGS;
    const after: WatchSettingsRow = {
      ...before,
      ...(patch.thresholds === undefined ? {} : { thresholds: patch.thresholds }),
      ...(patch.metrics === undefined ? {} : { metrics: patch.metrics }),
      ...(patch.autoBisect === undefined ? {} : { autoBisect: patch.autoBisect }),
      ...(patch.autoFile === undefined ? {} : { autoFile: patch.autoFile }),
      ...(patch.fixSourceId === undefined ? {} : { fixSourceId: patch.fixSourceId }),
    };
    this.stored.set(organizationId, after);
    return Promise.resolve(after);
  }

  /** @inheritdoc */
  markCompared(organizationId: string, at: Date): Promise<void> {
    this.stored.set(organizationId, {
      ...(this.stored.get(organizationId) ?? DEFAULT_SETTINGS),
      lastComparedAt: at,
    });
    return Promise.resolve();
  }

  /** @inheritdoc */
  workspacesDue(since: Date): Promise<string[]> {
    const withBaselines = [...new Set(this.baselines.map((row) => row.organizationId))];
    return Promise.resolve(
      withBaselines.filter((organizationId) => {
        const last = this.stored.get(organizationId)?.lastComparedAt ?? null;
        return last === null || last < since;
      }),
    );
  }

  /** @inheritdoc */
  workspacesWatching(repo: string): Promise<string[]> {
    return Promise.resolve(
      [...this.stored.entries()]
        .filter(([, settings]) =>
          settings.metrics.some((metric) => metric.repo.toLowerCase() === repo.toLowerCase()),
        )
        .map(([organizationId]) => organizationId),
    );
  }

  /** @inheritdoc */
  threshold(
    organizationId: string,
    metricKey: string,
    metricClass: MetricClass,
  ): Promise<ThresholdRule> {
    const thresholds = (this.stored.get(organizationId) ?? DEFAULT_SETTINGS).thresholds;
    return Promise.resolve({
      ...THRESHOLD_DEFAULTS[metricClass],
      ...thresholds.classes[metricClass],
      ...thresholds.metrics[metricKey],
    });
  }

  /** @inheritdoc */
  insertBaseline(row: NewBaseline): Promise<BaselineRow | undefined> {
    if (
      this.baselines.some(
        (held) =>
          held.organizationId === row.organizationId &&
          held.repo === row.repo &&
          held.releaseTag === row.releaseTag &&
          held.metricKey === row.metricKey,
      )
    ) {
      return Promise.resolve(undefined);
    }
    const stored = baseline({
      id: `ba5e0000-0000-4000-8000-${(this.next++).toString().padStart(12, "0")}`,
      organizationId: row.organizationId,
      repo: row.repo,
      releaseTag: row.releaseTag,
      metricSource: row.metricSource,
      metricKey: row.metricKey,
      metricClass: row.metricClass,
      window: row.window,
      capturedVia: row.capturedVia,
      capturedAt: new Date(Date.UTC(2026, 9, 1, 0, 0, this.next)),
    });
    this.baselines.push(stored);
    return Promise.resolve(stored);
  }

  /** @inheritdoc */
  latestBaselines(organizationId: string): Promise<BaselineRow[]> {
    const newest = new Map<string, BaselineRow>();
    for (const row of this.baselines.filter((held) => held.organizationId === organizationId)) {
      const key = `${row.repo} ${row.metricKey}`;
      const held = newest.get(key);
      if (held === undefined || held.capturedAt < row.capturedAt) newest.set(key, row);
    }
    return Promise.resolve([...newest.values()]);
  }

  /** @inheritdoc */
  openItem(organizationId: string, baselineId: string): Promise<WatchItemRow | undefined> {
    return Promise.resolve(
      this.rows.find(
        (row) =>
          row.organizationId === organizationId &&
          row.baseline.id === baselineId &&
          OPEN_STATUSES.includes(row.status),
      ),
    );
  }

  /** @inheritdoc */
  insertItem(
    organizationId: string,
    baselineId: string,
    reading: ItemReading,
  ): Promise<WatchItemRow> {
    const from = this.baselines.find((row) => row.id === baselineId) ?? baseline();
    const row = item({
      id: `17e00000-0000-4000-8000-${(this.next++).toString().padStart(12, "0")}`,
      organizationId,
      baseline: from,
      ...readingOf(reading),
    });
    this.rows.push(row);
    return Promise.resolve(row);
  }

  /** @inheritdoc */
  updateReading(organizationId: string, itemId: string, reading: ItemReading): Promise<void> {
    this.patch(organizationId, itemId, readingOf(reading));
    return Promise.resolve();
  }

  /** @inheritdoc */
  items(organizationId: string): Promise<WatchItemRow[]> {
    return Promise.resolve(this.rows.filter((row) => row.organizationId === organizationId));
  }

  /** @inheritdoc */
  item(organizationId: string, itemId: string): Promise<WatchItemRow | undefined> {
    return Promise.resolve(
      this.rows.find((row) => row.organizationId === organizationId && row.id === itemId),
    );
  }

  /** @inheritdoc */
  openItems(): Promise<WatchItemRow[]> {
    return Promise.resolve(this.rows.filter((row) => OPEN_STATUSES.includes(row.status)));
  }

  /** @inheritdoc */
  move(
    organizationId: string,
    itemId: string,
    from: WatchStatus,
    change: ItemChange,
  ): Promise<boolean> {
    const row = this.rows.find(
      (held) =>
        held.organizationId === organizationId && held.id === itemId && held.status === from,
    );
    if (row === undefined) return Promise.resolve(false);
    this.patch(organizationId, itemId, {
      ...(change.status === undefined ? {} : { status: change.status }),
      ...(change.note === undefined ? {} : { note: change.note }),
      ...(change.bisectId === undefined ? {} : { bisectId: change.bisectId }),
      ...(change.bisectResult === undefined ? {} : { bisectResult: change.bisectResult }),
      ...(change.investigationId === undefined
        ? {}
        : { investigationId: change.investigationId, investigationDisplayId: "RS-131" }),
      ...(change.fixTicketRef === undefined ? {} : { fixTicketRef: change.fixTicketRef }),
      ...(change.prRef === undefined ? {} : { prRef: change.prRef }),
    });
    return Promise.resolve(true);
  }

  /** @inheritdoc */
  dismiss(organizationId: string, itemId: string): Promise<boolean> {
    const row = this.rows.find(
      (held) =>
        held.organizationId === organizationId &&
        held.id === itemId &&
        OPEN_STATUSES.includes(held.status),
    );
    if (row === undefined) return Promise.resolve(false);
    this.patch(organizationId, itemId, { status: "dismissed" });
    return Promise.resolve(true);
  }

  /** @inheritdoc */
  openInvestigation(
    organizationId: string,
    question: string,
    tools: readonly string[],
  ): Promise<{ readonly id: string; readonly displayId: string } | undefined> {
    if (!this.hasForensicsKind) return Promise.resolve(undefined);
    this.opened.push({ organizationId, question, tools });
    return Promise.resolve({ id: "1e500000-0000-4000-8000-000000000131", displayId: "RS-131" });
  }

  /** @inheritdoc */
  unknownMetrics(metricIds: readonly string[]): Promise<string[]> {
    return Promise.resolve(metricIds.filter((id) => !this.catalogue.has(id)));
  }

  /** @inheritdoc */
  ticketSources(): Promise<string[]> {
    return Promise.resolve([...this.sources]);
  }

  /** @inheritdoc */
  draftState(_organizationId: string, draftId: string): Promise<DraftState | undefined> {
    return Promise.resolve(this.drafts.get(draftId));
  }

  /** @inheritdoc */
  fixProgress(_organizationId: string, ticketId: string): Promise<FixProgress> {
    return Promise.resolve(
      this.progress.get(ticketId) ?? {
        issueId: null,
        queued: false,
        activeRunId: null,
        ranBefore: false,
        mergedPr: null,
      },
    );
  }

  /** Change a row in place. */
  patch(organizationId: string, itemId: string, change: Partial<WatchItemRow>): void {
    this.rows = this.rows.map((row) =>
      row.organizationId === organizationId && row.id === itemId ? { ...row, ...change } : row,
    );
  }

  /** The current state of a row. */
  get(itemId: string): WatchItemRow {
    const row = this.rows.find((held) => held.id === itemId);
    if (row === undefined) throw new Error(`no item ${itemId}`);
    return row;
  }
}

/** A reading as the row fields it sets. */
function readingOf(reading: ItemReading): Partial<WatchItemRow> {
  return {
    current: reading.current,
    driftValue: reading.driftValue,
    driftUnit: reading.driftUnit,
    driftDisplay: `${reading.driftValue >= 0 ? "+" : "-"}${Math.abs(reading.driftValue).toString()}${reading.driftUnit === "%" ? "%" : ` ${reading.driftUnit}`}`,
    severity: reading.severity,
  };
}

/** A telemetry tool that answers the readings a test sets. */
export class FakeTelemetry {
  baseline: unknown = fakeReading(5);
  current: unknown = fakeReading(5.7, 12);
  asked: Record<string, unknown>[] = [];
  installed = true;

  /** The registry a service is given. */
  registry(): { find(slug: string): unknown } {
    return {
      find: (slug: string) =>
        slug === "telemetry" && this.installed
          ? {
              query: (_context: unknown, structured: Record<string, unknown>) => {
                this.asked.push(structured);
                return Promise.resolve({
                  payload:
                    structured.op === "metric_window"
                      ? this.baseline
                      : { status: "ok", a: this.baseline, b: this.current },
                  sources: [{ kind: "telemetry", locator: "telemetry://x", title: "t" }],
                  usage: { tokens: 0 },
                });
              },
            }
          : undefined,
    };
  }
}

/** A sample reading as the telemetry tool reports one. */
export function fakeReading(median: number, n = 30, spread = 0.1): Record<string, unknown> {
  return {
    status: "ok",
    window: "2026-10-03T00:00:00.000Z..2026-10-10T00:00:00.000Z",
    from: "2026-10-03T00:00:00.000Z",
    to: "2026-10-10T00:00:00.000Z",
    value: median,
    unit: "cm",
    n,
    basis: "samples",
    median,
    spread,
    spreadKind: "iqr",
  };
}

/**
 * One argument of one call of a mock, untyped — so a spec can match it without `any`.
 *
 * @param mock - The mock.
 * @param call - Which call, from 0.
 * @param index - Which argument, from 0.
 * @returns The argument.
 */
export function callArg(mock: { mock: { calls: unknown[][] } }, call = 0, index = 0): unknown {
  return mock.mock.calls[call][index];
}
