/**
 * The watch's reads of the telemetry tool (CM.4,
 * [#623](https://github.com/NobuData/ouroboros/issues/623)).
 *
 * The watch does not measure anything itself. A baseline is a `metric_window` of the build &
 * test telemetry tool (CL.6, #619) and a nightly check is its `compare` — the same two
 * operations an investigation calls — so the watch card and a brief read one number from one
 * place, and what the watch read is a citable `telemetry://` source it can hand the forensics
 * investigation.
 */

import type { ResearchToolAdapter, SourceRecord, ToolResult } from "../tools/research-tool.adapter";
import type { ResearchToolRegistry } from "../tools/research-tool.registry";
import type { Reading } from "../telemetry/telemetry.readings";
import type { WindowStats } from "./watch.drift";

/** The telemetry tool's slug. */
export const TELEMETRY_SLUG = "telemetry";

/** A reading the watch can use, or why it cannot. */
export type WatchReading =
  | {
      readonly status: "ok";
      readonly window: WindowStats;
      readonly sources: readonly SourceRecord[];
    }
  | { readonly status: "no_data"; readonly reason: string };

/** What a telemetry query answers, as far as the watch reads it. */
interface TelemetryPayload {
  readonly status?: string;
  readonly reason?: string;
  readonly b?: Reading;
}

/** A tool that answers structured queries. */
type Queryable = ResearchToolAdapter & {
  query(context: unknown, structured: unknown): Promise<ToolResult>;
};

const SPREAD_KINDS = new Set(["iqr", "stddev", "mad"]);

/**
 * An instant with an offset, from what a reading reports — a day (`2026-10-01`) or an instant.
 *
 * @param at - The reading's bound.
 * @returns ISO-8601 with `Z`.
 */
function instant(at: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T00:00:00Z` : new Date(at).toISOString();
}

/**
 * A telemetry reading as V115's window statistics.
 *
 * @param reading - The reading.
 * @returns The window — a rate or a sum, which has no median, is recorded as its figure with a
 *   spread of 0 — or the reason there is none.
 */
export function windowOf(reading: Reading | undefined): WatchReading {
  if (reading === undefined)
    return { status: "no_data", reason: "the telemetry tool gave no reading" };
  if (reading.status === "no_data") return { status: "no_data", reason: reading.reason };
  if (reading.from === null || reading.to === null || reading.n < 1) {
    return { status: "no_data", reason: "the reading has no window or no samples" };
  }
  if (!/^\S{1,16}$/.test(reading.unit)) {
    return {
      status: "no_data",
      reason: `the unit "${reading.unit}" is not one a baseline can store`,
    };
  }

  return {
    status: "ok",
    sources: [],
    window: {
      n: reading.n,
      median: reading.median ?? reading.value,
      spread: reading.spread ?? 0,
      spread_kind:
        reading.spreadKind !== null && SPREAD_KINDS.has(reading.spreadKind)
          ? (reading.spreadKind as WindowStats["spread_kind"])
          : "iqr",
      unit: reading.unit,
      from: instant(reading.from),
      to: instant(reading.to),
    },
  };
}

/** Reads metric windows through the telemetry tool. */
export class WatchReadings {
  /** @param registry - The research tool adapters of this build. */
  constructor(private readonly registry: ResearchToolRegistry) {}

  /**
   * A metric over the last `days` days — what a baseline captures.
   *
   * @param organizationId - The workspace.
   * @param metricKey - The metric.
   * @param repo - `owner/name`.
   * @param days - The window's length.
   * @returns The window and its citation, or why there is none.
   */
  async window(
    organizationId: string,
    metricKey: string,
    repo: string,
    days: number,
  ): Promise<WatchReading> {
    const result = await this.ask(organizationId, {
      op: "metric_window",
      metric: metricKey,
      window: `${days.toString()}d`,
      repo,
    });
    if (result === undefined)
      return { status: "no_data", reason: "the telemetry tool is not installed" };

    return withSources(windowOf(result.payload as Reading), result.sources);
  }

  /**
   * The nightly comparison: a release's baseline against a current window.
   *
   * @param organizationId - The workspace.
   * @param metricKey - The metric.
   * @param repo - `owner/name`.
   * @param releaseTag - The release whose baseline is side A.
   * @param window - Side B: a span such as `7d`, or an absolute range.
   * @returns The current window and the comparison's citation, or why there is none.
   */
  async compare(
    organizationId: string,
    metricKey: string,
    repo: string,
    releaseTag: string,
    window: string,
  ): Promise<WatchReading> {
    const result = await this.ask(organizationId, {
      op: "compare",
      metric: metricKey,
      windowA: `baseline:${releaseTag}`,
      windowB: window,
      repo,
    });
    if (result === undefined)
      return { status: "no_data", reason: "the telemetry tool is not installed" };

    return withSources(windowOf((result.payload as TelemetryPayload).b), result.sources);
  }

  /**
   * Ask the telemetry tool one structured query.
   *
   * @param organizationId - The workspace.
   * @param structured - The query.
   * @returns Its answer, or undefined when this build has no telemetry tool.
   */
  private async ask(
    organizationId: string,
    structured: Record<string, unknown>,
  ): Promise<ToolResult | undefined> {
    const tool = this.registry.find(TELEMETRY_SLUG) as Queryable | undefined;
    if (tool === undefined || typeof tool.query !== "function") return undefined;

    return tool.query(
      // The watch reads for the workspace, not for an investigation, and archives nothing here.
      { organizationId, investigationId: "", config: {}, secret: null, tokenCeiling: null },
      structured,
    );
  }
}

/**
 * Attach a query's sources to a usable reading.
 *
 * @param reading - The reading.
 * @param sources - What the tool cited.
 * @returns The reading with its sources; a `no_data` reading unchanged.
 */
function withSources(reading: WatchReading, sources: readonly SourceRecord[]): WatchReading {
  return reading.status === "ok" ? { ...reading, sources } : reading;
}
