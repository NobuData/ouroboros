import type { AuditService } from "../audit/audit.service";
import type { AppConfigService } from "../config/config.service";
import type { VaultService } from "../vault/vault.service";
import { SLACK_APP_MANIFEST_VERSION, SLACK_BOT_SCOPES } from "./slack.app";
import { SLACK_ERRORS } from "./slack.errors";
import {
  BOT_TOKEN,
  FakeSlackApi,
  FakeSlackStore,
  FakeVault,
  KEN,
  ORG,
  RecordingAudit,
  TEAM,
  grant,
  slackConfig,
} from "./slack.fixture";
import { SlackInstallService } from "./slack.install.service";
import type { SlackRepository } from "./slack.repository";

/**
 * The install, verification and revocation (#535): the token is sealed and never stored or
 * recorded in the clear; a re-install revives the same row; a second Slack workspace is refused;
 * and a revoked app flips the connection once and stops there.
 */

/** A service over fakes. */
function setup(config: Record<string, unknown> = {}) {
  const slack = new FakeSlackApi();
  const store = new FakeSlackStore();
  const vault = new FakeVault();
  const audit = new RecordingAudit();
  const service = new SlackInstallService(
    slackConfig(config) as unknown as AppConfigService,
    slack,
    store as unknown as SlackRepository,
    vault as unknown as VaultService,
    audit as unknown as AuditService,
  );

  return { service, slack, store, vault, audit };
}

/** What a refused call threw. */
async function refusal(run: Promise<unknown>): Promise<{ code: string; getStatus(): number }> {
  return run.then(
    () => {
      throw new Error("the call was not refused");
    },
    (error: { code: string; getStatus(): number }) => error,
  );
}

describe("the authorize URL", () => {
  it("asks for exactly the documented scopes, with the state and the callback on the UI origin", () => {
    const url = new URL(setup().service.authorizeUrl("state-123"));

    expect(`${url.origin}${url.pathname}`).toBe("https://slack.com/oauth/v2/authorize");
    expect(url.searchParams.get("client_id")).toBe("1234567890.1234567890123");
    expect(url.searchParams.get("scope")).toBe(SLACK_BOT_SCOPES.join(","));
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example.test/api/v1/slack/oauth/callback",
    );
  });

  it("never carries the client secret", () => {
    expect(setup().service.authorizeUrl("s")).not.toContain("client-secret");
  });

  it("is refused on a deployment with no Slack app", () => {
    const { service } = setup({ slackClientId: undefined, slackClientSecret: undefined });

    let thrown: unknown;

    try {
      service.authorizeUrl("s");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: SLACK_ERRORS.notConfigured });
  });
});

describe("completing an install", () => {
  it("stores an active connection with its token sealed, scopes captured and app version recorded", async () => {
    const { service, store, vault, slack } = setup();

    const connection = await service.complete(ORG, KEN.userId, "code-1");
    const stored = store.connections[0];

    expect(connection).toMatchObject({
      organization_id: ORG,
      workspace_id: TEAM,
      workspace_name: "acme-robotics",
      status: "active",
      bot_user_id: "U07OUROBOT",
      installed_by: KEN.userId,
    });
    expect(stored.install_meta).toEqual({
      scopes: grant().scopes,
      app_id: "A07OUROBOROS",
      app_version: SLACK_APP_MANIFEST_VERSION,
    });
    expect(stored.last_verified_at).toBeInstanceOf(Date);

    // Sealed: the stored value is the envelope, not the token — and it opens to the token,
    // bound to this connection's id.
    expect(stored.bot_token_sealed).toMatch(/^ouro\.v1\.[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(stored.bot_token_sealed).not.toContain(BOT_TOKEN);
    await expect(vault.decryptText(ORG, stored.id, stored.bot_token_sealed ?? "")).resolves.toBe(
      BOT_TOKEN,
    );

    expect(slack.exchanged).toEqual([
      expect.objectContaining({
        code: "code-1",
        redirectUri: "https://app.example.test/api/v1/slack/oauth/callback",
      }),
    ]);
  });

  it("lists the workspace's channels after the install", async () => {
    const { service, store } = setup();

    await service.complete(ORG, KEN.userId, "code-1");

    expect(
      store.channelRows.map((row) => `${row.channel_name}:${row.joined}:${row.member_count}`),
    ).toEqual(["ouroboros-loops:true:24", "helios-alerts:false:24"]);
  });

  it("audits the install with the workspace, version and scopes — and no token", async () => {
    const { service, audit, store } = setup();

    await service.complete(ORG, KEN.userId, "code-1");

    expect(audit.events).toEqual([
      expect.objectContaining({
        organizationId: ORG,
        actorId: KEN.userId,
        action: "chat.connection_installed",
        subjectType: "chat_connection",
        subjectId: store.connections[0].id,
        detail: {
          workspaceId: TEAM,
          workspaceName: "acme-robotics",
          appId: "A07OUROBOROS",
          appVersion: SLACK_APP_MANIFEST_VERSION,
          scopes: grant().scopes.join(","),
        },
      }),
    ]);
    expect(JSON.stringify(audit.events)).not.toContain(BOT_TOKEN);
  });

  it("keeps the install when the channel listing fails — channels can be refreshed later", async () => {
    const { service, slack, store } = setup();
    slack.channelList = { ok: false, error: "ratelimited" };

    const connection = await service.complete(ORG, KEN.userId, "code-1");

    expect(connection.status).toBe("active");
    expect(store.channelRows).toEqual([]);
  });

  it("revives the same row on a re-install after a revocation, with a fresh seal", async () => {
    const { service, store } = setup();

    const first = await service.complete(ORG, KEN.userId, "code-1");
    await service.revoke(first, "app_uninstalled", "event");
    const again = await service.complete(ORG, KEN.userId, "code-2");

    expect(again.id).toBe(first.id);
    expect(store.connections).toHaveLength(1);
    expect(store.connections[0]).toMatchObject({ status: "active", status_detail: null });
    expect(store.connections[0].bot_token_sealed).not.toBeNull();
  });

  it("refuses a second Slack workspace while one is active, naming the first", async () => {
    const { service, slack, store } = setup();

    await service.complete(ORG, KEN.userId, "code-1");
    slack.exchange = { ok: true, grant: grant({ teamId: "T999ZZ", teamName: "acme-labs" }) };

    const error = await refusal(service.complete(ORG, KEN.userId, "code-2"));

    expect(error.code).toBe(SLACK_ERRORS.alreadyConnected);
    expect(error.getStatus()).toBe(409);
    expect(store.connections).toHaveLength(1);
  });

  it("turns the database's one-active rule into the same refusal under a race", async () => {
    const { service, slack, store } = setup();

    await service.complete(ORG, KEN.userId, "code-1");
    slack.exchange = { ok: true, grant: grant({ teamId: "T999ZZ", teamName: "acme-labs" }) };
    // The pre-check sees nothing active; the insert then meets the unique index.
    jest.spyOn(store, "connectionOf").mockResolvedValueOnce(undefined);

    expect((await refusal(service.complete(ORG, KEN.userId, "code-2"))).code).toBe(
      SLACK_ERRORS.alreadyConnected,
    );
  });

  it("is a 502 when Slack does not complete the exchange, and stores nothing", async () => {
    const { service, slack, store, audit } = setup();
    slack.exchange = { ok: false, error: "invalid_code" };

    const error = await refusal(service.complete(ORG, KEN.userId, "bad"));

    expect(error.code).toBe(SLACK_ERRORS.installFailed);
    expect(error.getStatus()).toBe(502);
    expect(store.connections).toEqual([]);
    expect(audit.events).toEqual([]);
  });

  it("is refused on a deployment with no Slack app", async () => {
    const { service } = setup({ slackClientId: undefined, slackClientSecret: undefined });

    expect((await refusal(service.complete(ORG, KEN.userId, "c"))).code).toBe(
      SLACK_ERRORS.notConfigured,
    );
  });
});

describe("verifying a connection", () => {
  it("unseals the token, asks Slack, stamps the verification and refreshes channels", async () => {
    const { service, slack, store } = setup();
    await service.complete(ORG, KEN.userId, "code-1");
    store.connections[0].last_verified_at = new Date(0);
    slack.tokensSeen.length = 0;

    await expect(service.verify(ORG)).resolves.toBe("verified");

    // Slack is called with the token itself, never the envelope.
    expect(slack.tokensSeen).toEqual([BOT_TOKEN, BOT_TOKEN]);
    expect(store.connections[0].last_verified_at.getTime()).toBeGreaterThan(0);
  });

  it.each(["invalid_auth", "token_revoked", "account_inactive"])(
    "flips the connection to revoked on %s, drops the dead token and audits it as nobody's act",
    async (error) => {
      const { service, slack, store, audit } = setup();
      await service.complete(ORG, KEN.userId, "code-1");
      slack.auth = { ok: false, error };

      await expect(service.verify(ORG)).resolves.toBe("revoked");

      expect(store.connections[0]).toMatchObject({
        status: "revoked",
        status_detail: error,
        bot_token_sealed: null,
      });
      expect(audit.events.at(-1)).toMatchObject({
        action: "chat.connection_revoked",
        actorId: null,
        detail: { reason: error, source: "auth.test" },
      });
    },
  );

  it("halts there: a revoked connection is not asked again, and nothing piles up", async () => {
    const { service, slack, audit } = setup();
    await service.complete(ORG, KEN.userId, "code-1");
    slack.auth = { ok: false, error: "token_revoked" };
    await service.verify(ORG);
    slack.tokensSeen.length = 0;
    const recorded = audit.events.length;

    await expect(service.verify(ORG)).resolves.toBe("not_connected");
    await expect(service.verify(ORG)).resolves.toBe("not_connected");

    expect(slack.tokensSeen).toEqual([]);
    expect(audit.events).toHaveLength(recorded);
  });

  it("leaves the connection active on a failure worth retrying", async () => {
    const { service, slack, store } = setup();
    await service.complete(ORG, KEN.userId, "code-1");
    slack.auth = { ok: false, error: "ratelimited" };

    await expect(service.verify(ORG)).resolves.toBe("unreachable");
    expect(store.connections[0].status).toBe("active");
  });

  it("says not_connected for a workspace that never installed", async () => {
    await expect(setup().service.verify(ORG)).resolves.toBe("not_connected");
  });
});

describe("revoking", () => {
  it("is idempotent: a redelivered uninstall event changes and records nothing more", async () => {
    const { service, audit } = setup();
    const connection = await service.complete(ORG, KEN.userId, "code-1");

    await service.revoke(connection, "app_uninstalled", "event");
    await service.revoke(connection, "app_uninstalled", "event");

    expect(audit.events.filter((event) => event.action === "chat.connection_revoked")).toHaveLength(
      1,
    );
  });

  it("does not treat an ordinary error as a revocation", async () => {
    const { service, store } = setup();
    const connection = await service.complete(ORG, KEN.userId, "code-1");

    await expect(
      service.noteFailure(connection, "channel_not_found", "chat.postMessage"),
    ).resolves.toBe(false);
    expect(store.connections[0].status).toBe("active");
  });

  it("yields no token for a revoked connection", async () => {
    const { service } = setup();
    const connection = await service.complete(ORG, KEN.userId, "code-1");
    await service.revoke(connection, "token_revoked", "event");

    await expect(service.botToken(connection.id)).resolves.toBeUndefined();
  });
});
