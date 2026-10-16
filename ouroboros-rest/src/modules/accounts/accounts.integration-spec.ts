import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { stubGithub } from "../../testing/github.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { AUTH_ERRORS } from "../auth/auth.errors";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { ACCOUNTS_ERRORS } from "./accounts.errors";
import type {
  AccountStatusResource,
  AddedPreapprovedEmailResource,
  AdminAccountResource,
  AdminAccountsResource,
} from "./accounts.resources";

/**
 * Account approval end to end, against a migrated database and the real BetterAuth: the
 * decision a sign-up meets (held, invited, pre-approved, administrator), the guard's refusals
 * and its allow-list, the personal workspace withheld while held and made on approval — on the
 * held person's own open session, with no new sign-in — and the admin routes over HTTP.
 */

const ADMIN_EMAIL = "admin@account-approval.test";
const STATUS = "/api/v1/account/status";
const ACCOUNTS = "/api/v1/admin/accounts";
const PREAPPROVED = "/api/v1/admin/preapproved-emails";
/** A product route a held account may not reach, and one that needs no workspace. */
const PREFERENCES = "/api/v1/me/preferences";

/** One `"user"` row's approval columns. */
interface StatusRow {
  account_status: string;
  account_status_reason: string | null;
  account_status_changed_by: string | null;
  github_login: string | null;
}

describe("account approval", () => {
  let api: ApiHarness;
  let admin: Person;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_APP_ADMIN_EMAILS: ADMIN_EMAIL });
  });

  afterAll(() => api.close());

  beforeEach(async () => {
    admin = await api.signIn({ email: ADMIN_EMAIL, displayName: "App Admin" });
  });

  afterEach(() => api.truncate());

  /**
   * @param userId - Whose.
   * @returns Their approval columns.
   */
  async function statusOf(userId: string): Promise<StatusRow> {
    const { rows } = await api.sql.query<StatusRow>(
      `select account_status, account_status_reason, account_status_changed_by, github_login
         from ${SCHEMA_NAME}."user" where "id" = $1`,
      [userId],
    );

    return rows[0];
  }

  /**
   * @param userId - Whose.
   * @returns How many memberships they hold.
   */
  async function membershipsOf(userId: string): Promise<number> {
    const { rows } = await api.sql.query<{ count: string }>(
      `select count(*)::text as count from ${SCHEMA_NAME}.member where "userId" = $1`,
      [userId],
    );

    return Number(rows[0].count);
  }

  /**
   * @param userId - Whose.
   * @returns Their sessions' active organizations.
   */
  async function activeOrganizationsOf(userId: string): Promise<(string | null)[]> {
    const { rows } = await api.sql.query<{ activeOrganizationId: string | null }>(
      `select "activeOrganizationId" from ${SCHEMA_NAME}.session where "userId" = $1`,
      [userId],
    );

    return rows.map((row) => row.activeOrganizationId);
  }

  /**
   * @returns The trail, oldest first.
   */
  async function events(): Promise<{ action: string; actor_email: string | null }[]> {
    const { rows } = await api.sql.query<{ action: string; actor_email: string | null }>(
      `select action, actor_email from ${SCHEMA_NAME}.app_account_events order by at, id`,
    );

    return rows;
  }

  describe("a stranger's first sign-in", () => {
    it("is held: pending, with a held event, no workspace and a session acting nowhere", async () => {
      const stranger = await api.signUp({ email: "priya@contractor.test", held: true });

      expect(await statusOf(stranger.id)).toMatchObject({
        account_status: "pending",
        account_status_reason: "held",
        account_status_changed_by: null,
      });
      expect(await events()).toEqual([{ action: "held", actor_email: null }]);
      expect(await membershipsOf(stranger.id)).toBe(0);
      expect(await activeOrganizationsOf(stranger.id)).toEqual([null]);
    });

    it("can read its status, and nothing else", async () => {
      const stranger = await api.signUp({ email: "priya@contractor.test", held: true });

      const status = await api.as(stranger)("get", STATUS).expect(200);
      expect(bodyOf<AccountStatusResource>(status)).toEqual({
        status: "pending",
        appAdmin: false,
        email: "priya@contractor.test",
      });

      const refused = await api.as(stranger)("get", PREFERENCES).expect(403);
      expect(bodyOf<ErrorEnvelope>(refused).code).toBe(AUTH_ERRORS.accountPendingApproval);
      await api.as(stranger)("get", "/api/v1/orgs").expect(403);
      await api.as(stranger)("get", ACCOUNTS).expect(403);
    });

    it("can still sign out", async () => {
      const stranger = await api.signUp({ email: "priya@contractor.test", held: true });

      await api.as(stranger)("post", "/api/v1/auth/logout").expect(204);
    });

    it("is approved when the address is pre-approved", async () => {
      await api
        .as(admin)("post", PREAPPROVED)
        .send({ email: "Lee@Acme.test", note: "starts Monday" })
        .expect(201);

      const lee = await api.signUp({ email: "lee@acme.test", held: true });

      expect(await statusOf(lee.id)).toMatchObject({
        account_status: "approved",
        account_status_reason: "preapproved",
      });
      expect(await membershipsOf(lee.id)).toBe(1);
      await api.as(lee)("get", PREFERENCES).expect(200);
    });

    it("is approved when the address has a pending workspace invitation", async () => {
      const workspace = await api.workspace(admin);
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.invitation
           ("id", "organizationId", "email", "role", "status", "expiresAt", "inviterId")
         values ('inv-1', $1, 'maya@acme.test', 'member', 'pending', now() + interval '1 day', $2)`,
        [workspace.id, admin.id],
      );

      const maya = await api.signUp({ email: "maya@acme.test", held: true });

      expect(await statusOf(maya.id)).toMatchObject({
        account_status: "approved",
        account_status_reason: "invited",
      });
    });

    it("is held when the invitation has expired", async () => {
      const workspace = await api.workspace(admin);
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.invitation
           ("id", "organizationId", "email", "role", "status", "expiresAt", "inviterId")
         values ('inv-2', $1, 'maya@acme.test', 'member', 'pending', now() - interval '1 day', $2)`,
        [workspace.id, admin.id],
      );

      const maya = await api.signUp({ email: "maya@acme.test", held: true });

      expect((await statusOf(maya.id)).account_status).toBe("pending");
    });

    it("is approved for an application administrator", async () => {
      await api.sql.query(`delete from ${SCHEMA_NAME}."user" where "email" = $1`, [ADMIN_EMAIL]);

      const fresh = await api.signUp({ email: ADMIN_EMAIL, held: true });

      expect(await statusOf(fresh.id)).toMatchObject({
        account_status: "approved",
        account_status_reason: "app_admin",
      });
    });

    it("keeps the GitHub login, through the provider profile", async () => {
      const github = stubGithub({ profile: { login: "priyaraman", name: "Priya Raman" } });

      try {
        await api.signInWithGithub(github, "code", { held: true });

        const { rows } = await api.sql.query<{ id: string }>(
          `select "id" from ${SCHEMA_NAME}."user" where "email" = $1`,
          [github.primaryEmail],
        );
        expect(await statusOf(rows[0].id)).toMatchObject({
          account_status: "pending",
          github_login: "priyaraman",
        });
      } finally {
        github.restore();
      }
    });
  });

  describe("the administrator", () => {
    it("lists the held, and approval works on the held person's very next request", async () => {
      const stranger = await api.signUp({ email: "priya@contractor.test", held: true });

      const listed = await api.as(admin)("get", ACCOUNTS).expect(200);
      expect(bodyOf<AdminAccountsResource>(listed).accounts.map((each) => each.email)).toEqual([
        "priya@contractor.test",
      ]);

      const approved = await api
        .as(admin)("post", `${ACCOUNTS}/${stranger.id}/approve`)
        .expect(200);
      expect(bodyOf<AdminAccountResource>(approved)).toMatchObject({
        status: "approved",
        statusReason: "approved_by_admin",
        statusChangedBy: ADMIN_EMAIL,
      });

      // The personal workspace, made by approval and stamped onto the open session.
      expect(await membershipsOf(stranger.id)).toBe(1);
      expect((await activeOrganizationsOf(stranger.id))[0]).not.toBeNull();

      // The same cookie — its snapshot still says pending — now reaches the product.
      await api.as(stranger)("get", PREFERENCES).expect(200);
      expect(await events()).toEqual([
        { action: "held", actor_email: null },
        { action: "approved", actor_email: ADMIN_EMAIL },
      ]);
    });

    it("denies, and the denied person's open session is refused", async () => {
      const stranger = await api.signUp({ email: "sam@unknown.test", held: true });

      await api.as(admin)("post", `${ACCOUNTS}/${stranger.id}/deny`).expect(200);

      const refused = await api.as(stranger)("get", PREFERENCES).expect(403);
      expect(bodyOf<ErrorEnvelope>(refused).code).toBe(AUTH_ERRORS.accountDenied);
      const status = await api.as(stranger)("get", STATUS).expect(200);
      expect(bodyOf<AccountStatusResource>(status).status).toBe("denied");

      const denied = await api.as(admin)("get", `${ACCOUNTS}?status=denied`).expect(200);
      expect(bodyOf<AdminAccountsResource>(denied).accounts.map((each) => each.id)).toEqual([
        stranger.id,
      ]);
    });

    it("cannot deny an application administrator", async () => {
      const refused = await api.as(admin)("post", `${ACCOUNTS}/${admin.id}/deny`).expect(409);

      expect(bodyOf<ErrorEnvelope>(refused).code).toBe(ACCOUNTS_ERRORS.cannotDenyAppAdmin);
    });

    it("passes the guard even with a stored pending status", async () => {
      await api.sql.query(
        `update ${SCHEMA_NAME}."user" set account_status = 'pending', account_status_reason = 'held'
          where "id" = $1`,
        [admin.id],
      );

      await api.as(admin)("get", PREFERENCES).expect(200);
      const status = await api.as(admin)("get", STATUS).expect(200);
      expect(bodyOf<AccountStatusResource>(status)).toMatchObject({
        status: "approved",
        appAdmin: true,
      });
    });

    it("approves a pending account by pre-approving its address", async () => {
      const stranger = await api.signUp({ email: "priya@contractor.test", held: true });

      const added = await api
        .as(admin)("post", PREAPPROVED)
        .send({ email: "PRIYA@contractor.test" })
        .expect(201);

      expect(bodyOf<AddedPreapprovedEmailResource>(added)).toMatchObject({
        email: "priya@contractor.test",
        addedBy: ADMIN_EMAIL,
        approvedAccount: { id: stranger.id, status: "approved" },
      });
      await api.as(admin)("post", PREAPPROVED).send({ email: "priya@contractor.test" }).expect(409);
      await api.as(admin)("delete", `${PREAPPROVED}/priya%40contractor.test`).expect(204);
      await api.as(admin)("delete", `${PREAPPROVED}/priya%40contractor.test`).expect(404);
      expect((await events()).map((event) => event.action)).toEqual([
        "held",
        "preapproved_added",
        "approved",
        "preapproved_removed",
      ]);
    });

    it("refuses a malformed address with 422", async () => {
      await api.as(admin)("post", PREAPPROVED).send({ email: "Lee <lee@x.test>" }).expect(422);
    });
  });

  it("refuses the admin routes to anybody else with 403 app_admin_required", async () => {
    const member = await api.signIn({ email: "member@acme.test" });

    for (const [method, path] of [
      ["get", ACCOUNTS],
      ["post", `${ACCOUNTS}/${admin.id}/approve`],
      ["post", `${ACCOUNTS}/${admin.id}/deny`],
      ["get", PREAPPROVED],
      ["delete", `${PREAPPROVED}/x%40y.test`],
    ] as const) {
      const refused = await api.as(member)(method, path).expect(403);
      expect(bodyOf<ErrorEnvelope>(refused).code).toBe(AUTH_ERRORS.appAdminRequired);
    }
  });
});
