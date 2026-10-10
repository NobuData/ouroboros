/**
 * `telemetry://` locators — a citation that carries its own query (CL.6,
 * [#619](https://github.com/NobuData/ouroboros/issues/619)).
 *
 * *"Hover drift is up 14 % in gusts"* is evidence only if a reader can see which metric, which two
 * windows and how many samples produced it — and can ask again. So a telemetry source's locator
 * **is** the query: {@link locatorOf} writes one from a query and {@link queryOf} reads it back,
 * and the tool's `fetch(locator)` runs what it read. The two are inverses, and a test holds them
 * to it.
 *
 * | query | locator |
 * | --- | --- |
 * | `metric_window`, an insights metric | `telemetry://metric/<metric id>/<window>` |
 * | `metric_window`, a case metric | `telemetry://case/<case key>/<measurement>/<window>` |
 * | `compare` | either of the above, the window `<a>-vs-<b>` |
 * | `case_history`, one case | `telemetry://history/case/<case key>/<window>` |
 * | `case_history`, a suite | `telemetry://history/suite/<window>?suite=<name>` |
 * | `run_series` | `telemetry://runs/<runs \| tokens>/<window>` |
 *
 * What narrows a query without naming it — a repository, a dimension, a suite's name — rides as a
 * percent-encoded query string, keys sorted. The shape is the one V122's
 * `source_locator_valid()` accepts; `research-tool.citations.ts` mirrors it.
 */

import { ResearchToolError } from "../tools/research-tool.errors";

/** The operations the tool answers. */
export const TELEMETRY_OPERATIONS = [
  "metric_window",
  "case_history",
  "run_series",
  "compare",
] as const;

/** The series `run_series` can draw. */
export const RUN_SERIES_KINDS = ["runs", "tokens"] as const;

/** A series kind. */
export type RunSeriesKind = (typeof RUN_SERIES_KINDS)[number];

/** A metric, by its key (V115's identity). */
export type MetricRef =
  | { readonly source: "bi_metric"; readonly key: string; readonly metricId: string }
  | {
      readonly source: "case_metric";
      /** `<case key>:<measurement>`. */
      readonly key: string;
      readonly caseKey: string;
      readonly measurement: string;
    };

/** A query, canonical: its windows absolute, its metric resolved to a source. */
export type TelemetryQuery =
  | {
      readonly op: "metric_window";
      readonly metric: MetricRef;
      readonly window: string;
      readonly repo?: string;
      readonly dimension?: string;
    }
  | {
      readonly op: "compare";
      readonly metric: MetricRef;
      readonly windowA: string;
      readonly windowB: string;
      readonly repo?: string;
      readonly dimension?: string;
    }
  | {
      readonly op: "case_history";
      readonly subject:
        | { readonly kind: "case"; readonly caseKey: string }
        | { readonly kind: "suite"; readonly suite: string };
      readonly window: string;
      readonly repo?: string;
    }
  | {
      readonly op: "run_series";
      readonly kind: RunSeriesKind;
      readonly window: string;
      readonly repo?: string;
    };

const BI_METRIC = /^[a-z][a-z0-9_]{0,62}$/;
const CASE_METRIC = /^([0-9a-f]{64}):([a-z][a-z0-9_]{0,62})$/;
const CASE_KEY = /^[0-9a-f]{64}$/;
const SEPARATOR = "-vs-";

/** The longest narrowing value — a repository, a dimension or a suite's name. */
export const MAX_NARROWING_CHARS = 200;

/**
 * Refuse a query or a locator.
 *
 * @param detail - What is wrong.
 * @returns Never.
 * @throws {ResearchToolError} `unsupported`, always.
 */
function refuse(detail: string): never {
  throw new ResearchToolError("unsupported", detail);
}

/**
 * A metric key as a reference to its plane.
 *
 * @param key - A metric id of the insights registry (`merge_rate`), or a case metric
 *   `<case key>:<measurement>` (`29f7…7560:hover_drift_cm`).
 * @returns The reference.
 * @throws {ResearchToolError} `unsupported` when it is neither.
 */
export function metricRef(key: unknown): MetricRef {
  if (typeof key === "string") {
    const caseMetric = CASE_METRIC.exec(key);

    if (caseMetric !== null) {
      return { source: "case_metric", key, caseKey: caseMetric[1], measurement: caseMetric[2] };
    }
    if (BI_METRIC.test(key)) return { source: "bi_metric", key, metricId: key };
  }

  return refuse(
    "a metric is an insights metric id (`merge_rate`) or a case metric `<64-hex case key>:<measurement>`",
  );
}

/**
 * Percent-encode a value so it survives the locator's character set.
 *
 * @param value - Anything.
 * @returns It, with everything outside `A–Z a–z 0–9 . _ ~ -` encoded.
 */
function encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * A window as a locator writes it.
 *
 * @param window - An absolute range, or `baseline:<tag>`.
 * @returns The same, a baseline's tag percent-encoded.
 * @throws {ResearchToolError} `unsupported` for a tag that contains the `-vs-` separator, which
 *   would make the locator split in the wrong place.
 */
function windowToken(window: string): string {
  if (!window.startsWith("baseline:")) return window;

  const tag = window.slice("baseline:".length);

  if (tag.includes(SEPARATOR)) {
    refuse(
      `a release tag containing "${SEPARATOR}" cannot be cited — it is the locator's separator`,
    );
  }

  return `baseline:${encode(tag)}`;
}

/**
 * A locator's query string.
 *
 * @param narrowing - The values that narrow the query; absent ones are left out.
 * @returns `?key=value&…` with keys sorted, or the empty string.
 */
function queryString(narrowing: Readonly<Record<string, string | undefined>>): string {
  const pairs = Object.entries(narrowing)
    .filter((pair): pair is [string, string] => pair[1] !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${encode(value)}`);

  return pairs.length === 0 ? "" : `?${pairs.join("&")}`;
}

/**
 * The path a metric is cited under.
 *
 * @param metric - The metric.
 * @returns `metric/<id>` or `case/<case key>/<measurement>`.
 */
function metricPath(metric: MetricRef): string {
  return metric.source === "bi_metric"
    ? `metric/${metric.metricId}`
    : `case/${metric.caseKey}/${metric.measurement}`;
}

/**
 * The locator of a query.
 *
 * @param query - The canonical query.
 * @returns The `telemetry://` locator that {@link queryOf} reads back to the same query.
 * @throws {ResearchToolError} `unsupported` for a baseline tag that cannot be cited.
 */
export function locatorOf(query: TelemetryQuery): string {
  switch (query.op) {
    case "metric_window":
      return `telemetry://${metricPath(query.metric)}/${windowToken(query.window)}${queryString({
        repo: query.repo,
        dimension: query.dimension,
      })}`;
    case "compare":
      return `telemetry://${metricPath(query.metric)}/${windowToken(query.windowA)}${SEPARATOR}${windowToken(
        query.windowB,
      )}${queryString({ repo: query.repo, dimension: query.dimension })}`;
    case "case_history":
      return query.subject.kind === "case"
        ? `telemetry://history/case/${query.subject.caseKey}/${windowToken(query.window)}${queryString(
            {
              repo: query.repo,
            },
          )}`
        : `telemetry://history/suite/${windowToken(query.window)}${queryString({
            repo: query.repo,
            suite: query.subject.suite,
          })}`;
    case "run_series":
      return `telemetry://runs/${query.kind}/${windowToken(query.window)}${queryString({
        repo: query.repo,
      })}`;
  }
}

/**
 * Decode a locator's window token.
 *
 * @param token - `2026-08-01..2026-08-08`, or `baseline:<encoded tag>`.
 * @returns The window as a query writes it.
 */
function windowFrom(token: string): string {
  return token.startsWith("baseline:")
    ? `baseline:${decodeURIComponent(token.slice("baseline:".length))}`
    : token;
}

/**
 * The query a locator carries.
 *
 * @param locator - A `telemetry://` locator this tool wrote.
 * @returns The query, as the input {@link TelemetryResearchTool.query} takes — windows and all.
 * @throws {ResearchToolError} `unsupported` for a locator this tool did not write: another
 *   scheme, an unknown path, a malformed encoding. A `telemetry://` source cited by hand or by
 *   another system is not something this tool can re-run, and it says so.
 */
export function queryOf(locator: string): Readonly<Record<string, unknown>> {
  const unknown = (): never =>
    refuse(
      "this is not a locator the telemetry tool wrote — it re-runs telemetry://metric/…, telemetry://case/…, telemetry://history/… and telemetry://runs/…",
    );

  if (typeof locator !== "string" || !locator.startsWith("telemetry://") || locator.length > 2048) {
    return unknown();
  }

  const [path, search, ...extra] = locator.slice("telemetry://".length).split("?");

  if (extra.length > 0) return unknown();

  const narrowing: Record<string, string> = {};

  try {
    for (const pair of search === undefined ? [] : search.split("&")) {
      const at = pair.indexOf("=");

      if (at <= 0) return unknown();
      narrowing[pair.slice(0, at)] = decodeURIComponent(pair.slice(at + 1));
    }
  } catch {
    return unknown();
  }

  const segments = path.split("/");
  const windowPart = segments.pop() ?? "";
  let windows: string[];

  try {
    windows = windowPart.split(SEPARATOR).map(windowFrom);
  } catch {
    return unknown();
  }

  const { repo, dimension, suite, ...others } = narrowing;

  if (
    Object.keys(others).length > 0 ||
    windows.length > 2 ||
    windows.some((window) => window === "")
  ) {
    return unknown();
  }

  const scoped = (extraKeys: Readonly<Record<string, string | undefined>>) =>
    Object.fromEntries(
      Object.entries({ repo, ...extraKeys }).filter(([, value]) => value !== undefined),
    );
  const [head, second, third] = segments;
  const metric =
    head === "metric" && segments.length === 2
      ? second
      : head === "case" && segments.length === 3
        ? `${second}:${third}`
        : null;

  if (metric !== null && suite === undefined) {
    return windows.length === 2
      ? {
          op: "compare",
          metric,
          windowA: windows[0],
          windowB: windows[1],
          ...scoped({ dimension }),
        }
      : { op: "metric_window", metric, window: windows[0], ...scoped({ dimension }) };
  }

  if (windows.length !== 1 || dimension !== undefined) return unknown();

  if (head === "history" && second === "case" && segments.length === 3 && suite === undefined) {
    return { op: "case_history", case: third, window: windows[0], ...scoped({}) };
  }
  if (head === "history" && second === "suite" && segments.length === 2 && suite !== undefined) {
    return { op: "case_history", suite, window: windows[0], ...scoped({}) };
  }
  if (head === "runs" && segments.length === 2 && suite === undefined) {
    return { op: "run_series", kind: second, window: windows[0], ...scoped({}) };
  }

  return unknown();
}

/**
 * Read a case key.
 *
 * @param value - The input.
 * @returns The key.
 * @throws {ResearchToolError} `unsupported` when it is not a 64-hex case key.
 */
export function caseKey(value: unknown): string {
  return typeof value === "string" && CASE_KEY.test(value)
    ? value
    : refuse("a case is named by its 64-hex case key");
}

/**
 * Read an optional narrowing value — a repository, a dimension or a suite's name.
 *
 * @param value - The input; `undefined` and `null` mean "not narrowed".
 * @param what - What it is, for the refusal.
 * @returns The value, or `undefined`.
 * @throws {ResearchToolError} `unsupported` for anything that is not a short, non-blank string.
 */
export function narrowing(value: unknown, what: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_NARROWING_CHARS) {
    return refuse(
      `${what} is a non-blank string of at most ${String(MAX_NARROWING_CHARS)} characters`,
    );
  }

  return value;
}
