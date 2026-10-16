import { AUTH_ERRORS } from "../auth/auth.errors";
import type { AppConfigService } from "../config/config.service";
import { RecordingMailer } from "../mail/mail.fixture";
import type { AccountDirectory, AccountStatusChange } from "./accounts.directory";
import { ACCOUNTS_ERRORS } from "./accounts.errors";
import type {
  AccountEvent,
  AccountRow,
  AccountsRepository,
  PreapprovedEmailRow,
} from "./accounts.repository";
import { AccountsService, DEFAULT_ACCOUNT_LIST, toAccountResource } from "./accounts.service";

/**
 * Account approval's operations: the caller's status, the administrator check on every admin
 * route, approve and deny with their events, the personal workspace and email that follow an
 * approval, and the pre-approved list — including that pre-approving an address already waiting
 * approves its account.
 *
 * The repository and the directory are in-memory fakes; the mailer records.
 */

const ADMIN = { id: "admin-1", email: "Ken@Acme-Robotics.dev", accountStatus: "approved" };
const STRANGER = { id: "user-9", email: "maya@acme-robotics.dev", accountStatus: "approved" };

/** A row in one status. */
function row(id: string, email: string, status: AccountRow["account_status"]): AccountRow {
  return {
    id,
    name: `Person ${id}`,
    email,
    github_login: id === "priya" ? "priyaraman" : null,
    account_status: status,
    createdAt: new Date("2026-10-12T09:00:00.000Z"),
    account_status_changed_at: null,
    account_status_changed_by: null,
    account_status_reason: status === "pending" ? "held" : null,
  };
}

/** The fakes and the service over them. */
function harness(options: { smtp?: boolean; workspaceFails?: boolean; admins?: string[] } = {}) {
  const rows = new Map<string, AccountRow>([
    ["priya", row("priya", "priya@contractor.dev", "pending")],
    ["sam", row("sam", "sam@unknown.example", "denied")],
    ["maya", row("maya", "maya@acme-robotics.dev", "approved")],
    ["ken", row("ken", "ken@acme-robotics.dev", "pending")],
  ]);
  const preapproved = new Map<string, PreapprovedEmailRow>();
  const events: AccountEvent[] = [];
  const changes: { userId: string; change: AccountStatusChange }[] = [];
  const workspaces: string[] = [];

  const repository = {
    list: jest.fn((status: string) =>
      Promise.resolve([...rows.values()].filter((each) => each.account_status === status)),
    ),
    find: jest.fn((id: string) => Promise.resolve(rows.get(id))),
    findByEmail: jest.fn((email: string) =>
      Promise.resolve([...rows.values()].find((each) => each.email === email)),
    ),
    listPreapproved: jest.fn(() => Promise.resolve([...preapproved.values()])),
    addPreapproved: jest.fn((entry: { email: string; addedBy: string; note: string | null }) => {
      if (preapproved.has(entry.email)) return Promise.resolve(undefined);
      const added = {
        email: entry.email,
        added_by: entry.addedBy,
        note: entry.note,
        created_at: new Date("2026-10-15T10:00:00.000Z"),
      };
      preapproved.set(entry.email, added);
      return Promise.resolve(added);
    }),
    removePreapproved: jest.fn((email: string) => {
      const removed = preapproved.get(email);
      preapproved.delete(email);
      return Promise.resolve(removed);
    }),
    record: jest.fn((event: AccountEvent) => {
      events.push(event);
      return Promise.resolve();
    }),
  };

  const directory: AccountDirectory = {
    setStatus(userId, change) {
      changes.push({ userId, change });
      return Promise.resolve();
    },
    ensureWorkspace(owner) {
      if (options.workspaceFails) return Promise.reject(new Error("adapter down"));
      workspaces.push(owner.id);
      return Promise.resolve(`org-${owner.id}`);
    },
  };

  const mailer = new RecordingMailer(options.smtp === false ? "none" : "smtp");
  const config = {
    appAdminEmails: options.admins ?? ["ken@acme-robotics.dev"],
    uiUrl: "http://localhost:3000",
  } as unknown as AppConfigService;
  const service = new AccountsService(
    repository as unknown as AccountsRepository,
    directory,
    config,
    mailer,
  );

  return { service, repository, events, changes, workspaces, mailer, preapproved, rows };
}

describe("the caller's status", () => {
  it("reads the stored status rather than the snapshot", async () => {
    const { service } = harness();

    await expect(
      service.status({ id: "priya", email: "priya@contractor.dev", accountStatus: "approved" }),
    ).resolves.toEqual({ status: "pending", appAdmin: false, email: "priya@contractor.dev" });
  });

  it("answers denied for a denied account", async () => {
    const { service } = harness();

    await expect(
      service.status({ id: "sam", email: "sam@unknown.example", accountStatus: "denied" }),
    ).resolves.toMatchObject({ status: "denied", appAdmin: false });
  });

  it("answers approved and appAdmin for an administrator stored as pending", async () => {
    const { service } = harness();

    await expect(service.status({ id: "ken", email: "Ken@Acme-Robotics.dev" })).resolves.toEqual({
      status: "approved",
      appAdmin: true,
      email: "Ken@Acme-Robotics.dev",
    });
  });

  it("falls back to the snapshot for a row it cannot find, and to pending when there is neither", async () => {
    const { service } = harness();

    await expect(
      service.status({ id: "gone", email: "x@y.dev", accountStatus: "approved" }),
    ).resolves.toMatchObject({ status: "approved" });
    await expect(service.status({ id: "gone", email: "x@y.dev" })).resolves.toMatchObject({
      status: "pending",
    });
  });
});

describe("the administrator check", () => {
  const routes: [string, (service: AccountsService) => Promise<unknown>][] = [
    ["list", (service) => service.list(STRANGER)],
    ["approve", (service) => service.approve(STRANGER, "priya")],
    ["deny", (service) => service.deny(STRANGER, "priya")],
    ["listPreapproved", (service) => service.listPreapproved(STRANGER)],
    ["addPreapproved", (service) => service.addPreapproved(STRANGER, { email: "a@b.dev" })],
    ["removePreapproved", (service) => service.removePreapproved(STRANGER, "a@b.dev")],
  ];

  it.each(routes)("refuses %s to anybody not in OURO_APP_ADMIN_EMAILS", async (_name, call) => {
    const { service, events, changes } = harness();

    await expect(call(service)).rejects.toMatchObject({
      code: AUTH_ERRORS.appAdminRequired,
      status: 403,
    });
    expect(events).toEqual([]);
    expect(changes).toEqual([]);
  });

  it.each(routes)(
    "refuses %s to everybody when no administrator is configured",
    async (_n, call) => {
      const { service } = harness({ admins: [] });

      await expect(call(service)).rejects.toMatchObject({ code: AUTH_ERRORS.appAdminRequired });
    },
  );

  it("returns the administrator's lower-cased address, which decisions are recorded under", () => {
    expect(harness().service.requireAppAdmin(ADMIN)).toBe("ken@acme-robotics.dev");
  });
});

describe("the lists", () => {
  it("defaults to the pending list", async () => {
    const { service, repository } = harness();

    const { accounts } = await service.list(ADMIN);

    expect(DEFAULT_ACCOUNT_LIST).toBe("pending");
    expect(repository.list).toHaveBeenCalledWith("pending");
    expect(accounts.map((each) => each.id)).toEqual(["priya", "ken"]);
  });

  it("answers the denied list in the published shape", async () => {
    const { service } = harness();

    await expect(service.list(ADMIN, "denied")).resolves.toEqual({
      accounts: [
        {
          id: "sam",
          name: "Person sam",
          email: "sam@unknown.example",
          githubLogin: null,
          status: "denied",
          createdAt: "2026-10-12T09:00:00.000Z",
          statusChangedAt: null,
          statusChangedBy: null,
          statusReason: null,
        },
      ],
    });
  });
});

describe("approving", () => {
  it("sets approved by the administrator, records the event, makes the workspace and emails the person", async () => {
    const { service, changes, events, workspaces, mailer } = harness();

    const account = await service.approve(ADMIN, "priya");

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      userId: "priya",
      change: {
        status: "approved",
        reason: "approved_by_admin",
        changedBy: "ken@acme-robotics.dev",
      },
    });
    expect(changes[0].change.changedAt).toBeInstanceOf(Date);
    expect(events).toEqual([
      {
        actorEmail: "ken@acme-robotics.dev",
        action: "approved",
        subjectUserId: "priya",
        subjectEmail: "priya@contractor.dev",
        detail: { previousStatus: "pending" },
      },
    ]);
    expect(workspaces).toEqual(["priya"]);
    expect(mailer.sent.map((message) => [message.to, message.subject])).toEqual([
      ["priya@contractor.dev", "Your Ouroboros account was approved"],
    ]);
    expect(account).toMatchObject({
      id: "priya",
      status: "approved",
      statusReason: "approved_by_admin",
      statusChangedBy: "ken@acme-robotics.dev",
      githubLogin: "priyaraman",
    });
    expect(account.statusChangedAt).toEqual(expect.any(String));
  });

  it("approves a denied account later", async () => {
    const { service, events } = harness();

    await expect(service.approve(ADMIN, "sam")).resolves.toMatchObject({ status: "approved" });
    expect(events[0]).toMatchObject({ action: "approved", detail: { previousStatus: "denied" } });
  });

  it("changes nothing for an account that is already approved", async () => {
    const { service, changes, events, mailer } = harness();

    await expect(service.approve(ADMIN, "maya")).resolves.toMatchObject({ status: "approved" });
    expect(changes).toEqual([]);
    expect(events).toEqual([]);
    expect(mailer.sent).toEqual([]);
  });

  it("sends nothing, and fails nothing, without SMTP", async () => {
    const { service, mailer } = harness({ smtp: false });

    await expect(service.approve(ADMIN, "priya")).resolves.toMatchObject({ status: "approved" });
    expect(mailer.sent).toEqual([]);
  });

  it("stands when the email or the workspace fails", async () => {
    const { service, mailer, changes } = harness({ workspaceFails: true });
    mailer.failFor("priya@contractor.dev");

    await expect(service.approve(ADMIN, "priya")).resolves.toMatchObject({ status: "approved" });
    expect(changes).toHaveLength(1);
  });

  it("answers 404 account_not_found for an unknown id", async () => {
    await expect(harness().service.approve(ADMIN, "nobody")).rejects.toMatchObject({
      code: ACCOUNTS_ERRORS.accountNotFound,
      status: 404,
    });
  });
});

describe("denying", () => {
  it("sets denied by the administrator and records the event, sending nothing", async () => {
    const { service, changes, events, mailer, workspaces } = harness();

    const account = await service.deny(ADMIN, "priya");

    expect(changes[0]).toMatchObject({
      userId: "priya",
      change: { status: "denied", reason: "denied_by_admin", changedBy: "ken@acme-robotics.dev" },
    });
    expect(events).toEqual([
      {
        actorEmail: "ken@acme-robotics.dev",
        action: "denied",
        subjectUserId: "priya",
        subjectEmail: "priya@contractor.dev",
        detail: { previousStatus: "pending" },
      },
    ]);
    expect(mailer.sent).toEqual([]);
    expect(workspaces).toEqual([]);
    expect(account).toMatchObject({ status: "denied", statusReason: "denied_by_admin" });
  });

  it("refuses to deny an application administrator with 409 cannot_deny_app_admin", async () => {
    const { service, changes } = harness();

    await expect(service.deny(ADMIN, "ken")).rejects.toMatchObject({
      code: ACCOUNTS_ERRORS.cannotDenyAppAdmin,
      status: 409,
    });
    expect(changes).toEqual([]);
  });

  it("changes nothing for an account that is already denied", async () => {
    const { service, events } = harness();

    await expect(service.deny(ADMIN, "sam")).resolves.toMatchObject({ status: "denied" });
    expect(events).toEqual([]);
  });

  it("answers 404 account_not_found for an unknown id", async () => {
    await expect(harness().service.deny(ADMIN, "nobody")).rejects.toMatchObject({
      code: ACCOUNTS_ERRORS.accountNotFound,
    });
  });
});

describe("the pre-approved list", () => {
  it("adds a lower-cased address with its note and records the event", async () => {
    const { service, events } = harness();

    await expect(
      service.addPreapproved(ADMIN, { email: "Lee@Acme-Robotics.dev", note: "  starts Monday " }),
    ).resolves.toEqual({
      email: "lee@acme-robotics.dev",
      addedBy: "ken@acme-robotics.dev",
      createdAt: "2026-10-15T10:00:00.000Z",
      note: "starts Monday",
      approvedAccount: null,
    });
    expect(events).toEqual([
      {
        actorEmail: "ken@acme-robotics.dev",
        action: "preapproved_added",
        subjectUserId: null,
        subjectEmail: "lee@acme-robotics.dev",
        detail: { note: "starts Monday" },
      },
    ]);
  });

  it("stores a blank note as none", async () => {
    const { service, repository } = harness();

    await service.addPreapproved(ADMIN, { email: "lee@acme-robotics.dev", note: "   " });

    expect(repository.addPreapproved).toHaveBeenCalledWith({
      email: "lee@acme-robotics.dev",
      addedBy: "ken@acme-robotics.dev",
      note: null,
    });
  });

  it("refuses a duplicate with 409 already_preapproved", async () => {
    const { service } = harness();
    await service.addPreapproved(ADMIN, { email: "lee@acme-robotics.dev" });

    await expect(
      service.addPreapproved(ADMIN, { email: "lee@acme-robotics.dev" }),
    ).rejects.toMatchObject({ code: ACCOUNTS_ERRORS.alreadyPreapproved, status: 409 });
  });

  it("approves a pending account already waiting under the address, exactly as approve does", async () => {
    const { service, events, workspaces, mailer } = harness();

    const added = await service.addPreapproved(ADMIN, { email: "priya@contractor.dev" });

    expect(added.approvedAccount).toMatchObject({
      id: "priya",
      status: "approved",
      statusReason: "approved_by_admin",
    });
    expect(events.map((event) => event.action)).toEqual(["preapproved_added", "approved"]);
    expect(workspaces).toEqual(["priya"]);
    expect(mailer.sent.map((message) => message.to)).toEqual(["priya@contractor.dev"]);
  });

  it("leaves a denied account under the address for an explicit approval", async () => {
    const { service, events } = harness();

    const added = await service.addPreapproved(ADMIN, { email: "sam@unknown.example" });

    expect(added.approvedAccount).toBeNull();
    expect(events.map((event) => event.action)).toEqual(["preapproved_added"]);
  });

  it("lists newest first in the published shape", async () => {
    const { service } = harness();
    await service.addPreapproved(ADMIN, { email: "lee@acme-robotics.dev" });

    await expect(service.listPreapproved(ADMIN)).resolves.toEqual({
      emails: [
        {
          email: "lee@acme-robotics.dev",
          addedBy: "ken@acme-robotics.dev",
          createdAt: "2026-10-15T10:00:00.000Z",
          note: null,
        },
      ],
    });
  });

  it("removes an address in any case and records the event", async () => {
    const { service, events, preapproved } = harness();
    await service.addPreapproved(ADMIN, { email: "lee@acme-robotics.dev" });

    await service.removePreapproved(ADMIN, " LEE@acme-robotics.dev ");

    expect(preapproved.size).toBe(0);
    expect(events[1]).toEqual({
      actorEmail: "ken@acme-robotics.dev",
      action: "preapproved_removed",
      subjectUserId: null,
      subjectEmail: "lee@acme-robotics.dev",
    });
  });

  it("answers 404 preapproved_email_not_found for an address not listed", async () => {
    await expect(harness().service.removePreapproved(ADMIN, "nobody@x.dev")).rejects.toMatchObject({
      code: ACCOUNTS_ERRORS.preapprovedEmailNotFound,
      status: 404,
    });
  });
});

describe("the account resource", () => {
  it("renders dates as ISO strings and keeps nulls", () => {
    expect(
      toAccountResource({
        ...row("priya", "priya@contractor.dev", "pending"),
        account_status_changed_at: new Date("2026-10-13T00:00:00.000Z"),
      }),
    ).toMatchObject({ statusChangedAt: "2026-10-13T00:00:00.000Z", statusChangedBy: null });
  });
});
