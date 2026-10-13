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
  channelNotFound: "slack_channel_not_found",
  channelArchived: "slack_channel_archived",
  channelNotJoined: "slack_channel_not_joined",
  channelListFailed: "slack_channel_list_failed",
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

/**
 * The workspace has no active Slack connection, so there are no channels to list or bind.
 *
 * @returns `409 slack_not_connected`.
 */
export function slackNotConnected(): ConflictError {
  return new ConflictError(
    SLACK_ERRORS.notConnected,
    "This workspace is not connected to Slack. Connect Slack from Settings, then try again.",
    {},
  );
}

/**
 * A channel id that names no channel of this workspace's Slack connection — or names a DM
 * conversation, which is stored beside the channels and is not one.
 *
 * @param id - The id asked for.
 * @returns `404 slack_channel_not_found`.
 */
export function slackChannelNotFound(id: string): NotFoundError {
  return new NotFoundError(
    SLACK_ERRORS.channelNotFound,
    "No such Slack channel in this workspace. Refresh the channel list and pick one from it.",
    { id },
  );
}

/**
 * A channel that was archived in Slack: nobody can post there, the app included.
 *
 * @param name - The channel's name, without `#`.
 * @returns `409 slack_channel_archived`.
 */
export function slackChannelArchived(name: string): ConflictError {
  return new ConflictError(
    SLACK_ERRORS.channelArchived,
    `#${name} is archived in Slack, so nothing can be posted there. Unarchive it in Slack, or pick another channel.`,
    { channelName: name },
  );
}

/**
 * A channel the bot is not a member of. The app holds no scope to join one by itself (a product
 * decision, #541), so the person adds it in Slack — the same for a public and a private channel.
 *
 * @param name - The channel's name, without `#`.
 * @returns `409 slack_channel_not_joined`, saying exactly what to type.
 */
export function slackChannelNotJoined(name: string): ConflictError {
  return new ConflictError(
    SLACK_ERRORS.channelNotJoined,
    `Ouroboros is not a member of #${name}, and it cannot join a channel by itself. In Slack, type /invite @Ouroboros in #${name}, then refresh the channel list and try again. Private channels work the same way.`,
    { channelName: name },
  );
}

/**
 * Slack did not list the workspace's channels. Nothing stored was changed.
 *
 * @param reason - Slack's error code, or `token_unavailable` when the stored token could not be
 *   read.
 * @returns `502 slack_channel_list_failed`.
 */
export function slackChannelListFailed(reason: string): UpstreamError {
  return new UpstreamError(
    SLACK_ERRORS.channelListFailed,
    "Slack did not list this workspace's channels. The list was left as it was — try again.",
    { reason },
  );
}
