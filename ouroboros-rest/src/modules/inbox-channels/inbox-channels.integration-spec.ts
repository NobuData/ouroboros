/**
 * The decision channels, against a migrated database, the real planes and a sandbox git host
 * (#463, BN.3). Each acceptance criterion on the application's own services:
 *
 *   - a decision with a PR ref posts exactly one comment; a retry or a redeploy-style re-sync does
 *     not post a second; resolution edits that comment to show the outcome and the actor;
 *   - a mirror failure is recorded and blocks nothing;
 *   - instant mails fire for `err` items only, each actionable row carrying one token per action;
 *   - a token link opens a confirm page and nothing executes on link-open (GET, and a HEAD
 *     prefetch); a non-sensitive token action executes from the page and returns a receipt;
 *   - a merge-class link demands the token's own signed-in person and refuses without one;
 *   - expired, used and revoked links render distinguishable pages; resolving an item revokes its
 *     outstanding tokens; a token issued to one person does not work for another;
 *   - preferences round-trip and the digest lands at the configured time;
 *   - the channel truth payload has no fake ✓.
 */

import request from "supertest";

import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import { SEEDED_PAYLOADS } from "../decisions/decision.kinds.fixture";
import { RecordingMailer } from "../mail/mail.fixture";
import { MAILER } from "../mail/mailer";
import {
  PrPlaneHosts,
  prPlaneScene,
  type PrPlaneScene,
} from "../pull-requests/pr-plane.integration.fixture";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { InMemoryPrHost } from "../ticket-sources/providers/in-memory.pr.fixture";
import type { ChannelsResource } from "./channels.truth";
import { DecisionMailService } from "./mail/decision-mail.service";
import { DecisionMirrorService } from "./mirror/mirror.service";
import type { NotificationPreferencesResource } from "./notifications/preferences.service";

/** Every action link in a mail's text part, by its action label. */
function links(text: string): Map<string, string> {
  const found = new Map<string, string>();

  for (const match of text.matchAll(
    /^ {2}([^:\n]+?)(?: \(asks you to sign in first\))?: \S+(\/api\/v1\/inbox\/answer\/ouro_act_[\w-]+)$/gm,
  )) {
    found.set(match[1] ?? "", match[2] ?? "");
  }

  return found;
}

/** The data-problem marker of a page, if any. */
const problem = (html: string) => /data-problem="([a-z_]+)"/.exec(html)?.[1];

/** Retry an assertion until it holds or a second passes. */
async function eventually<T>(read: () => Promise<T>, holds: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5000;
  let value = await read();

  while (!holds(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    value = await read();
  }

  return value;
}

describe("the decision channels, against a migrated database and a sandbox host", () => {
  const hosts = new PrPlaneHosts();
  const mailer = new RecordingMailer();
  let api: ApiHarness;
  let host: InMemoryPrHost;

  beforeAll(async () => {
    api = await ApiHarness.start(
      { OURO_RUN_CONTROL_SWEEP_SECONDS: "3600", OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" },
      [...hosts.overrides(), { provide: MAILER, useValue: mailer }],
    );
  });

  afterAll(() => api.close());

  beforeEach(() => {
    host = hosts.reset();
    mailer.sent.length = 0;
  });

  afterEach(() => api.truncate());

  /** @returns The application's registry. */
  const registry = () => api.nest.get(DecisionKindRegistry, { strict: false });

  /** @returns The application's mirror. */
  const mirror = () => api.nest.get(DecisionMirrorService, { strict: false });

  /** The PR's comments on the sandbox host. */
  const comments = (at: PrPlaneScene) =>
    host.ledger().comments.filter(([number]) => number === at.prNumber);

  /** File the run-needs-human card (err, not merge-class) about the scene's run and PR. */
  async function needsHuman(at: PrPlaneScene): Promise<string> {
    const { itemId } = await registry().emit({
      organizationId: at.org,
      kindId: "run_needs_human",
      payload: SEEDED_PAYLOADS.run_needs_human,
      refs: [
        { type: "run", id: at.runId, label: "loop #1" },
        { type: "pr", id: at.prId, label: `PR #${String(at.prNumber)}` },
      ],
      key: { plane: "runs", sourceRef: `run:${at.runId}` },
    });

    return itemId ?? "";
  }

  /** File the merge-approval card (err, merge-class) about the scene's PR. */
  async function mergeApproval(at: PrPlaneScene): Promise<string> {
    const { itemId } = await registry().emit({
      organizationId: at.org,
      kindId: "merge_approval",
      payload: SEEDED_PAYLOADS.merge_approval,
      refs: [
        { type: "run", id: at.runId, label: "loop #1" },
        { type: "pr", id: at.prId, label: `PR #${String(at.prNumber)}` },
      ],
      key: { plane: "pr.gates", sourceRef: `pr:${at.prId}` },
    });

    return itemId ?? "";
  }

  /** The instant mail's links for one person, once it has left. */
  async function mailedLinks(person: Person): Promise<Map<string, string>> {
    const mails = await eventually(
      () => Promise.resolve(mailer.to(person.email)),
      (sent) => sent.length > 0,
    );

    return links(mails[0]?.text ?? "");
  }

  describe("the GitHub mirror", () => {
    it("posts exactly one comment, never a second on retry, and edits it on resolution", async () => {
      const at = await prPlaneScene(api, host, "manual");
      const itemId = await needsHuman(at);

      await eventually(
        () => Promise.resolve(comments(at)),
        (found) => found.length === 1,
      );
      // A retry and a redeploy-style resync of an item already shown.
      await mirror().sync(itemId);
      await mirror().sweep();

      expect(comments(at)).toHaveLength(1);
      expect(comments(at)[0]?.[2]).toContain("**⚠ Needs you** · err");
      expect(comments(at)[0]?.[2]).toContain(`/inbox?item=${itemId}`);

      await registry().resolveFromSource({
        itemId,
        organizationId: at.org,
        settlement: "run_terminated",
        channel: "web",
      });

      const edited = await eventually(
        () => Promise.resolve(comments(at)),
        (found) => found[0]?.[2].includes("✓ Answered") === true,
      );

      expect(edited).toHaveLength(1);
      expect(edited[0]?.[2]).toContain("closed — settled elsewhere");

      const row = await api.sql.query<{ revision: number; shown_revision: number }>(
        `select revision, shown_revision from ${SCHEMA_NAME}.decision_channel_mirrors where item_id = $1`,
        [itemId],
      );

      expect(row.rows[0]).toEqual({ revision: 2, shown_revision: 2 });
    });

    it("records a host failure honestly and blocks nothing", async () => {
      const at = await prPlaneScene(api, host, "manual");

      host.refuse("upstream");
      const itemId = await needsHuman(at);
      const row = await eventually(
        () =>
          api.sql.query<{ last_error: string | null; attempts: number }>(
            `select last_error, attempts from ${SCHEMA_NAME}.decision_channel_mirrors where item_id = $1`,
            [itemId],
          ),
        (result) => (result.rows[0]?.attempts ?? 0) > 0,
      );

      expect(row.rows[0]?.last_error).toBeTruthy();
      expect(
        (
          await api.sql.query(
            `select 1 from ${SCHEMA_NAME}.decision_items where id = $1 and status = 'open'`,
            [itemId],
          )
        ).rows,
      ).toHaveLength(1);

      host.recover();
      await mirror().sweep();

      expect(comments(at)).toHaveLength(1);
    });
  });

  describe("email tokens", () => {
    it("opens a confirm page that executes nothing — GET or HEAD — then answers from it with a receipt", async () => {
      const at = await prPlaneScene(api, host, "manual");
      const itemId = await needsHuman(at);
      const mailed = await mailedLinks(at.owner);
      const cancel = mailed.get("Cancel loop") ?? "";

      expect([...mailed.keys()].sort()).toEqual(["Cancel loop", "Retry with note"]);

      const opened = await api.anonymous("get", cancel).expect(200);

      expect(opened.headers["content-type"]).toMatch(/^text\/html/);
      expect(opened.headers["cache-control"]).toBe("no-store");
      expect(opened.text).toContain("Take over a loop that needs a human?");
      await request(api.baseUrl).head(cancel).expect(200);

      const before = await api.sql.query(
        `select status from ${SCHEMA_NAME}.decision_items where id = $1`,
        [itemId],
      );

      expect(before.rows[0]).toEqual({ status: "open" });

      const answered = await api.anonymous("post", cancel).type("form").send("").expect(200);

      expect(answered.text).toContain("✓ Cancel loop");
      expect(answered.text).toContain("by email");

      const resolution = await api.sql.query<{
        action_id: string;
        channel: string;
        resolved_by_user: string;
      }>(
        `select action_id, channel, resolved_by_user from ${SCHEMA_NAME}.decision_resolutions where item_id = $1`,
        [itemId],
      );

      expect(resolution.rows[0]).toEqual({
        action_id: "cancel_run",
        channel: "email",
        resolved_by_user: at.owner.id,
      });

      // Used, and the other link revoked by the resolution: two different designed pages.
      const used = await api.anonymous("get", cancel).expect(410);
      const revoked = await api.anonymous("get", mailed.get("Retry with note") ?? "").expect(410);

      expect(problem(used.text)).toBe("used");
      expect(problem(revoked.text)).toBe("answered");
    });

    it("demands the token's own signed-in person for a merge-class action", async () => {
      const at = await prPlaneScene(api, host, "manual");
      const itemId = await mergeApproval(at);
      const approve = (await mailedLinks(at.owner)).get("Approve & merge") ?? "";
      const colleague = await api.signUp();

      await api.join(at.org, colleague, "admin");

      const signIn = await api.anonymous("get", approve).expect(200);

      expect(signIn.text).toContain("Sign in to confirm");
      expect(signIn.text).not.toContain("<form");

      const refused = await api.anonymous("post", approve).type("form").send("").expect(401);

      expect(refused.text).toContain("Nothing was done");

      const elsewhere = await api.as(colleague)("post", approve).type("form").send("").expect(403);

      expect(problem(elsewhere.text)).toBe("wrong_user");

      const confirm = await api.as(at.owner)("get", approve).expect(200);

      expect(confirm.text).toContain("<form");

      const done = await api.as(at.owner)("post", approve).type("form").send("").expect(200);

      expect(done.text).toContain("✓ Approve &amp; merge");
      expect(
        (
          await api.sql.query<{ channel: string }>(
            `select channel from ${SCHEMA_NAME}.decision_resolutions where item_id = $1`,
            [itemId],
          )
        ).rows,
      ).toEqual([{ channel: "email" }]);
    });

    it("revokes outstanding tokens the moment the item is answered in the browser", async () => {
      const at = await prPlaneScene(api, host, "manual");
      const itemId = await needsHuman(at);
      const cancel = (await mailedLinks(at.owner)).get("Cancel loop") ?? "";

      await api
        .as(at.owner)("post", `/api/v1/inbox/items/${itemId}/actions/cancel_run`)
        .set(TENANT_HEADER, at.bench.workspace.slug)
        .send({})
        .expect(200);

      const page = await api.anonymous("post", cancel).type("form").send("").expect(410);

      expect(problem(page.text)).toBe("answered");
    });

    it("renders an expired link as its own page", async () => {
      const at = await prPlaneScene(api, host, "manual");
      await needsHuman(at);
      const cancel = (await mailedLinks(at.owner)).get("Cancel loop") ?? "";

      // A token is fixed once minted (V096), so the clock is moved under it: the history trigger
      // is set aside for this one statement, as no application path could.
      const client = await api.sql.connect();

      try {
        await client.query("begin");
        await client.query(
          `alter table ${SCHEMA_NAME}.action_tokens disable trigger action_tokens_history`,
        );
        await client.query(
          `update ${SCHEMA_NAME}.action_tokens
              set created_at = now() - interval '3 days', expires_at = now() - interval '1 minute'`,
        );
        await client.query(
          `alter table ${SCHEMA_NAME}.action_tokens enable trigger action_tokens_history`,
        );
        await client.query("commit");
      } finally {
        client.release();
      }

      expect(problem((await api.anonymous("get", cancel).expect(410)).text)).toBe("expired");
    });

    it("mails warn and info items to nobody", async () => {
      const at = await prPlaneScene(api, host, "manual");

      await registry().emit({
        organizationId: at.org,
        kindId: "fact_review",
        payload: SEEDED_PAYLOADS.fact_review,
        refs: [],
        key: { plane: "facts", sourceRef: "fact:quiet:proposed" },
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(mailer.sent).toHaveLength(0);
    });

    it("answers a link that names no token with its 404 page", async () => {
      const page = await api
        .anonymous("get", `/api/v1/inbox/answer/ouro_act_0000000000000000_${"A".repeat(43)}`)
        .expect(404);

      expect(problem(page.text)).toBe("unknown");
    });
  });

  describe("preferences, the digest and the channel truth", () => {
    it("round-trips preferences and lands the digest at the configured time", async () => {
      const at = await prPlaneScene(api, host, "manual");
      const slug = at.bench.workspace.slug;
      const defaults = bodyOf<NotificationPreferencesResource>(
        await api
          .as(at.owner)("get", "/api/v1/inbox/notifications")
          .set(TENANT_HEADER, slug)
          .expect(200),
      );

      expect(defaults).toMatchObject({
        digest: { enabled: false, time: "09:00" },
        instant: { severity: "err" },
      });

      // Off for instants, so the only mail is the digest; due at this very minute.
      const now = new Date();
      const time = now.toISOString().slice(11, 16);
      const written = bodyOf<NotificationPreferencesResource>(
        await api
          .as(at.owner)("patch", "/api/v1/inbox/notifications")
          .set(TENANT_HEADER, slug)
          .send({ digestEnabled: true, digestTime: time, instantSeverity: "off" })
          .expect(200),
      );

      expect(written).toMatchObject({
        digest: { enabled: true, time },
        instant: { severity: "off" },
        isExplicit: true,
      });
      expect(
        bodyOf<NotificationPreferencesResource>(
          await api
            .as(at.owner)("get", "/api/v1/inbox/notifications")
            .set(TENANT_HEADER, slug)
            .expect(200),
        ),
      ).toEqual(written);

      await needsHuman(at);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(mailer.sent).toHaveLength(0);

      const report = await api.nest.get(DecisionMailService, { strict: false }).pass();

      expect(report.digestSent).toBe(1);
      expect(mailer.sent[0]?.subject).toMatch(/1 decision waiting/);
      expect(mailer.sent[0]?.text).toContain("Take over a loop that needs a human?");
      expect(mailer.sent[0]?.text).toContain("Resolved in the last day (0)");

      // Sent once for the slot.
      expect((await api.nest.get(DecisionMailService, { strict: false }).pass()).digestSent).toBe(
        0,
      );

      await api
        .as(at.owner)("patch", "/api/v1/inbox/notifications")
        .set(TENANT_HEADER, slug)
        .send({ digestTime: null })
        .expect(422);
    });

    it("tells the truth about every channel on a default install", async () => {
      const at = await prPlaneScene(api, host, "manual");
      const truth = bodyOf<ChannelsResource>(
        await api
          .as(at.owner)("get", "/api/v1/inbox/channels")
          .set(TENANT_HEADER, at.bench.workspace.slug)
          .expect(200),
      );

      expect(truth.channels.map(({ id, state, until }) => [id, state, until])).toEqual([
        ["slack", "unavailable-until", "Chat Ops"],
        ["email", "connected", null],
        ["push", "unavailable-until", "BP.2"],
        ["github", "connected", null],
      ]);
    });
  });
});
