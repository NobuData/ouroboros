import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { CriteriaService } from "../pull-requests/criteria/criteria.service";
import {
  MOCKUP_WAIVER_REASON,
  one,
  PrPlaneHosts,
  prPlaneScene,
  type PrPlaneScene,
} from "../pull-requests/pr-plane.integration.fixture";
import { MergeExecutorService } from "../pull-requests/merge/merge.executor";
import type { InMemoryPrHost } from "../ticket-sources/providers/in-memory.pr.fixture";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { InvitationResource, MemberResource, MembersPageResource } from "./members.resources";

/**
 * The Members & Roles card, on the application's own services and a real database
 * ([#485](https://github.com/NobuData/ouroboros/issues/485), BR.1):
 *
 *   * **the cross-plane fixture** — unticking `can_approve_loops` through the settings route takes
 *     away approve, waive, arm and merge on the PR plane; ticking it gives approve back;
 *   * **defaults follow the role, explicit settings survive it**;
 *   * **owner protection** — the last owner can be neither demoted nor removed, and the attempt
 *     is audited;
 *   * **invitations** — invite → resend → revoke round-trips through the organization plugin.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/members
 * ```
 */

describe("members, roles and capabilities", () => {
  const hosts = new PrPlaneHosts();
  let api: ApiHarness;
  let host: InMemoryPrHost;

  beforeAll(async () => {
    api = await ApiHarness.start(
      { OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" },
      hosts.overrides(),
    );
  });

  afterAll(() => api.close());

  beforeEach(() => {
    host = hosts.reset();
  });

  afterEach(async () => {
    await api.nest.get(MergeExecutorService).settled();
    await api.truncate();
  });

  /** A call as somebody, in the scene's workspace. */
  function as(
    person: Person,
    at: PrPlaneScene,
    method: "get" | "post" | "patch" | "delete",
    path: string,
  ) {
    return api.as(person)(method, path).set(TENANT_HEADER, at.bench.workspace.slug);
  }

  /** The card, read as somebody. */
  async function card(person: Person, at: PrPlaneScene): Promise<MembersPageResource> {
    return bodyOf<MembersPageResource>(
      await as(person, at, "get", "/api/v1/settings/members").expect(200),
    );
  }

  /** One person's row on the card. */
  async function rowOf(person: Person, at: PrPlaneScene): Promise<MemberResource> {
    const row = (await card(at.owner, at)).members.find((member) => member.userId === person.id);

    if (row === undefined) throw new Error(`${person.id} is not on the card`);

    return row;
  }

  /** Set a member's role and/or capability through the route, as the owner. */
  function patch(at: PrPlaneScene, memberId: string, body: object) {
    return as(at.owner, at, "patch", `/api/v1/settings/members/${memberId}`).send(body);
  }

  describe("the cross-plane fixture", () => {
    it("takes approve, waive, arm and merge away from an admin whose capability is unticked, and gives approve back", async () => {
      const at = await prPlaneScene(api, host, "engine");
      const admin = await api.signUp();

      await api.join(at.org, admin, "admin");

      const before = await rowOf(admin, at);

      expect(before).toMatchObject({
        displayRole: "Maintainer",
        canApproveLoops: true,
        canApproveLoopsSource: "role",
      });

      const unticked = bodyOf<MemberResource>(
        await patch(at, before.id, { canApproveLoops: false }).expect(200),
      );

      expect(unticked).toMatchObject({ canApproveLoops: false, canApproveLoopsSource: "explicit" });

      const criterion = await api.nest
        .get(CriteriaService)
        .create(
          at.org,
          at.prId,
          { id: at.owner.id, name: at.owner.displayName },
          { claim: "Telemetry frames must arrive in ISR order under load" },
        );

      await as(at.owner, at, "post", `/api/v1/pull-requests/${at.prId}/request-review`)
        .send({ reviewer: "octo-reviewer" })
        .expect(200);

      const base = `/api/v1/pull-requests/${at.prId}`;
      const refused: [string, object][] = [
        [`${base}/approvals`, { decision: "approve" }],
        [`${base}/criteria/${criterion.id}/waive`, { reason: MOCKUP_WAIVER_REASON }],
        [`${base}/merge-plan/arm`, { revisionId: at.revisionId }],
        [`${base}/merge-plan/merge`, {}],
      ];

      for (const [path, body] of refused) {
        await as(admin, at, "post", path)
          .send(body)
          .expect(403)
          .expect((response) => {
            expect(response.body).toMatchObject({
              code: "capability_required",
              details: { capability: "can_approve_loops" },
            });
          });
      }

      const written = await one<{ approvals: number; waivers: number; armed: number }>(
        api,
        `select (select count(*) from ${SCHEMA_NAME}.pr_approvals where pr_id = $1 and state <> 'requested')::int as approvals,
                (select count(*) from ${SCHEMA_NAME}.pr_waivers where organization_id = $2)::int as waivers,
                (select count(*) from ${SCHEMA_NAME}.pr_merge_plans where pr_id = $1 and armed)::int as armed`,
        [at.prId, at.org],
      );

      expect(written).toEqual({ approvals: 0, waivers: 0, armed: 0 });
      expect(host.ledger().merged).toEqual([]);

      await patch(at, before.id, { canApproveLoops: true }).expect(200);
      await as(admin, at, "post", `${base}/approvals`)
        .send({ decision: "approve", note: "reviewed the ISR path" })
        .expect(200);
    });

    it("keeps a member's default at no, and lets an explicit tick through", async () => {
      const at = await prPlaneScene(api, host, "engine");
      const member = await api.signUp();

      await api.join(at.org, member, "member");
      await as(at.owner, at, "post", `/api/v1/pull-requests/${at.prId}/request-review`)
        .send({ reviewer: "octo-reviewer" })
        .expect(200);

      const row = await rowOf(member, at);

      expect(row).toMatchObject({ displayRole: "Viewer", canApproveLoops: false });
      await as(member, at, "post", `/api/v1/pull-requests/${at.prId}/approvals`)
        .send({ decision: "approve" })
        .expect(403);

      await patch(at, row.id, { canApproveLoops: true }).expect(200);
      await as(member, at, "post", `/api/v1/pull-requests/${at.prId}/approvals`)
        .send({ decision: "approve" })
        .expect(200);
    });
  });

  describe("roles", () => {
    it("displays roles per S3 and leaves the plugin's roles as the enforcement", async () => {
      const at = await prPlaneScene(api, host);
      const admin = await api.signUp();
      const viewer = await api.signUp();

      await api.join(at.org, admin, "admin");
      await api.join(at.org, viewer, "viewer");

      const page = await card(viewer, at);
      const byUser = new Map(page.members.map((member) => [member.userId, member]));

      expect(byUser.get(at.owner.id)).toMatchObject({ roles: ["owner"], displayRole: "Owner" });
      expect(byUser.get(admin.id)).toMatchObject({ roles: ["admin"], displayRole: "Maintainer" });
      expect(byUser.get(viewer.id)).toMatchObject({
        roles: ["viewer"],
        displayRole: "Viewer",
        you: true,
      });
      expect(page.canManage).toBe(false);
      expect(page.footer).toEqual({
        hierarchy: "Owner > Maintainer (approve/merge) > Viewer (read-only)",
        directorySync: null,
      });
      // Last active is the session table's: the viewer just made a request with a session.
      expect(byUser.get(viewer.id)?.lastActiveAt).not.toBeNull();

      // A viewer cannot change anything on the card.
      await as(viewer, at, "patch", `/api/v1/settings/members/${byUser.get(admin.id)?.id}`)
        .send({ canApproveLoops: false })
        .expect(403);
    });

    it("keeps an explicit capability through a role change", async () => {
      const at = await prPlaneScene(api, host);
      const admin = await api.signUp();

      await api.join(at.org, admin, "admin");

      const row = await rowOf(admin, at);

      await patch(at, row.id, { canApproveLoops: false }).expect(200);

      const demoted = bodyOf<MemberResource>(
        await patch(at, row.id, { role: "member" }).expect(200),
      );

      expect(demoted).toMatchObject({
        roles: ["member"],
        canApproveLoops: false,
        canApproveLoopsSource: "explicit",
      });

      const promoted = bodyOf<MemberResource>(
        await patch(at, row.id, { role: "admin" }).expect(200),
      );

      // Admin's default is yes; the explicit no survives anyway.
      expect(promoted).toMatchObject({
        roles: ["admin"],
        canApproveLoops: false,
        canApproveLoopsSource: "explicit",
      });

      const trail = await api.sql.query<{ detail: Record<string, unknown> }>(
        `select detail from ${SCHEMA_NAME}.audit_events
          where organization_id = $1 and action = 'member.role_changed' order by occurred_at`,
        [at.org],
      );

      expect(trail.rows.map((row) => row.detail)).toEqual([
        expect.objectContaining({ before: "admin", after: "member", outcome: "success" }),
        expect.objectContaining({ before: "member", after: "admin", outcome: "success" }),
      ]);
    });

    it("refuses to demote or remove the last owner, with a clear reason, and audits the attempt", async () => {
      const at = await prPlaneScene(api, host);
      const ownerRow = await rowOf(at.owner, at);

      await patch(at, ownerRow.id, { role: "admin" })
        .expect(409)
        .expect((response) => {
          expect(response.body).toMatchObject({
            code: "owner_protected",
            details: { attempt: "demote" },
          });
        });
      await as(at.owner, at, "delete", `/api/v1/settings/members/${ownerRow.id}`)
        .expect(409)
        .expect((response) => {
          expect(response.body).toMatchObject({
            code: "owner_protected",
            details: { attempt: "remove" },
          });
        });

      expect((await rowOf(at.owner, at)).roles).toEqual(["owner"]);

      const trail = await api.sql.query<{ action: string; detail: Record<string, unknown> }>(
        `select action, detail from ${SCHEMA_NAME}.audit_events
          where organization_id = $1 and subject_type = 'member' order by occurred_at`,
        [at.org],
      );

      expect(trail.rows.map((row) => [row.action, row.detail.outcome, row.detail.reason])).toEqual([
        ["member.role_changed", "failure", "owner_protected"],
        ["member.removed", "failure", "owner_protected"],
      ]);
    });
  });

  describe("invitations", () => {
    it("round-trips invite → resend → revoke through the organization plugin, with a real invitedAt", async () => {
      const at = await prPlaneScene(api, host);
      const invited = bodyOf<InvitationResource>(
        await as(at.owner, at, "post", "/api/v1/settings/members/invitations")
          .send({ email: "priya@acme.dev", role: "member" })
          .expect(201),
      );

      expect(invited).toMatchObject({
        email: "priya@acme.dev",
        roles: ["member"],
        displayRole: "Viewer",
        expired: false,
      });

      const stored = await one<{ createdAt: Date; status: string }>(
        api,
        `select "createdAt", status from ${SCHEMA_NAME}.invitation where id = $1`,
        [invited.id],
      );

      expect(stored.status).toBe("pending");
      expect(invited.invitedAt).toBe(stored.createdAt.toISOString());
      expect((await card(at.owner, at)).invitations.map((row) => row.id)).toEqual([invited.id]);

      const resent = bodyOf<InvitationResource>(
        await as(
          at.owner,
          at,
          "post",
          `/api/v1/settings/members/invitations/${invited.id}/resend`,
        ).expect(200),
      );

      expect(resent.invitedAt).toBe(invited.invitedAt);
      expect(Date.parse(resent.expiresAt)).toBeGreaterThanOrEqual(Date.parse(invited.expiresAt));

      await as(at.owner, at, "delete", `/api/v1/settings/members/invitations/${invited.id}`).expect(
        204,
      );

      expect((await card(at.owner, at)).invitations).toEqual([]);
      await as(at.owner, at, "post", `/api/v1/settings/members/invitations/${invited.id}/resend`)
        .expect(409)
        .expect((response) => {
          expect((response.body as { code: string }).code).toBe("invitation_not_pending");
        });

      const trail = await api.sql.query<{ action: string }>(
        `select action from ${SCHEMA_NAME}.audit_events
          where organization_id = $1 and subject_type = 'invitation' order by occurred_at`,
        [at.org],
      );

      expect(trail.rows.map((row) => row.action)).toEqual([
        "member.invited",
        "member.invitation_resent",
        "member.invitation_revoked",
      ]);
    });
  });
});
