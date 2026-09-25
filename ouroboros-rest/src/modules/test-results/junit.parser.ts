/**
 * The JUnit XML parser — the canonical interchange (decision **T3**, option 1-A) that twister,
 * pytest `--junitxml`, ctest and Playwright all emit (AT.1,
 * [#329](https://github.com/NobuData/ouroboros/issues/329)).
 *
 * Streamed through saxes, so a truncated report still yields every element that closed.
 *
 * ## What it reads
 *
 * - `testsuites` › `testsuite` › `testcase`, with nested suites read as suites of their own.
 * - An attempt's outcome from `failure`, `error` and `skipped`; its time from `time` (seconds).
 * - **Retry markers** as modern emitters (Maven surefire, pytest-rerunfailures) write them:
 *   `flakyFailure` / `flakyError` are earlier attempts that failed before the recorded outcome;
 *   `rerunFailure` / `rerunError` are later attempts after it. So a case's attempts are its flaky
 *   markers, then its own outcome, then its reruns. A `testcase` repeated with the same classname
 *   and name in one suite (an emitter that writes each attempt as its own element) is read as
 *   successive attempts, in document order.
 * - **The platform**: twister's `platform` property on the case, then on the suite, then a
 *   `platform` attribute on the suite. A suite whose cases name different platforms becomes one
 *   suite per platform. None at all is `unknown`, with a `junit_platform_missing` warning.
 * - **The failure payload**: `message` from the attribute (or the body's first line), `log_excerpt`
 *   from the body (or the case's `system-out`/`system-err`), capped at {@link LOG_EXCERPT_CHARS},
 *   and `path` from pytest's `file` and `line` attributes.
 * - Every other property, and the attributes the tree has no column for, go into `meta`.
 * - A `testsuite` with no name is recorded as `default` (V051 refuses a blank suite name), and a
 *   `testcase` with no name is dropped — it has no identity to key.
 */

import { SaxesParser } from "saxes";

import type { TestAttemptOutcome, TestCaseFailure } from "../db/schema";
import {
  EMPTY_OUTPUT,
  headOf,
  textOf,
  type NormalizedCase,
  type NormalizedSuite,
  type ParseOutput,
  type ParseWarning,
  type ResultFile,
  type TestResultParser,
} from "./parser.spi";
import { UNKNOWN_PLATFORM, kindOf, normalizePlatform } from "./platform";

/** The longest log excerpt stored on a failure — the page shows a few lines, not a log. */
export const LOG_EXCERPT_CHARS = 4000;

/** The attributes read into columns, and therefore left out of `meta`. */
const CASE_COLUMNS = new Set(["name", "classname", "time", "file", "line"]);

/** The attributes of a `testsuite` that are counts or bookkeeping rather than information. */
const SUITE_BOOKKEEPING = new Set([
  "name",
  "time",
  "tests",
  "failures",
  "errors",
  "skipped",
  "disabled",
  "timestamp",
  "platform",
]);

/** The elements that record an attempt, and the outcome each records. */
const ATTEMPT_MARKERS: Record<string, { outcome: TestAttemptOutcome; when: "before" | "after" }> = {
  flakyFailure: { outcome: "failed", when: "before" },
  flakyError: { outcome: "error", when: "before" },
  rerunFailure: { outcome: "failed", when: "after" },
  rerunError: { outcome: "error", when: "after" },
};

/** A failure payload being read. */
interface PayloadDraft {
  message: string | null;
  body: string;
}

/** A `testcase` being read. */
interface CaseDraft {
  name: string;
  classname: string | null;
  seconds: number | null;
  outcome: TestAttemptOutcome;
  before: TestAttemptOutcome[];
  after: TestAttemptOutcome[];
  payload: PayloadDraft | null;
  path: string | null;
  output: string;
  properties: Record<string, string>;
  attributes: Record<string, string>;
}

/** A `testsuite` being read. */
interface SuiteDraft {
  name: string;
  seconds: number | null;
  properties: Record<string, string>;
  attributes: Record<string, string>;
  cases: CaseDraft[];
}

/** One case, read, with the platform it runs on. */
interface ReadCase {
  platform: string | null;
  kase: NormalizedCase;
}

/** The JUnit {@link TestResultParser}. */
export class JunitParser implements TestResultParser {
  readonly id = "junit";

  /**
   * An XML file whose head opens a `testsuites` or `testsuite` element.
   *
   * @param file - The file.
   * @returns True when it is a JUnit report.
   */
  detect(file: ResultFile): boolean {
    return /<testsuites?[\s>/]/.test(headOf(file));
  }

  /**
   * Read the report. See this file's header.
   *
   * @param file - The file.
   * @returns Its suites, and a warning for a truncated or malformed document or a missing platform.
   */
  parse(file: ResultFile): ParseOutput {
    const warnings: ParseWarning[] = [];
    const read: { suite: SuiteDraft; cases: ReadCase[] }[] = [];
    const suites: SuiteDraft[] = [];
    const parser = new SaxesParser({ position: true });
    let kase: CaseDraft | null = null;
    let payload: PayloadDraft | null = null;
    let capturing: "payload" | "output" | null = null;
    let propertiesOf: "suite" | "case" | null = null;
    let closing = false;
    let halted = false;

    parser.on("error", (error) => {
      if (halted) {
        return;
      }
      halted = true;
      warnings.push({
        code: closing ? "xml_truncated" : "xml_malformed",
        file: file.name,
        message: closing
          ? `The report ends mid-document (${error.message}); every element that closed is kept.`
          : `The report is not well-formed XML (${error.message}); every element before it is kept.`,
        at: `line ${parser.line}`,
      });
    });

    parser.on("opentag", (tag) => {
      if (halted) {
        return;
      }
      const attrs = tag.attributes as Record<string, string>;

      switch (tag.name) {
        case "testsuite":
          suites.push({
            name: (attrs.name ?? "").trim(),
            seconds: seconds(attrs.time),
            properties: {},
            attributes: attrs,
            cases: [],
          });
          return;
        case "properties":
          propertiesOf = kase !== null ? "case" : suites.length > 0 ? "suite" : null;
          return;
        case "property": {
          const target =
            propertiesOf === "case" ? kase?.properties : suites[suites.length - 1]?.properties;

          if (target !== undefined && attrs.name !== undefined) {
            target[attrs.name] = attrs.value ?? "";
          }
          return;
        }
        case "testcase":
          kase = {
            name: (attrs.name ?? "").trim(),
            classname: blankToNull(attrs.classname),
            seconds: seconds(attrs.time),
            outcome: "passed",
            before: [],
            after: [],
            payload: null,
            path: pathOf(attrs.file, attrs.line),
            output: "",
            properties: {},
            attributes: attrs,
          };
          return;
        case "failure":
        case "error":
        case "skipped":
          if (kase !== null) {
            kase.outcome =
              tag.name === "failure" ? "failed" : tag.name === "error" ? "error" : "skipped";
            if (tag.name !== "skipped") {
              payload = { message: blankToNull(attrs.message), body: "" };
              kase.payload = payload;
              capturing = "payload";
            }
          }
          return;
        case "system-out":
        case "system-err":
          if (kase !== null) {
            capturing = "output";
          }
          return;
        default: {
          const marker = ATTEMPT_MARKERS[tag.name];

          if (kase !== null && marker !== undefined) {
            (marker.when === "before" ? kase.before : kase.after).push(marker.outcome);
            // A retry's own message is the payload only when the case has none of its own.
            if (kase.payload === null) {
              payload = { message: blankToNull(attrs.message), body: "" };
              kase.payload = payload;
              capturing = "payload";
            }
          }
        }
      }
    });

    const onText = (text: string): void => {
      if (halted || kase === null) {
        return;
      }
      if (capturing === "payload" && payload !== null) {
        payload.body = capped(payload.body + text);
      } else if (capturing === "output") {
        kase.output = capped(kase.output + text);
      }
    };

    parser.on("text", onText);
    parser.on("cdata", onText);

    parser.on("closetag", (tag) => {
      if (halted) {
        return;
      }

      switch (tag.name) {
        case "testcase":
          if (kase !== null && kase.name !== "") {
            suites[suites.length - 1]?.cases.push(kase);
          }
          kase = null;
          payload = null;
          capturing = null;
          return;
        case "testsuite": {
          const suite = suites.pop();

          if (suite !== undefined) {
            read.push({ suite, cases: suite.cases.map((draft) => readCase(draft, suite)) });
          }
          return;
        }
        case "properties":
          propertiesOf = null;
          return;
        default:
          if (
            tag.name in ATTEMPT_MARKERS ||
            ["failure", "error", "system-out", "system-err"].includes(tag.name)
          ) {
            capturing = null;
          }
      }
    });

    parser.write(textOf(file));
    closing = true;
    parser.close();

    // Suites still open when the document ended keep every case that closed inside them.
    for (const suite of suites.reverse()) {
      read.push({ suite, cases: suite.cases.map((draft) => readCase(draft, suite)) });
    }

    if (read.length === 0 && warnings.length === 0) {
      return EMPTY_OUTPUT;
    }

    return { suites: toSuites(read, file.name, warnings), coverage: [], warnings };
  }
}

/**
 * One case draft as a normalized case and its platform.
 *
 * @param draft - The case.
 * @param suite - Its suite, for the platform fallback.
 * @returns The case.
 */
function readCase(draft: CaseDraft, suite: SuiteDraft): ReadCase {
  const { platform: casePlatform, ...caseProperties } = draft.properties;
  const platform = casePlatform ?? suite.properties.platform ?? suite.attributes.platform ?? null;
  const meta: Record<string, unknown> = {};
  const extra = Object.fromEntries(
    Object.entries(draft.attributes).filter(([key]) => !CASE_COLUMNS.has(key)),
  );

  if (Object.keys(caseProperties).length > 0) {
    meta.properties = caseProperties;
  }
  if (Object.keys(extra).length > 0) {
    meta.attributes = extra;
  }

  return {
    platform,
    kase: {
      name: draft.name,
      classname: draft.classname,
      outcomes: [...draft.before, draft.outcome, ...draft.after],
      durationMs: draft.seconds === null ? null : Math.round(draft.seconds * 1000),
      failure: failureOf(draft),
      meta,
    },
  };
}

/**
 * A case's failure payload.
 *
 * @param draft - The case.
 * @returns The payload, or null when no attempt failed.
 */
function failureOf(draft: CaseDraft): TestCaseFailure | null {
  if (draft.payload === null) {
    return null;
  }

  const body = draft.payload.body.trim();
  const output = draft.output.trim();
  const message = draft.payload.message ?? blankToNull(body.split("\n")[0]);
  const excerpt = body !== "" ? body : output;
  const failure: TestCaseFailure = {};

  if (message !== null) {
    failure.message = message;
  }
  if (excerpt !== "") {
    failure.log_excerpt = excerpt;
  }
  if (draft.path !== null) {
    failure.path = draft.path;
  }

  return failure;
}

/**
 * Group the read cases into suites by (name, platform), merging repeated cases into attempts.
 *
 * @param read - Every suite read, with its cases.
 * @param fileName - For the warnings.
 * @param warnings - Where a missing platform is reported.
 * @returns The normalized suites, in document order.
 */
function toSuites(
  read: readonly { suite: SuiteDraft; cases: ReadCase[] }[],
  fileName: string,
  warnings: ParseWarning[],
): NormalizedSuite[] {
  const byKey = new Map<string, { suite: SuiteDraft; platform: string; cases: NormalizedCase[] }>();

  for (const { suite, cases } of read) {
    const name = suite.name === "" ? "default" : suite.name;
    let missing = false;

    for (const { platform: raw, kase } of cases) {
      const platform = raw === null ? null : normalizePlatform(raw);

      if (platform === null) {
        missing = true;
      }
      const tag = platform ?? UNKNOWN_PLATFORM;
      const key = `${name}\u001f${tag}`;
      const group = byKey.get(key) ?? { suite, platform: tag, cases: [] };

      byKey.set(key, group);
      group.cases.push(kase);
    }

    if (cases.length === 0) {
      const raw = suite.properties.platform ?? suite.attributes.platform;
      const platform = raw === undefined ? null : normalizePlatform(raw);

      missing ||= platform === null;
      const tag = platform ?? UNKNOWN_PLATFORM;

      if (!byKey.has(`${name}\u001f${tag}`)) {
        byKey.set(`${name}\u001f${tag}`, { suite, platform: tag, cases: [] });
      }
    }

    if (missing) {
      warnings.push({
        code: "junit_platform_missing",
        file: fileName,
        message: `Suite "${name}" names no platform; its cases are recorded under "${UNKNOWN_PLATFORM}".`,
      });
    }
  }

  return [...byKey.entries()].map(([key, { suite, platform, cases }]) => {
    const name = key.split("\u001f")[0];
    const merged = mergeAttempts(cases);
    const summed = merged.reduce<number | null>(
      (sum, kase) => (kase.durationMs === null ? sum : (sum ?? 0) + kase.durationMs),
      null,
    );

    return {
      name,
      platform,
      kind: kindOf(platform),
      format: "junit",
      durationMs: suite.seconds === null ? summed : Math.round(suite.seconds * 1000),
      meta: suiteMeta(suite),
      cases: merged,
    };
  });
}

/**
 * Merge cases that share a classname and name into one case whose attempts are theirs in order.
 *
 * @param cases - A suite's cases, in document order.
 * @returns One case per identity, in first-seen order.
 */
export function mergeAttempts(cases: readonly NormalizedCase[]): NormalizedCase[] {
  const byIdentity = new Map<string, NormalizedCase>();

  for (const kase of cases) {
    const identity = `${kase.classname ?? ""}\u001f${kase.name}`;
    const seen = byIdentity.get(identity);

    byIdentity.set(
      identity,
      seen === undefined
        ? kase
        : {
            ...seen,
            outcomes: [...seen.outcomes, ...kase.outcomes],
            durationMs:
              seen.durationMs === null && kase.durationMs === null
                ? null
                : (seen.durationMs ?? 0) + (kase.durationMs ?? 0),
            failure: kase.failure ?? seen.failure,
            meta: { ...seen.meta, ...kase.meta },
          },
    );
  }

  return [...byIdentity.values()];
}

/**
 * A suite's `meta`: its non-platform properties and its informative attributes.
 *
 * @param suite - The suite.
 * @returns The object, empty when there is nothing.
 */
function suiteMeta(suite: SuiteDraft): Record<string, unknown> {
  const { platform: _platform, ...properties } = suite.properties;
  const attributes = Object.fromEntries(
    Object.entries(suite.attributes).filter(([key]) => !SUITE_BOOKKEEPING.has(key)),
  );
  const meta: Record<string, unknown> = {};

  if (Object.keys(properties).length > 0) {
    meta.properties = properties;
  }
  if (Object.keys(attributes).length > 0) {
    meta.attributes = attributes;
  }

  return meta;
}

/**
 * JUnit's `time` attribute.
 *
 * @param value - Seconds, as text.
 * @returns The seconds, or null when absent, not a number or negative.
 */
function seconds(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }

  const parsed = Number(value.replace(/,/g, ""));

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * pytest's `file` and `line` as one path.
 *
 * @param file - The file attribute.
 * @param line - The line attribute.
 * @returns `file:line`, `file`, or null.
 */
function pathOf(file: string | undefined, line: string | undefined): string | null {
  const path = blankToNull(file);

  if (path === null) {
    return null;
  }

  return blankToNull(line) === null ? path : `${path}:${line}`;
}

/**
 * Trim, and treat blank as absent.
 *
 * @param value - The text.
 * @returns It trimmed, or null.
 */
function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";

  return trimmed === "" ? null : trimmed;
}

/**
 * Cap captured text at {@link LOG_EXCERPT_CHARS}.
 *
 * @param text - The text so far.
 * @returns Its first {@link LOG_EXCERPT_CHARS} characters.
 */
function capped(text: string): string {
  return text.length > LOG_EXCERPT_CHARS ? text.slice(0, LOG_EXCERPT_CHARS) : text;
}
