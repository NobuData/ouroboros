import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { OPENAI_COMPATIBLE_API_KEY_FIELD } from "../providers/adapters/openai-compatible.adapter";
import { BASE_URL_FIELD } from "../providers/provider.config";
import type { Page } from "../tenancy/pagination";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { ProviderConnectionResource } from "../provider-connections/resources";
import type { AuditEventResource } from "./audit.resources";

/**
 * The credential trail end to end — every one of AD.4's
 * ([#225](https://github.com/NobuData/ouroboros/issues/225)) acceptance criteria that only a
 * real database can answer.
 *
 * ---------------------------------------------------------------------------
 * **The provider is real, and it is a server this file starts** — the same stand-in
 * `provider-connections.integration-spec.ts` uses, and for the same reason: every operation
 * that writes an event turns on a *live* validation, so a suite that stubbed the adapter
 * would be arranging the very thing it is meant to observe. A refused rotation here is a real
 * `401` from a real socket.
 *
 * ---------------------------------------------------------------------------
 * **What only this suite can assert:**
 *
 *   * **Every operation writes exactly one row**, counted in the table rather than on a mock
 *     — the criterion's *verified in the harness*, taken literally.
 *   * **Append-only is enforced by the database.** `audit_events_no_update` refuses a
 *     revision even to the owner this suite connects as, and the grants are what a
 *     non-owner deployment gets. Both are asserted against `pg` directly, outside the
 *     application, because a rule the application merely declines to break is not a rule.
 *   * **The trail is organization-scoped.** A second workspace's events are unreachable
 *     through the endpoint, asserted by creating them and then failing to find them.
 *   * **`GET /api/v1/providers/audit` is the trail and not a connection named `audit`**,
 *     which is a claim about router registration order that only a running application can
 *     answer.
 *   * **No row carries secret material**, grepped over what the table actually holds — the
 *     bytes on disk rather than the object a builder returned.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

const PROVIDERS = "/api/v1/providers";
const TRAIL = "/api/v1/providers/audit";

/** The credential the stub provider accepts. */
const GOOD_KEY = "sk-int-0000-known-good-credential-Xq4A";

/** A second one, for the rotation that succeeds. */
const NEXT_KEY = "sk-int-0000-the-rotated-credential-7Kd2";

/** One the stub provider refuses with a `401`. */
const BAD_KEY = "sk-int-0000-this-key-is-not-accepted";

describe("the credential trail, against a migrated database and a live provider", () => {
  let api: ApiHarness;
  let provider: Server;
  let baseUrl: string;

  beforeAll(async () => {
    provider = createServer((request: IncomingMessage, response: ServerResponse) => {
      const authorization = request.headers.authorization;

      if (
        authorization !== undefined &&
        ![GOOD_KEY, NEXT_KEY].some((key) => authorization === `Bearer ${key}`)
      ) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "invalid api key" } }));
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: [] }));
    });

    await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port.toString()}/v1`;

    api = await ApiHarness.start();
  });

  afterAll(async () => {
    await api.close();
    await new Promise<void>((resolve, reject) => {
      provider.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(async () => {
    await api.truncate();
  });

  /** Somebody who signed up with a password, and a workspace they own. */
  async function owned(): Promise<{ owner: Person; space: Workspace }> {
    const owner = await api.signUp();

    return { owner, space: await api.workspace(owner) };
  }

  /** A request from somebody, acting in a workspace. */
  const acting =
    (person: Person, space: Workspace) =>
    (method: "get" | "post" | "patch" | "delete", path: string) =>
      api.as(person)(method, path).set(TENANT_HEADER, space.slug);

  /** The body an add sends. */
  const addBody = (secret: string = GOOD_KEY) => ({
    kind: "openai_compatible",
    displayName: "OpenAI-compatible · local vLLM",
    monthlyCapCents: 60_000,
    config: { [BASE_URL_FIELD]: baseUrl, [OPENAI_COMPATIBLE_API_KEY_FIELD]: secret },
  });

  /** Connect a provider and answer the resource. */
  async function connect(person: Person, space: Workspace): Promise<ProviderConnectionResource> {
    return bodyOf<ProviderConnectionResource>(
      await acting(person, space)("post", PROVIDERS).send(addBody()).expect(201),
    );
  }

  /** Every event a workspace has, read outside the application, oldest first. */
  async function storedEvents(organizationId: string) {
    const { rows } = await api.sql.query<{
      action: string;
      actor_id: string | null;
      subject_type: string;
      subject_id: string | null;
      ip: string | null;
      detail: Record<string, unknown>;
    }>(
      `select action, actor_id, subject_type, subject_id, host(ip) as ip, detail
         from ${SCHEMA_NAME}.audit_events
        where organization_id = $1
        order by occurred_at, id`,
      [organizationId],
    );

    return rows;
  }

  describe("every operation writes exactly one event", () => {
    it("records an add, a reveal, a rotation, three kinds of edit and a delete", async () => {
      const { owner, space } = await owned();
      const connection = await connect(owner, space);
      const path = `${PROVIDERS}/${connection.id}`;

      await acting(owner, space)("post", `${path}/reveal`).send({}).expect(200);
      await acting(owner, space)("post", `${path}/rotate`).send({ secret: NEXT_KEY }).expect(200);
      await acting(owner, space)("patch", path).send({ enabled: false }).expect(200);
      await acting(owner, space)("patch", path).send({ monthlyCapCents: 90_000 }).expect(200);
      await acting(owner, space)("patch", path).send({ displayName: "vLLM" }).expect(200);
      await acting(owner, space)("delete", path).expect(204);

      expect((await storedEvents(space.id)).map((event) => event.action)).toEqual([
        "provider.added",
        "provider.revealed",
        "provider.rotated",
        "provider.disabled",
        "provider.cap_changed",
        "provider.updated",
        "provider.deleted",
      ]);
    });

    it("records a refused add, which wrote no connection to name", async () => {
      // AD.4's criterion covers the failure paths. Nothing reached
      // `provider_connections` — that is AD.2's own guarantee — so `subject_id` is null,
      // which is why V022 gives that column no foreign key.
      const { owner, space } = await owned();

      await acting(owner, space)("post", PROVIDERS).send(addBody(BAD_KEY)).expect(422);

      const events = await storedEvents(space.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ action: "provider.added", subject_id: null });
      expect(events[0].detail).toMatchObject({
        outcome: "failure",
        reason: "provider_validation_failed",
      });
    });

    it("records a refused rotation, and the old credential is still the one that works", async () => {
      // *A failed rotation is still an event* — the criterion's own words. Both the success
      // and the refusal are `provider.rotated`; `outcome` is what tells them apart.
      const { owner, space } = await owned();
      const connection = await connect(owner, space);

      await acting(owner, space)("post", `${PROVIDERS}/${connection.id}/rotate`)
        .send({ secret: BAD_KEY })
        .expect(422);

      const events = await storedEvents(space.id);
      expect(events.map((event) => event.action)).toEqual(["provider.added", "provider.rotated"]);
      expect(events[1].detail).toMatchObject({ outcome: "failure" });
    });

    it("attributes every event to the session's own person", async () => {
      const { owner, space } = await owned();

      await connect(owner, space);

      expect((await storedEvents(space.id))[0].actor_id).toBe(owner.id);
    });

    it("records the address the request arrived from", async () => {
      // Loopback, because Supertest reaches the application over one. What this asserts is
      // that a *real* address reaches the column through the middleware and the
      // AsyncLocalStorage store, and that the `inet` type accepts what the normaliser
      // produced — a dual-stack listener would otherwise have written `::ffff:127.0.0.1`.
      const { owner, space } = await owned();

      await connect(owner, space);

      expect((await storedEvents(space.id))[0].ip).toMatch(/^(127\.0\.0\.1|::1)$/);
    });
  });

  describe("the trail endpoint", () => {
    it("is the trail rather than a connection whose id is the word audit", async () => {
      // A claim about router registration order, which only a running application answers.
      // `AuditModule` is imported before `ProviderConnectionsModule` for this; with the two
      // swapped, this request is `GET /api/v1/providers/{id}` and `ConnectionParams` refuses
      // it as a `422` on a route that exists.
      const { owner, space } = await owned();

      const page = bodyOf<Page<AuditEventResource>>(
        await acting(owner, space)("get", TRAIL).expect(200),
      );

      expect(page).toMatchObject({ items: [], total: 0, limit: 25, offset: 0 });
    });

    it("answers newest first, with the actor's name resolved", async () => {
      const { owner, space } = await owned();
      const connection = await connect(owner, space);

      await acting(owner, space)("post", `${PROVIDERS}/${connection.id}/reveal`)
        .send({})
        .expect(200);

      const page = bodyOf<Page<AuditEventResource>>(
        await acting(owner, space)("get", TRAIL).expect(200),
      );

      expect(page.items.map((event) => event.action)).toEqual([
        "provider.revealed",
        "provider.added",
      ]);
      expect(page.items[0].actorName).toBe(owner.displayName);
      expect(page.items[0].subjectId).toBe(connection.id);
    });

    it("filters by connection, by actor and by action", async () => {
      const { owner, space } = await owned();
      const connection = await connect(owner, space);

      await acting(owner, space)("patch", `${PROVIDERS}/${connection.id}`)
        .send({ enabled: false })
        .expect(200);

      const byAction = bodyOf<Page<AuditEventResource>>(
        await acting(owner, space)("get", `${TRAIL}?action=provider.disabled`).expect(200),
      );
      expect(byAction.total).toBe(1);
      expect(byAction.items[0].action).toBe("provider.disabled");

      const byConnection = bodyOf<Page<AuditEventResource>>(
        await acting(owner, space)("get", `${TRAIL}?connectionId=${connection.id}`).expect(200),
      );
      expect(byConnection.total).toBe(2);

      const byActor = bodyOf<Page<AuditEventResource>>(
        await acting(owner, space)("get", `${TRAIL}?actorId=${owner.id}`).expect(200),
      );
      expect(byActor.total).toBe(2);
    });

    it("counts the filtered set rather than the whole trail", async () => {
      // A `total` computed against a different set is a page count that lies.
      const { owner, space } = await owned();
      const connection = await connect(owner, space);

      await acting(owner, space)("patch", `${PROVIDERS}/${connection.id}`)
        .send({ enabled: false })
        .expect(200);

      const page = bodyOf<Page<AuditEventResource>>(
        await acting(owner, space)("get", `${TRAIL}?action=provider.added&limit=1`).expect(200),
      );

      expect(page).toMatchObject({ total: 1, limit: 1 });
    });

    it("refuses an action outside the vocabulary rather than answering an empty page", async () => {
      // `?action=provider.reveal` is a misspelling, not a finding — and an empty page would
      // tell somebody a workspace is clean when it has not been asked the right question.
      const { owner, space } = await owned();

      const refusal = bodyOf<ErrorEnvelope>(
        await acting(owner, space)("get", `${TRAIL}?action=provider.reveal`).expect(422),
      );

      expect(refusal.code).toBe("validation_failed");
    });

    it("is unreachable by a member, and by a viewer", async () => {
      // The one read in the providers surface that administrators alone may make. *Maya
      // revealed the Anthropic key at 14:02 from 198.51.100.61* is a fact about a colleague.
      const { owner, space } = await owned();

      await connect(owner, space);

      for (const role of ["member", "viewer"] as const) {
        const person = await api.signUp();

        await api.join(space.id, person, role);

        const refusal = bodyOf<ErrorEnvelope>(
          await acting(person, space)("get", TRAIL).expect(403),
        );

        expect(refusal.code).toBe("forbidden");
      }
    });

    it("cannot reach another workspace's events", async () => {
      // Organization-scoped, asserted by creating events somewhere else and failing to find
      // them — rather than by reading a `where` clause.
      const first = await owned();
      const second = await owned();

      await connect(first.owner, first.space);

      const page = bodyOf<Page<AuditEventResource>>(
        await acting(second.owner, second.space)("get", TRAIL).expect(200),
      );

      expect(page.total).toBe(0);
      expect(await storedEvents(first.space.id)).toHaveLength(1);
    });
  });

  describe("the table refuses what the API has no route for", () => {
    it("refuses an update, to the owner this suite connects as", async () => {
      // The half of the append-only posture a grant cannot enforce: this connection is the
      // database's owner, and a superuser bypasses every grant in the catalogue.
      const { owner, space } = await owned();

      await connect(owner, space);

      await expect(
        api.sql.query(
          `update ${SCHEMA_NAME}.audit_events set action = 'provider.deleted'
            where organization_id = $1`,
          [space.id],
        ),
      ).rejects.toMatchObject({ code: "23001" });
    });

    it("permits exactly one update — clearing an attribution — and nothing beside it", async () => {
      // The foreign key's own `on delete set null` is an UPDATE, so a trigger that refused
      // every one would be making people undeletable rather than making events immutable.
      // What happened cannot be rewritten; who did it can be forgotten.
      const { owner, space } = await owned();

      await connect(owner, space);

      await expect(
        api.sql.query(
          `update ${SCHEMA_NAME}.audit_events set actor_id = null where organization_id = $1`,
          [space.id],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });

      await expect(
        api.sql.query(
          `update ${SCHEMA_NAME}.audit_events set actor_id = $2 where organization_id = $1`,
          [space.id, owner.id],
        ),
      ).rejects.toMatchObject({ code: "23001" });
    });

    it("grants the application role select and insert and nothing else", async () => {
      // What a deployment that separates migrating from running actually gets. Asserted
      // through the catalogue rather than by reading the migration.
      const { rows } = await api.sql.query<{
        sel: boolean;
        ins: boolean;
        upd: boolean;
        del: boolean;
      }>(
        `select has_table_privilege('ouroboros_app', '${SCHEMA_NAME}.audit_events', 'select') as sel,
                has_table_privilege('ouroboros_app', '${SCHEMA_NAME}.audit_events', 'insert') as ins,
                has_table_privilege('ouroboros_app', '${SCHEMA_NAME}.audit_events', 'update') as upd,
                has_table_privilege('ouroboros_app', '${SCHEMA_NAME}.audit_events', 'delete') as del`,
      );

      expect(rows[0]).toEqual({ sel: true, ins: true, upd: false, del: false });
    });

    it("takes a workspace's trail with the workspace, which is why there is no delete trigger", async () => {
      const { owner, space } = await owned();

      await connect(owner, space);

      await expect(
        api.sql.query(`delete from ${SCHEMA_NAME}.organization where "id" = $1`, [space.id]),
      ).resolves.toMatchObject({ rowCount: 1 });

      expect(await storedEvents(space.id)).toHaveLength(0);
    });
  });

  describe("what the table never holds", () => {
    it("carries no credential, no fragment of one and no envelope", async () => {
      // The grep, over the bytes the table actually holds rather than over an object a
      // builder returned. Every substring of eight characters or more is looked for, because
      // a partial key in a table nothing prunes is a leak with extra steps.
      const { owner, space } = await owned();
      const connection = await connect(owner, space);

      await acting(owner, space)("post", `${PROVIDERS}/${connection.id}/reveal`)
        .send({})
        .expect(200);
      await acting(owner, space)("post", `${PROVIDERS}/${connection.id}/rotate`)
        .send({ secret: NEXT_KEY })
        .expect(200);
      await acting(owner, space)("post", `${PROVIDERS}/${connection.id}/rotate`)
        .send({ secret: BAD_KEY })
        .expect(422);

      const rendered = JSON.stringify(await storedEvents(space.id));

      for (const credential of [GOOD_KEY, NEXT_KEY, BAD_KEY]) {
        for (let length = credential.length; length >= 8; length -= 1) {
          for (let start = 0; start + length <= credential.length; start += 1) {
            expect(rendered).not.toContain(credential.slice(start, start + length));
          }
        }
      }

      expect(rendered).not.toContain("ouro.v1.");
    });

    it("holds only flat, scalar payloads, which is what makes that grep exhaustive", async () => {
      const { owner, space } = await owned();

      await connect(owner, space);

      for (const event of await storedEvents(space.id)) {
        for (const value of Object.values(event.detail)) {
          expect(value === null || typeof value !== "object").toBe(true);
        }
      }
    });
  });
});
