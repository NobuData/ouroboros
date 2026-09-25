/**
 * The HIL results parser — `ouro-hil-results.json`, the versioned schema a rig uploads beside its
 * JUnit report because JUnit cannot express a value, a unit and a limit (option **2-A**, AT.1
 * [#329](https://github.com/NobuData/ouroboros/issues/329); the schema is
 * `schemas/hil-results/v1.json`).
 *
 * ## Validation failures are warnings, and they are as narrow as possible
 *
 * The document is validated against the schema with every error collected, and each error drops
 * the **smallest element that encloses it**: a bad unit drops that measurement
 * (`hil_measurement_incomplete`), a case with no procedure drops that case, a suite with no name
 * drops that suite (`hil_schema_invalid`). Only a document whose envelope is wrong — not JSON
 * (`hil_json_malformed`), a version this build does not know (`hil_schema_version_unknown`), no rig —
 * is dropped whole. Everything that survived is kept, and nothing is dropped silently.
 *
 * ## The verdict is computed, never uploaded
 *
 * `max` passes when `value <= limit`, `min` when `value >= limit` — V053's `hil_verdict()`, which
 * the database also holds each row to. A case with no `status` of its own is `failed` when any
 * surviving measurement fails, `passed` when all pass, and `error` when none survived.
 */

import Ajv2020, { type ErrorObject } from "ajv/dist/2020";

import type { TestAttemptOutcome, TestCaseFailure } from "../db/schema";
import { HIL_RESULTS_SCHEMA, HIL_SCHEMA_NAME, HIL_SCHEMA_VERSION } from "./hil.schema";
import {
  EMPTY_OUTPUT,
  headOf,
  textOf,
  type NormalizedCase,
  type NormalizedMeasurement,
  type NormalizedSuite,
  type ParseOutput,
  type ParseWarning,
  type ResultFile,
  type TestResultParser,
} from "./parser.spi";
import { rigPlatform } from "./platform";

/** A measurement as the document spells it, once validated. */
interface HilMeasurementDoc {
  metric: string;
  value: number;
  unit: string;
  limit: number;
  direction: "max" | "min";
  trials?: Record<string, unknown>[];
}

/** A case as the document spells it, once validated. */
interface HilCaseDoc {
  name: string;
  classname?: string;
  status?: TestAttemptOutcome;
  duration_ms?: number;
  procedure: string;
  measurements: unknown[];
}

/** A suite as the document spells it, once validated. */
interface HilSuiteDoc {
  name: string;
  cases: unknown[];
}

/** Where an error sits: which suite, case and measurement enclose it. */
interface ErrorSite {
  suite?: number;
  kase?: number;
  measurement?: number;
}

/** The compiled schema — compiled once, on first use. */
let validator: ReturnType<Ajv2020["compile"]> | undefined;

/**
 * The compiled validator for {@link HIL_RESULTS_SCHEMA}.
 *
 * @returns It.
 */
function validate(): ReturnType<Ajv2020["compile"]> {
  validator ??= new Ajv2020({ allErrors: true, strict: true }).compile(HIL_RESULTS_SCHEMA);

  return validator;
}

/**
 * The verdict a measurement's numbers give — V053's `hil_verdict()`.
 *
 * @param value - The measured value.
 * @param limit - The limit.
 * @param direction - `max` (must not exceed) or `min` (must reach). Both inclusive.
 * @returns `pass` or `fail`.
 */
export function hilVerdict(
  value: number,
  limit: number,
  direction: "max" | "min",
): "pass" | "fail" {
  return (direction === "max" ? value <= limit : value >= limit) ? "pass" : "fail";
}

/** The HIL {@link TestResultParser}. */
export class HilParser implements TestResultParser {
  readonly id = "hil";

  /**
   * A JSON file named `ouro-hil-results*.json`, or one whose head names the schema.
   *
   * @param file - The file.
   * @returns True when it is a HIL document.
   */
  detect(file: ResultFile): boolean {
    return (
      /(^|\/)ouro-hil-results[^/]*\.json$/i.test(file.name) ||
      new RegExp(`"schema"\\s*:\\s*"${HIL_SCHEMA_NAME}"`).test(headOf(file))
    );
  }

  /**
   * Read the document. See this file's header.
   *
   * @param file - The file.
   * @returns One physical suite per document suite that survived, and a warning per drop.
   */
  parse(file: ResultFile): ParseOutput {
    const warn = (code: ParseWarning["code"], message: string, at?: string): ParseOutput => ({
      ...EMPTY_OUTPUT,
      warnings: [{ code, file: file.name, message, ...(at === undefined ? {} : { at }) }],
    });
    let doc: unknown;

    try {
      doc = JSON.parse(textOf(file));
    } catch (error) {
      return warn(
        "hil_json_malformed",
        `The HIL document is not JSON (${(error as Error).message}); none of it is kept.`,
      );
    }

    if (!isObject(doc) || doc.schema !== HIL_SCHEMA_NAME) {
      return warn(
        "hil_schema_invalid",
        `The document does not name the ${HIL_SCHEMA_NAME} schema; none of it is kept.`,
        "/schema",
      );
    }
    if (doc.schema_version !== HIL_SCHEMA_VERSION) {
      return warn(
        "hil_schema_version_unknown",
        `schema_version ${JSON.stringify(doc.schema_version)} is not one this build reads (it reads ${HIL_SCHEMA_VERSION}); none of it is kept.`,
        "/schema_version",
      );
    }

    const check = validate();
    const errors = check(doc) ? [] : (check.errors ?? []);
    const warnings: ParseWarning[] = [];
    const dropped = sitesOf(errors, file.name, warnings);

    if (dropped.document) {
      return { ...EMPTY_OUTPUT, warnings };
    }

    const platform = rigPlatform(doc.rig as string) as string;
    const bench = dropped.bench ? undefined : (doc.bench as string | undefined);
    const suites: NormalizedSuite[] = [];

    (doc.suites as unknown[]).forEach((suiteDoc, s) => {
      if (dropped.suites.has(s)) {
        return;
      }
      const suite = suiteDoc as HilSuiteDoc;
      const cases: NormalizedCase[] = [];
      const seen = new Set<string>();

      suite.cases.forEach((caseDoc, c) => {
        if (dropped.cases.has(`${s}/${c}`)) {
          return;
        }
        const kase = caseDoc as HilCaseDoc;
        const identity = `${kase.classname?.trim() ?? ""}\u001f${kase.name.trim()}`;

        if (seen.has(identity)) {
          warnings.push({
            code: "hil_schema_invalid",
            file: file.name,
            message: `Case "${kase.name}" appears twice in suite "${suite.name}"; the second is dropped.`,
            at: `/suites/${s}/cases/${c}`,
          });
          return;
        }
        seen.add(identity);
        cases.push(readCase(kase, s, c, dropped.measurements, file.name, warnings));
      });

      const durations = cases
        .map((kase) => kase.durationMs)
        .filter((ms): ms is number => ms !== null);

      suites.push({
        name: suite.name.trim(),
        platform,
        kind: "physical",
        format: "hil",
        durationMs: durations.length === 0 ? null : durations.reduce((a, b) => a + b, 0),
        meta: bench === undefined ? {} : { bench },
        cases,
      });
    });

    return { suites, coverage: [], warnings };
  }
}

/**
 * One validated case as a normalized case.
 *
 * @param kase - The case.
 * @param s - Its suite's index, for paths.
 * @param c - Its index, for paths.
 * @param droppedMeasurements - The measurements the schema dropped, as `s/c/m`.
 * @param fileName - For warnings.
 * @param warnings - Where a duplicate metric is reported.
 * @returns The case, with its HIL detail.
 */
function readCase(
  kase: HilCaseDoc,
  s: number,
  c: number,
  droppedMeasurements: ReadonlySet<string>,
  fileName: string,
  warnings: ParseWarning[],
): NormalizedCase {
  const measurements: NormalizedMeasurement[] = [];
  const metrics = new Set<string>();

  kase.measurements.forEach((measurementDoc, m) => {
    if (droppedMeasurements.has(`${s}/${c}/${m}`)) {
      return;
    }
    const measurement = measurementDoc as HilMeasurementDoc;

    // JSON admits 1e400, which parses to Infinity and passes the schema's `number`; V053 refuses it.
    if (!Number.isFinite(measurement.value) || !Number.isFinite(measurement.limit)) {
      warnings.push({
        code: "hil_measurement_incomplete",
        file: fileName,
        message: `Metric "${measurement.metric}" on case "${kase.name}" is not a finite number; it is dropped.`,
        at: `/suites/${s}/cases/${c}/measurements/${m}`,
      });
      return;
    }
    if (metrics.has(measurement.metric)) {
      warnings.push({
        code: "hil_measurement_incomplete",
        file: fileName,
        message: `Metric "${measurement.metric}" is measured twice on case "${kase.name}"; the second is dropped.`,
        at: `/suites/${s}/cases/${c}/measurements/${m}`,
      });
      return;
    }
    metrics.add(measurement.metric);
    measurements.push({
      metric: measurement.metric,
      value: measurement.value,
      unit: measurement.unit,
      limitValue: measurement.limit,
      limitKind: measurement.direction,
      verdict: hilVerdict(measurement.value, measurement.limit, measurement.direction),
      trials: measurement.trials ?? [],
    });
  });

  const status = kase.status ?? derivedStatus(measurements);

  return {
    name: kase.name.trim(),
    classname: kase.classname?.trim() ?? null,
    outcomes: [status],
    durationMs: kase.duration_ms ?? null,
    failure: status === "failed" || status === "error" ? failureOf(measurements) : null,
    meta: {},
    hil: { procedure: kase.procedure.trim(), measurements },
  };
}

/**
 * A case's status from its measurements, when the rig gave none.
 *
 * @param measurements - The surviving measurements.
 * @returns error when none survived; failed when any fails; passed otherwise.
 */
function derivedStatus(measurements: readonly NormalizedMeasurement[]): TestAttemptOutcome {
  if (measurements.length === 0) {
    return "error";
  }

  return measurements.some((m) => m.verdict === "fail") ? "failed" : "passed";
}

/**
 * The failure a HIL-only case shows — its failing measurements, in the card's own words.
 *
 * @param measurements - The surviving measurements.
 * @returns A payload naming each failing measurement, or null when none failed.
 */
function failureOf(measurements: readonly NormalizedMeasurement[]): TestCaseFailure | null {
  const failing = measurements.filter((m) => m.verdict === "fail");

  if (failing.length === 0) {
    return null;
  }

  return {
    message: failing
      .map(
        (m) =>
          `${m.metric} ${m.value}${m.unit === "count" ? "" : m.unit} vs ${m.limitKind} ${m.limitValue}${m.unit === "count" ? "" : m.unit}`,
      )
      .join("; "),
  };
}

/** What the schema's errors drop. */
interface Dropped {
  document: boolean;
  bench: boolean;
  suites: Set<number>;
  cases: Set<string>;
  measurements: Set<string>;
}

/**
 * Map every schema error to the smallest element that encloses it, and warn once per element.
 *
 * @param errors - ajv's errors, all of them.
 * @param fileName - For the warnings.
 * @param warnings - Where each drop is reported.
 * @returns What to drop.
 */
function sitesOf(
  errors: readonly ErrorObject[],
  fileName: string,
  warnings: ParseWarning[],
): Dropped {
  const dropped: Dropped = {
    document: false,
    bench: false,
    suites: new Set(),
    cases: new Set(),
    measurements: new Set(),
  };
  const messages = new Map<string, { site: ErrorSite; path: string; reasons: string[] }>();

  for (const error of errors) {
    const site = siteOf(error.instancePath);
    const path =
      site.suite === undefined
        ? error.instancePath === "/bench"
          ? "/bench"
          : ""
        : site.kase === undefined
          ? `/suites/${site.suite}`
          : site.measurement === undefined
            ? `/suites/${site.suite}/cases/${site.kase}`
            : `/suites/${site.suite}/cases/${site.kase}/measurements/${site.measurement}`;
    const entry = messages.get(path) ?? { site, path, reasons: [] };

    entry.reasons.push(`${error.instancePath || "/"} ${error.message ?? "is invalid"}`);
    messages.set(path, entry);
  }

  for (const { site, path, reasons } of messages.values()) {
    const why = reasons.join("; ");

    if (site.measurement !== undefined) {
      dropped.measurements.add(`${site.suite}/${site.kase}/${site.measurement}`);
      warnings.push({
        code: "hil_measurement_incomplete",
        file: fileName,
        message: `A measurement was dropped: ${why}.`,
        at: path,
      });
    } else if (site.kase !== undefined) {
      dropped.cases.add(`${site.suite}/${site.kase}`);
      warnings.push({
        code: "hil_schema_invalid",
        file: fileName,
        message: `A case was dropped: ${why}.`,
        at: path,
      });
    } else if (site.suite !== undefined) {
      dropped.suites.add(site.suite);
      warnings.push({
        code: "hil_schema_invalid",
        file: fileName,
        message: `A suite was dropped: ${why}.`,
        at: path,
      });
    } else if (path === "/bench") {
      dropped.bench = true;
      warnings.push({
        code: "hil_schema_invalid",
        file: fileName,
        message: `The bench was dropped: ${why}.`,
        at: path,
      });
    } else {
      dropped.document = true;
      warnings.push({
        code: "hil_schema_invalid",
        file: fileName,
        message: `The document was dropped: ${why}.`,
        at: "/",
      });
    }
  }

  return dropped;
}

/**
 * Which suite, case and measurement an instance path is inside.
 *
 * @param instancePath - ajv's JSON pointer, e.g. `/suites/0/cases/2/measurements/1/unit`.
 * @returns The enclosing indices, as deep as the path goes.
 */
function siteOf(instancePath: string): ErrorSite {
  const match = /^\/suites\/(\d+)(?:\/cases\/(\d+)(?:\/measurements\/(\d+))?)?/.exec(instancePath);

  if (match === null) {
    return {};
  }

  return {
    suite: Number(match[1]),
    kase: match[2] === undefined ? undefined : Number(match[2]),
    measurement: match[3] === undefined ? undefined : Number(match[3]),
  };
}

/**
 * Narrow to a plain object.
 *
 * @param value - Anything JSON.
 * @returns True for a non-null, non-array object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
