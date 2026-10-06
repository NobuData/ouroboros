/**
 * The right column's poll (BC.5, [#394](https://github.com/NobuData/ouroboros/issues/394)) —
 * the I.8 poll family over `GET /api/onboarding/defaults?repo=`, which forwards BB.5's one read
 * (#388): the defaults rows, the reassure claims and the projected timeline.
 *
 * The poll is what keeps the column **true**: the dry-run policy flipped in Settings reaches the
 * timeline's merge row and the draft-only claim on the next answer, the nightly estimator's run
 * lands on its row without a reload, and a pick stored in the first-issue card names itself in
 * the timeline's first row.
 */

import type { OnboardingDefaults } from "@/app/api/onboarding";
import { type Poll, type PollOptions, createPoll, requestPayload } from "@/app/poll";

import { UNREACHABLE_DEFAULTS, UNREADABLE_DEFAULTS } from "./defaults-view";
import { REPO_PARAM } from "./view";

/** Where the browser asks — **this origin**, not `ouroboros-rest`. */
export const DEFAULTS_ENDPOINT = "/api/onboarding/defaults";

/** How to build the poll. Everything is optional; production supplies none of it. */
export interface DefaultsPollOptions extends PollOptions {
  /** How to make one read of an endpoint. Defaults to {@link requestDefaults}. */
  read?: (endpoint: string, etag: string | null) => ReturnType<typeof requestDefaults>;
}

/**
 * The endpoint for one repository's column.
 *
 * @param repo `owner/name`.
 * @returns `/api/onboarding/defaults?repo=owner%2Fname`.
 */
export function defaultsEndpoint(repo: string): string {
  return `${DEFAULTS_ENDPOINT}?${REPO_PARAM}=${encodeURIComponent(repo)}`;
}

/**
 * Whether a value is a list whose every member is an object with these string fields.
 *
 * @param value What arrived.
 * @param fields The fields each member must carry as strings.
 * @returns True for such a list.
 */
function isListOf(value: unknown, fields: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (member: unknown) =>
        typeof member === "object" &&
        member !== null &&
        fields.every((field) => typeof (member as Record<string, unknown>)[field] === "string"),
    )
  );
}

/**
 * Whether a payload is shaped like the column — enough to draw the rows, the claims and the
 * timeline.
 *
 * @param value What arrived.
 * @returns True for the column.
 */
export function isOnboardingDefaults(value: unknown): value is OnboardingDefaults {
  if (typeof value !== "object" || value === null) return false;

  const { deployment, rows, reassure, timeline } = value as Partial<Record<keyof OnboardingDefaults, unknown>>;

  if (typeof deployment !== "string") return false;
  if (!isListOf(rows, ["key", "variant", "status", "text"])) return false;
  if (!(rows as Record<string, unknown>[]).every((row) => row.link === null || typeof row.link === "object")) return false;
  if (typeof reassure !== "object" || reassure === null) return false;
  if (!isListOf((reassure as Record<string, unknown>).claims, ["key", "text"])) return false;
  if (!((reassure as Record<string, unknown>).claims as Record<string, unknown>[]).every((claim) => typeof claim.mechanism === "object" && claim.mechanism !== null)) return false;
  if (typeof timeline !== "object" || timeline === null) return false;

  const { kind, basis, rows: timelineRows } = timeline as Record<string, unknown>;

  return typeof kind === "string" && typeof basis === "string" && isListOf(timelineRows, ["key", "actor", "text", "kind"]);
}

/**
 * One read of a repository's column on this origin.
 *
 * @param endpoint The endpoint, with its repository.
 * @param etag The last answer's entity tag, or null.
 * @returns The poll's answer.
 */
export function requestDefaults(endpoint: string, etag: string | null) {
  return requestPayload(endpoint, etag, isOnboardingDefaults, {
    unreachable: UNREACHABLE_DEFAULTS,
    unreadable: UNREADABLE_DEFAULTS,
  });
}

/**
 * Build the poll for one repository's column.
 *
 * @param endpoint The endpoint.
 * @param options A stubbed reader, a fake clock — the test seams.
 * @returns The poll, not yet started.
 */
export function createDefaultsPoll(endpoint: string, options: DefaultsPollOptions = {}): Poll<OnboardingDefaults> {
  const read = options.read ?? requestDefaults;

  return createPoll((etag) => read(endpoint, etag), options);
}
