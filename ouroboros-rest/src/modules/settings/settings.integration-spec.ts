import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import type { DashboardResource } from "../dashboard/resources";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { ADMINISTRATORS } from "../tenancy/roles.guard";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { AutoMergeResource } from "./resources";

/**
 * `/api/v1/settings/auto-merge`, over a socket and against a migrated database
 * ([#74](https://github.com/NobuData/ouroboros/issues/74)).
 *
 * Every one of the ticket's criteria only exists end to end, and they are what this suite
 * is for. **The role matrix**: a member's PATCH is a `403` that writes nothing, an
 * administrator's persists. **Lazy creation**: a workspace with no settings row reads
 * `false`, then writes cleanly — the first write is the row's creation. **Attribution**:
 * `updated_by` and `updated_at` are set on every write, in the row itself. **The ETag
 * contract**: a persisted flip is reflected in the next #70 poll, because the aggregate's
 * version fingerprints `workspace_settings`.
 *
 * One wording correction the ticket inherits from the roadmap diagram: the refusal's code
 * is `forbidden`, not `forbidden_role` — the API has exactly one `403` and one word for it
 * (`tenancy.errors.ts`), and a second word for the same refusal would be drift dressed as
 * precision. The roadmap records the correction.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The surface under test, and the aggregate whose tag must notice it. */
const SETTING = "/api/v1/settings/auto-merge";
const DASHBOARD = "/api/v1/dashboard";

describe("the auto-merge setting endpoint", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** The workspace's settings rows, straight from the table — what a refusal must not grow. */
  async function storedRows(
    workspaceId: string,
  ): Promise<{ auto_merge_on_checks: boolean; updated_by: string | null; updated_at: Date }[]> {
    const { rows } = await api.sql.query<{
      auto_merge_on_checks: boolean;
      updated_by: string | null;
      updated_at: Date;
    }>(
      `select auto_merge_on_checks, updated_by, updated_at
       from ouroboros.workspace_settings where organization_id = $1`,
      [workspaceId],
    );

    return rows;
  }

  describe("who may ask", () => {
    it("refuses a stranger", async () => {
      await api.anonymous("get", SETTING).expect(401);
      await api.anonymous("patch", SETTING).expect(401);
    });

    it("asks a session acting in no workspace to choose one", async () => {
      const nomad = await api.signIn();

      const response = await api.as(nomad)("get", SETTING).expect(400);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("organization_required");
    });
  });

  describe("the role matrix", () => {
    it("lets every role read, including the one that exists to look", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);
      const viewer = await api.signIn();
      await api.join(workspace.id, viewer, "viewer");

      const setting = bodyOf<AutoMergeResource>(
        await api.as(viewer)("get", SETTING).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      expect(setting.enabled).toBe(false);
    });

    it("refuses a member's flip with the API's one 403, and does not write", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);
      const member = await api.signIn();
      await api.join(workspace.id, member, "member");

      const response = await api
        .as(member)("patch", SETTING)
        .set(TENANT_HEADER, workspace.slug)
        .send({ enabled: true })
        .expect(403);

      const envelope = bodyOf<ErrorEnvelope>(response);
      expect(envelope.code).toBe("forbidden");
      expect(envelope.details).toEqual({ role: "member", required: [...ADMINISTRATORS] });
      // The does-not-write half: no lazily created row, and the workspace still reads off.
      expect(await storedRows(workspace.id)).toEqual([]);
      const setting = bodyOf<AutoMergeResource>(
        await api.as(member)("get", SETTING).set(TENANT_HEADER, workspace.slug).expect(200),
      );
      expect(setting.enabled).toBe(false);
    });

    it("refuses a viewer the same way", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);
      const viewer = await api.signIn();
      await api.join(workspace.id, viewer, "viewer");

      await api
        .as(viewer)("patch", SETTING)
        .set(TENANT_HEADER, workspace.slug)
        .send({ enabled: true })
        .expect(403);

      expect(await storedRows(workspace.id)).toEqual([]);
    });

    it("persists an admin's flip, not only an owner's", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);
      const admin = await api.signIn();
      await api.join(workspace.id, admin, "admin");

      const setting = bodyOf<AutoMergeResource>(
        await api
          .as(admin)("patch", SETTING)
          .set(TENANT_HEADER, workspace.slug)
          .send({ enabled: true })
          .expect(200),
      );

      expect(setting.enabled).toBe(true);
      expect(setting.updatedBy).toBe(admin.id);
    });
  });

  describe("the lazy row", () => {
    it("reads off for a workspace that has never chosen, without creating a row", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      const setting = bodyOf<AutoMergeResource>(
        await api.as(owner)("get", SETTING).set(TENANT_HEADER, workspace.slug).expect(200),
      );

      expect(setting).toEqual({ enabled: false, updatedAt: null, updatedBy: null });
      expect(await storedRows(workspace.id)).toEqual([]);
    });

    it("creates the row on the first write, attributed and stamped", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      const setting = bodyOf<AutoMergeResource>(
        await api
          .as(owner)("patch", SETTING)
          .set(TENANT_HEADER, workspace.slug)
          .send({ enabled: true })
          .expect(200),
      );

      // The answer is the new state, and the row behind it carries the ticket's two
      // attribution criteria: `updated_by` is the session user, `updated_at` is set.
      expect(setting.enabled).toBe(true);
      expect(setting.updatedBy).toBe(owner.id);
      expect(setting.updatedAt).not.toBeNull();

      const rows = await storedRows(workspace.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].auto_merge_on_checks).toBe(true);
      expect(rows[0].updated_by).toBe(owner.id);
      expect(rows[0].updated_at.toISOString()).toBe(setting.updatedAt);
    });

    it("moves the stamps on every write, second flips included", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);
      const admin = await api.signIn();
      await api.join(workspace.id, admin, "admin");

      const first = bodyOf<AutoMergeResource>(
        await api
          .as(owner)("patch", SETTING)
          .set(TENANT_HEADER, workspace.slug)
          .send({ enabled: true })
          .expect(200),
      );
      const second = bodyOf<AutoMergeResource>(
        await api
          .as(admin)("patch", SETTING)
          .set(TENANT_HEADER, workspace.slug)
          .send({ enabled: false })
          .expect(200),
      );

      // One row throughout — the upsert updates, never duplicates — and the attribution
      // follows the latest writer.
      expect(second.enabled).toBe(false);
      expect(second.updatedBy).toBe(admin.id);
      expect(new Date(second.updatedAt!).getTime()).toBeGreaterThanOrEqual(
        new Date(first.updatedAt!).getTime(),
      );
      expect(await storedRows(workspace.id)).toHaveLength(1);
    });
  });

  describe("the body", () => {
    it("refuses what is not a boolean, naming the field", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      const response = await api
        .as(owner)("patch", SETTING)
        .set(TENANT_HEADER, workspace.slug)
        .send({ enabled: "yes" })
        .expect(422);

      const envelope = bodyOf<ErrorEnvelope>(response);
      expect(envelope.code).toBe("validation_failed");
      expect(Object.keys(envelope.details)).toContain("enabled");
      expect(await storedRows(workspace.id)).toEqual([]);
    });
  });

  describe("the contract with the aggregate", () => {
    it("is reflected in the next poll: the tag changes and the pulse reports the flip", async () => {
      // The ticket's ETag criterion, held where it can actually break: the aggregate's
      // version fingerprints `workspace_settings`, so the write this module performs must
      // turn the dashboard's `304` back into a `200` whose payload carries the new state.
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);

      const before = await api
        .as(owner)("get", DASHBOARD)
        .set(TENANT_HEADER, workspace.slug)
        .expect(200);
      const held = before.headers.etag;
      expect(bodyOf<DashboardResource>(before).pulse.autoMerge).toBe(false);

      // The tag is current: nothing has moved, so the poll is a 304.
      await api
        .as(owner)("get", DASHBOARD)
        .set(TENANT_HEADER, workspace.slug)
        .set("If-None-Match", held)
        .expect(304);

      await api
        .as(owner)("patch", SETTING)
        .set(TENANT_HEADER, workspace.slug)
        .send({ enabled: true })
        .expect(200);

      const after = await api
        .as(owner)("get", DASHBOARD)
        .set(TENANT_HEADER, workspace.slug)
        .set("If-None-Match", held)
        .expect(200);

      expect(after.headers.etag).not.toBe(held);
      expect(bodyOf<DashboardResource>(after).pulse.autoMerge).toBe(true);
    });
  });

  describe("isolation", () => {
    it("never flips another workspace's switch", async () => {
      const owner = await api.signIn();
      const workspace = await api.workspace(owner);
      const other = await api.signIn();
      const elsewhere = await api.workspace(other);

      await api
        .as(owner)("patch", SETTING)
        .set(TENANT_HEADER, workspace.slug)
        .send({ enabled: true })
        .expect(200);

      const setting = bodyOf<AutoMergeResource>(
        await api.as(other)("get", SETTING).set(TENANT_HEADER, elsewhere.slug).expect(200),
      );

      expect(setting.enabled).toBe(false);
      expect(await storedRows(elsewhere.id)).toEqual([]);
    });
  });
});
