/**
 * The identity link's lifecycle, against the listening application and a migrated database
 * (BZ.6, [#540](https://github.com/NobuData/ouroboros/issues/540)).
 *
 * A link is what turns a Slack user into a member with permissions, so everything a press or a
 * command may do rests on it. `slack.link.service.spec.ts` proves the service against a fake
 * store; this walks the whole path — `/ouro link` signed as Slack signs it, the reply's deep
 * link, the confirmation page, the session cookie, V132's unique indexes — and holds each
 * promise where it is kept:
 *
 *   - **nothing is linked by looking**: opening the page, anonymously or signed in, changes no row;
 *   - **single use, newest only, fifteen minutes**: a spent, replaced or expired token links nothing;
 *   - **consent is the signed-in person's own**: an anonymous or cross-site POST links nothing;
 *   - **the email match is an assist**: the page says whether it matches, and only the POST links;
 *   - **one identity per member, one member per identity** — refused by the service and by V132;
 *   - **unlinking keeps the record**: what was done while linked still names who did it.
 */

import { ACME, ChatBench } from "../../testing/chatops.bench.fixture";
import type { Person } from "../../testing/harness.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { REPLIES } from "./slack.inbound.service";

/** The identity-link row a suite reads back. */
interface LinkRow extends Record<string, unknown> {
  id: string;
  platform_user_id: string;
  user_id: string | null;
  member_id: string | null;
  state: string;
  verified_via: string | null;
  link_token_hash: string | null;
  expires_at: Date | null;
  revoked_at: Date | null;
}

/** The part of a `chat_commands` row attribution rests on. */
interface CommandRow extends Record<string, unknown> {
  id: string;
  command: string;
  outcome: string;
  platform_user_id: string | null;
  invoker_user_id: string | null;
  invoker_link_id: string | null;
  audit_event_id: string | null;
}

describe("linking a Slack identity", () => {
  let bench: ChatBench;

  beforeAll(async () => {
    bench = await ChatBench.start();
  });

  afterAll(() => bench.close());
  afterEach(() => bench.reset());

  /**
   * Every identity-link row, oldest first.
   *
   * @param slackUserId - Only this Slack user's rows, when given.
   * @returns The rows.
   */
  async function links(slackUserId?: string): Promise<LinkRow[]> {
    const { rows } = await bench.api.sql.query<LinkRow>(
      `select * from ${SCHEMA_NAME}.chat_identity_links
        where $1::text is null or platform_user_id = $1
        order by created_at, id`,
      [slackUserId ?? null],
    );

    return rows;
  }

  /**
   * The states of a Slack user's rows, oldest first.
   *
   * @param slackUserId - The Slack user.
   * @returns `["revoked", "linked"]`, say.
   */
  async function states(slackUserId: string): Promise<string[]> {
    return (await links(slackUserId)).map((row) => row.state);
  }

  /**
   * Type `/ouro <text>` as a Slack user and read what they were told.
   *
   * @param slackUserId - Who types it.
   * @param text - The text after `/ouro`.
   * @returns The reply's text.
   */
  function typed(slackUserId: string, text: string): Promise<string> {
    return bench.typed(ACME, slackUserId, text);
  }

  /**
   * A fresh link for a Slack user.
   *
   * @param slackUserId - Who asks.
   * @returns The link's path.
   */
  async function offered(slackUserId: string): Promise<string> {
    const { path } = await bench.linkOffer(ACME, slackUserId);

    if (path === undefined) {
      throw new Error(`/ouro link offered ${slackUserId} no link.`);
    }

    return path;
  }

  describe("the deep link", () => {
    it("is offered only to the person who typed it, and names the token's own route", async () => {
      await bench.connected();

      const { reply, path } = await bench.linkOffer(ACME, "U0KEN");

      expect(reply.body.response_type).toBe("ephemeral");
      expect(reply.body.text).toBe(REPLIES.linkOffer);
      expect(path).toMatch(/^\/api\/v1\/slack\/link\/[A-Za-z0-9_-]{20,}$/);

      // The token itself is nowhere in the database: only its hash is.
      const [row] = await links("U0KEN");

      expect(row).toMatchObject({ state: "pending", user_id: null, member_id: null });
      expect(row?.link_token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(path).not.toContain(row?.link_token_hash);
    });

    it("links nothing when it is only opened — signed in or not", async () => {
      const { owner } = await bench.connected();
      const path = await offered("U0KEN");

      const anonymous = await bench.api.anonymous("get", path).expect(200);
      const signedIn = await bench.api.as(owner)("get", path).expect(200);

      expect(anonymous.text).toContain("Sign in to link your Slack identity");
      expect(signedIn.text).toContain("Link this Slack identity to your account?");
      expect(signedIn.text).toContain("Nothing is linked until you press the button.");
      expect(await states("U0KEN")).toEqual(["pending"]);

      // And opening it did not spend it.
      await bench.api.as(owner)("post", path).expect(200);
      expect(await states("U0KEN")).toEqual(["linked"]);
    });

    it("works once: a second press links nothing and says the link is not valid", async () => {
      const { owner, workspace } = await bench.connected();
      const maya = await bench.member(workspace, "member", "Maya Chen");
      const path = await offered("U0KEN");

      const first = await bench.api.as(owner)("post", path).expect(200);

      expect(first.text).toContain("Your Slack identity is linked");

      // Replayed by the same person, and presented by somebody else who got hold of it.
      const again = await bench.api.as(owner)("post", path).expect(404);
      const stolen = await bench.api.as(maya)("post", path).expect(404);

      expect(again.text).toContain("This link is not valid");
      expect(stolen.text).toContain("This link is not valid");
      await bench.api.as(maya)("get", path).expect(404);

      const rows = await links();

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        platform_user_id: "U0KEN",
        user_id: owner.id,
        state: "linked",
        link_token_hash: null,
        expires_at: null,
      });
    });

    it("is replaced by a newer one: only the latest link works", async () => {
      const { owner } = await bench.connected();
      const older = await offered("U0KEN");
      const newer = await offered("U0KEN");

      expect(newer).not.toBe(older);
      await bench.api.as(owner)("post", older).expect(404);
      expect(await states("U0KEN")).toEqual(["pending"]);

      await bench.api.as(owner)("post", newer).expect(200);
      expect(await states("U0KEN")).toEqual(["linked"]);
    });

    it("expires: a lapsed link shows that it has, and links nothing", async () => {
      const { owner } = await bench.connected();
      const path = await offered("U0KEN");
      const [minted] = await links("U0KEN");

      // Fifteen minutes, give or take the test's own seconds.
      const lifetime = (minted?.expires_at?.getTime() ?? 0) - Date.now();

      expect(lifetime).toBeGreaterThan(14 * 60 * 1000);
      expect(lifetime).toBeLessThanOrEqual(15 * 60 * 1000);

      await bench.api.sql.query(
        `update ${SCHEMA_NAME}.chat_identity_links
            set expires_at = now() - interval '1 second' where id = $1`,
        [minted?.id],
      );

      const opened = await bench.api.as(owner)("get", path).expect(410);
      const pressed = await bench.api.as(owner)("post", path).expect(410);

      expect(opened.text).toContain("This link has expired");
      expect(pressed.text).toContain("This link has expired");
      expect(await states("U0KEN")).toEqual(["pending"]);

      // A new one is one command away, and works.
      await bench.link(ACME, "U0KEN", owner);
      expect(await states("U0KEN")).toEqual(["linked"]);
    });

    it("answers a token that never existed, or is not a token, as it answers a spent one", async () => {
      const { owner } = await bench.connected();
      const path = await offered("U0KEN");
      const forged = `${path.slice(0, -6)}AAAAAA`;

      for (const bad of [
        forged,
        "/api/v1/slack/link/not-a-token",
        "/api/v1/slack/link/%27%20or%201=1",
      ]) {
        const opened = await bench.api.as(owner)("get", bad).expect(404);

        expect(opened.text).toContain("This link is not valid");
        await bench.api.as(owner)("post", bad).expect(404);
      }

      expect(await states("U0KEN")).toEqual(["pending"]);
    });
  });

  describe("whose consent it takes", () => {
    it("refuses an anonymous press with the sign-in page, and links nothing", async () => {
      await bench.connected();

      const path = await offered("U0KEN");
      const pressed = await bench.api.anonymous("post", path).expect(401);

      expect(pressed.text).toContain("Sign in to link your Slack identity");
      expect(pressed.text).toContain(`/login?next=${encodeURIComponent(path)}`);
      expect(await states("U0KEN")).toEqual(["pending"]);
    });

    it.each(["cross-site", "same-site"])(
      "treats a %s post as nobody's, even with a session",
      async (site) => {
        const { owner } = await bench.connected();
        const path = await offered("U0KEN");

        const pressed = await bench.api
          .as(owner)("post", path)
          .set("Sec-Fetch-Site", site)
          .expect(401);

        expect(pressed.text).toContain("Sign in to link your Slack identity");
        expect(await states("U0KEN")).toEqual(["pending"]);

        // The same browser, from the page itself, does link.
        await bench.api.as(owner)("post", path).set("Sec-Fetch-Site", "same-origin").expect(200);
        expect(await states("U0KEN")).toEqual(["linked"]);
      },
    );

    it("refuses somebody who is not a member of the workspace the app is installed for", async () => {
      await bench.connected();

      const outsider = await bench.api.signIn({ displayName: "Olive Outsider" });
      const path = await offered("U0KEN");

      const opened = await bench.api.as(outsider)("get", path).expect(403);
      const pressed = await bench.api.as(outsider)("post", path).expect(403);

      expect(opened.text).toContain("You are not a member of that workspace");
      expect(pressed.text).toContain("You are not a member of that workspace");
      expect(await states("U0KEN")).toEqual(["pending"]);
    });

    it("binds the Slack user the link was minted for, and nobody else", async () => {
      const { owner, workspace } = await bench.connected();
      const maya = await bench.member(workspace, "member", "Maya Chen");
      const forKen = await offered("U0KEN");
      const forMaya = await offered("U0MAYA");

      // Each confirms the other's link: the identity bound is the token's, the account the session's.
      await bench.api.as(maya)("post", forKen).expect(200);

      expect(await links("U0KEN")).toMatchObject([{ state: "linked", user_id: maya.id }]);
      expect(await links("U0MAYA")).toMatchObject([{ state: "pending", user_id: null }]);

      await bench.api.as(owner)("post", forMaya).expect(200);

      expect(await links("U0MAYA")).toMatchObject([{ state: "linked", user_id: owner.id }]);
      expect(await links("U0SAM")).toEqual([]);
    });

    it("stops working when Slack is no longer connected", async () => {
      const { owner } = await bench.connected();
      const path = await offered("U0KEN");

      await bench.slack.emitEvent({
        type: "event_callback",
        team_id: ACME.id,
        event_id: "Ev0GONE",
        event: { type: "app_uninstalled" },
      });
      await bench.idle();

      const pressed = await bench.api.as(owner)("post", path).expect(409);

      expect(pressed.text).toContain("Slack is no longer connected");
      expect(await states("U0KEN")).toEqual(["pending"]);
    });
  });

  describe("the email on the Slack profile", () => {
    /**
     * A workspace whose owner's account has the address of a Slack profile.
     *
     * @param email - The account's address.
     * @returns The owner.
     */
    async function ownerWith(email: string): Promise<Person> {
      const owner = await bench.api.signIn({ displayName: "Maya Chen", email });
      const workspace = await bench.api.workspace(owner);

      await bench.install(owner, workspace, ACME);

      return owner;
    }

    it("is said to match — and still links nothing until the press, recorded as confirmed", async () => {
      // Folded: the profile's address and the account's differ only in case.
      const maya = await ownerWith("Maya@Acme-Robotics.dev");
      const path = await offered("U0MAYA");

      const opened = await bench.api.as(maya)("get", path).expect(200);

      expect(opened.text).toContain("The email on this Slack profile matches your account.");
      expect(opened.text).toContain("That is a suggestion, not proof");
      expect(await links("U0MAYA")).toMatchObject([
        { state: "pending", user_id: null, verified_via: null },
      ]);

      await bench.api.as(maya)("post", path).expect(200);

      expect(await links("U0MAYA")).toMatchObject([
        { state: "linked", user_id: maya.id, verified_via: "email_match_confirmed" },
      ]);

      const audited = await bench.rows<{ actor_id: string; detail: Record<string, unknown> }>(
        "audit_events",
        "action = 'chat.identity_linked'",
      );

      expect(audited).toHaveLength(1);
      expect(audited[0]?.actor_id).toBe(maya.id);
      expect(audited[0]?.detail).toMatchObject({
        platformUserId: "U0MAYA",
        verifiedVia: "email_match_confirmed",
      });
    });

    it("is said not to match, and the link is then on the session alone", async () => {
      const maya = await ownerWith("maya@acme-robotics.dev");
      // Ken's Slack profile, Maya's account.
      const path = await offered("U0KEN");

      const opened = await bench.api.as(maya)("get", path).expect(200);

      expect(opened.text).toContain("The email on this Slack profile does not match your account");
      expect(opened.text).not.toContain("matches your account.");

      await bench.api.as(maya)("post", path).expect(200);

      expect(await links("U0KEN")).toMatchObject([
        { state: "linked", user_id: maya.id, verified_via: "oauth_session" },
      ]);
    });

    it("never links on a matching email alone: the matching account that does not press stays unlinked", async () => {
      const maya = await ownerWith("maya@acme-robotics.dev");
      const path = await offered("U0MAYA");

      await bench.api.as(maya)("get", path).expect(200);
      await bench.api.as(maya)("get", path).expect(200);

      expect(await states("U0MAYA")).toEqual(["pending"]);
      // And Slack treats her as unlinked: a command is answered with the link prompt.
      expect(await typed("U0MAYA", "status")).toBe(REPLIES.needsLink);
      expect(
        (await bench.rows<CommandRow>("chat_commands")).map((row) => [
          row.outcome,
          row.invoker_user_id,
        ]),
      ).toEqual([["unlinked", null]]);
    });
  });

  describe("one identity per member, one member per identity", () => {
    it("says so when somebody already linked asks again, and mints nothing", async () => {
      const { owner } = await bench.connected();

      await bench.link(ACME, "U0KEN", owner);

      const { reply, path } = await bench.linkOffer(ACME, "U0KEN");

      expect(reply.body.text).toBe(REPLIES.alreadyLinked);
      expect(path).toBeUndefined();
      expect(await links("U0KEN")).toMatchObject([{ state: "linked", link_token_hash: null }]);
    });

    it("refuses a second Slack identity for an account that has one", async () => {
      const { owner } = await bench.connected();

      await bench.link(ACME, "U0KEN", owner);

      const second = await offered("U0SAM");
      const opened = await bench.api.as(owner)("get", second).expect(200);
      const pressed = await bench.api.as(owner)("post", second).expect(409);

      // The page cannot know yet; the press is where V132's index speaks.
      expect(opened.text).toContain("Link this Slack identity to your account?");
      expect(pressed.text).toContain("Your account already has a Slack identity");
      expect(await links("U0SAM")).toMatchObject([{ state: "pending", user_id: null }]);
      expect(await links("U0KEN")).toMatchObject([{ state: "linked", user_id: owner.id }]);
      expect(await bench.rows("audit_events", "action = 'chat.identity_linked'")).toHaveLength(1);
    });

    it("holds both rules in the database, whatever the service does", async () => {
      const { owner, workspace } = await bench.connected();
      const maya = await bench.member(workspace, "member", "Maya Chen");

      await bench.link(ACME, "U0KEN", owner);

      const [linked] = await links("U0KEN");
      const memberOf = async (person: Person): Promise<string> =>
        (
          await bench.rows<{ id: string }>("member", `"organizationId" = $1 and "userId" = $2`, [
            workspace.id,
            person.id,
          ])
        )[0]?.id ?? "";
      const plant = async (slackUserId: string, person: Person): Promise<unknown> =>
        bench.api.sql.query(
          `insert into ${SCHEMA_NAME}.chat_identity_links
             (organization_id, connection_id, platform_user_id, member_id, state, verified_via, linked_at)
           select organization_id, connection_id, $2, $3, 'linked', 'oauth_session', now()
             from ${SCHEMA_NAME}.chat_identity_links where id = $1`,
          [linked?.id, slackUserId, await memberOf(person)],
        );

      // The same Slack user, as a second member.
      await expect(plant("U0KEN", maya)).rejects.toMatchObject({
        constraint: "chat_identity_links_platform_user_key",
      });
      // The same member, from a second Slack user.
      await expect(plant("U0SAM", owner)).rejects.toMatchObject({
        constraint: "chat_identity_links_member_key",
      });

      expect(await links()).toHaveLength(1);
    });
  });

  describe("unlinking", () => {
    it("says there is nothing to unlink for somebody who never linked", async () => {
      await bench.connected();

      expect(await typed("U0KEN", "unlink")).toBe(REPLIES.notLinked);
      expect(await links()).toEqual([]);
    });

    it("keeps what was done under the link attributed, and stops anything new", async () => {
      const { owner } = await bench.connected();

      await bench.link(ACME, "U0KEN", owner);
      await typed("U0KEN", "status");
      await bench.idle();

      const [before] = await bench.rows<CommandRow>("chat_commands");
      const [link] = await links("U0KEN");
      const auditOf = async (id: string | null | undefined): Promise<string | null | undefined> =>
        (await bench.rows<{ actor_id: string | null }>("audit_events", "id = $1", [id]))[0]
          ?.actor_id;

      expect(before).toMatchObject({
        command: "status",
        platform_user_id: "U0KEN",
        invoker_user_id: owner.id,
        invoker_link_id: link?.id,
      });
      expect(before?.outcome).not.toBe("unlinked");
      expect(await auditOf(before?.audit_event_id)).toBe(owner.id);

      expect(await typed("U0KEN", "unlink")).toBe(REPLIES.unlinked);

      // The link is revoked and kept — by them, at a time — not deleted.
      const [revoked] = await links("U0KEN");

      expect(revoked).toMatchObject({ id: link?.id, state: "revoked", user_id: owner.id });
      expect(revoked?.revoked_at).not.toBeNull();
      expect(
        (
          await bench.rows<{ actor_id: string }>(
            "audit_events",
            "action = 'chat.identity_unlinked'",
          )
        ).map((row) => row.actor_id),
      ).toEqual([owner.id]);

      // What they did while linked is still theirs, on the row and in the audit log.
      const [after] = await bench.rows<CommandRow>("chat_commands", "id = $1", [before?.id]);

      expect(after).toEqual(before);
      expect(await auditOf(after?.audit_event_id)).toBe(owner.id);

      // And nothing new runs as them.
      expect(await typed("U0KEN", "status")).toBe(REPLIES.needsLink);
      await bench.idle();

      const attempts = await bench.rows<CommandRow>("chat_commands", "id <> $1", [before?.id]);

      expect(attempts).toMatchObject([
        {
          outcome: "unlinked",
          platform_user_id: "U0KEN",
          invoker_user_id: null,
          invoker_link_id: null,
        },
      ]);
      expect(await typed("U0KEN", "unlink")).toBe(REPLIES.notLinked);
    });

    it("can be undone: linking again makes a new link beside the revoked one", async () => {
      const { owner, workspace } = await bench.connected();
      const maya = await bench.member(workspace, "member", "Maya Chen");

      await bench.link(ACME, "U0KEN", owner);
      await typed("U0KEN", "unlink");

      // Free on both sides: the identity may go to somebody else, the account to another identity.
      await bench.link(ACME, "U0KEN", maya);
      await bench.link(ACME, "U0SAM", owner);

      expect(await links("U0KEN")).toMatchObject([
        { state: "revoked", user_id: owner.id },
        { state: "linked", user_id: maya.id },
      ]);
      expect(await links("U0SAM")).toMatchObject([{ state: "linked", user_id: owner.id }]);

      await typed("U0KEN", "status");
      await bench.idle();

      expect(await bench.rows<CommandRow>("chat_commands")).toMatchObject([
        { platform_user_id: "U0KEN", invoker_user_id: maya.id },
      ]);
    });
  });
});
