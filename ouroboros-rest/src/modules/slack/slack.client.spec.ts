import { HttpSlackApi, REVOKED_ERRORS, replyPayload } from "./slack.client";
import { BOT_TOKEN } from "./slack.fixture";

/**
 * The Slack Web API client (#535): each call is one HTTPS request, a failure is a value with
 * Slack's own error code, and a reply goes only to Slack's hosts.
 */

/** One scripted answer: a body, a thrown failure, or a body with a status and headers. */
type Scripted = Record<string, unknown> | Error | Answer;

/** A scripted answer that is not a plain 200. */
class Answer {
  constructor(
    readonly body: Record<string, unknown>,
    readonly status: number,
    readonly headers: Record<string, string> = {},
  ) {}
}

/** A fetch that answers from a script and records what it was asked. */
function fakeFetch(...answers: Scripted[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = ((url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const answer = answers.shift() ?? { ok: false, error: "no_more_answers" };

    if (answer instanceof Error) {
      return Promise.reject(answer);
    }

    const scripted = answer instanceof Answer ? answer : new Answer(answer, 200);

    return Promise.resolve({
      ok: scripted.status < 400,
      status: scripted.status,
      headers: new Headers(scripted.headers),
      json: () => Promise.resolve(scripted.body),
    } as Response);
  }) as typeof fetch;

  return { impl, calls };
}

/** The body a call sent — every body this client sends is a string. */
function bodyOf(call: { init: RequestInit }): string {
  return typeof call.init.body === "string" ? call.init.body : "";
}

describe("oauth.v2.access", () => {
  const input = {
    clientId: "id",
    clientSecret: "client-secret",
    code: "code-1",
    redirectUri: "https://app/cb",
  };

  it("posts the code and credentials as a form and reads the grant", async () => {
    const { impl, calls } = fakeFetch({
      ok: true,
      access_token: BOT_TOKEN,
      bot_user_id: "U07OUROBOT",
      app_id: "A07OUROBOROS",
      scope: "chat:write,commands",
      team: { id: "T024AB", name: "acme-robotics" },
      authed_user: { id: "U07KEN" },
    });

    const answer = await new HttpSlackApi(impl).exchangeCode(input);

    expect(answer).toEqual({
      ok: true,
      grant: {
        botToken: BOT_TOKEN,
        botUserId: "U07OUROBOT",
        appId: "A07OUROBOROS",
        scopes: ["chat:write", "commands"],
        teamId: "T024AB",
        teamName: "acme-robotics",
        installerUserId: "U07KEN",
      },
    });
    expect(calls[0].url).toBe("https://slack.com/api/oauth.v2.access");
    expect(calls[0].init.method).toBe("POST");
    expect(bodyOf(calls[0])).toBe(
      "client_id=id&client_secret=client-secret&code=code-1&redirect_uri=https%3A%2F%2Fapp%2Fcb",
    );
  });

  it("answers Slack's error code when the code is refused", async () => {
    const { impl } = fakeFetch({ ok: false, error: "invalid_code" });

    await expect(new HttpSlackApi(impl).exchangeCode(input)).resolves.toEqual({
      ok: false,
      error: "invalid_code",
    });
  });

  it("refuses a grant with no bot token or team — a user-token or org-wide install", async () => {
    const { impl } = fakeFetch({ ok: true, authed_user: { id: "U1", access_token: "xoxp-1" } });

    await expect(new HttpSlackApi(impl).exchangeCode(input)).resolves.toEqual({
      ok: false,
      error: "incomplete_grant",
    });
  });
});

describe("the token-bearing calls", () => {
  it("sends the bot token as a bearer header, never in the URL or the body", async () => {
    const { impl, calls } = fakeFetch({ ok: true, team_id: "T024AB", user_id: "U07OUROBOT" });

    await expect(new HttpSlackApi(impl).authTest(BOT_TOKEN)).resolves.toEqual({
      ok: true,
      teamId: "T024AB",
      botUserId: "U07OUROBOT",
    });

    const { url, init } = calls[0];
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${BOT_TOKEN}`);
    expect(url).not.toContain(BOT_TOKEN);
    expect(bodyOf(calls[0])).not.toContain(BOT_TOKEN);
  });

  it.each([...REVOKED_ERRORS])(
    "passes %s through as the error, for the caller to treat as a revocation",
    async (error) => {
      const { impl } = fakeFetch({ ok: false, error });

      await expect(new HttpSlackApi(impl).authTest(BOT_TOKEN)).resolves.toEqual({
        ok: false,
        error,
      });
    },
  );

  it("is unreachable, not a rejection, when the network fails", async () => {
    const { impl } = fakeFetch(new Error("ECONNRESET"));

    await expect(new HttpSlackApi(impl).authTest(BOT_TOKEN)).resolves.toEqual({
      ok: false,
      error: "unreachable",
    });
  });

  it("lists channels across pages, with membership, privacy and archive state", async () => {
    const { impl, calls } = fakeFetch(
      {
        ok: true,
        channels: [{ id: "C1", name: "ouroboros-loops", is_member: true, num_members: 24 }],
        response_metadata: { next_cursor: "page-2" },
      },
      {
        ok: true,
        channels: [
          { id: "C2", name: "eng-leads", is_private: true, is_archived: true },
          { name: "no-id" },
        ],
        response_metadata: { next_cursor: "" },
      },
    );

    const answer = await new HttpSlackApi(impl).listChannels(BOT_TOKEN);

    expect(answer).toEqual({
      ok: true,
      channels: [
        {
          id: "C1",
          name: "ouroboros-loops",
          isPrivate: false,
          isMember: true,
          isArchived: false,
          memberCount: 24,
        },
        {
          id: "C2",
          name: "eng-leads",
          isPrivate: true,
          isMember: false,
          isArchived: true,
          memberCount: null,
        },
      ],
    });
    expect(calls).toHaveLength(2);
    expect(bodyOf(calls[0])).toContain("types=public_channel%2Cprivate_channel");
    expect(bodyOf(calls[1])).toContain("cursor=page-2");
  });

  it("stops paging a cursor that never empties", async () => {
    const page = { ok: true, channels: [], response_metadata: { next_cursor: "again" } };
    const { impl, calls } = fakeFetch(...Array.from({ length: 40 }, () => page));

    await new HttpSlackApi(impl).listChannels(BOT_TOKEN);

    expect(calls).toHaveLength(20);
  });

  it("reads a profile's display name and email, falling back to the real name", async () => {
    const { impl } = fakeFetch(
      {
        ok: true,
        user: {
          name: "maya",
          profile: { display_name: "", real_name: "Maya Chen", email: "maya@acme-robotics.dev" },
        },
      },
      { ok: true, user: { name: "bot", profile: {} } },
    );
    const api = new HttpSlackApi(impl);

    await expect(api.userProfile(BOT_TOKEN, "U07MAYA")).resolves.toEqual({
      ok: true,
      user: { id: "U07MAYA", displayName: "Maya Chen", email: "maya@acme-robotics.dev" },
    });
    await expect(api.userProfile(BOT_TOKEN, "U07BOT")).resolves.toEqual({
      ok: true,
      user: { id: "U07BOT", displayName: "bot", email: null },
    });
  });

  it("opens a Socket Mode connection with the app-level token", async () => {
    const { impl, calls } = fakeFetch({
      ok: true,
      url: "wss://wss-primary.slack.com/link/?ticket=1",
    });

    await expect(new HttpSlackApi(impl).openSocket("xapp-1-A0-1-abc")).resolves.toEqual({
      ok: true,
      url: "wss://wss-primary.slack.com/link/?ticket=1",
    });
    expect(calls[0].url).toBe("https://slack.com/api/apps.connections.open");
  });
});

describe("replying to a response_url", () => {
  it("posts an ephemeral message with its link button", async () => {
    const { impl, calls } = fakeFetch({ ok: true });

    const sent = await new HttpSlackApi(impl).respond("https://hooks.slack.com/commands/T1/2/3", {
      ephemeral: true,
      text: "Link your account",
      link: { label: "Link", url: "https://app.example.test/api/v1/slack/link/t" },
    });

    expect(sent).toEqual({ ok: true });
    expect(JSON.parse(bodyOf(calls[0]))).toEqual({
      response_type: "ephemeral",
      replace_original: false,
      text: "Link your account",
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: "Link your account" } },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Link" },
              url: "https://app.example.test/api/v1/slack/link/t",
            },
          ],
        },
      ],
    });
  });

  it.each([
    ["another host", "https://hooks.example.com/commands/1", "response_url_not_slack"],
    ["a look-alike host", "https://hooks.slack.com.evil.example/1", "response_url_not_slack"],
    ["plain http", "http://hooks.slack.com/commands/1", "response_url_not_slack"],
    ["an internal address", "https://169.254.169.254/latest", "response_url_not_slack"],
    ["not a URL", "not a url", "response_url_malformed"],
  ])("posts nothing to %s", async (_label, url, error) => {
    const { impl, calls } = fakeFetch({ ok: true });

    await expect(
      new HttpSlackApi(impl).respond(url, { ephemeral: true, text: "x" }),
    ).resolves.toEqual({
      ok: false,
      error,
    });
    expect(calls).toEqual([]);
  });

  it("omits the actions block when the reply offers no link", () => {
    expect(replyPayload({ ephemeral: true, text: "Done." }).blocks).toHaveLength(1);
  });
});

describe("a moved Web API base (OURO_SLACK_API_BASE_URL, #545)", () => {
  const STAND_IN = "http://slack-stub:8080/api";

  it("calls every method at the base it was given, a trailing slash or not", async () => {
    const { impl, calls } = fakeFetch({ ok: true, team_id: "T1" }, { ok: true, team_id: "T1" });

    await new HttpSlackApi(impl, STAND_IN).authTest(BOT_TOKEN);
    await new HttpSlackApi(impl, `${STAND_IN}/`).authTest(BOT_TOKEN);

    expect(calls.map((call) => call.url)).toEqual([
      `${STAND_IN}/auth.test`,
      `${STAND_IN}/auth.test`,
    ]);
  });

  it("replies to a response_url on the stand-in's origin, and still to Slack's", async () => {
    const { impl, calls } = fakeFetch({ ok: true }, { ok: true });
    const api = new HttpSlackApi(impl, STAND_IN);

    await expect(
      api.respond("http://slack-stub:8080/hooks/commands/1", { ephemeral: true, text: "x" }),
    ).resolves.toEqual({ ok: true });
    await expect(
      api.respond("https://hooks.slack.com/commands/1", { ephemeral: true, text: "x" }),
    ).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it.each([
    ["another port of the stand-in's host", "http://slack-stub:9090/hooks/1"],
    ["another host", "http://elsewhere:8080/hooks/1"],
    ["plain http to Slack's host", "http://hooks.slack.com/commands/1"],
  ])("posts nothing to %s", async (_label, url) => {
    const { impl, calls } = fakeFetch({ ok: true });

    await expect(
      new HttpSlackApi(impl, STAND_IN).respond(url, { ephemeral: true, text: "x" }),
    ).resolves.toEqual({ ok: false, error: "response_url_not_slack" });
    expect(calls).toEqual([]);
  });

  it("widens nothing when the base is Slack's own", async () => {
    const { impl, calls } = fakeFetch({ ok: true });

    await expect(
      new HttpSlackApi(impl).respond("https://slack.com/hooks/1", { ephemeral: true, text: "x" }),
    ).resolves.toEqual({ ok: false, error: "response_url_not_slack" });
    expect(calls).toEqual([]);
  });
});

describe("publishing a message (#536)", () => {
  const message = {
    text: "✓ Loop #1846 finished",
    blocks: [],
    attachments: [{ color: "#2f9e6b", blocks: [{ type: "section" }] }],
  };

  it("posts to a channel with blocks and attachments as JSON form fields, and answers the ts", async () => {
    const { impl, calls } = fakeFetch({ ok: true, ts: "1760000000.000100", channel: "C071LOOPS" });

    await expect(
      new HttpSlackApi(impl).postMessage(BOT_TOKEN, "C071LOOPS", message),
    ).resolves.toEqual({
      ok: true,
      ts: "1760000000.000100",
    });

    const form = new URLSearchParams(bodyOf(calls[0]));

    expect(calls[0].url).toBe("https://slack.com/api/chat.postMessage");
    expect(form.get("channel")).toBe("C071LOOPS");
    expect(form.get("text")).toBe("✓ Loop #1846 finished");
    expect(JSON.parse(form.get("attachments") ?? "")).toEqual(message.attachments);
    expect(form.get("blocks")).toBe("[]");
    // A card links to this product; Slack must not expand those links into previews.
    expect(form.get("unfurl_links")).toBe("false");
    expect(bodyOf(calls[0])).not.toContain(BOT_TOKEN);
  });

  it("edits by ts, always sending blocks and attachments so removed buttons are really removed", async () => {
    const { impl, calls } = fakeFetch({ ok: true, ts: "1760000000.000100" });

    await expect(
      new HttpSlackApi(impl).updateMessage(BOT_TOKEN, "C071LOOPS", "1760000000.000100", {
        text: "closed",
      }),
    ).resolves.toEqual({ ok: true, ts: "1760000000.000100" });

    const form = new URLSearchParams(bodyOf(calls[0]));

    expect(calls[0].url).toBe("https://slack.com/api/chat.update");
    expect(form.get("ts")).toBe("1760000000.000100");
    expect(form.get("blocks")).toBe("[]");
    expect(form.get("attachments")).toBe("[]");
  });

  it("opens a DM and answers the conversation's id", async () => {
    const { impl, calls } = fakeFetch({ ok: true, channel: { id: "D07KEN" } }, { ok: true });
    const api = new HttpSlackApi(impl);

    await expect(api.openDm(BOT_TOKEN, "U07KEN")).resolves.toEqual({
      ok: true,
      channelId: "D07KEN",
    });
    expect(calls[0].url).toBe("https://slack.com/api/conversations.open");
    expect(new URLSearchParams(bodyOf(calls[0])).get("users")).toBe("U07KEN");
    await expect(api.openDm(BOT_TOKEN, "U07KEN")).resolves.toEqual({
      ok: false,
      error: "incomplete_answer",
    });
  });

  it("reports Retry-After, in seconds, with a rate limit", async () => {
    const { impl } = fakeFetch(
      new Answer({ ok: false, error: "ratelimited" }, 429, { "retry-after": "30" }),
    );

    await expect(new HttpSlackApi(impl).postMessage(BOT_TOKEN, "C1", message)).resolves.toEqual({
      ok: false,
      error: "ratelimited",
      retryAfterSeconds: 30,
    });
  });

  it("reports no wait when Slack names none, or names nonsense", async () => {
    const { impl } = fakeFetch(
      { ok: false, error: "channel_not_found" },
      new Answer({ ok: false, error: "ratelimited" }, 429, { "retry-after": "soon" }),
    );
    const api = new HttpSlackApi(impl);

    await expect(api.postMessage(BOT_TOKEN, "C1", message)).resolves.toEqual({
      ok: false,
      error: "channel_not_found",
    });
    await expect(api.postMessage(BOT_TOKEN, "C1", message)).resolves.toEqual({
      ok: false,
      error: "ratelimited",
    });
  });

  it("is unreachable, not a rejection, when the network fails, and incomplete without a ts", async () => {
    const { impl } = fakeFetch(new Error("ECONNRESET"), { ok: true });
    const api = new HttpSlackApi(impl);

    await expect(api.postMessage(BOT_TOKEN, "C1", message)).resolves.toEqual({
      ok: false,
      error: "unreachable",
    });
    await expect(api.postMessage(BOT_TOKEN, "C1", message)).resolves.toEqual({
      ok: false,
      error: "incomplete_answer",
    });
  });
});
