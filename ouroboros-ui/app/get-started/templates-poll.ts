/**
 * The template tiles' poll (BC.3, [#392](https://github.com/NobuData/ouroboros/issues/392)) —
 * the I.8 poll family over `GET /api/onboarding/templates?repo=`, which forwards BB.3's read (#386).
 *
 * The poll is what opens a locked tile by itself: every read re-evaluates each tier's gate
 * against the workspace's merged loops, so the moment the count crosses the threshold the tile's
 * `unlock.locked` turns false on the next answer — no reload, nothing decided here.
 */

import type { OnboardingTemplateTiles } from "@/app/api/onboarding";
import { type Poll, type PollOptions, createPoll, requestPayload } from "@/app/poll";

import { UNREACHABLE_TEMPLATES, UNREADABLE_TEMPLATES } from "./templates-view";
import { REPO_PARAM } from "./view";

/** Where the browser asks — **this origin**, not `ouroboros-rest`. */
export const TEMPLATES_ENDPOINT = "/api/onboarding/templates";

/** How to build the poll. Everything is optional; production supplies none of it. */
export interface TemplatesPollOptions extends PollOptions {
  /** How to make one read of an endpoint. Defaults to {@link requestTemplates}. */
  read?: (endpoint: string, etag: string | null) => ReturnType<typeof requestTemplates>;
}

/**
 * The endpoint for one repository's tiles.
 *
 * @param repo `owner/name`.
 * @returns `/api/onboarding/templates?repo=owner%2Fname`.
 */
export function templatesEndpoint(repo: string): string {
  return `${TEMPLATES_ENDPOINT}?${REPO_PARAM}=${encodeURIComponent(repo)}`;
}

/**
 * Whether a payload is shaped like the grid — enough to draw every tile and its gate.
 *
 * @param value What arrived.
 * @returns True for the tiles.
 */
export function isTemplateTiles(value: unknown): value is OnboardingTemplateTiles {
  if (typeof value !== "object" || value === null) return false;

  const { repo, tiles, mergedLoops, studioPath } = value as Partial<
    Record<keyof OnboardingTemplateTiles, unknown>
  >;

  return (
    typeof repo === "string" &&
    typeof mergedLoops === "number" &&
    typeof studioPath === "string" &&
    Array.isArray(tiles) &&
    tiles.every(
      (tile) =>
        typeof tile === "object" &&
        tile !== null &&
        typeof (tile as { slug?: unknown }).slug === "string" &&
        typeof (tile as { name?: unknown }).name === "string" &&
        typeof (tile as { selected?: unknown }).selected === "boolean" &&
        Array.isArray((tile as { stageDots?: unknown }).stageDots) &&
        Array.isArray((tile as { effortRange?: unknown }).effortRange),
    )
  );
}

/**
 * One read of a repository's tiles on this origin.
 *
 * @param endpoint The endpoint, with its repository.
 * @param etag The last answer's entity tag, or null.
 * @returns The poll's answer.
 */
export function requestTemplates(endpoint: string, etag: string | null) {
  return requestPayload(endpoint, etag, isTemplateTiles, {
    unreachable: UNREACHABLE_TEMPLATES,
    unreadable: UNREADABLE_TEMPLATES,
  });
}

/**
 * Build the poll for one repository's tiles.
 *
 * @param endpoint The endpoint.
 * @param options A stubbed reader, a fake clock — the test seams.
 * @returns The poll, not yet started.
 */
export function createTemplatesPoll(
  endpoint: string,
  options: TemplatesPollOptions = {},
): Poll<OnboardingTemplateTiles> {
  const read = options.read ?? requestTemplates;

  return createPoll((etag) => read(endpoint, etag), options);
}
