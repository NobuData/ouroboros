# Chat Ops setup — registering your Slack app

> Delivered by BZ.1 ([#535](https://github.com/NobuData/ouroboros/issues/535)). The product-facing
> version of this guide is `ouroboros-docs/docs/administration/chatops.mdx`.

A self-hosted Ouroboros deployment cannot use anybody else's Slack app: **each deployment
registers its own** (decision C1), gives `ouroboros-rest` its credentials, and a workspace Owner
or Maintainer then installs it from Settings. This guide is the registration.

What the app is — its scopes, events, command and paths — is fixed in
`ouroboros-rest/src/modules/slack/slack.app.ts`. The manifest below is **version `v1.0`**; that
version is recorded on every install (`install_meta.app_version`), and it changes whenever the
manifest's scopes, events, command or URLs do.

## 1. What you need

- A Slack workspace where you may create and install apps.
- The deployment's **public UI origin** — the value of `OURO_UI_URL`, for example
  `https://ouroboros.example.com`. It must be HTTPS and reachable from Slack. All four URLs
  below are on this one origin: `ouroboros-ui` forwards them to `ouroboros-rest`.

## 2. Create the app from this manifest

At <https://api.slack.com/apps> choose **Create New App → From a manifest**, pick the workspace,
and paste the manifest with every `https://ouroboros.example.com` replaced by your UI origin.

```yaml
display_information:
  name: Ouroboros
  description: Answer what your loops are waiting on, from Slack.
features:
  bot_user:
    display_name: Ouroboros
    always_online: true
  slash_commands:
    - command: /ouro
      url: https://ouroboros.example.com/api/v1/slack/commands
      description: Ouroboros commands
      usage_hint: link | unlink | help
      should_escape: false
oauth_config:
  redirect_urls:
    - https://ouroboros.example.com/api/v1/slack/oauth/callback
  scopes:
    bot:
      - chat:write
      - commands
      - channels:read
      - groups:read
      - im:write
      - users:read
      - users:read.email
settings:
  event_subscriptions:
    request_url: https://ouroboros.example.com/api/v1/slack/events
    bot_events:
      - app_uninstalled
      - tokens_revoked
  interactivity:
    is_enabled: true
    request_url: https://ouroboros.example.com/api/v1/slack/interactivity
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

### The four URLs

| Slack setting | URL |
| --- | --- |
| Event Subscriptions → Request URL | `<UI origin>/api/v1/slack/events` |
| Interactivity & Shortcuts → Request URL | `<UI origin>/api/v1/slack/interactivity` |
| Slash Commands → `/ouro` → Request URL | `<UI origin>/api/v1/slack/commands` |
| OAuth & Permissions → Redirect URL | `<UI origin>/api/v1/slack/oauth/callback` |

### The scopes, and why each is asked for

| Bot scope | Used for |
| --- | --- |
| `chat:write` | Posting messages as the app in channels it was added to. |
| `commands` | The `/ouro` slash command. |
| `channels:read` | Listing public channels, so a channel can be chosen by name. |
| `groups:read` | The same for private channels the app was invited to. |
| `im:write` | Opening a direct message with a person. |
| `users:read` | A person's display name on the linking screen. |
| `users:read.email` | A linking **suggestion** only: the confirmation screen says whether the Slack profile's email matches the signed-in account. It never links anybody by itself. |

No user scopes are requested, and no scope reads message content.

## 3. Give the deployment the app's credentials

From the app's **Basic Information** page, set on `ouroboros-rest` (and in the top-level
`.env`):

| Variable | Value |
| --- | --- |
| `OURO_SLACK_CLIENT_ID` | **Client ID**. Not a secret. |
| `OURO_SLACK_CLIENT_SECRET` | **Client Secret**. |
| `OURO_SLACK_SIGNING_SECRET` | **Signing Secret**. |

Set all three or none — `ouroboros-rest` refuses to boot with only some of them. With none, the
Slack routes refuse every request and the Slack tile in Settings says no Slack app is registered.
Restart `ouroboros-rest` after setting them.

Slack verifies the Events request URL the moment you save it, so the deployment must be running
**with the signing secret set** before the manifest's event subscription will save. If Slack
reports the URL as unverified, set the variables, restart, and press **Retry**.

## 4. Install it into a workspace

Signed in to Ouroboros as an Owner or Maintainer, open **Settings → Integrations** and choose
**Connect** on the **Slack** tile. Slack shows the consent screen; on approval you return to
Settings and the tile reads the Slack workspace's name.

The bot token Slack grants is sealed in the vault (`chat_connections.bot_token_sealed`) before
it is stored, is never returned by any API, and is never logged. One Slack workspace can be
connected to one Ouroboros workspace.

## 5. Verification checklist

- [ ] Slack's **Event Subscriptions** page shows the request URL as **Verified**.
- [ ] The **Slack** tile in Settings → Integrations shows the Slack workspace's name.
- [ ] `GET /api/v1/slack/connection` answers `"state": "connected"`, with an empty
      `missingScopes`.
- [ ] In Slack, `/ouro help` answers, visible only to you.
- [ ] `/ouro link` answers with a **Link your account** button; the page it opens names your
      Slack identity and your Ouroboros account, and **Link this Slack identity** completes it.
- [ ] `/ouro unlink` answers that the identity is unlinked.
- [ ] Removing the app from the Slack workspace turns the tile to **not connected**, with
      Slack's reason, within a few seconds.

## 6. How requests are verified

Every request Slack sends is authenticated by its signature and nothing else:
`X-Slack-Signature` must equal `v0=` followed by the HMAC-SHA256, under the signing secret, of
`v0:{X-Slack-Request-Timestamp}:{raw request body}` — compared in constant time, over the bytes
as they arrived. A timestamp more than five minutes from the server's clock is refused as a
replay, so keep the host's clock synchronised. A refused request is answered `401` and logged;
nothing in it is parsed or acted on.

Each request is acknowledged immediately and its work done afterwards, so Slack's three-second
limit holds whatever the work is. A redelivered event is handled once.

## 7. Development: Socket Mode

A local stack has no public URL for Slack to call. For development only, the app can reach
Slack over Socket Mode instead:

1. In the app's settings turn **Socket Mode** on, and under **Basic Information → App-Level
   Tokens** create a token with the `connections:write` scope (`xapp-…`).
2. Set `OURO_SLACK_SOCKET_MODE=true` and `OURO_SLACK_APP_TOKEN=xapp-…` alongside the three
   variables above.

Events, button presses and `/ouro` then arrive over the socket. The OAuth redirect URL is still
a browser redirect, so it can stay `http://localhost:3000/api/v1/slack/oauth/callback`.

**Socket Mode is not a production path.** `ouroboros-rest` refuses to boot with
`OURO_SLACK_SOCKET_MODE=true` when `NODE_ENV=production`; the signed HTTPS endpoints are the
one supported production transport.

## 8. What works today

BZ.1 delivers the boundary: install, verified endpoints, identity linking and the connection
status. BZ.3 (#537) delivers the commands: `/ouro status`, `queue`, `pause loop`, `resume loop`,
`abort loop`, `answer`, `dry-run`, `route`, `estimate`, `pause all` and `help` run as the linked
person who typed them — the reference is `ouroboros-docs/docs/cli/ouro.mdx`. Answering a
decision with a button in Slack replies *not available yet* and changes nothing, and no card is
posted to a channel yet — those arrive with the rest of the Chat Ops epic (#536, #538). The **Needs-you decisions → Slack
DM** notification route stays locked until decisions can be delivered to Slack.
