/**
 * The onboarding wizard API's refusals ([#385](https://github.com/NobuData/ouroboros/issues/385)),
 * each a code `openapi.yaml` publishes.
 *
 * The guard failure is the one that matters most: `POST /complete-step` answering
 * `onboarding_step_incomplete` carries the step that blocks and the derived reason, which is the
 * sentence the action bar renders beside a disabled button — so the wizard's optimistic state and
 * the derived one can never silently disagree.
 */

import { ConflictError, InvalidRequestError, NotFoundError } from "../errors/error.envelope";
import type { DerivedStep, OnboardingStepNumber } from "./onboarding.derivation";

/** The codes, as one object. */
export const ONBOARDING_ERRORS = {
  /** The picked ticket is not one of this workspace's canonical tickets. */
  ticketNotFound: "onboarding_ticket_not_found",
  /** The picked template is not one the workspace is offered. */
  templateUnknown: "onboarding_template_unknown",
  /** A step cannot be completed because it — or one before it — is not done in reality. */
  stepIncomplete: "onboarding_step_incomplete",
} as const;

/**
 * A ticket the workspace does not have — another workspace's included, which is why this is a
 * `404` and never a `403`.
 *
 * @param ticketId - The id the caller sent.
 * @returns The error.
 */
export function ticketNotFound(ticketId: string): NotFoundError {
  return new NotFoundError(ONBOARDING_ERRORS.ticketNotFound, "No such ticket in this workspace.", {
    ticketId,
  });
}

/**
 * A template slug the workspace is not offered (`workflow_templates_for`).
 *
 * @param slug - The slug the caller sent.
 * @param offered - The slugs that are offered, so the caller can correct itself.
 * @returns The error.
 */
export function templateUnknown(slug: string, offered: readonly string[]): InvalidRequestError {
  return new InvalidRequestError(
    ONBOARDING_ERRORS.templateUnknown,
    `"${slug}" is not a workflow template this workspace is offered.`,
    { selectedTemplate: slug, offered: [...offered] },
  );
}

/**
 * The completion guard refused: a step at or before the one being completed is not done.
 *
 * @param step - The step the caller tried to complete.
 * @param blocking - The first step that is not done, as derived now.
 * @returns The error, whose message is the blocking step's stated reason.
 */
export function stepIncomplete(step: OnboardingStepNumber, blocking: DerivedStep): ConflictError {
  const reason = blocking.reason ?? `Step ${blocking.step} is not done.`;

  return new ConflictError(ONBOARDING_ERRORS.stepIncomplete, reason, {
    step,
    blockingStep: blocking.step,
    reason,
  });
}
