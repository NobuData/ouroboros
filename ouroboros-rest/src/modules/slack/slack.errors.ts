/**
 * What the Slack app refuses, as codes (BZ.1,
 * [#535](https://github.com/NobuData/ouroboros/issues/535)).
 *
 * One map and one factory per refusal, as every module's errors are. The inbound endpoints'
 * refusal is deliberately uninformative — a forged request learns only that it was refused; the
 * reason goes to the security log (`slack.signature.guard.ts`).
 */

import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnauthenticatedError,
  UpstreamError,
} from "../errors/error.envelope";

/** The codes this module answers with. */
export const SLACK_ERRORS = {
  signatureInvalid: "slack_signature_invalid",
  notConfigured: "slack_not_configured",
  stateInvalid: "slack_oauth_state_invalid",
  installDenied: "slack_install_denied",
  installFailed: "slack_install_failed",
  alreadyConnected: "slack_already_connected",
  notConnected: "slack_not_connected",
} as const;

/**
 * A request to an inbound endpoint that Slack did not sign, or signed too long ago.
 *
 * @returns `401 slack_signature_invalid`, saying nothing about which check failed.
 */
export function slackSignatureInvalid(): UnauthenticatedError {
  return new UnauthenticatedError(
    SLACK_ERRORS.signatureInvalid,
    "This request was not signed by Slack.",
    {},
  );
}

/**
 * The deployment has registered no Slack app.
 *
 * @returns `404 slack_not_configured` — there is nothing to install.
 */
export function slackNotConfigured(): NotFoundError {
  return new NotFoundError(
    SLACK_ERRORS.notConfigured,
    "Slack is not set up on this deployment. An operator registers the Slack app first — see docs/CHATOPS_SETUP.md.",
    {},
  );
}

/**
 * An OAuth callback whose `state` is not the one this browser's install began with.
 *
 * @returns `400 slack_oauth_state_invalid`.
 */
export function slackStateInvalid(): BadRequestError {
  return new BadRequestError(
    SLACK_ERRORS.stateInvalid,
    "This Slack install did not start in this browser session, or it has expired. Start the install again from Settings.",
    {},
  );
}

/**
 * The person declined the install on Slack's consent screen, or Slack refused it.
 *
 * @param reason - Slack's `error` parameter, e.g. `access_denied`.
 * @returns `400 slack_install_denied`.
 */
export function slackInstallDenied(reason: string): BadRequestError {
  return new BadRequestError(
    SLACK_ERRORS.installDenied,
    "Slack did not grant the install. Nothing was connected.",
    { reason },
  );
}

/**
 * Slack did not complete the code exchange, or answered something this service cannot use.
 *
 * @param reason - Slack's error code, or a short description of what was missing.
 * @returns `502 slack_install_failed`.
 */
export function slackInstallFailed(reason: string): UpstreamError {
  return new UpstreamError(
    SLACK_ERRORS.installFailed,
    "Slack did not complete the install. Nothing was connected — try again.",
    { reason },
  );
}

/**
 * The workspace already has an active Slack connection to a different Slack workspace.
 *
 * @param workspaceName - The Slack workspace already connected.
 * @returns `409 slack_already_connected` — one active Slack workspace per organisation in MVP.
 */
export function slackAlreadyConnected(workspaceName: string): ConflictError {
  return new ConflictError(
    SLACK_ERRORS.alreadyConnected,
    `This workspace is already connected to the Slack workspace ${workspaceName}. Remove the app there before connecting another.`,
    { workspaceName },
  );
}
