import { ARCHETYPES } from "../chat/chat.fixture";
import { renderBlockKit } from "./slack.blockkit";
import {
  GONE_ERRORS,
  REJECTED_ERRORS,
  SlackChatBackend,
  TOKEN_UNREADABLE,
  classify,
} from "./slack.chat-backend";
import { REVOKED_ERRORS } from "./slack.client";
import { BOT_TOKEN, FakeSlackApi, ORG } from "./slack.fixture";
import type { SlackInstallService } from "./slack.install.service";
import type { SlackRepository } from "./slack.repository";

/**
 * Slack as a chat backend (#536): the card model in, Block Kit out, and Slack's errors turned
 * into the four things the outbox acts on.
 */

const CONNECTION = "c5360000-0000-4000-8000-000000000001";

function harness(options: { token: string | undefined } = { token: BOT_TOKEN }) {
  const { token } = options;
  const slack = new FakeSlackApi();
  const installs = {
    botToken: jest.fn().mockResolvedValue(token),
    noteFailure: jest.fn().mockResolvedValue(true),
  };
  const repository = {
    connection: jest.fn().mockResolvedValue({ id: CONNECTION, organization_id: ORG }),
  };
  const backend = new SlackChatBackend(
    slack,
    installs as unknown as SlackInstallService,
    repository as unknown as SlackRepository,
  );

  return { backend, slack, installs, repository };
}

describe("rendering", () => {
  it("is the Block Kit renderer's, unchanged", () => {
    const { backend } = harness();

    expect(backend.render(ARCHETYPES.question)).toEqual(renderBlockKit(ARCHETYPES.question));
  });
});

describe("sending", () => {
  it("posts the rendered card with the connection's token and answers Slack's ts", async () => {
    const { backend, slack, installs } = harness();
    const rendered = backend.render(ARCHETYPES.loop_finished);

    const sent = await backend.post({ connectionId: CONNECTION, channelId: "C071LOOPS", rendered });

    expect(installs.botToken).toHaveBeenCalledWith(CONNECTION);
    expect(sent).toEqual({ ok: true, ts: slack.posted[0].ts });
    expect(slack.posted[0]).toMatchObject({
      channel: "C071LOOPS",
      message: {
        text: "✓ Loop #1846 finished — PR #512 merged",
        blocks: [],
        attachments: (rendered.payload as { attachments: unknown[] }).attachments,
      },
    });
    expect(slack.tokensSeen).toEqual([BOT_TOKEN]);
  });

  it("edits a message in place, addressed by its ts", async () => {
    const { backend, slack } = harness();
    const rendered = backend.render(ARCHETYPES.question_resolved);

    await expect(
      backend.update({
        connectionId: CONNECTION,
        channelId: "C071LOOPS",
        ts: "1760000000.000001",
        rendered,
      }),
    ).resolves.toEqual({ ok: true, ts: "1760000000.000001" });

    expect(slack.updated).toEqual([
      expect.objectContaining({ channel: "C071LOOPS", ts: "1760000000.000001" }),
    ]);
    expect(JSON.stringify(slack.updated[0].message)).not.toContain('"type":"button"');
  });

  it("opens a DM with one person", async () => {
    const { backend } = harness();

    await expect(
      backend.openDm({ connectionId: CONNECTION, platformUserId: "U07KEN" }),
    ).resolves.toEqual({
      ok: true,
      channelId: "D07KEN",
    });
    await expect(
      backend.openDm({ connectionId: CONNECTION, platformUserId: "U0NOBODY" }),
    ).resolves.toEqual({
      ok: false,
      error: "user_not_found",
      reason: "gone",
    });
  });

  it("is a retry, not a rejection, when the token cannot be unsealed — and calls nothing", async () => {
    const { backend, slack } = harness({ token: undefined });

    await expect(
      backend.post({
        connectionId: CONNECTION,
        channelId: "C1",
        rendered: backend.render(ARCHETYPES.system_line),
      }),
    ).resolves.toEqual({ ok: false, error: TOKEN_UNREADABLE, reason: "retry" });
    expect(slack.posted).toEqual([]);
  });

  it("passes Retry-After through on a rate limit", async () => {
    const { backend, slack } = harness();
    slack.deliveries.push({ ok: false, error: "ratelimited", retryAfterSeconds: 30 });

    await expect(
      backend.post({
        connectionId: CONNECTION,
        channelId: "C1",
        rendered: backend.render(ARCHETYPES.system_line),
      }),
    ).resolves.toEqual({ ok: false, error: "ratelimited", reason: "retry", retryAfterSeconds: 30 });
  });

  it("flips the connection when Slack says the install is over", async () => {
    const { backend, slack, installs } = harness();
    slack.deliveries.push({ ok: false, error: "token_revoked" });

    await expect(
      backend.post({
        connectionId: CONNECTION,
        channelId: "C1",
        rendered: backend.render(ARCHETYPES.system_line),
      }),
    ).resolves.toEqual({ ok: false, error: "token_revoked", reason: "revoked" });
    expect(installs.noteFailure).toHaveBeenCalledWith(
      { id: CONNECTION, organization_id: ORG },
      "token_revoked",
      "chat.postMessage",
    );
  });

  it("does not touch the connection for any other failure", async () => {
    const { backend, slack, installs } = harness();
    slack.deliveries.push({ ok: false, error: "not_in_channel" });

    await backend.post({
      connectionId: CONNECTION,
      channelId: "C1",
      rendered: backend.render(ARCHETYPES.system_line),
    });

    expect(installs.noteFailure).not.toHaveBeenCalled();
  });
});

describe("classifying Slack's errors", () => {
  it.each([...REVOKED_ERRORS])("%s means the install is over", (error) => {
    expect(classify({ error }).reason).toBe("revoked");
  });

  it.each([...GONE_ERRORS])("%s means the destination is gone", (error) => {
    expect(classify({ error }).reason).toBe("gone");
  });

  it.each([...REJECTED_ERRORS])("%s means this message never will be taken", (error) => {
    expect(classify({ error }).reason).toBe("rejected");
  });

  it.each([
    "ratelimited",
    "unreachable",
    "http_503",
    "internal_error",
    "fatal_error",
    "something_new",
  ])("%s is worth another try", (error) => {
    expect(classify({ error }).reason).toBe("retry");
  });

  it("keeps the three sets apart", () => {
    const all = [...REVOKED_ERRORS, ...GONE_ERRORS, ...REJECTED_ERRORS];

    expect(new Set(all).size).toBe(all.length);
  });
});
