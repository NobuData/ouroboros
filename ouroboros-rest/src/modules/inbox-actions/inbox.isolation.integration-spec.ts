/**
 * Organization isolation on every Needs-You route (#465, BN.5) — the queue, the feed, the resolved
 * history, the stat card, the policy card, the channel rows, the notification preferences, snooze,
 * the action executor and the emailed confirm page.
 *
 * Their workspace holds one of everything: an open card, a snoozed card, an answered card, a
 * protected path, a git host, the preferences of a person who belongs to both workspaces, and a
 * live action token. Mine is an owner's workspace with none of it — and every route, aimed at
 * their objects, answers as if they do not exist, and changes nothing of theirs.
 *
 * `HAS A CLAIM FOR EVERY INBOX ROUTE` compares the claims with the router's own list, so an inbox
 * route added without one fails here, naming itself.
 */

import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { routeTable } from "../auth/route.table.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import { SEEDED_PAYLOADS } from "../decisions/decision.kinds.fixture";
import type { InboxFeedResource } from "../decisions/inbox.feed";
import type {
  InboxQueueResource,
  InboxResolvedResource,
  InboxStatsResource,
} from "../decisions/inbox.queue";
import type { ChannelsResource } from "../inbox-channels/channels.truth";
import type { NotificationPreferencesResource } from "../inbox-channels/notifications/preferences.service";
import { ActionTokenService } from "../inbox-channels/tokens/action-token.service";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { PolicyCardResource } from "../inbox-policies/inbox-policies.compose";

const INBOX = "/api/v1/inbox";

/** What one route's isolation claim is. */
interface IsolationCase {
  readonly about: string;
  readonly check: () => Promise<void>;
}

describe("organization isolation, on every inbox route", () => {
  let api: ApiHarness;
  let me: Person;
  let mine: Workspace;
  let them: Person;
  let theirs: Workspace;
  let theirOpen: string;
  let theirSnoozed: string;
  let theirToken: string;

  /** File a card in a workspace. */
  async function file(org: string, key: string): Promise<string> {
    const { itemId } = await api.nest.get(DecisionKindRegistry, { strict: false }).emit({
      organizationId: org,
      kindId: "fact_review",
      payload: SEEDED_PAYLOADS.fact_review,
      refs: [],
      key: { plane: "facts", sourceRef: `fact:${key}:proposed` },
    });

    return itemId ?? "";
  }

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
    them = await api.signIn();
    theirs = await api.workspace(them);
    me = await api.signIn();
    mine = await api.workspace(me);
    // They also belong to my workspace, so one person's preferences exist in both.
    await api.join(mine.id, them, "member");

    theirOpen = await file(theirs.id, "open");
    theirSnoozed = await file(theirs.id, "snoozed");
    const answered = await file(theirs.id, "answered");

    await api.sql.query(
      `update ${SCHEMA_NAME}.decision_items set status = 'snoozed', snoozed_until = now() + interval '1 day',
              snoozed_by = $2 where id = $1`,
      [theirSnoozed, them.id],
    );
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.decision_resolutions
              (item_id, organization_id, action_id, resolver, resolved_by_user, channel)
       values ($1, $2, 'confirm', 'human', $3, 'web')`,
      [answered, theirs.id, them.id],
    );
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name, config)
       values ($1, 'github', 'GitHub', '{"login": "acme", "repos": ["helios"]}'::jsonb)`,
      [theirs.id],
    );
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.protected_path_policies (organization_id, repo_ref, path_glob)
       values ($1, 'acme/helios', 'boot/**')`,
      [theirs.id],
    );
    await api
      .as(them)("patch", `${INBOX}/notifications`)
      .set(TENANT_HEADER, theirs.slug)
      .send({ digestEnabled: true, digestTime: "07:30", mutedKinds: ["fact_review"] })
      .expect(200);
    theirToken = await api.nest
      .get(ActionTokenService, { strict: false })
      .mint(theirs.id, theirOpen, "confirm", them.id, "email");
  });

  afterAll(async () => {
    await api.truncate();
    await api.close();
  });

  /** A request as me, in my workspace. */
  function as(method: "get" | "post" | "patch", path: string) {
    return api.as(me)(method, path).set(TENANT_HEADER, mine.slug);
  }

  /** One of their items' status and attempts — a refused mutation changed nothing. */
  async function theirItem(id: string) {
    const item = await api.sql.query<{ status: string }>(
      `select status from ${SCHEMA_NAME}.decision_items where id = $1`,
      [id],
    );
    const attempts = await api.sql.query(
      `select 1 from ${SCHEMA_NAME}.decision_action_attempts where item_id = $1`,
      [id],
    );

    return { status: item.rows[0]?.status, attempts: attempts.rows.length };
  }

  /** Their preferences as stored. */
  async function theirPreferences() {
    const { rows } = await api.sql.query<{ digest_enabled: boolean; muted_kinds: string[] }>(
      `select digest_enabled, muted_kinds from ${SCHEMA_NAME}.notification_preferences
        where organization_id = $1 and user_id = $2`,
      [theirs.id, them.id],
    );

    return rows[0];
  }

  const CASES: Readonly<Record<string, IsolationCase>> = {
    [`GET ${INBOX}`]: {
      about: "queues none of another workspace's cards, open or snoozed",
      check: async () => {
        const queue = bodyOf<InboxQueueResource>(await as("get", INBOX).expect(200));

        expect(queue.items).toEqual([]);
        expect(queue.snoozed).toEqual([]);
      },
    },
    [`GET ${INBOX}/feed`]: {
      about: "counts none of another workspace's cards in the pill",
      check: async () => {
        const feed = bodyOf<InboxFeedResource>(await as("get", `${INBOX}/feed`).expect(200));

        expect(feed).toMatchObject({ open: 0, snoozed: 0 });
      },
    },
    [`GET ${INBOX}/resolved`]: {
      about: "lists none of another workspace's answers",
      check: async () => {
        const resolved = bodyOf<InboxResolvedResource>(
          await as("get", `${INBOX}/resolved`).expect(200),
        );

        expect(resolved.rows).toEqual([]);
        expect(resolved.previousDay).toBeNull();
      },
    },
    [`GET ${INBOX}/stats`]: {
      about: "counts none of another workspace's answers in the stat card",
      check: async () => {
        const stats = bodyOf<InboxStatsResource>(await as("get", `${INBOX}/stats`).expect(200));

        expect(stats.display.decisions).toBe("—");
      },
    },
    [`GET ${INBOX}/policies`]: {
      about: "derives no row from another workspace's protected paths",
      check: async () => {
        const card = bodyOf<PolicyCardResource>(await as("get", `${INBOX}/policies`).expect(200));

        expect(JSON.stringify(card)).not.toContain("boot/**");
      },
    },
    [`GET ${INBOX}/channels`]: {
      about: "counts no git host of another workspace as connected",
      check: async () => {
        const truth = bodyOf<ChannelsResource>(await as("get", `${INBOX}/channels`).expect(200));

        expect(truth.channels.find((row) => row.id === "github")?.state).toBe("available");
      },
    },
    [`GET ${INBOX}/notifications`]: {
      about: "reads a person's defaults here, not their preferences in another workspace",
      check: async () => {
        const read = bodyOf<NotificationPreferencesResource>(
          await api
            .as(them)("get", `${INBOX}/notifications`)
            .set(TENANT_HEADER, mine.slug)
            .expect(200),
        );

        expect(read).toMatchObject({
          isExplicit: false,
          mutedKinds: [],
          digest: { enabled: false },
        });
      },
    },
    [`PATCH ${INBOX}/notifications`]: {
      about: "writes a person's preferences here and leaves another workspace's untouched",
      check: async () => {
        await api
          .as(them)("patch", `${INBOX}/notifications`)
          .set(TENANT_HEADER, mine.slug)
          .send({ digestEnabled: false, mutedKinds: [] })
          .expect(200);

        expect(await theirPreferences()).toEqual({
          digest_enabled: true,
          muted_kinds: ["fact_review"],
        });
      },
    },
    [`POST ${INBOX}/items/:id/snooze`]: {
      about: "cannot snooze another workspace's card",
      check: async () => {
        await as("post", `${INBOX}/items/${theirOpen}/snooze`).send({ minutes: 60 }).expect(404);

        expect((await theirItem(theirOpen)).status).toBe("open");
      },
    },
    [`POST ${INBOX}/snooze-all`]: {
      about: "snoozes none of another workspace's cards",
      check: async () => {
        await as("post", `${INBOX}/snooze-all`).send({}).expect(200);

        expect((await theirItem(theirOpen)).status).toBe("open");
      },
    },
    [`POST ${INBOX}/items/:id/unsnooze`]: {
      about: "cannot wake another workspace's snoozed card",
      check: async () => {
        await as("post", `${INBOX}/items/${theirSnoozed}/unsnooze`).send({}).expect(404);

        expect((await theirItem(theirSnoozed)).status).toBe("snoozed");
      },
    },
    [`POST ${INBOX}/unsnooze-all`]: {
      about: "wakes none of another workspace's snoozed cards",
      check: async () => {
        await as("post", `${INBOX}/unsnooze-all`).send({}).expect(200);

        expect((await theirItem(theirSnoozed)).status).toBe("snoozed");
      },
    },
    [`POST ${INBOX}/items/:id/actions/:actionId`]: {
      about: "cannot answer another workspace's card — no attempt, no plane call",
      check: async () => {
        const refused = await as("post", `${INBOX}/items/${theirOpen}/actions/confirm`)
          .send({})
          .expect(404);

        expect(bodyOf<{ code: string }>(refused).code).toBe("decision_item_not_found");
        expect(await theirItem(theirOpen)).toEqual({ status: "open", attempts: 0 });
      },
    },
    [`GET ${INBOX}/answer/:token`]: {
      about: "shows another person's emailed card to nobody else signed in",
      check: async () => {
        const page = await as("get", `${INBOX}/answer/${theirToken}`).expect(403);

        expect(page.text).toContain('data-problem="wrong_user"');
        expect(page.text).not.toContain("Should the loops trust this fact?");
      },
    },
    [`POST ${INBOX}/answer/:token`]: {
      about: "answers nothing with another person's emailed link, and leaves it unspent",
      check: async () => {
        await as("post", `${INBOX}/answer/${theirToken}`).type("form").send("").expect(403);

        const token = await api.sql.query<{ used_at: Date | null }>(
          `select used_at from ${SCHEMA_NAME}.action_tokens where item_id = $1`,
          [theirOpen],
        );

        expect(token.rows[0]?.used_at).toBeNull();
        expect(await theirItem(theirOpen)).toEqual({ status: "open", attempts: 0 });
      },
    },
  };

  it("HAS A CLAIM FOR EVERY INBOX ROUTE THE APPLICATION REGISTERS", () => {
    const routes = routeTable(api.nest)
      .filter((route) => route.path === INBOX || route.path.startsWith(`${INBOX}/`))
      .map((route) => route.signature)
      .sort();

    expect(routes).toEqual(Object.keys(CASES).sort());
  });

  it("has their side populated, so every claim below is about something that exists", async () => {
    const queue = bodyOf<InboxQueueResource>(
      await api.as(them)("get", INBOX).set(TENANT_HEADER, theirs.slug).expect(200),
    );
    const resolved = bodyOf<InboxResolvedResource>(
      await api.as(them)("get", `${INBOX}/resolved`).set(TENANT_HEADER, theirs.slug).expect(200),
    );

    expect(queue.items.map((item) => item.id)).toEqual([theirOpen]);
    expect(queue.snoozed.map((item) => item.id)).toEqual([theirSnoozed]);
    expect(resolved.rows).toHaveLength(1);
    expect(await theirPreferences()).toEqual({
      digest_enabled: true,
      muted_kinds: ["fact_review"],
    });
    expect((await api.as(them)("get", `${INBOX}/answer/${theirToken}`).expect(200)).text).toContain(
      "Should the loops trust this fact?",
    );
  });

  describe("each route holds the line", () => {
    it.each(
      Object.entries(CASES).map(
        ([signature, value]) => [signature, value.about, value.check] as const,
      ),
    )("%s — %s", async (_signature, _about, check) => {
      await check();
    });
  });
});
