/**
 * The e2e suite's Slack — a stand-in workspace `ouroboros-rest` talks to as Slack, so the
 * chatops leg can walk the whole chain: install → publish → answer → command → escalation.
 *
 * [#545](https://github.com/NobuData/ouroboros/issues/545), CA.5 — the Chat Ops MVP gate. Each
 * piece of the integration passes its own tests against a fake; what none of them shows is the
 * composition: that a card rendered is a card **published**, that a button pressed in Slack
 * resumes a real run, that a command typed there answers what the console answers. For that the
 * service has to post to something that is not itself.
 *
 * ---------------------------------------------------------------------------
 * **It is the receiving half of `ouroboros-rest/src/testing/slack.harness.fixture.ts`**
 * (BZ.6, #540), as a container. That harness lives inside one Jest process and reaches the
 * service through an injected `fetch`; a compose stack has no such seam, so the service is
 * pointed here by `OURO_SLACK_API_BASE_URL` (`docker-compose.e2e.yml`) and this file answers
 * the same methods the same way. The emitting half — signing a body as Slack does and sending
 * it to the service — stays with the suite, in `support/slack.ts`: the signing secret is the
 * service's and the suite's, never this fixture's.
 *
 * **It has a world, and is told nothing of what the suite expects.** A team is declared with its
 * bot token, channels and people; a method called with a token no team holds — or a revoked
 * one — answers `invalid_auth`, as Slack does. Messages posted are kept per channel with the
 * `ts` they were given, and an update replaces the one it names.
 *
 * ```
 * POST /api/<method>            the Web API methods the service calls (form-encoded, bearer token)
 * POST /hooks/<anything>        a `response_url`: the reply is kept, and answered `ok`
 * GET  /healthz                 up
 * POST /__slack/reset           forget every team, call, message, reply, script and code
 * POST /__slack/team            {team} — declare a workspace (replaces one with the same id)
 * POST /__slack/code            {teamId} → {code} — an OAuth code, exchangeable once
 * POST /__slack/revoke          {teamId, revoked} — its token stops (or resumes) working
 * POST /__slack/membership      {teamId, channel, isMember} — the bot is removed from, or invited
 *                               back to, a channel
 * POST /__slack/script          {method, answers} — the method's next calls answer these, in order:
 *                               {"error": "…"}, {"rateLimit": seconds} or {"delayMs": n}
 * GET  /__slack/calls           every Web API call since the last reset, oldest first
 * GET  /__slack/messages        every message as it now stands
 * GET  /__slack/replies         every reply posted to a `response_url`
 * ```
 *
 * **Failures are scripted one call at a time**, which is what lets the leg dead-letter exactly
 * one publish and what `scripts/verify-chatops.sh` uses to break publishing beneath the service.
 *
 * **No dependencies, on purpose** — `provider-stub`'s argument: a fixture whose build can fail
 * on a registry outage must not be able to fail the release gate.
 */

import { createServer } from "node:http";

/** Where it listens. Fixed, for `provider-stub`'s reason: compose names it, nothing configures it. */
const PORT = 8080;

/** The Slack app the service is configured with — `docker-compose.e2e.yml` gives both the same. */
const CLIENT_ID = process.env.SLACK_STUB_CLIENT_ID ?? "5450000000.5450000000545";
const CLIENT_SECRET =
  process.env.SLACK_STUB_CLIENT_SECRET ?? "e2e-slack-client-secret-0123456789abcdef";

/** The scopes an install grants unless a team says otherwise — the harness's own list. */
const DEFAULT_SCOPES = [
  "chat:write",
  "commands",
  "channels:read",
  "groups:read",
  "im:write",
  "users:read",
  "users:read.email",
];

/** The largest body read, in bytes. A card's blocks are a few kilobytes. */
const BODY_LIMIT = 1024 * 1024;

/** The most calls, messages and replies kept. A leg makes dozens; this is a bound, not a budget. */
const KEEP = 2000;

/** The declared teams, by id. */
let teams = new Map();
/** The ids of teams whose token no longer works. */
let revoked = new Set();
/** OAuth codes not yet exchanged → the team each installs. */
let codes = new Map();
/** Scripted answers, by method, consumed in order. */
let scripts = new Map();
/** Every Web API call, oldest first. */
let calls = [];
/** Every message as it now stands. */
let messages = [];
/** Every reply posted to a `response_url`. */
let replies = [];
/** What OAuth codes are numbered from. */
let sequence = 0;
/**
 * What message timestamps are numbered from — never reset. A `ts` is a message's identity in its
 * channel, and the service keeps every one it was given: a stub that handed the same `ts` out
 * again after a reset would be a Slack that reuses message ids, which the service rightly
 * refuses to record twice.
 */
let posted = 0;

/** Forget everything. */
function reset() {
  teams = new Map();
  revoked = new Set();
  codes = new Map();
  scripts = new Map();
  calls = [];
  messages = [];
  replies = [];
  sequence = 0;
}

/**
 * Keep a record, dropping the oldest past {@link KEEP}.
 *
 * @param list The list.
 * @param entry What to keep.
 */
function keep(list, entry) {
  list.push(entry);
  if (list.length > KEEP) list.shift();
}

/**
 * Read a request's body as text, bounded.
 *
 * @param request The request.
 * @returns The body — cut at {@link BODY_LIMIT}.
 */
function bodyOf(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let read = 0;

    request.on("data", (chunk) => {
      if (read < BODY_LIMIT) chunks.push(chunk.subarray(0, BODY_LIMIT - read));
      read += chunk.length;
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

/**
 * A JSON body, or an empty object for none or an unreadable one.
 *
 * @param raw The body.
 * @returns The parsed object.
 */
function jsonOf(raw) {
  try {
    const parsed = JSON.parse(raw === "" ? "{}" : raw);

    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * A JSON list a form field carries — `blocks`, `attachments`.
 *
 * @param field The field, or undefined.
 * @returns The list, or an empty one.
 */
function listOf(field) {
  const parsed = field === undefined ? [] : jsonOf(`{"list":${field}}`).list;

  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Answer a request with JSON.
 *
 * @param response The response.
 * @param status The status.
 * @param body The body.
 * @param headers Extra headers.
 */
function send(response, status, body, headers = {}) {
  response
    .writeHead(status, { "content-type": "application/json", ...headers })
    .end(JSON.stringify(body));
}

/**
 * What a Web API method answers, from the declared world — the harness's `answer`, restated.
 *
 * @param method The method.
 * @param token The bearer token it carried.
 * @param form Its fields.
 * @returns Slack's answer body.
 */
function answer(method, token, form) {
  if (method === "oauth.v2.access") {
    const team = teams.get(codes.get(form.code ?? "") ?? "");

    if (form.client_id !== CLIENT_ID || form.client_secret !== CLIENT_SECRET) {
      return { ok: false, error: "invalid_client_id" };
    }
    if (team === undefined) return { ok: false, error: "invalid_code" };

    // A code is exchanged once.
    codes.delete(form.code ?? "");

    return {
      ok: true,
      access_token: team.botToken,
      bot_user_id: team.botUserId,
      app_id: "A0E2ESLACKSTUB",
      scope: (team.scopes ?? DEFAULT_SCOPES).join(","),
      team: { id: team.id, name: team.name },
      authed_user: { id: team.users[0]?.id },
    };
  }

  const team = [...teams.values()].find((known) => known.botToken === token);

  if (team === undefined || revoked.has(team.id)) return { ok: false, error: "invalid_auth" };

  switch (method) {
    case "auth.test":
      return { ok: true, team_id: team.id, user_id: team.botUserId };
    case "conversations.list":
      return {
        ok: true,
        channels: team.channels.map((channel) => ({
          id: channel.id,
          name: channel.name,
          is_private: channel.isPrivate ?? false,
          is_member: channel.isMember ?? true,
          is_archived: channel.isArchived ?? false,
          num_members: channel.members ?? 3,
        })),
        response_metadata: { next_cursor: "" },
      };
    case "users.info": {
      const user = team.users.find((known) => known.id === form.user);

      return user === undefined
        ? { ok: false, error: "user_not_found" }
        : {
            ok: true,
            user: {
              id: user.id,
              name: user.name,
              profile: { display_name: user.name, real_name: user.name, email: user.email },
            },
          };
    }
    case "conversations.open":
      return team.users.some((known) => known.id === form.users)
        ? { ok: true, channel: { id: `D${(form.users ?? "").slice(1)}` } }
        : { ok: false, error: "user_not_found" };
    case "chat.postMessage": {
      const channel = team.channels.find((known) => known.id === form.channel);

      // A channel the bot was removed from refuses the post, as Slack does.
      if (channel !== undefined && channel.isMember === false)
        return { ok: false, error: "not_in_channel" };

      posted += 1;

      // Seconds of the wall clock, and a counter where Slack has microseconds: unique for the
      // life of the container, and across a restart of it.
      const ts = `${String(Math.floor(Date.now() / 1000))}.${String(posted).padStart(6, "0")}`;

      keep(messages, {
        team: team.id,
        channel: form.channel ?? "",
        ts,
        edits: 0,
        text: form.text ?? "",
        blocks: listOf(form.blocks),
        attachments: listOf(form.attachments),
      });

      return { ok: true, channel: form.channel, ts };
    }
    case "chat.update": {
      const at = messages.findIndex(
        (message) => message.channel === form.channel && message.ts === form.ts,
      );

      if (at === -1) return { ok: false, error: "message_not_found" };

      messages[at] = {
        ...messages[at],
        edits: messages[at].edits + 1,
        text: form.text ?? "",
        blocks: listOf(form.blocks),
        attachments: listOf(form.attachments),
      };

      return { ok: true, channel: form.channel, ts: form.ts };
    }
    default:
      return { ok: false, error: "unknown_method" };
  }
}

/**
 * Answer one Web API call, scripted or from the world, and record it.
 *
 * @param method The method.
 * @param request The request.
 * @param response The response.
 */
async function api(method, request, response) {
  const form = Object.fromEntries(new URLSearchParams(await bodyOf(request)));
  const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1];
  const scripted = scripts.get(method)?.shift();
  let status = 200;
  let body;
  const headers = {};

  if (scripted !== undefined && "rateLimit" in scripted) {
    status = 429;
    headers["retry-after"] = String(scripted.rateLimit);
    body = { ok: false, error: "ratelimited" };
  } else if (scripted !== undefined && "error" in scripted) {
    body = { ok: false, error: scripted.error };
  } else {
    if (scripted !== undefined && "delayMs" in scripted) {
      await new Promise((resolve) => setTimeout(resolve, Number(scripted.delayMs)));
    }
    body = answer(method, token, form);
  }

  // The token is a credential even here: what is kept is whether one was sent, not what it was.
  keep(calls, { method, authorized: token !== undefined, form, status, answer: body });
  send(response, status, body, headers);
}

/**
 * Answer one control.
 *
 * @param name The control, after `/__slack/`.
 * @param request The request.
 * @param response The response.
 */
async function control(name, request, response) {
  if (request.method === "GET") {
    if (name === "calls") return send(response, 200, { calls });
    if (name === "messages") return send(response, 200, { messages });
    if (name === "replies") return send(response, 200, { replies });

    return send(response, 404, { error: "unknown_control" });
  }

  const body = jsonOf(await bodyOf(request));

  switch (name) {
    case "reset":
      reset();
      return send(response, 200, { ok: true });
    case "team": {
      const team = body.team;

      if (typeof team?.id !== "string" || typeof team.botToken !== "string") {
        return send(response, 400, { error: "team_needs_id_and_bot_token" });
      }

      teams.set(team.id, { channels: [], users: [], ...team });
      return send(response, 200, { ok: true });
    }
    case "code": {
      if (!teams.has(body.teamId)) return send(response, 404, { error: "unknown_team" });

      sequence += 1;

      const code = `e2e-code-${String(sequence)}`;

      codes.set(code, body.teamId);
      return send(response, 200, { code });
    }
    case "revoke":
      if (body.revoked === false) revoked.delete(body.teamId);
      else revoked.add(body.teamId);
      return send(response, 200, { ok: true });
    case "membership": {
      const channel = teams.get(body.teamId)?.channels.find((known) => known.id === body.channel);

      if (channel === undefined) return send(response, 404, { error: "unknown_channel" });

      channel.isMember = body.isMember === true;
      return send(response, 200, { ok: true });
    }
    case "script":
      if (typeof body.method !== "string" || !Array.isArray(body.answers)) {
        return send(response, 400, { error: "script_needs_method_and_answers" });
      }

      scripts.set(body.method, [...(scripts.get(body.method) ?? []), ...body.answers]);
      return send(response, 200, { ok: true });
    default:
      return send(response, 404, { error: "unknown_control" });
  }
}

const server = createServer((request, response) => {
  const path = (request.url ?? "").split("?")[0] ?? "";

  Promise.resolve()
    .then(async () => {
      if (path === "/healthz") return send(response, 200, { ok: true });
      if (path.startsWith("/__slack/"))
        return control(path.slice("/__slack/".length), request, response);

      if (request.method === "POST" && path.startsWith("/hooks/")) {
        keep(replies, { path, body: jsonOf(await bodyOf(request)) });
        return response.writeHead(200, { "content-type": "text/plain" }).end("ok");
      }

      if (request.method === "POST" && path.startsWith("/api/")) {
        return api(path.slice("/api/".length), request, response);
      }

      return send(response, 404, { error: "not_found" });
    })
    .catch((reason) => send(response, 500, { error: String(reason) }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`slack-stub listening on ${String(PORT)}`);
});

// compose's stop is a SIGTERM to PID 1: close rather than wait for the ten-second kill.
process.on("SIGTERM", () => server.close(() => process.exit(0)));
