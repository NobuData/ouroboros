import type { AuditService } from "../audit/audit.service";
import type { AppConfigService } from "../config/config.service";
import type { DatabaseService } from "../db/db.service";
import type { ChatConnectionPublic } from "../db/schema";
import type { VaultService } from "../vault/vault.service";
import {
  FakeSlackApi,
  FakeSlackStore,
  FakeVault,
  KEN,
  MAYA,
  ORG,
  RecordingAudit,
  SLACK_KEN,
  SLACK_MAYA,
  slackConfig,
} from "./slack.fixture";
import { SlackInstallService } from "./slack.install.service";
import { LINK_TTL_MS, SlackLinkService, hashLinkToken, linkPath } from "./slack.link.service";
import type { SlackRepository } from "./slack.repository";

/**
 * The linking flow (#535, decision C4): a single-use, expiring deep link; a session; an explicit
 * confirmation — and an email match that suggests and never completes.
 */

/** A database that answers the one read the confirmation screen makes: the workspace's name. */
const database = {
  db: {
    selectFrom: () => ({
      select: () => ({
        where: () => ({ executeTakeFirst: () => Promise.resolve({ name: "Acme Robotics" }) }),
      }),
    }),
  },
} as unknown as DatabaseService;

/** The services over fakes, with Slack already installed. */
async function setup() {
  const slack = new FakeSlackApi();
  const store = new FakeSlackStore();
  const audit = new RecordingAudit();
  const config = slackConfig() as unknown as AppConfigService;
  const installs = new SlackInstallService(
    config,
    slack,
    store as unknown as SlackRepository,
    new FakeVault() as unknown as VaultService,
    audit as unknown as AuditService,
  );
  const links = new SlackLinkService(
    config,
    slack,
    store as unknown as SlackRepository,
    installs,
    audit as unknown as AuditService,
    database,
  );
  const connection: ChatConnectionPublic = await installs.complete(ORG, KEN.userId, "code");

  audit.events.length = 0;

  return { links, installs, slack, store, audit, connection };
}

/** The token an offered link carries. */
function tokenOf(offer: { kind: string; url?: string }): string {
  return (offer.url ?? "").split("/link/")[1] ?? "";
}

describe("offering a link", () => {
  it("issues a deep link on the UI origin and stores only the token's hash, for fifteen minutes", async () => {
    const { links, store, connection } = await setup();
    const before = Date.now();

    const offer = await links.offer(connection, SLACK_MAYA);
    const token = tokenOf(offer);

    expect(offer.kind).toBe("link");
    expect(offer).toHaveProperty("url", `https://app.example.test${linkPath(token)}`);
    expect(token).toMatch(/^ouro_lnk_[A-Za-z0-9_-]{43}$/);

    const row = store.links[0];
    expect(row).toMatchObject({
      state: "pending",
      platform_user_id: SLACK_MAYA,
      member_id: null,
      display_name_cache: "Maya Chen",
      link_token_hash: hashLinkToken(token),
    });
    // The token itself is nowhere in the row.
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.expires_at!.getTime() - before).toBeGreaterThanOrEqual(LINK_TTL_MS - 50);
    expect(row.expires_at!.getTime() - before).toBeLessThanOrEqual(LINK_TTL_MS + 5000);
  });

  it("replaces an earlier link: only the newest one names the handshake", async () => {
    const { links, store, connection } = await setup();

    const first = tokenOf(await links.offer(connection, SLACK_MAYA));
    const second = tokenOf(await links.offer(connection, SLACK_MAYA));

    expect(store.links).toHaveLength(1);
    expect((await links.page(first, MAYA)).status).toBe(404);
    expect((await links.page(second, MAYA)).status).toBe(200);
  });

  it("says already linked, and issues nothing, for somebody who is", async () => {
    const { links, connection, store } = await setup();
    await links.confirm(tokenOf(await links.offer(connection, SLACK_MAYA)), MAYA);

    await expect(links.offer(connection, SLACK_MAYA)).resolves.toEqual({ kind: "already_linked" });
    expect(store.links).toHaveLength(1);
  });

  it("still issues a link when Slack will not share the profile — by user id alone", async () => {
    const { links, slack, store, connection } = await setup();
    slack.profileError = "missing_scope";

    expect((await links.offer(connection, SLACK_MAYA)).kind).toBe("link");
    expect(store.links[0].display_name_cache).toBeNull();
  });
});

describe("the confirmation screen", () => {
  it("names the Slack identity and the account, and links nothing by being opened", async () => {
    const { links, store, connection, audit } = await setup();
    const token = tokenOf(await links.offer(connection, SLACK_MAYA));

    const page = await links.page(token, MAYA);

    expect(page.status).toBe(200);
    expect(page.html).toContain("Maya Chen");
    expect(page.html).toContain(SLACK_MAYA);
    expect(page.html).toContain("acme-robotics");
    expect(page.html).toContain(MAYA.email);
    expect(page.html).toContain("Acme Robotics");
    expect(page.html).toContain('<form method="post">');
    // Opening it — as a link scanner would — binds nothing.
    expect(store.links[0].state).toBe("pending");
    expect(audit.events).toEqual([]);
  });

  it("asks an anonymous visitor to sign in and return, without showing an account", async () => {
    const { links, connection } = await setup();
    const token = tokenOf(await links.offer(connection, SLACK_MAYA));

    const page = await links.page(token, undefined);

    expect(page.status).toBe(200);
    expect(page.html).toContain(
      `https://app.example.test/login?next=${encodeURIComponent(linkPath(token))}`,
    );
    expect(page.html).not.toContain('<form method="post">');
  });

  it("offers a matching email as a suggestion that still needs the button", async () => {
    const { links, connection, store } = await setup();
    // Ken's Slack profile carries his account's email.
    const token = tokenOf(await links.offer(connection, SLACK_KEN));

    const page = await links.page(token, KEN);

    expect(page.html).toContain("matches your account");
    expect(page.html).toContain("not proof");
    expect(page.html).toContain('<form method="post">');
    expect(store.links[0].state).toBe("pending");
  });

  it("says so when the emails do not match, and still lets the person confirm", async () => {
    const { links, connection } = await setup();
    const token = tokenOf(await links.offer(connection, SLACK_MAYA));

    const page = await links.page(token, MAYA);

    expect(page.html).toContain("does not match your account");
    expect(page.html).toContain('<form method="post">');
  });

  it.each([
    ["a token that was never issued", `ouro_lnk_${"a".repeat(43)}`],
    ["a malformed token", "not-a-token"],
    ["an empty token", ""],
  ])("is a 404 for %s", async (_label, token) => {
    const { links } = await setup();

    expect((await links.page(token, MAYA)).status).toBe(404);
  });

  it("is a 410 once the fifteen minutes are over", async () => {
    const { links, store, connection } = await setup();
    const token = tokenOf(await links.offer(connection, SLACK_MAYA));
    store.links[0].expires_at = new Date(Date.now() - 1000);

    expect((await links.page(token, MAYA)).status).toBe(410);
    expect((await links.confirm(token, MAYA)).status).toBe(410);
    expect(store.links[0].state).toBe("pending");
  });

  it("refuses somebody who is not a member of the workspace the app is installed in", async () => {
    const { links, connection, store } = await setup();
    const token = tokenOf(await links.offer(connection, SLACK_MAYA));
    const stranger = { userId: "user-stranger", name: "Sam", email: "sam@elsewhere.example" };

    expect((await links.page(token, stranger)).status).toBe(403);
    expect((await links.confirm(token, stranger)).status).toBe(403);
    expect(store.links[0].state).toBe("pending");
  });

  it("refuses when the app was removed while the link was open", async () => {
    const { links, installs, connection } = await setup();
    const token = tokenOf(await links.offer(connection, SLACK_MAYA));
    await installs.revoke(connection, "app_uninstalled", "event");

    expect((await links.page(token, MAYA)).status).toBe(409);
    expect((await links.confirm(token, MAYA)).status).toBe(409);
  });
});

describe("confirming", () => {
  it("binds the Slack identity to the signed-in member and audits it under their name", async () => {
    const { links, store, connection, audit } = await setup();
    const token = tokenOf(await links.offer(connection, SLACK_MAYA));

    const page = await links.confirm(token, MAYA);

    expect(page.status).toBe(200);
    expect(page.html).toContain("Your Slack identity is linked");
    expect(store.links[0]).toMatchObject({
      state: "linked",
      member_id: "mem-maya",
      verified_via: "oauth_session",
      link_token_hash: null,
      expires_at: null,
    });
    expect(audit.events).toEqual([
      expect.objectContaining({
        organizationId: ORG,
        actorId: MAYA.userId,
        action: "chat.identity_linked",
        subjectType: "chat_identity_link",
        subjectId: store.links[0].id,
        detail: {
          connectionId: connection.id,
          platformUserId: SLACK_MAYA,
          verifiedVia: "oauth_session",
        },
      }),
    ]);
  });

  it("records an email match as how the link was verified — after the confirmation, not instead of it", async () => {
    const { links, store, connection } = await setup();
    const token = tokenOf(await links.offer(connection, SLACK_KEN));

    await links.confirm(token, KEN);

    expect(store.links[0].verified_via).toBe("email_match_confirmed");
  });

  it("works once: the second use of the same link finds nothing", async () => {
    const { links, connection, audit } = await setup();
    const token = tokenOf(await links.offer(connection, SLACK_MAYA));

    expect((await links.confirm(token, MAYA)).status).toBe(200);
    expect((await links.confirm(token, MAYA)).status).toBe(404);
    expect((await links.page(token, MAYA)).status).toBe(404);
    expect(audit.events).toHaveLength(1);
  });

  it("refuses an anonymous POST with 401 and links nothing", async () => {
    const { links, store, connection, audit } = await setup();
    const token = tokenOf(await links.offer(connection, SLACK_MAYA));

    const page = await links.confirm(token, undefined);

    expect(page.status).toBe(401);
    expect(page.html).toContain("Nothing was linked");
    expect(store.links[0].state).toBe("pending");
    expect(audit.events).toEqual([]);
  });

  it("refuses an account that already has a Slack identity on this connection", async () => {
    const { links, connection, store } = await setup();
    await links.confirm(tokenOf(await links.offer(connection, SLACK_MAYA)), MAYA);
    const second = tokenOf(await links.offer(connection, "U07SECOND"));

    const page = await links.confirm(second, MAYA);

    expect(page.status).toBe(409);
    expect(page.html).toContain("already has a Slack identity");
    expect(store.links.find((row) => row.platform_user_id === "U07SECOND")!.state).toBe("pending");
  });
});

describe("unlinking", () => {
  it("revokes the link and keeps the row, audited as the person's own act", async () => {
    const { links, store, connection, audit } = await setup();
    await links.confirm(tokenOf(await links.offer(connection, SLACK_MAYA)), MAYA);
    audit.events.length = 0;

    await expect(links.unlink(connection, SLACK_MAYA)).resolves.toBe(true);

    // Revoked, not erased: who it was and how it was verified are still there.
    expect(store.links).toHaveLength(1);
    expect(store.links[0]).toMatchObject({
      state: "revoked",
      member_id: "mem-maya",
      user_id: MAYA.userId,
      verified_via: "oauth_session",
      revoked_by: MAYA.userId,
    });
    expect(store.links[0].revoked_at).toBeInstanceOf(Date);
    expect(audit.events).toEqual([
      expect.objectContaining({ action: "chat.identity_unlinked", actorId: MAYA.userId }),
    ]);
  });

  it("lets the same person link again afterwards, as a new row", async () => {
    const { links, store, connection } = await setup();
    await links.confirm(tokenOf(await links.offer(connection, SLACK_MAYA)), MAYA);
    await links.unlink(connection, SLACK_MAYA);

    const page = await links.confirm(tokenOf(await links.offer(connection, SLACK_MAYA)), MAYA);

    expect(page.status).toBe(200);
    expect(store.links.map((row) => row.state)).toEqual(["revoked", "linked"]);
  });

  it("changes nothing for somebody who is not linked, or only half-way", async () => {
    const { links, connection, audit } = await setup();
    await links.offer(connection, SLACK_MAYA);

    await expect(links.unlink(connection, SLACK_MAYA)).resolves.toBe(false);
    await expect(links.unlink(connection, "U07NOBODY")).resolves.toBe(false);
    expect(audit.events).toEqual([]);
  });
});
