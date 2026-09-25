/**
 * The parser fixture matrix (AT.1, [#329](https://github.com/NobuData/ouroboros/issues/329)) — the
 * committed report files under `fixtures/`, read as the upload manifest would hand them over.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ResultFile } from "./parser.spi";

/** Where the committed reports live. */
export const FIXTURE_DIR = join(__dirname, "fixtures");

/** The golden file every parse of the matrix is held to. */
export const GOLDEN_PATH = join(FIXTURE_DIR, "golden.json");

/** The command that rewrites {@link GOLDEN_PATH}. */
export const REGENERATE =
  "OURO_UPDATE_GOLDENS=1 yarn jest src/modules/test-results/parsers.spec.ts";

/** Every fixture, by the class of input it stands for. */
export const MATRIX = {
  /** twister XML with every retry marker, three platforms and a rig. */
  twister: "twister-reruns.xml",
  /** pytest `--junitxml`, with no platform. */
  pytest: "pytest.xml",
  /** The twister report cut mid-case. */
  truncatedXml: "truncated.xml",
  /** A report with a mismatched close tag after its first case. */
  malformedXml: "malformed.xml",
  /** A valid `ouro-hil-results.json`. */
  hilValid: "hil-valid.json",
  /** One with every schema violation the taxonomy names. */
  hilInvalid: "hil-invalid.json",
  /** A version this build does not read. */
  hilUnknownVersion: "hil-unknown-version.json",
  /** Not JSON at all — the upload cut short. */
  hilTruncated: "ouro-hil-results-truncated.json",
  /** lcov with an LF/LH record and a DA-only record. */
  lcov: "lcov.info",
  /** cobertura with a root summary. */
  cobertura: "cobertura.xml",
  /** cobertura with no summary, cut short. */
  coberturaNoSummary: "cobertura-no-summary.xml",
  /** lcov that instruments nothing. */
  lcovEmpty: "lcov-empty.info",
  /** Something no parser reads. */
  unrecognized: "notes.txt",
} as const;

/**
 * One committed fixture as a manifest file.
 *
 * @param name - Its file name under `fixtures/`.
 * @returns It.
 */
export function fixtureFile(name: string): ResultFile {
  return { name, bytes: readFileSync(join(FIXTURE_DIR, name)) };
}

/**
 * A manifest file from text.
 *
 * @param name - Its name.
 * @param text - Its content.
 * @returns It.
 */
export function textFile(name: string, text: string): ResultFile {
  return { name, bytes: Buffer.from(text, "utf8") };
}
