import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import {
  GITHUB_TOKEN_CLEARED_EVENT,
  GITHUB_TOKEN_ROTATED_EVENT,
  GITHUB_TOKEN_SET_EVENT,
} from "../audit/audit.events";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { isEnvelope } from "../vault/envelope";
import { ADMINISTRATORS } from "../tenancy/roles.guard";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { FIXTURE_ROTATED_TOKEN, FIXTURE_TOKEN } from "./github.fixture";
import type { GithubTokenResource } from "./github.resources";

/**
 * `/api/v1/settings/github-token`, over a socket and against a migrated database
 * ([#101](https://github.com/NobuData/ouroboros/issues/101)).
 *
 * Three of K.3's five criteria only exist end to end, and they are what this suite is for:
 *
 *   * **The role gate** — *only owner/admin can set, rotate or clear*. A member's `PUT` is a
 *     `403` that writes nothing; an admin's persists. The read carries the same gate, which
 *     is the one place this surface departs from `settings.controller.ts` and therefore the
 *     one worth proving over a socket.
 *   * **The token round trip** — set, then rotate, then clear, with the column read straight
 *     out of PostgreSQL at each step. What is asserted about the column is what V027
 *     guarantees: it holds an envelope and never a token, and clearing removes the **row**
 *     rather than nulling it.
 *   * **The token is absent from every API response** — greped over the real bodies rather
 *     than over a resource this file composed, including the `422` a malformed token
 *     produces, which is the response most likely to echo what it refused.
 *
 * The fourth and fifth criteria — rate-limit backoff, and pagination without loading
 * everything — need no database and are held in `github.rate-limit.spec.ts` and
 * `github.client.spec.ts`, against a scripted GitHub rather than a real one.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The surface under test. */
const TOKEN = "/api/v1/settings/github-token";

describe("the GitHub token endpoint", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** The workspace's credential rows, straight from the table. */
  async function storedRows(
    workspaceId: string,
  ): Promise<{ token_encrypted: string; created_at: Date; updated_at: Date }[]> {
    const { rows } = await api.sql.query<{
      token_encrypted: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `select token_encrypted, created_at, updated_at
         from ouroboros.github_credentials where organization_id = $1`,
      [workspaceId],
    );

    return rows;
  }

  /** The workspace's trail, oldest first. */
  async function auditActions(workspaceId: string): Promise<string[]> {
    const { rows } = await api.sql.query<{ action: string }>(
      `select action from ouroboros.audit_events
        where organization_id = $1 order by occurred_at, id`,
      [workspaceId],
    );

    return rows.map((row) => row.action);
  }

  describe("who may ask", () => {
    it("refuses a stranger", async () => {
      await api.anonymous("get", TOKEN).expect(401);
      await api.anonymous("put", TOKEN).expect(401);
      await api.anonymous("delete", TOKEN).expect(401);
    });

    it("asks a session acting in no workspace to choose one", async () => {
      const nomad = await api.signIn();

      const response = await api.as(nomad)("get", TOKEN).expect(400);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("organization_required");
    });
  });

  describe("the role gate", () => {
    it("refuses a member's write with the API's one 403, and stores nothing", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);
      const member = await api.signIn();
      await api.join(workspace.id, member, "member");

      const response = await api
        .as(member)("put", TOKEN)
        .set(TENANT_HEADER, workspace.slug)
        .send({ token: FIXTURE_TOKEN })
        .expect(403);

      const envelope = bodyOf<ErrorEnvelope>(response);
      expect(envelope.code).toBe("forbidden");
      expect(envelope.details).toEqual({ role: "member", required: [...ADMINISTRATORS] });
      expect(await storedRows(workspace.id)).toEqual([]);
    });

    it("refuses a viewer the read as well as the write", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);
      const viewer = await api.signIn();
      await api.join(workspace.id, viewer, "viewer");

      // The departure from the auto-merge surface, over a socket: a viewer looking at that
      // switch learns a policy, and a viewer looking at this learns that a credential exists,
      // when it was last rotated and its last four characters.
      await api.as(viewer)("get", TOKEN).set(TENANT_HEADER, workspace.slug).expect(403);
      await api.as(viewer)("delete", TOKEN).set(TENANT_HEADER, workspace.slug).expect(403);
    });

    it("lets an admin set one, not only an owner", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);
      const admin = await api.signIn();
      await api.join(workspace.id, admin, "admin");

      const resource = bodyOf<GithubTokenResource>(
        await api
          .as(admin)("put", TOKEN)
          .set(TENANT_HEADER, workspace.slug)
          .send({ token: FIXTURE_TOKEN })
          .expect(200),
      );

      expect(resource.configured).toBe(true);
      expect(await storedRows(workspace.id)).toHaveLength(1);
    });
  });

  describe("the round trip", () => {
    it("reads not-configured for a workspace that has none, without a 404", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      const resource = bodyOf<GithubTokenResource>(
        await api.as(owner)("get", TOKEN).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      expect(resource).toEqual({
        configured: false,
        masked: null,
        createdAt: null,
        updatedAt: null,
      });
      expect(await storedRows(workspace.id)).toEqual([]);
    });

    it("stores a sealed token and answers the mask", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      const resource = bodyOf<GithubTokenResource>(
        await api
          .as(owner)("put", TOKEN)
          .set(TENANT_HEADER, workspace.slug)
          .send({ token: FIXTURE_TOKEN })
          .expect(200),
      );

      expect(resource.masked).toBe("ghp_••••6789");

      const [row] = await storedRows(workspace.id);
      // V027's guarantee, observed: the column holds an envelope, and a plaintext could not
      // have been stored even if this service had tried.
      expect(isEnvelope(row.token_encrypted)).toBe(true);
      expect(row.token_encrypted).not.toContain(FIXTURE_TOKEN.slice(4, 20));
    });

    it("reads the same mask back on a later request", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      await api
        .as(owner)("put", TOKEN)
        .set(TENANT_HEADER, workspace.slug)
        .send({ token: FIXTURE_TOKEN })
        .expect(200);

      const resource = bodyOf<GithubTokenResource>(
        await api.as(owner)("get", TOKEN).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      // Which is the whole of the no-suffix-column decision working: the mask is derived from
      // the stored ciphertext on every read, so there is nothing that can fall out of step.
      expect(resource.masked).toBe("ghp_••••6789");
      expect(resource.configured).toBe(true);
    });

    it("replaces the token on a second write, and moves updated_at past created_at", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      await api
        .as(owner)("put", TOKEN)
        .set(TENANT_HEADER, workspace.slug)
        .send({ token: FIXTURE_TOKEN })
        .expect(200);
      const [first] = await storedRows(workspace.id);

      const resource = bodyOf<GithubTokenResource>(
        await api
          .as(owner)("put", TOKEN)
          .set(TENANT_HEADER, workspace.slug)
          .send({ token: FIXTURE_ROTATED_TOKEN })
          .expect(200),
      );

      const [second] = await storedRows(workspace.id);
      expect(resource.masked).toBe("ghp_••••ytre");
      expect(second.token_encrypted).not.toBe(first.token_encrypted);
      // One row, still — set and rotate are the same upsert on the same primary key.
      expect(await storedRows(workspace.id)).toHaveLength(1);
      // The half `constraints.sql` cannot assert: it runs in one transaction, where `now()`
      // is a single instant, so *updated_at moves past created_at* is only observable across
      // two real requests — which is what makes it answerable without a `rotated_at` column.
      expect(second.updated_at.getTime()).toBeGreaterThan(second.created_at.getTime());
    });

    it("clears by deleting the row rather than nulling the column", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      await api
        .as(owner)("put", TOKEN)
        .set(TENANT_HEADER, workspace.slug)
        .send({ token: FIXTURE_TOKEN })
        .expect(200);

      const resource = bodyOf<GithubTokenResource>(
        await api.as(owner)("delete", TOKEN).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      expect(resource.configured).toBe(false);
      // "This workspace has no token" is the absence of a row: one state to read rather than
      // two that mean the same thing.
      expect(await storedRows(workspace.id)).toEqual([]);
    });

    it("succeeds when there was nothing to clear, because that is the outcome asked for", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      await api.as(owner)("delete", TOKEN).set(TENANT_HEADER, workspace.slug).expect(200);
    });

    it("keeps one workspace's token out of another's answer", async () => {
      const owner = await api.signIn();
      const first = await api.workspace(owner);
      const second = await api.workspace(owner);

      await api
        .as(owner)("put", TOKEN)
        .set(TENANT_HEADER, first.slug)
        .send({ token: FIXTURE_TOKEN })
        .expect(200);

      const resource = bodyOf<GithubTokenResource>(
        await api.as(owner)("get", TOKEN).set(TENANT_HEADER, second.slug).expect(200),
      );

      expect(resource.configured).toBe(false);
    });
  });

  describe("the trail", () => {
    it("records a set, a rotation and a clear as three different events", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      await api
        .as(owner)("put", TOKEN)
        .set(TENANT_HEADER, workspace.slug)
        .send({ token: FIXTURE_TOKEN })
        .expect(200);
      await api
        .as(owner)("put", TOKEN)
        .set(TENANT_HEADER, workspace.slug)
        .send({ token: FIXTURE_ROTATED_TOKEN })
        .expect(200);
      await api.as(owner)("delete", TOKEN).set(TENANT_HEADER, workspace.slug).expect(200);

      expect(await auditActions(workspace.id)).toEqual([
        GITHUB_TOKEN_SET_EVENT,
        GITHUB_TOKEN_ROTATED_EVENT,
        GITHUB_TOKEN_CLEARED_EVENT,
      ]);
    });

    it("puts no token in the trail's own payload", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      await api
        .as(owner)("put", TOKEN)
        .set(TENANT_HEADER, workspace.slug)
        .send({ token: FIXTURE_TOKEN })
        .expect(200);

      const { rows } = await api.sql.query<{ detail: unknown }>(
        `select detail from ouroboros.audit_events where organization_id = $1`,
        [workspace.id],
      );

      expect(JSON.stringify(rows)).not.toContain(FIXTURE_TOKEN.slice(4, 20));
    });
  });

  describe("what a refusal says", () => {
    it("refuses a value that is not shaped like a token, naming the field", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      const response = await api
        .as(owner)("put", TOKEN)
        .set(TENANT_HEADER, workspace.slug)
        .send({ token: "https://github.com/nobudata/ouroboros" })
        .expect(422);

      const envelope = bodyOf<ErrorEnvelope>(response);
      expect(envelope.code).toBe("validation_failed");
      expect(Object.keys(envelope.details)).toEqual(["token"]);
    });

    it("never echoes the value it refused", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      // The response most likely to leak a credential: a real token pasted into a body that
      // is wrong for some other reason. A message that echoed the field would put it in the
      // body, the browser's console and whatever collects client errors.
      const response = await api
        .as(owner)("put", TOKEN)
        .set(TENANT_HEADER, workspace.slug)
        .send({ token: `${FIXTURE_TOKEN}!` })
        .expect(422);

      expect(JSON.stringify(bodyOf<ErrorEnvelope>(response))).not.toContain(
        FIXTURE_TOKEN.slice(4, 20),
      );
    });

    it("refuses a body carrying anything the DTO does not declare", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      await api
        .as(owner)("put", TOKEN)
        .set(TENANT_HEADER, workspace.slug)
        .send({ token: FIXTURE_TOKEN, organizationId: "somebody-else" })
        .expect(422);
    });
  });
});
