/**
 * A cited hunk, and the address that names one
 * ([#366](https://github.com/NobuData/ouroboros/issues/366)).
 *
 * ```
 * /prs/5eed…?hunk=drivers/can/telemetry_buf.c:41-66#files
 * ```
 *
 * A hunk reference of the criteria matrix brings the reader to the page's changed files, and the
 * address follows so the citation is linkable. The Changed files & diff card
 * ([#367](https://github.com/NobuData/ouroboros/issues/367)) reads the same parameter to scroll
 * its diff to the range.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import { PR_HUNK_PARAM } from "@/app/paths";

/** The longest path a hunk names — the service's `MAX_HUNK_PATH`. */
export const MAX_HUNK_PATH = 1024;

/** The highest line a hunk names — the service's bound, a 32-bit integer. */
export const MAX_HUNK_LINE = 2_147_483_647;

/** A range of lines of one changed file. */
export interface Hunk {
  /** The file's path in the revision's snapshot — `drivers/can/telemetry_buf.c`. */
  readonly path: string;
  /** The first line, from 1. */
  readonly lineStart: number;
  /** The last line, never before the first. */
  readonly lineEnd: number;
}

/**
 * Whether a value is a line a hunk can name.
 *
 * @param value What arrived.
 * @returns `true` for an integer from 1 to {@link MAX_HUNK_LINE}.
 */
export function isHunkLine(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_HUNK_LINE
  );
}

/**
 * Whether a value is a hunk the service could accept.
 *
 * @param value What arrived.
 * @returns `true` for a path that is neither empty, padded nor over-long, and a range whose last
 *   line is not before its first.
 */
export function isHunk(value: unknown): value is Hunk {
  if (typeof value !== "object" || value === null) return false;

  const { path, lineStart, lineEnd } = value as Partial<Hunk>;

  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= MAX_HUNK_PATH &&
    path.trim() === path &&
    isHunkLine(lineStart) &&
    isHunkLine(lineEnd) &&
    lineStart <= lineEnd
  );
}

/**
 * A hunk's range, in words.
 *
 * @param hunk The hunk.
 * @returns `line 41` or `lines 41–66`.
 */
export function hunkRange(hunk: Hunk): string {
  return hunk.lineStart === hunk.lineEnd
    ? `line ${hunk.lineStart}`
    : `lines ${hunk.lineStart}–${hunk.lineEnd}`;
}

/**
 * A hunk as the address states it.
 *
 * @param hunk The hunk.
 * @returns `drivers/can/telemetry_buf.c:41-66`, or `…:41` for a single line.
 */
export function hunkValue(hunk: Hunk): string {
  return hunk.lineStart === hunk.lineEnd
    ? `${hunk.path}:${hunk.lineStart}`
    : `${hunk.path}:${hunk.lineStart}-${hunk.lineEnd}`;
}

/**
 * The hunk an address names.
 *
 * @param value `?hunk=`, as the router or `URLSearchParams` states it.
 * @returns The hunk, or `null` when the parameter is absent, repeated or not a path followed by
 *   `:line` or `:first-last` — the page then cites none. The path is whatever precedes the last
 *   colon, so a path that holds one itself is still read.
 */
export function hunkParam(value: string | readonly string[] | null | undefined): Hunk | null {
  if (typeof value !== "string") return null;

  const match = /^(.+):([1-9]\d{0,9})(?:-([1-9]\d{0,9}))?$/.exec(value);
  if (match === null) return null;

  const lineStart = Number(match[2]);
  const hunk = {
    path: match[1] as string,
    lineStart,
    lineEnd: match[3] === undefined ? lineStart : Number(match[3]),
  };

  return isHunk(hunk) ? hunk : null;
}

/**
 * The address with `?hunk=` set or removed, everything else kept.
 *
 * @param search The current query, `?…` or empty.
 * @param hunk The cited hunk, or `null` for none.
 * @returns The new query, with its `?` — or empty when nothing is left to say.
 */
export function withHunk(search: string, hunk: Hunk | null): string {
  const query = new URLSearchParams(search);

  if (hunk === null) query.delete(PR_HUNK_PARAM);
  else query.set(PR_HUNK_PARAM, hunkValue(hunk));

  const next = query.toString();

  return next === "" ? "" : `?${next}`;
}

/**
 * Whether two hunks are the same citation.
 *
 * @param a One hunk, or `null`.
 * @param b Another, or `null`.
 * @returns `true` when both are absent, or both name the same path and range.
 */
export function sameHunk(a: Hunk | null, b: Hunk | null): boolean {
  if (a === null || b === null) return a === b;

  return a.path === b.path && a.lineStart === b.lineStart && a.lineEnd === b.lineEnd;
}
