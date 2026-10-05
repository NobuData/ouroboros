/**
 * The wizard's poll (BC.1, [#390](https://github.com/NobuData/ouroboros/issues/390)) — the I.8
 * poll family over `GET /api/onboarding?repo=`, which forwards BB.2's read (#385).
 *
 * The rail is derived on the service, so polling is what keeps it **live**: a source paused or
 * disconnected in another tab regresses step 1 here, with the service's explanation, without a
 * reload — and a workflow instantiated elsewhere ticks step 3 the same way.
 */

import type { Onboarding } from "@/app/api/onboarding";
import { type Poll, type PollOptions, createPoll, requestPayload } from "@/app/poll";

import { REPO_PARAM, UNREACHABLE_ONBOARDING, UNREADABLE_ONBOARDING } from "./view";

/** Where the browser asks — **this origin**, not `ouroboros-rest`. */
export const ONBOARDING_ENDPOINT = "/api/onboarding";

/** How to build the poll. Everything is optional; production supplies none of it. */
export interface OnboardingPollOptions extends PollOptions {
  /** How to make one read of an endpoint. Defaults to {@link requestOnboarding}. */
  read?: (endpoint: string, etag: string | null) => ReturnType<typeof requestOnboarding>;
}

/**
 * The endpoint for one repository's wizard.
 *
 * @param repo `owner/name`.
 * @returns `/api/onboarding?repo=owner%2Fname`.
 */
export function onboardingEndpoint(repo: string): string {
  return `${ONBOARDING_ENDPOINT}?${REPO_PARAM}=${encodeURIComponent(repo)}`;
}

/**
 * Whether a payload is shaped like the wizard — enough to draw the rail and the action bar.
 *
 * @param value What arrived.
 * @returns True for the wizard.
 */
export function isOnboarding(value: unknown): value is Onboarding {
  if (typeof value !== "object" || value === null) return false;

  const { repo, steps, currentStep, choices } = value as Partial<Record<keyof Onboarding, unknown>>;

  return (
    typeof repo === "string" &&
    Array.isArray(steps) &&
    steps.every(
      (step) =>
        typeof step === "object" &&
        step !== null &&
        typeof (step as { step?: unknown }).step === "number" &&
        typeof (step as { status?: unknown }).status === "string" &&
        typeof (step as { title?: unknown }).title === "string",
    ) &&
    (currentStep === null || typeof currentStep === "number") &&
    typeof choices === "object" &&
    choices !== null
  );
}

/**
 * One read of a repository's wizard on this origin.
 *
 * @param endpoint The endpoint, with its repository.
 * @param etag The last answer's entity tag, or null.
 * @returns The poll's answer.
 */
export function requestOnboarding(endpoint: string, etag: string | null) {
  return requestPayload(endpoint, etag, isOnboarding, {
    unreachable: UNREACHABLE_ONBOARDING,
    unreadable: UNREADABLE_ONBOARDING,
  });
}

/**
 * Build the poll for one repository's wizard.
 *
 * @param endpoint The endpoint.
 * @param options A stubbed reader, a fake clock — the test seams.
 * @returns The poll, not yet started.
 */
export function createOnboardingPoll(endpoint: string, options: OnboardingPollOptions = {}): Poll<Onboarding> {
  const read = options.read ?? requestOnboarding;

  return createPoll((etag) => read(endpoint, etag), options);
}
