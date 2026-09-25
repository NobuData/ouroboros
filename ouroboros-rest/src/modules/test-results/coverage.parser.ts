/**
 * The coverage parser — lcov and cobertura reports reduced to the two numbers every figure on the
 * card is arithmetic over: lines covered and lines instrumented (decision **T9**, AT.1
 * [#329](https://github.com/NobuData/ouroboros/issues/329)).
 *
 * The percentage and the delta against the prior attempt are not a parser's business; the
 * orchestrator computes them the way V059's `test_run_coverage` does, so the report a parse returns
 * and the view the page reads can never disagree.
 *
 * - **lcov** — `LF:`/`LH:` per `SF:` record when present, otherwise the record's `DA:` lines.
 * - **cobertura** — the root `<coverage lines-valid lines-covered>` when present, otherwise every
 *   `<line hits>` counted, deduplicated per file and line number.
 *
 * A report that yields nothing instrumented has no percentage at all, rather than a percentage of
 * zero, and is a `coverage_unreadable` warning.
 */

import { SaxesParser } from "saxes";

import {
  EMPTY_OUTPUT,
  headOf,
  textOf,
  type CoverageCounts,
  type ParseOutput,
  type ParseWarning,
  type ResultFile,
  type TestResultParser,
} from "./parser.spi";

/** The coverage {@link TestResultParser}. */
export class CoverageParser implements TestResultParser {
  readonly id = "coverage";

  /**
   * An lcov tracefile (`*.info`, `lcov*`, or a head that opens a record) or a cobertura XML report.
   *
   * @param file - The file.
   * @returns True when it is a coverage report.
   */
  detect(file: ResultFile): boolean {
    return isLcov(file) || isCobertura(file);
  }

  /**
   * Count the report's lines.
   *
   * @param file - The file.
   * @returns One {@link CoverageCounts}, or a `coverage_unreadable` warning.
   */
  parse(file: ResultFile): ParseOutput {
    const warnings: ParseWarning[] = [];
    const counts = isCobertura(file) ? cobertura(file, warnings) : lcov(textOf(file));

    if (
      counts === null ||
      counts.total <= 0 ||
      counts.covered < 0 ||
      counts.covered > counts.total
    ) {
      return {
        ...EMPTY_OUTPUT,
        warnings: [
          ...warnings,
          {
            code: "coverage_unreadable",
            file: file.name,
            message:
              "The coverage report gave no line counts; it contributes nothing to the percentage.",
          },
        ],
      };
    }

    const coverage: CoverageCounts = {
      file: file.name,
      linesCovered: counts.covered,
      linesTotal: counts.total,
    };

    return { suites: [], coverage: [coverage], warnings };
  }
}

/** Lines covered and instrumented. */
interface Counts {
  covered: number;
  total: number;
}

/**
 * Whether the file is an lcov tracefile.
 *
 * @param file - The file.
 * @returns True by name, or by a head that opens a record.
 */
function isLcov(file: ResultFile): boolean {
  return /(^|\/)(lcov[^/]*|[^/]*\.info)$/i.test(file.name) || /^(TN|SF):/m.test(headOf(file));
}

/**
 * Whether the file is a cobertura report.
 *
 * @param file - The file.
 * @returns True when its head opens a `coverage` element.
 */
function isCobertura(file: ResultFile): boolean {
  return /<coverage[\s>]/.test(headOf(file));
}

/**
 * Count an lcov tracefile.
 *
 * @param text - The tracefile.
 * @returns The counts, or null when no record gave any.
 */
function lcov(text: string): Counts | null {
  let covered = 0;
  let total = 0;
  let seen = false;
  let record = freshRecord();

  const close = (): void => {
    if (record.lf !== null && record.lh !== null) {
      total += record.lf;
      covered += record.lh;
      seen = true;
    } else if (record.da.size > 0) {
      total += record.da.size;
      covered += [...record.da.values()].filter((hits) => hits > 0).length;
      seen = true;
    }
    record = freshRecord();
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const [tag, value = ""] = splitOnce(line, ":");

    switch (tag) {
      case "LF":
        record.lf = wholeNumber(value);
        break;
      case "LH":
        record.lh = wholeNumber(value);
        break;
      case "DA": {
        const [lineNo, hits] = value.split(",");
        const n = wholeNumber(lineNo);
        const h = wholeNumber(hits);

        if (n !== null && h !== null) {
          record.da.set(n, Math.max(record.da.get(n) ?? 0, h));
        }
        break;
      }
      case "end_of_record":
        close();
        break;
    }
  }
  // A tracefile cut short keeps the record it was in the middle of.
  close();

  return seen ? { covered, total } : null;
}

/**
 * An empty lcov record.
 *
 * @returns It.
 */
function freshRecord(): { lf: number | null; lh: number | null; da: Map<number, number> } {
  return { lf: null, lh: null, da: new Map() };
}

/**
 * Count a cobertura report.
 *
 * @param file - The report.
 * @param warnings - Where a truncated or malformed document is reported.
 * @returns The counts, or null when the report gave none.
 */
function cobertura(file: ResultFile, warnings: ParseWarning[]): Counts | null {
  const parser = new SaxesParser();
  let root: Counts | null = null;
  const lines = new Map<string, number>();
  let currentFile = "";
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
      message: `The coverage report is ${closing ? "cut short" : "not well-formed XML"} (${error.message}).`,
    });
  });

  parser.on("opentag", (tag) => {
    if (halted) {
      return;
    }
    const attrs = tag.attributes as Record<string, string>;

    if (tag.name === "coverage") {
      const total = wholeNumber(attrs["lines-valid"]);
      const covered = wholeNumber(attrs["lines-covered"]);

      root = total === null || covered === null ? null : { covered, total };
    } else if (tag.name === "class") {
      currentFile = attrs.filename ?? attrs.name ?? "";
    } else if (tag.name === "line") {
      const n = wholeNumber(attrs.number);
      const hits = wholeNumber(attrs.hits);

      if (n !== null && hits !== null) {
        const key = `${currentFile}\u001f${n}`;

        lines.set(key, Math.max(lines.get(key) ?? 0, hits));
      }
    }
  });

  parser.write(textOf(file));
  closing = true;
  parser.close();

  if (root !== null) {
    return root;
  }
  if (lines.size === 0) {
    return null;
  }

  return { covered: [...lines.values()].filter((hits) => hits > 0).length, total: lines.size };
}

/**
 * Split at the first separator.
 *
 * @param text - The text.
 * @param separator - The separator.
 * @returns The part before, and the part after (absent when there is no separator).
 */
function splitOnce(text: string, separator: string): [string, string?] {
  const at = text.indexOf(separator);

  return at === -1 ? [text] : [text.slice(0, at), text.slice(at + separator.length)];
}

/**
 * A whole number ≥ 0.
 *
 * @param text - Its spelling.
 * @returns It, or null when the text is not one.
 */
function wholeNumber(text: string | undefined): number | null {
  if (text === undefined || !/^\s*\d+\s*$/.test(text)) {
    return null;
  }

  return Number(text);
}
