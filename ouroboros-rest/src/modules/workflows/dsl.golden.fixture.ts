/**
 * The golden fixture set, read from the repository
 * ([#133](https://github.com/NobuData/ouroboros/issues/133)).
 *
 * [`schemas/workflow-dsl/`](../../../../schemas/workflow-dsl) holds the published JSON
 * Schema, one document per rule, and `fixtures/expected.json` — the verdict every validator
 * of this DSL has to produce for each of them. The files live above both modules because
 * neither owns them: this service's zod validator and `ouroboros-engine`'s pydantic
 * validator each read the same directory, from their own suite, and assert against the same
 * recording. That is the issue's *CI parity test*, and it holds without either module
 * importing the other or a third process comparing two outputs.
 *
 * Nothing here ships. The service validates with zod and its container carries no fixtures;
 * this file is `*.fixture.ts`, which `tsconfig.build.json` leaves out of the build.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { DslErrorCode, DslWarningCode } from "./dsl.errors";

/** Where the shared contract lives, resolved from this file rather than from the cwd. */
export const SCHEMAS_DIR = resolve(__dirname, "../../../../schemas/workflow-dsl");

/** The committed JSON Schema's path. */
export const SCHEMA_PATH = join(SCHEMAS_DIR, "v1.json");

/** Where the fixtures live. */
export const FIXTURES_DIR = join(SCHEMAS_DIR, "fixtures");

/** One recorded diagnostic: the parity contract, without the prose. */
export interface ExpectedDiagnostic {
  /** The code the validator must report. */
  code: DslErrorCode | DslWarningCode;
  /** The JSON Pointer it must be anchored at. */
  path: string;
  /** The node id it must carry, when the rule anchors to a node. */
  node?: string;
  /** The edge endpoints it must carry, when the rule anchors to an edge. */
  edge?: { from: string; to: string };
}

/** One recorded case: a document, what it is validated with, and the verdict it must get. */
export interface ExpectedCase {
  /** The case name — unique, and what a failing assertion names. */
  name: string;
  /** Why this document is in the set. One sentence, read by a person reviewing a change. */
  about: string;
  /** The document's path under `fixtures/`. */
  document: string;
  /** The catalogue's path under `fixtures/`, when the case supplies one. */
  catalogue?: string;
  /** Whether the document may be saved and published. */
  valid: boolean;
  /** Every error, in document order. */
  errors: ExpectedDiagnostic[];
  /** Every warning, in document order. */
  warnings: ExpectedDiagnostic[];
}

/** The catalogue shape the fixture files hold. */
export interface ExpectedCatalogue {
  /** Every skill the case's workspace has defined. */
  skills?: string[];
  /** Every model identifier the case's registry resolves. */
  models?: string[];
  /** Every task name the case's routing table has a route for. */
  tasks?: string[];
}

/**
 * Read and parse a file under `fixtures/`.
 *
 * @param relativePath - The path under `fixtures/`, as `expected.json` spells it.
 * @returns The parsed JSON.
 */
export function readFixture(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, relativePath), "utf8")) as unknown;
}

/** The committed JSON Schema, parsed. */
export function readSchema(): Record<string, unknown> {
  return JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as Record<string, unknown>;
}

/** Every recorded case, in the order `expected.json` lists them. */
export function readExpectedCases(): ExpectedCase[] {
  const recorded = readFixture("expected.json") as { cases: ExpectedCase[] };
  return recorded.cases;
}
