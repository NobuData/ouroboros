/**
 * What this deployment's Slack app is, as constants (BZ.1,
 * [#535](https://github.com/NobuData/ouroboros/issues/535), decision **C1**).
 *
 * A self-hosted deployment cannot use anybody else's Slack app: each operator registers their
 * own, from the manifest in `docs/CHATOPS_SETUP.md`. What that manifest declares is fixed here,
 * so the install URL, the guide and the status API cannot disagree about it.
 *
 * ```
 * scopes   chat:write · commands · channels:read · groups:read · im:write · users:read ·
 *          users:read.email
 * events   app_uninstalled · tokens_revoked
 * paths    /api/v1/slack/{events,interactivity,commands,oauth/callback}
 * ```
 */

/** The route family, relative to the API base path — `ouroboros-ui/proxy.ts` forwards it. */
export const SLACK_ROUTE = "slack";

/** The family's full path prefix, as a request path carries it. */
export const SLACK_PATH_PREFIX = "/api/v1/slack/";

/**
 * The bot scopes the app asks for — minimal, and documented one by one in the setup guide.
 *
 * `users:read.email` is the linking assist only: it pre-fills a suggestion on the confirmation
 * screen and never completes a link by itself.
 */
export const SLACK_BOT_SCOPES = [
  "chat:write",
  "commands",
  "channels:read",
  "groups:read",
  "im:write",
  "users:read",
  "users:read.email",
] as const;

/**
 * The events the app subscribes to. Both are the platform saying the install is over, which is
 * what flips a connection to `revoked`.
 */
export const SLACK_EVENT_SUBSCRIPTIONS = ["app_uninstalled", "tokens_revoked"] as const;

/**
 * The version of the manifest `docs/CHATOPS_SETUP.md` carries — recorded on the connection at
 * install as `install_meta.app_version`, and what mockup 19's header prints. Bumped whenever the
 * manifest's scopes, events, command or URLs change, because that is when an installed
 * workspace has to be re-approved.
 */
export const SLACK_APP_MANIFEST_VERSION = "v1.0";

/** The one slash command the app registers. Its subcommands are parsed here and in BZ.3 (#537). */
export const SLACK_COMMAND = "/ouro";

/** Slack's hosts — the only two this module ever calls. */
export const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
export const SLACK_API_URL = "https://slack.com/api";
