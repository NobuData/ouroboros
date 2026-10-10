/**
 * The gap-analysis deliverable input, read into the matrix it describes (CM.2,
 * [#621](https://github.com/NobuData/ouroboros/issues/621)).
 *
 * The investigation loop stores what the `gap_analysis@1` playbook produced in
 * `investigation_deliverable_inputs` (#620), already through the engine's citation gate:
 *
 *   {"title", "us", "rivals": [name…],
 *    "rows": [{"capability", "gap", "cells": [{"subject", "status", "sources": [id…]}]}]}
 *
 * This is the second gate. It refuses what the matrix may not contain, with a named code:
 *
 *   matrix_input_invalid    a missing title, an unknown status, a repeated capability, …
 *   matrix_row_incomplete   a row without exactly one cell per column — us and every rival
 *   matrix_cell_uncited     a cell that states anything but `unknown` and cites nothing (V7)
 *
 * The playbook's six statuses become V112's five and a note: `beta` is a `partial` labelled
 * *beta*, `in_flight` is a `wip` labelled *in flight*. A row's `gap` is kept as the **proposed**
 * severity — an input to `matrix.severity.ts`, never the stored answer.
 */

import type { MatrixCellStatus, MatrixGapSeverity } from "../../db/schema";
import { matrixCellUncited, matrixInputInvalid, matrixRowIncomplete } from "./briefs.errors";

/** The most rows a matrix may have. */
export const MAX_MATRIX_ROWS = 100;

/** The most rival columns a matrix may have — V112's `capability_matrices_rivals_bounded`. */
export const MAX_MATRIX_RIVALS = 12;

/** The most sources one cell may cite. */
export const MAX_CELL_SOURCES = 64;

const MAX_TITLE = 200;
const MAX_LABEL = 120;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** The statuses a playbook writes, and what each is stored as. */
const STATUSES: Readonly<Record<string, { status: MatrixCellStatus; note: string | null }>> = {
  shipping: { status: "shipping", note: null },
  partial: { status: "partial", note: null },
  beta: { status: "partial", note: "beta" },
  in_flight: { status: "wip", note: "in flight" },
  wip: { status: "wip", note: "in flight" },
  none: { status: "none", note: null },
  unknown: { status: "unknown", note: null },
};

const SEVERITIES: readonly MatrixGapSeverity[] = ["high", "med", "low", "wip", "lead"];

/** One cell of the input. */
export interface MatrixInputCell {
  /** The column: null for us, otherwise the rival's index in {@link MatrixInput.rivals}. */
  readonly rival: number | null;
  readonly status: MatrixCellStatus;
  /** The label beside the glyph when it is not the status. */
  readonly note: string | null;
  /** `source_records` ids, lower-cased and distinct. */
  readonly sources: readonly string[];
}

/** One capability row of the input. */
export interface MatrixInputRow {
  readonly capability: string;
  /** The severity the investigation proposed; null when it named none. */
  readonly proposed: MatrixGapSeverity | null;
  /** One cell per column — us first, then the rivals in column order. */
  readonly cells: readonly MatrixInputCell[];
}

/** A matrix, as a gap analysis described it. */
export interface MatrixInput {
  readonly title: string;
  /** The first column's name — `Helios`. */
  readonly us: string;
  /** The rival columns, left to right. */
  readonly rivals: readonly string[];
  readonly rows: readonly MatrixInputRow[];
}

/**
 * Read a matrix input.
 *
 * @param payload - The stored `matrix` deliverable input.
 * @returns The matrix it describes.
 * @throws {InvalidRequestError} `matrix_input_invalid`, `matrix_row_incomplete` or
 *   `matrix_cell_uncited`.
 */
export function parseMatrixInput(payload: Record<string, unknown>): MatrixInput {
  const title = label(payload["title"], "title", MAX_TITLE);
  const us = label(payload["us"], "us", MAX_LABEL);

  const named = payload["rivals"];
  if (!Array.isArray(named) || named.length < 1 || named.length > MAX_MATRIX_RIVALS) {
    throw matrixInputInvalid(`rivals is a list of 1 to ${MAX_MATRIX_RIVALS.toString()} names`);
  }
  const rivals = named.map((name) => label(name, "a rival", MAX_LABEL));
  const columns = [us, ...rivals].map(key);
  if (new Set(columns).size !== columns.length) {
    throw matrixInputInvalid("every column — us and each rival — has a distinct name");
  }

  const listed = payload["rows"];
  if (!Array.isArray(listed) || listed.length < 1 || listed.length > MAX_MATRIX_ROWS) {
    throw matrixInputInvalid(`rows is a list of 1 to ${MAX_MATRIX_ROWS.toString()} capabilities`);
  }
  const rows = listed.map((row) => parseRow(row, us, rivals));
  if (new Set(rows.map((row) => row.capability)).size !== rows.length) {
    throw matrixInputInvalid("a capability is listed once");
  }

  return { title, us, rivals, rows };
}

/**
 * Read one row and hold it to V7: complete, and cited wherever it states something.
 *
 * @param candidate - The row as stored.
 * @param us - Our column's name.
 * @param rivals - The rival columns.
 * @returns The row, its cells in column order.
 */
function parseRow(candidate: unknown, us: string, rivals: readonly string[]): MatrixInputRow {
  if (!isRecord(candidate)) throw matrixInputInvalid("a row is an object");
  const capability = label(candidate["capability"], "a capability", MAX_TITLE);

  const gap = candidate["gap"];
  const proposed = SEVERITIES.find((severity) => severity === gap) ?? null;
  if (gap !== undefined && gap !== null && proposed === null) {
    throw matrixInputInvalid(`the gap of "${capability}" is one of ${SEVERITIES.join(", ")}`);
  }

  const listed = candidate["cells"];
  if (!Array.isArray(listed)) throw matrixInputInvalid(`"${capability}" lists its cells`);

  const columns = [us, ...rivals];
  const found = new Map<number, MatrixInputCell[]>();
  for (const cell of listed) {
    if (!isRecord(cell)) throw matrixInputInvalid(`a cell of "${capability}" is an object`);

    const subject = label(cell["subject"], `a subject of "${capability}"`, MAX_LABEL);
    const column = columns.findIndex((name) => key(name) === key(subject));
    if (column < 0) {
      throw matrixInputInvalid(`"${subject}" in "${capability}" is not a column of the matrix`);
    }

    const stored = typeof cell["status"] === "string" ? STATUSES[cell["status"]] : undefined;
    if (stored === undefined) {
      throw matrixInputInvalid(
        `the status of ${subject} in "${capability}" is one of ${Object.keys(STATUSES).join(", ")}`,
      );
    }

    const sources = sourcesOf(cell["sources"], capability, subject);
    if (stored.status !== "unknown" && sources.length === 0) {
      throw matrixCellUncited(capability, columns[column], stored.status);
    }

    found.set(column, [
      ...(found.get(column) ?? []),
      { rival: column === 0 ? null : column - 1, ...stored, sources },
    ]);
  }

  const missing = columns.filter((_, column) => !found.has(column));
  const repeated = columns.filter((_, column) => (found.get(column)?.length ?? 0) > 1);
  if (missing.length > 0 || repeated.length > 0) {
    throw matrixRowIncomplete(capability, missing, repeated);
  }

  return {
    capability,
    proposed,
    cells: columns.map((_, column) => (found.get(column) as MatrixInputCell[])[0]),
  };
}

/**
 * @param candidate - A cell's `sources`.
 * @param capability - Its row, for the refusal.
 * @param subject - Its column, for the refusal.
 * @returns The distinct ids, lower-cased; empty when the cell lists none.
 */
function sourcesOf(candidate: unknown, capability: string, subject: string): string[] {
  if (candidate === undefined || candidate === null) return [];
  if (
    !Array.isArray(candidate) ||
    candidate.length > MAX_CELL_SOURCES ||
    candidate.some((id) => typeof id !== "string" || !UUID.test(id))
  ) {
    throw matrixInputInvalid(
      `the sources of ${subject} in "${capability}" are at most ${MAX_CELL_SOURCES.toString()} source record ids`,
    );
  }

  return [...new Set((candidate as string[]).map((id) => id.toLowerCase()))];
}

/**
 * @param candidate - A name or title.
 * @param what - What it is, for the refusal.
 * @param max - The most characters it may have.
 * @returns It, trimmed.
 */
function label(candidate: unknown, what: string, max: number): string {
  if (typeof candidate !== "string" || candidate.trim() === "" || candidate.trim().length > max) {
    throw matrixInputInvalid(
      `${what} is a non-blank string of at most ${max.toString()} characters`,
    );
  }
  return candidate.trim();
}

/**
 * @param name - A column name.
 * @returns What two spellings of the same column share.
 */
export function key(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * @param value - Anything.
 * @returns Whether it is a plain JSON object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
