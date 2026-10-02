/**
 * Typed slot reads from a finding's `data` (BV.4,
 * [#513](https://github.com/NobuData/ouroboros/issues/513)).
 *
 * A template's title, evidence line, impact and binding are filled only from these — a value of
 * the wrong type reads as absent rather than being coerced, so a malformed finding produces a
 * spike or no suggestion, never a sentence with `NaN` or `undefined` in it.
 */

import type { ComposerFinding } from "./composer.types";

/**
 * A finite number from a finding's data.
 *
 * @param finding - The finding.
 * @param key - The data key.
 * @returns The number, or `undefined` when absent or not a finite number.
 */
export function num(finding: ComposerFinding, key: string): number | undefined {
  const value = finding.data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * A non-blank string from a finding's data.
 *
 * @param finding - The finding.
 * @param key - The data key.
 * @returns The string, or `undefined` when absent, not a string, or blank.
 */
export function text(finding: ComposerFinding, key: string): string | undefined {
  const value = finding.data[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * A list of non-blank strings from a finding's data.
 *
 * @param finding - The finding.
 * @param key - The data key.
 * @returns The strings, or `undefined` when absent or not all non-blank strings.
 */
export function texts(finding: ComposerFinding, key: string): string[] | undefined {
  const value = finding.data[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter((item): item is string => typeof item === "string" && item !== "");
  return strings.length === value.length ? strings : undefined;
}

/**
 * The part of a `scope` after a known prefix — `"stage HIL"` → `"HIL"`.
 *
 * @param finding - The finding.
 * @param prefix - The prefix, with its trailing space.
 * @returns The rest, or `undefined` when the scope does not start with the prefix.
 */
export function scoped(finding: ComposerFinding, prefix: string): string | undefined {
  const scope = text(finding, "scope");
  return scope?.startsWith(prefix) === true ? scope.slice(prefix.length).trim() : undefined;
}
