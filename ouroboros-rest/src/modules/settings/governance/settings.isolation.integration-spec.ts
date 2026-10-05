/**
 * Tenant isolation on every settings-owned route (BR.6,
 * [#490](https://github.com/NobuData/ouroboros/issues/490)) — the workspace card, auto-merge,
 * members, invitations and capabilities, service accounts, the audit plane and its export,
 * webhooks and their deliveries, notification routes, retention, the integrations hub, the GitHub
 * token, the workspace lifecycle, and the autonomy policy with its dry-run switch.
 *
 * Their workspace holds one of everything — a second member, a pending invitation, a service
 * account, a webhook endpoint with a dead-lettered delivery, an enabled notification route, a
 * retention tier, a GitHub token, a tenant domain, a published policy, audit events, and a paused
 * lifecycle — every human-readable value of it carrying the word **theirs**. Mine is an owner's
 * workspace with a webhook endpoint of its own. Each route makes two claims:
 *
 *   * **in mine** — aimed at their object by id it answers that module's `*_not_found`; a read
 *     says nothing of theirs (no "theirs" anywhere in the body); a write lands in mine only;
 *   * **in theirs, by header** — the same request naming their workspace in `X-Ouro-Tenant` is
 *     `404 tenant_not_found`, because I am not a member there.
 *
 * After every case their whole workspace — every row of every table that names it — is what it
 * was before the first one. `HAS A CLAIM FOR EVERY SETTINGS ROUTE` compares the claims with the
 * router's own list, so a settings route added without one fails here, naming itself.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/settings/governance/settings.isolation
 * ```
 */

import {
  ApiHarness,
  type Method,
  type Person,
  type Workspace,
} from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import type { AuditPlanePage } from "../../audit-plane/audit-plane.resources";
import { routeTable } from "../../auth/route.table.fixture";
import { SCHEMA_NAME } from "../../db/schema";
import { FIXTURE_ROTATED_TOKEN, FIXTURE_TOKEN, FIXTURE_MASK } from "../../github/github.fixture";
import type { LifecycleResource } from "../../lifecycle/lifecycle.resources";
import type { MembersPageResource } from "../../members/members.resources";
import type { PathPreviewResource } from "../../policies/path-preview.service";
import type { PolicyVersionListResource } from "../../policies/policy-history.service";
import type { PolicyPreviewResource, PolicyResource } from "../../policies/policy-publish.service";
import type { RetentionSettingsResource } from "../../retention/retention.resources";
import type { ServiceAccountSecretResource } from "../../service-accounts/service-accounts.resources";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import { WebhookDispatcher } from "../../webhooks/webhook.dispatcher";
import type { HostResolver } from "../../webhooks/webhook.ssrf";
import { WEBHOOK_RESOLVER, WEBHOOK_TRANSPORT } from "../../webhooks/webhook.transport";
import type {
  WebhookDeliveryPageResource,
  WebhookSecretResource,
} from "../../webhooks/webhooks.resources";
import { ScriptedTransport } from "../../webhooks/webhooks.store.fixture";
import type { AutoMergeResource } from "../resources";
import type { WorkspaceSettingsResource } from "../workspace.resources";

const SETTINGS = "/api/v1/settings";
const POLICIES = "/api/v1/policies";

/** The word every value of their workspace carries, and nothing of mine does. */
const THEIRS = /theirs/i;

/** Their tenant domain — which mine may not take. */
const THEIR_DOMAIN = "theirs.example.com";

/** Every name resolves to a public address: no case here is about SSRF. */
const resolver: HostResolver = () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]);

/**
 * Mockup 17's `policy v7`, as `schemas/org-policy/fixtures/valid/policy-v7.json` — their policy.
 *
 * @param perRunCapCents - The spend guard's per-run cap, so mine can differ.
 * @returns The document.
 */
function policyDocument(perRunCapCents: number): Record<string, unknown> {
  return {
    auto_merge: {
      enabled: true,
      conditions: { all: [{ effort_lte: "m" }, { not: { label: "refactor" } }] },
    },
    human_review: {
      enabled: true,
      conditions: { any: [{ label: "refactor" }, { effort_gte: "l" }] },
    },
    protected_paths: {
      enabled: true,
      conditions: { path_globs: ["boot/**", "keys/**", ".github/**"] },
    },
    spend_guard: {
      enabled: true,
      conditions: { per_run_cap_cents: perRunCapCents, monthly_cap_cents: 60000 },
    },
    dry_run_new_repos: { enabled: true, conditions: { first_n_loops: 10 } },
  };
}

/** What one route's isolation claim is. */
interface IsolationCase {
  /** What the claim says, for the test's name. */
  readonly about: string;
  /** The request, aimed at their objects — what the by-header claim replays in their workspace. */
  readonly path: () => string;
  /** The body the request carries, if any. */
  readonly body?: () => object;
  /** The claim in my workspace. */
  readonly check: () => Promise<void>;
}

/** An error envelope's code. */
function codeOf(response: { body: unknown }): string {
  return (response.body as { code: string }).code;
}

describe("tenant isolation, on every settings route", () => {
  const transport = new ScriptedTransport();
  let api: ApiHarness;
  let me: Person;
  let mine: Workspace;
  let them: Person;
  let theirs: Workspace;
  let myHook: string;
  /** Their objects, by what the routes address them as. */
  const their = {
    memberId: "",
    invitationId: "",
    serviceAccountId: "",
    webhookId: "",
    deliveryId: "",
    auditCursor: "",
    auditIds: [] as string[],
  };
  /** How many lines their own export answered with. */
  let theirExportLines = 0;
  /** Their whole workspace, as it stood once seeded. */
  let baseline: Record<string, unknown>;

  /** A request as somebody, in a workspace named by header. */
  function call(person: Person, at: Workspace, method: Method, path: string) {
    return api.as(person)(method, path).set(TENANT_HEADER, at.slug);
  }

  /** A request as me, in my workspace. */
  const asMe = (method: Method, path: string) => call(me, mine, method, path);

  /** A request as them, in theirs — the seeding and the sanity check. */
  const asThem = (method: Method, path: string) => call(them, theirs, method, path);

  /**
   * Every row of every table that names their workspace, as JSON — the whole of "nothing of theirs
   * changed".
   *
   * Discovered from the catalogue, as the lifecycle purge's census is, so a table added next month
   * is covered without anybody remembering to. `session` is left out: it names a workspace only as
   * a person's active one, and the library touches it on every request they make. `last_used_at`
   * is a service token's read-side stamp, also left out.
   *
   * @returns Table name to its rows, ordered.
   */
  async function theirWorkspace(): Promise<Record<string, unknown>> {
    const { rows: columns } = await api.sql.query<{ table_name: string; column_name: string }>(
      `select c.table_name, c.column_name
         from information_schema.columns c
         join information_schema.tables t
           on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = $1 and t.table_type = 'BASE TABLE'
          and c.column_name in ('organization_id', 'organizationId')
          and c.table_name <> 'session'
        order by c.table_name`,
      [SCHEMA_NAME],
    );
    const snapshot: Record<string, unknown> = {};

    for (const { table_name: table, column_name: column } of columns) {
      const { rows } = await api.sql.query<{ rows: unknown }>(
        `select coalesce(jsonb_agg(to_jsonb(t) - 'last_used_at' order by to_jsonb(t)::text), '[]')
                as rows
           from ${SCHEMA_NAME}."${table}" t where t."${column}" = $1`,
        [theirs.id],
      );

      snapshot[table] = rows[0].rows;
    }

    const organization = await api.sql.query(
      `select "name", "slug", "metadata" from ${SCHEMA_NAME}.organization where "id" = $1`,
      [theirs.id],
    );

    snapshot.organization = organization.rows;

    return snapshot;
  }

  beforeAll(async () => {
    api = await ApiHarness.start(
      // The dispatcher stays out of the way; the seed drives it once, to dead-letter a delivery.
      { OURO_WEBHOOK_DISPATCH_SECONDS: "300", OURO_WEBHOOK_MAX_ATTEMPTS: "1" },
      [
        { provide: WEBHOOK_TRANSPORT, useValue: transport },
        { provide: WEBHOOK_RESOLVER, useValue: resolver },
      ],
    );

    them = await api.signIn({ displayName: "Theirs Owner" });
    theirs = await api.workspace(them, undefined, "Theirs Robotics");
    me = await api.signIn({ displayName: "Mine Owner" });
    mine = await api.workspace(me, undefined, "Mine Robotics");

    // Their webhook first, so every audited seed below fans out to it.
    their.webhookId = bodyOf<WebhookSecretResource>(
      await asThem("post", `${SETTINGS}/webhooks`)
        .send({
          name: "Theirs SIEM",
          url: "https://theirs-siem.example.com/hook",
          eventFamilies: ["audit.*"],
          siem: true,
        })
        .expect(201),
    ).endpoint.id;
    myHook = bodyOf<WebhookSecretResource>(
      await asMe("post", `${SETTINGS}/webhooks`)
        .send({ name: "Mine hook", url: "https://mine.example.com/hook", eventFamilies: ["run.*"] })
        .expect(201),
    ).endpoint.id;

    const admin = await api.signIn({ displayName: "Theirs Admin" });

    await api.join(theirs.id, admin, "admin");
    their.memberId =
      bodyOf<MembersPageResource>(
        await asThem("get", `${SETTINGS}/members`).expect(200),
      ).members.find((row) => row.userId === admin.id)?.id ?? "";
    their.invitationId = bodyOf<{ id: string }>(
      await asThem("post", `${SETTINGS}/members/invitations`)
        .send({ email: "theirs-invitee@example.test", role: "member" })
        .expect(201),
    ).id;
    their.serviceAccountId = bodyOf<ServiceAccountSecretResource>(
      await asThem("post", `${SETTINGS}/service-accounts`)
        .send({ name: "theirs-bot", scopes: ["api.read"] })
        .expect(201),
    ).account.id;
    await asThem("patch", `${SETTINGS}/notifications/daily_digest`)
      .send({
        enabled: true,
        config: { time: "06:45", recipients: ["theirs-digest@example.test"] },
      })
      .expect(200);
    await asThem("patch", `${SETTINGS}/retention`)
      .send({ classes: { audit: 120 } })
      .expect(200);
    await asThem("patch", `${SETTINGS}/auto-merge`).send({ enabled: true }).expect(200);
    await asThem("patch", `${SETTINGS}/workspace`).send({ domain: THEIR_DOMAIN }).expect(200);
    await asThem("put", `${SETTINGS}/github-token`).send({ token: FIXTURE_TOKEN }).expect(200);
    await asThem("patch", `${POLICIES}/dry-run`).send({ dryRun: true }).expect(200);
    await asThem("post", POLICIES)
      .send({ document: policyDocument(250), baseVersion: null, changeNote: "Theirs v1" })
      .expect(201);
    // An enabled repository of theirs — what a path preview of mine must never list (#494).
    await api.sql.query(
      `with org as (
         insert into ${SCHEMA_NAME}.github_orgs (organization_id, login, enabled)
         values ($1, 'theirs-robotics', true) returning id)
       insert into ${SCHEMA_NAME}.github_repos (org_id, name, enabled)
       select id, 'theirs-firmware', true from org`,
      [theirs.id],
    );
    await asThem("post", `${SETTINGS}/lifecycle/pause`).send({ confirm: true }).expect(200);

    // Every audited seed above fanned out to their SIEM; the receiver is down, and one attempt is
    // all this run allows — so each lands in their dead-letter queue.
    transport.fallback = { status: 503, body: "theirs: unavailable" };
    await api.nest.get(WebhookDispatcher, { strict: false }).tick(new Date(Date.now() + 1000));
    their.deliveryId =
      bodyOf<WebhookDeliveryPageResource>(
        await asThem(
          "get",
          `${SETTINGS}/webhooks/${their.webhookId}/deliveries?status=dead_lettered`,
        ).expect(200),
      ).items[0]?.id ?? "";

    their.auditCursor =
      bodyOf<AuditPlanePage>(await asThem("get", `${SETTINGS}/audit?limit=1`).expect(200))
        .nextCursor ?? "";
    // Their own export, which audits itself — so it is read here, before the baseline is taken.
    theirExportLines = (await asThem("get", exportPath()).expect(200)).text.split("\n").length;

    const audit = await api.sql.query<{ id: string }>(
      `select id from ${SCHEMA_NAME}.audit_events where organization_id = $1`,
      [theirs.id],
    );

    their.auditIds = audit.rows.map((row) => row.id);
    baseline = await theirWorkspace();
  });

  afterAll(async () => {
    await api.truncate();
    await api.close();
  });

  /**
   * A read in my workspace that says nothing of theirs.
   *
   * @param path - What to read.
   * @returns The body, for a case with more to say.
   */
  async function readsNothingOfTheirs(path: string): Promise<unknown> {
    const response = await asMe("get", path).expect(200);
    const text = response.text;

    expect(text).not.toMatch(THEIRS);
    for (const id of [theirs.id, them.id, ...Object.values(their).flat()]) {
      if (typeof id === "string" && id !== "") expect(text).not.toContain(id);
    }

    return response.body as unknown;
  }

  /**
   * A request in my workspace aimed at one of their objects, answered as if it did not exist.
   *
   * @param method - The verb.
   * @param path - The path, carrying their id.
   * @param code - The module's not-found code.
   * @param body - The body, if any.
   */
  async function notFoundInMine(
    method: Method,
    path: string,
    code: string,
    body: object = {},
  ): Promise<void> {
    const response = await asMe(method, path).send(body).expect(404);

    expect(codeOf(response)).toBe(code);
  }

  const CASES: Readonly<Record<string, IsolationCase>> = {
    // ── the audit plane — read first, before my own cases below write my trail ──────────────
    [`GET ${SETTINGS}/audit`]: {
      about: "lists none of their events, and their cursor replayed in mine yields none either",
      path: () => `${SETTINGS}/audit`,
      check: async () => {
        await readsNothingOfTheirs(`${SETTINGS}/audit`);

        const replayed = await asMe(
          "get",
          `${SETTINGS}/audit?cursor=${encodeURIComponent(their.auditCursor)}`,
        );

        // A cursor is a position, not a grant: in mine it is refused or pages mine.
        expect([200, 422]).toContain(replayed.status);
        if (replayed.status === 200) {
          const ids = bodyOf<AuditPlanePage>(replayed).items.map((item) => item.id);

          expect(ids.filter((id) => their.auditIds.includes(id))).toEqual([]);
        }
      },
    },
    [`GET ${SETTINGS}/audit/today`]: {
      about: "summarises none of their events",
      path: () => `${SETTINGS}/audit/today`,
      check: async () => {
        await readsNothingOfTheirs(`${SETTINGS}/audit/today`);
      },
    },
    [`GET ${SETTINGS}/audit/export.csv`]: {
      about: "exports none of their events",
      path: () => exportPath(),
      check: async () => {
        await readsNothingOfTheirs(exportPath());
      },
    },

    // ── the workspace card and auto-merge ──────────────────────────────────────────────────
    [`GET ${SETTINGS}/workspace`]: {
      about: "reads my name and no domain, not theirs",
      path: () => `${SETTINGS}/workspace`,
      check: async () => {
        const card = (await readsNothingOfTheirs(
          `${SETTINGS}/workspace`,
        )) as WorkspaceSettingsResource;

        expect(card.id).toBe(mine.id);
        expect(card.domain.value).toBeNull();
      },
    },
    [`PATCH ${SETTINGS}/workspace`]: {
      about: "renames mine only, and cannot take their domain",
      path: () => `${SETTINGS}/workspace`,
      body: () => ({ name: "Theirs Robotics renamed" }),
      check: async () => {
        await asMe("patch", `${SETTINGS}/workspace`)
          .send({ domain: THEIR_DOMAIN })
          .expect(409)
          .expect((response) => {
            expect(codeOf(response)).toBe("domain_taken");
          });
        await asMe("patch", `${SETTINGS}/workspace`).send({ name: "Mine Renamed" }).expect(200);
      },
    },
    [`GET ${SETTINGS}/auto-merge`]: {
      about: "reads my switch, off, not theirs, on",
      path: () => `${SETTINGS}/auto-merge`,
      check: async () => {
        const setting = (await readsNothingOfTheirs(`${SETTINGS}/auto-merge`)) as AutoMergeResource;

        expect(setting.enabled).toBe(false);
      },
    },
    [`PATCH ${SETTINGS}/auto-merge`]: {
      about: "flips my switch only",
      path: () => `${SETTINGS}/auto-merge`,
      body: () => ({ enabled: false }),
      check: async () => {
        await asMe("patch", `${SETTINGS}/auto-merge`).send({ enabled: false }).expect(200);
      },
    },

    // ── members, invitations and capabilities ──────────────────────────────────────────────
    [`GET ${SETTINGS}/members`]: {
      about: "lists none of their members, invitations or service accounts",
      path: () => `${SETTINGS}/members`,
      check: async () => {
        const page = (await readsNothingOfTheirs(`${SETTINGS}/members`)) as MembersPageResource;

        expect(page.members.map((row) => row.userId)).toEqual([me.id]);
      },
    },
    [`POST ${SETTINGS}/members/invitations`]: {
      about: "invites into mine only",
      path: () => `${SETTINGS}/members/invitations`,
      body: () => ({ email: "theirs-second@example.test", role: "member" }),
      check: async () => {
        await asMe("post", `${SETTINGS}/members/invitations`)
          .send({ email: "mine-invitee@example.test", role: "member" })
          .expect(201);
      },
    },
    [`POST ${SETTINGS}/members/invitations/:id/resend`]: {
      about: "cannot resend their invitation",
      path: () => `${SETTINGS}/members/invitations/${their.invitationId}/resend`,
      check: () =>
        notFoundInMine(
          "post",
          `${SETTINGS}/members/invitations/${their.invitationId}/resend`,
          "invitation_not_found",
        ),
    },
    [`DELETE ${SETTINGS}/members/invitations/:id`]: {
      about: "cannot revoke their invitation",
      path: () => `${SETTINGS}/members/invitations/${their.invitationId}`,
      check: () =>
        notFoundInMine(
          "delete",
          `${SETTINGS}/members/invitations/${their.invitationId}`,
          "invitation_not_found",
        ),
    },
    [`PATCH ${SETTINGS}/members/:memberId`]: {
      about: "cannot change their member's role or untick their capability",
      path: () => `${SETTINGS}/members/${their.memberId}`,
      body: () => ({ canApproveLoops: false }),
      check: async () => {
        await notFoundInMine(
          "patch",
          `${SETTINGS}/members/${their.memberId}`,
          "workspace_member_not_found",
          { canApproveLoops: false },
        );
        await notFoundInMine(
          "patch",
          `${SETTINGS}/members/${their.memberId}`,
          "workspace_member_not_found",
          { role: "member" },
        );
      },
    },
    [`DELETE ${SETTINGS}/members/:memberId`]: {
      about: "cannot remove their member",
      path: () => `${SETTINGS}/members/${their.memberId}`,
      check: () =>
        notFoundInMine(
          "delete",
          `${SETTINGS}/members/${their.memberId}`,
          "workspace_member_not_found",
        ),
    },

    // ── service accounts ────────────────────────────────────────────────────────────────────
    [`GET ${SETTINGS}/service-accounts`]: {
      about: "lists none of their service accounts",
      path: () => `${SETTINGS}/service-accounts`,
      check: async () => {
        await readsNothingOfTheirs(`${SETTINGS}/service-accounts`);
      },
    },
    [`POST ${SETTINGS}/service-accounts`]: {
      about: "creates in mine only, even under their account's name",
      path: () => `${SETTINGS}/service-accounts`,
      body: () => ({ name: "theirs-bot-2", scopes: ["api.read"] }),
      check: async () => {
        // Names are unique per workspace, so their name is free in mine.
        await asMe("post", `${SETTINGS}/service-accounts`)
          .send({ name: "theirs-bot", scopes: ["api.read"] })
          .expect(201);
        await api.sql.query(
          `delete from ${SCHEMA_NAME}.service_accounts where organization_id = $1 and name = $2`,
          [mine.id, "theirs-bot"],
        );
      },
    },
    [`POST ${SETTINGS}/service-accounts/:id/rotate`]: {
      about: "cannot rotate their service account's token",
      path: () => `${SETTINGS}/service-accounts/${their.serviceAccountId}/rotate`,
      check: () =>
        notFoundInMine(
          "post",
          `${SETTINGS}/service-accounts/${their.serviceAccountId}/rotate`,
          "service_account_not_found",
        ),
    },
    [`POST ${SETTINGS}/service-accounts/:id/revoke`]: {
      about: "cannot revoke their service account",
      path: () => `${SETTINGS}/service-accounts/${their.serviceAccountId}/revoke`,
      check: () =>
        notFoundInMine(
          "post",
          `${SETTINGS}/service-accounts/${their.serviceAccountId}/revoke`,
          "service_account_not_found",
        ),
    },

    // ── webhooks and their deliveries ───────────────────────────────────────────────────────
    [`GET ${SETTINGS}/webhooks`]: {
      about: "lists none of their endpoints, and counts none in the SIEM row",
      path: () => `${SETTINGS}/webhooks`,
      check: async () => {
        await readsNothingOfTheirs(`${SETTINGS}/webhooks`);
      },
    },
    [`POST ${SETTINGS}/webhooks`]: {
      about: "creates in mine only — their SIEM does not hold mine's SIEM slot",
      path: () => `${SETTINGS}/webhooks`,
      body: () => ({
        name: "Theirs second",
        url: "https://theirs-2.example.com/hook",
        eventFamilies: ["audit.*"],
      }),
      check: async () => {
        const created = bodyOf<WebhookSecretResource>(
          await asMe("post", `${SETTINGS}/webhooks`)
            .send({
              name: "Mine SIEM",
              url: "https://mine-siem.example.com/hook",
              eventFamilies: ["audit.*"],
              siem: true,
            })
            .expect(201),
        );

        await asMe("delete", `${SETTINGS}/webhooks/${created.endpoint.id}`).expect(204);
      },
    },
    [`GET ${SETTINGS}/webhooks/:id`]: {
      about: "cannot read their endpoint",
      path: () => `${SETTINGS}/webhooks/${their.webhookId}`,
      check: () =>
        notFoundInMine("get", `${SETTINGS}/webhooks/${their.webhookId}`, "webhook_not_found"),
    },
    [`PATCH ${SETTINGS}/webhooks/:id`]: {
      about: "cannot edit their endpoint",
      path: () => `${SETTINGS}/webhooks/${their.webhookId}`,
      body: () => ({ active: false }),
      check: () =>
        notFoundInMine("patch", `${SETTINGS}/webhooks/${their.webhookId}`, "webhook_not_found", {
          active: false,
          url: "https://mine.example.com/stolen",
        }),
    },
    [`DELETE ${SETTINGS}/webhooks/:id`]: {
      about: "cannot delete their endpoint",
      path: () => `${SETTINGS}/webhooks/${their.webhookId}`,
      check: () =>
        notFoundInMine("delete", `${SETTINGS}/webhooks/${their.webhookId}`, "webhook_not_found"),
    },
    [`POST ${SETTINGS}/webhooks/:id/rotate-secret`]: {
      about: "cannot rotate their endpoint's secret — no new secret is handed to me",
      path: () => `${SETTINGS}/webhooks/${their.webhookId}/rotate-secret`,
      check: () =>
        notFoundInMine(
          "post",
          `${SETTINGS}/webhooks/${their.webhookId}/rotate-secret`,
          "webhook_not_found",
        ),
    },
    [`POST ${SETTINGS}/webhooks/:id/ping`]: {
      about: "cannot ping their endpoint — nothing is sent",
      path: () => `${SETTINGS}/webhooks/${their.webhookId}/ping`,
      check: async () => {
        const sent = transport.requests.length;

        await notFoundInMine(
          "post",
          `${SETTINGS}/webhooks/${their.webhookId}/ping`,
          "webhook_not_found",
        );
        expect(transport.requests).toHaveLength(sent);
      },
    },
    [`GET ${SETTINGS}/webhooks/:id/deliveries`]: {
      about: "cannot read their delivery log",
      path: () => `${SETTINGS}/webhooks/${their.webhookId}/deliveries`,
      check: () =>
        notFoundInMine(
          "get",
          `${SETTINGS}/webhooks/${their.webhookId}/deliveries`,
          "webhook_not_found",
        ),
    },
    [`POST ${SETTINGS}/webhooks/:id/deliveries/:deliveryId/redeliver`]: {
      about: "cannot redeliver their dead letter — through their endpoint or through mine",
      path: () =>
        `${SETTINGS}/webhooks/${their.webhookId}/deliveries/${their.deliveryId}/redeliver`,
      check: async () => {
        await notFoundInMine(
          "post",
          `${SETTINGS}/webhooks/${their.webhookId}/deliveries/${their.deliveryId}/redeliver`,
          "webhook_not_found",
        );
        // My own endpoint, their delivery id: the delivery is looked up under my endpoint.
        await notFoundInMine(
          "post",
          `${SETTINGS}/webhooks/${myHook}/deliveries/${their.deliveryId}/redeliver`,
          "webhook_delivery_not_found",
        );
      },
    },

    // ── notification routes, retention, integrations, the GitHub token ─────────────────────
    [`GET ${SETTINGS}/notifications`]: {
      about: "reads my routes, not their enabled digest or its recipients",
      path: () => `${SETTINGS}/notifications`,
      check: async () => {
        await readsNothingOfTheirs(`${SETTINGS}/notifications`);
      },
    },
    [`GET ${SETTINGS}/notifications/:kind`]: {
      about: "reads my daily digest route, not theirs",
      path: () => `${SETTINGS}/notifications/daily_digest`,
      check: async () => {
        await readsNothingOfTheirs(`${SETTINGS}/notifications/daily_digest`);
      },
    },
    [`PATCH ${SETTINGS}/notifications/:kind`]: {
      about: "writes my route only",
      path: () => `${SETTINGS}/notifications/daily_digest`,
      body: () => ({ enabled: false }),
      check: async () => {
        await asMe("patch", `${SETTINGS}/notifications/daily_digest`)
          .send({ config: { time: "10:00" } })
          .expect(200);
      },
    },
    [`GET ${SETTINGS}/retention`]: {
      about: "reads my tiers, not their 120-day audit tier",
      path: () => `${SETTINGS}/retention`,
      check: async () => {
        const card = (await readsNothingOfTheirs(
          `${SETTINGS}/retention`,
        )) as RetentionSettingsResource;

        expect(card.classes.find((tier) => tier.dataClass === "audit")?.days).not.toBe(120);
      },
    },
    [`PATCH ${SETTINGS}/retention`]: {
      about: "writes my tier only",
      path: () => `${SETTINGS}/retention`,
      body: () => ({ classes: { audit: 90 } }),
      check: async () => {
        await asMe("patch", `${SETTINGS}/retention`)
          .send({ classes: { audit: 200 } })
          .expect(200);
      },
    },
    [`GET ${SETTINGS}/integrations`]: {
      about: "composes no tile from their token, sources or endpoints",
      path: () => `${SETTINGS}/integrations`,
      check: async () => {
        await readsNothingOfTheirs(`${SETTINGS}/integrations`);
      },
    },
    [`GET ${SETTINGS}/github-token`]: {
      about: "never shows their token's mask",
      path: () => `${SETTINGS}/github-token`,
      check: async () => {
        const text = (await asMe("get", `${SETTINGS}/github-token`).expect(200)).text;

        expect(text).not.toContain(FIXTURE_MASK);
      },
    },
    [`PUT ${SETTINGS}/github-token`]: {
      about: "stores my token only",
      path: () => `${SETTINGS}/github-token`,
      body: () => ({ token: FIXTURE_ROTATED_TOKEN }),
      check: async () => {
        await asMe("put", `${SETTINGS}/github-token`)
          .send({ token: FIXTURE_ROTATED_TOKEN })
          .expect(200);
      },
    },
    [`DELETE ${SETTINGS}/github-token`]: {
      about: "clears my token only",
      path: () => `${SETTINGS}/github-token`,
      check: async () => {
        await asMe("delete", `${SETTINGS}/github-token`).expect(200);
      },
    },

    // ── the workspace lifecycle ─────────────────────────────────────────────────────────────
    [`GET ${SETTINGS}/lifecycle`]: {
      about: "reads mine as active, not theirs as paused",
      path: () => `${SETTINGS}/lifecycle`,
      check: async () => {
        const state = bodyOf<LifecycleResource>(
          await asMe("get", `${SETTINGS}/lifecycle`).expect(200),
        );

        expect(state).toMatchObject({ state: "active", banner: null });
      },
    },
    [`POST ${SETTINGS}/lifecycle/pause`]: {
      about: "pauses mine only",
      path: () => `${SETTINGS}/lifecycle/pause`,
      body: () => ({ confirm: true }),
      check: async () => {
        await asMe("post", `${SETTINGS}/lifecycle/pause`).send({ confirm: true }).expect(200);
        await asMe("post", `${SETTINGS}/lifecycle/resume`).expect(200);
      },
    },
    [`POST ${SETTINGS}/lifecycle/resume`]: {
      about: "cannot resume theirs — mine is active, so there is nothing to resume",
      path: () => `${SETTINGS}/lifecycle/resume`,
      check: async () => {
        const refused = await asMe("post", `${SETTINGS}/lifecycle/resume`).expect(409);

        expect(codeOf(refused)).toBe("workspace_state_conflict");
      },
    },
    [`GET ${SETTINGS}/lifecycle/disconnect-preview`]: {
      about: "previews mine — none of their token, sources or runs",
      path: () => `${SETTINGS}/lifecycle/disconnect-preview`,
      check: async () => {
        const preview = (await readsNothingOfTheirs(
          `${SETTINGS}/lifecycle/disconnect-preview`,
        )) as { tokenStored: boolean };

        expect(preview.tokenStored).toBe(false);
      },
    },
    [`POST ${SETTINGS}/lifecycle/disconnect`]: {
      about: "disconnects mine only — their token stays",
      path: () => `${SETTINGS}/lifecycle/disconnect`,
      body: () => ({ confirm: true }),
      check: async () => {
        await asMe("post", `${SETTINGS}/lifecycle/disconnect`).send({ confirm: true }).expect(200);
        await asMe("post", `${SETTINGS}/lifecycle/resume`).expect(200);
      },
    },
    [`POST ${SETTINGS}/lifecycle/delete`]: {
      about: "typing their name deletes neither workspace",
      path: () => `${SETTINGS}/lifecycle/delete`,
      body: () => ({ confirmName: "Theirs Robotics" }),
      check: async () => {
        const refused = await asMe("post", `${SETTINGS}/lifecycle/delete`)
          .send({ confirmName: "Theirs Robotics" })
          .expect(422);

        expect(codeOf(refused)).toBe("workspace_name_mismatch");
      },
    },
    [`POST ${SETTINGS}/lifecycle/restore`]: {
      about: "restores nothing of theirs — mine is not pending deletion",
      path: () => `${SETTINGS}/lifecycle/restore`,
      check: async () => {
        const refused = await asMe("post", `${SETTINGS}/lifecycle/restore`).expect(409);

        expect(codeOf(refused)).toBe("workspace_state_conflict");
      },
    },

    // ── the autonomy policy and the dry-run switch ──────────────────────────────────────────
    [`GET ${POLICIES}`]: {
      about: "reads my policy, not their v1",
      path: () => POLICIES,
      check: async () => {
        const policy = (await readsNothingOfTheirs(POLICIES)) as PolicyResource;

        expect(policy.publishedBy).not.toBe(them.id);
      },
    },
    [`POST ${POLICIES}/preview`]: {
      about: "compares a draft with my policy, not theirs",
      path: () => `${POLICIES}/preview`,
      body: () => ({ document: policyDocument(100) }),
      check: async () => {
        const current = bodyOf<PolicyResource>(await asMe("get", POLICIES).expect(200));
        const preview = bodyOf<PolicyPreviewResource>(
          await asMe("post", `${POLICIES}/preview`)
            .send({ document: policyDocument(100) })
            .expect(200),
        );

        expect(preview.baseVersion).toBe(current.version);
      },
    },
    [`POST ${POLICIES}`]: {
      about: "publishes into mine only — their version does not move",
      path: () => POLICIES,
      body: () => ({ document: policyDocument(100), baseVersion: 1 }),
      check: async () => {
        const current = bodyOf<PolicyResource>(await asMe("get", POLICIES).expect(200));

        await asMe("post", POLICIES)
          .send({
            document: policyDocument(100 + (current.version ?? 0)),
            baseVersion: current.version,
            changeNote: "Mine",
          })
          .expect(201);
      },
    },
    [`GET ${POLICIES}/versions`]: {
      about: "lists my versions, not their v1 or its note",
      path: () => `${POLICIES}/versions`,
      check: async () => {
        const history = (await readsNothingOfTheirs(
          `${POLICIES}/versions`,
        )) as PolicyVersionListResource;

        expect(history.items.map((item) => item.publishedBy)).not.toContain(them.id);
      },
    },
    [`POST ${POLICIES}/path-preview`]: {
      about: "previews against my repositories, never listing theirs",
      path: () => `${POLICIES}/path-preview`,
      body: () => ({ globs: ["boot/**"] }),
      check: async () => {
        const response = await asMe("post", `${POLICIES}/path-preview`)
          .send({ globs: ["boot/**"] })
          .expect(200);

        expect(response.text).not.toMatch(THEIRS);
        // Mine has no enabled repository; theirs has one.
        expect(bodyOf<PathPreviewResource>(response)).toEqual({ repositories: [] });
      },
    },
    [`GET ${POLICIES}/dry-run`]: {
      about: "reads my dry-run switch, not theirs",
      path: () => `${POLICIES}/dry-run`,
      check: async () => {
        const policy = bodyOf<{ dryRun: boolean }>(
          await asMe("get", `${POLICIES}/dry-run`).expect(200),
        );

        // Theirs is on; mine never answered.
        expect(policy.dryRun).toBe(false);
      },
    },
    [`PATCH ${POLICIES}/dry-run`]: {
      about: "writes my dry-run switch only",
      path: () => `${POLICIES}/dry-run`,
      body: () => ({ dryRun: false }),
      check: async () => {
        await asMe("patch", `${POLICIES}/dry-run`).send({ dryRun: false }).expect(200);
      },
    },
  };

  /** The export's path, over a window that holds every seeded event. */
  function exportPath(): string {
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();

    return `${SETTINGS}/audit/export.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  }

  it("HAS A CLAIM FOR EVERY SETTINGS ROUTE THE APPLICATION REGISTERS", () => {
    const routes = routeTable(api.nest)
      .filter(
        (route) =>
          route.path.startsWith(`${SETTINGS}/`) ||
          route.path === POLICIES ||
          route.path.startsWith(`${POLICIES}/`),
      )
      .map((route) => route.signature)
      .sort();

    expect(routes).toEqual(Object.keys(CASES).sort());
  });

  it("has their side populated, so every claim below is about something that exists", async () => {
    const page = bodyOf<MembersPageResource>(
      await asThem("get", `${SETTINGS}/members`).expect(200),
    );

    expect(page.members.map((row) => row.id)).toContain(their.memberId);
    expect(page.invitations.map((row) => row.id)).toEqual([their.invitationId]);
    expect(page.serviceAccounts.map((row) => row.id)).toContain(their.serviceAccountId);
    expect(their.deliveryId).not.toBe("");
    expect(their.auditCursor).not.toBe("");
    expect(
      bodyOf<LifecycleResource>(await asThem("get", `${SETTINGS}/lifecycle`).expect(200)).state,
    ).toBe("paused");
    expect(bodyOf<PolicyResource>(await asThem("get", POLICIES).expect(200))).toMatchObject({
      version: 1,
      changeNote: "Theirs v1",
    });
    expect((await asThem("get", `${SETTINGS}/github-token`).expect(200)).text).toContain(
      FIXTURE_MASK,
    );
    expect(theirExportLines).toBeGreaterThan(2);
  });

  describe("each route holds the line", () => {
    it.each(
      Object.entries(CASES).map(([signature, value]) => [signature, value.about, value] as const),
    )("%s — %s", async (signature, _about, claim) => {
      await claim.check();

      // The same request, naming their workspace: I am not a member there.
      const method = signature.split(" ")[0].toLowerCase() as Method;
      const refused = await call(me, theirs, method, claim.path()).send(claim.body?.() ?? {});

      expect(refused.status).toBe(404);
      expect(codeOf(refused)).toBe("tenant_not_found");

      expect(await theirWorkspace()).toEqual(baseline);
    });
  });
});
