import { RecordingMailer } from "../modules/mail/mail.fixture";
import {
  ACCOUNT_STATUSES,
  ACCOUNT_USER_FIELDS,
  accountApprovalHooks,
  decideAccountStatus,
  decideNewAccount,
  effectiveAccountStatus,
  holdNotifier,
  isAppAdmin,
  isEffectivelyApproved,
  keepGithubLoginFixed,
  poolLookups,
  type AccountApprovalLookups,
  type AccountHoldNotifier,
  type QueryPool,
} from "./account.approval";

/**
 * Account approval's decision at user creation, and what follows a hold.
 *
 * Rule 2 of the request, in order: administrator, pending invitation, pre-approval, else held.
 * The hooks are exercised as BetterAuth calls them — `before` with the row about to be written,
 * `after` with the row written — against fake lookups and a recording notifier; the notifier and
 * lookups are exercised against a fake pool and a recording mailer.
 */

const ADMINS = ["ken@acme-robotics.dev"] as const;

/** Lookups answering fixed facts, counting the calls. */
function lookups(facts: { invited?: boolean; preapproved?: boolean; fail?: boolean } = {}) {
  const calls: string[] = [];
  const fake: AccountApprovalLookups = {
    hasPendingInvitation(email) {
      calls.push(`invitation:${email}`);
      return facts.fail ? Promise.reject(new Error("db down")) : Promise.resolve(!!facts.invited);
    },
    isPreapproved(email) {
      calls.push(`preapproved:${email}`);
      return Promise.resolve(!!facts.preapproved);
    },
  };

  return { fake, calls };
}

/** A logger that keeps what it was told. */
function logger() {
  const warnings: string[] = [];

  return { warnings, warn: (message: string) => warnings.push(message) };
}

/** A notifier that records whom it was told about. */
function notifier() {
  const held: string[] = [];
  const fake: AccountHoldNotifier = {
    held(account) {
      held.push(account.email);
      return Promise.resolve();
    },
  };

  return { fake, held };
}

/** A new user row, as BetterAuth hands it to `create.before`. */
function newUser(email: string) {
  return {
    id: "u1",
    name: "Priya Raman",
    email,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("the fields", () => {
  it("map onto V149's snake_case columns", () => {
    expect(
      Object.fromEntries(Object.entries(ACCOUNT_USER_FIELDS).map(([k, v]) => [k, v.fieldName])),
    ).toEqual({
      accountStatus: "account_status",
      accountStatusChangedAt: "account_status_changed_at",
      accountStatusChangedBy: "account_status_changed_by",
      accountStatusReason: "account_status_reason",
      githubLogin: "github_login",
    });
  });

  it("let nobody choose their own status", () => {
    expect(ACCOUNT_USER_FIELDS.accountStatus.input).toBe(false);
    expect(ACCOUNT_USER_FIELDS.accountStatusReason.input).toBe(false);
    expect(ACCOUNT_USER_FIELDS.accountStatusChangedBy.input).toBe(false);
    expect(ACCOUNT_USER_FIELDS.accountStatusChangedAt.input).toBe(false);
  });

  it("put the status in the session, and keep the companions out of it", () => {
    expect("returned" in ACCOUNT_USER_FIELDS.accountStatus).toBe(false);
    expect(ACCOUNT_USER_FIELDS.accountStatusReason.returned).toBe(false);
    expect(ACCOUNT_USER_FIELDS.accountStatusChangedBy.returned).toBe(false);
    expect(ACCOUNT_USER_FIELDS.accountStatusChangedAt.returned).toBe(false);
  });

  it("are neither required nor defaulted by the library", () => {
    for (const field of Object.values(ACCOUNT_USER_FIELDS)) {
      expect(field.required).toBe(false);
      expect("defaultValue" in field).toBe(false);
    }
  });

  it("name the three statuses V149's CHECK allows", () => {
    expect(ACCOUNT_STATUSES).toEqual(["approved", "pending", "denied"]);
  });
});

describe("who is an application administrator", () => {
  it("matches the configured list case-insensitively", () => {
    expect(isAppAdmin("Ken@Acme-Robotics.dev", ADMINS)).toBe(true);
    expect(isAppAdmin("maya@acme-robotics.dev", ADMINS)).toBe(false);
  });

  it("is nobody when the list is empty, or the address absent", () => {
    expect(isAppAdmin("ken@acme-robotics.dev", [])).toBe(false);
    expect(isAppAdmin(null, ADMINS)).toBe(false);
    expect(isAppAdmin(undefined, ADMINS)).toBe(false);
  });
});

describe("the effective status", () => {
  it("is approved for an administrator whatever is stored", () => {
    for (const accountStatus of ["pending", "denied", undefined]) {
      expect(
        effectiveAccountStatus({ email: "ken@acme-robotics.dev", accountStatus }, ADMINS),
      ).toBe("approved");
    }
  });

  it("is the stored status for everybody else", () => {
    for (const status of ACCOUNT_STATUSES) {
      expect(effectiveAccountStatus({ email: "p@x.dev", accountStatus: status }, ADMINS)).toBe(
        status,
      );
    }
  });

  it("is unknown — never approved — when nothing is stored", () => {
    expect(effectiveAccountStatus({ email: "p@x.dev" }, ADMINS)).toBe("unknown");
    expect(effectiveAccountStatus({ email: "p@x.dev", accountStatus: "weird" }, ADMINS)).toBe(
      "unknown",
    );
    expect(isEffectivelyApproved({ email: "p@x.dev" }, ADMINS)).toBe(false);
  });

  it("admits only approved accounts and administrators", () => {
    expect(isEffectivelyApproved({ email: "p@x.dev", accountStatus: "approved" }, ADMINS)).toBe(
      true,
    );
    expect(isEffectivelyApproved({ email: "p@x.dev", accountStatus: "pending" }, ADMINS)).toBe(
      false,
    );
    expect(isEffectivelyApproved({ email: "p@x.dev", accountStatus: "denied" }, ADMINS)).toBe(
      false,
    );
  });
});

describe("rule 2, as a pure decision", () => {
  it("approves an administrator first", () => {
    expect(decideAccountStatus({ appAdmin: true, invited: true, preapproved: true })).toEqual({
      status: "approved",
      reason: "app_admin",
    });
  });

  it("approves an invited address next", () => {
    expect(decideAccountStatus({ appAdmin: false, invited: true, preapproved: true })).toEqual({
      status: "approved",
      reason: "invited",
    });
  });

  it("approves a pre-approved address after that", () => {
    expect(decideAccountStatus({ appAdmin: false, invited: false, preapproved: true })).toEqual({
      status: "approved",
      reason: "preapproved",
    });
  });

  it("holds everybody else", () => {
    expect(decideAccountStatus({ appAdmin: false, invited: false, preapproved: false })).toEqual({
      status: "pending",
      reason: "held",
    });
  });
});

describe("deciding a new account", () => {
  const configuration = { appAdminEmails: ADMINS };

  it("asks the database nothing about an administrator", async () => {
    const { fake, calls } = lookups();

    await expect(
      decideNewAccount("KEN@acme-robotics.dev", { configuration, lookups: fake, logger: logger() }),
    ).resolves.toEqual({ status: "approved", reason: "app_admin" });
    expect(calls).toEqual([]);
  });

  it("stops at the invitation, lower-casing the address", async () => {
    const { fake, calls } = lookups({ invited: true });

    await expect(
      decideNewAccount("Priya@Contractor.dev", { configuration, lookups: fake, logger: logger() }),
    ).resolves.toEqual({ status: "approved", reason: "invited" });
    expect(calls).toEqual(["invitation:priya@contractor.dev"]);
  });

  it("reads the pre-approval when there is no invitation", async () => {
    const { fake, calls } = lookups({ preapproved: true });

    await expect(
      decideNewAccount("lee@acme-robotics.dev", { configuration, lookups: fake, logger: logger() }),
    ).resolves.toEqual({ status: "approved", reason: "preapproved" });
    expect(calls).toEqual([
      "invitation:lee@acme-robotics.dev",
      "preapproved:lee@acme-robotics.dev",
    ]);
  });

  it("holds a stranger", async () => {
    const { fake } = lookups();

    await expect(
      decideNewAccount("priya@contractor.dev", { configuration, lookups: fake, logger: logger() }),
    ).resolves.toEqual({ status: "pending", reason: "held" });
  });

  it("holds rather than fails when a lookup fails, and says so", async () => {
    const { fake } = lookups({ fail: true });
    const log = logger();

    await expect(
      decideNewAccount("priya@contractor.dev", { configuration, lookups: fake, logger: log }),
    ).resolves.toEqual({ status: "pending", reason: "held" });
    expect(log.warnings.join()).toContain("priya@contractor.dev");
  });
});

describe("the user hooks", () => {
  it("decide the status as part of the insert, stamped and undecided by anybody", async () => {
    const { fake } = lookups();
    const hooks = accountApprovalHooks({
      configuration: { appAdminEmails: ADMINS },
      lookups: fake,
      notifier: notifier().fake,
      logger: logger(),
    });

    const result = await hooks.create?.before?.(newUser("priya@contractor.dev"), null);

    expect(result).toMatchObject({
      data: {
        email: "priya@contractor.dev",
        accountStatus: "pending",
        accountStatusReason: "held",
        accountStatusChangedBy: null,
      },
    });
    expect(
      (result as { data: Record<string, unknown> }).data.accountStatusChangedAt,
    ).toBeInstanceOf(Date);
  });

  it.each([
    ["an administrator", "ken@acme-robotics.dev", {}, "app_admin"],
    ["an invited address", "maya@acme-robotics.dev", { invited: true }, "invited"],
    ["a pre-approved address", "lee@acme-robotics.dev", { preapproved: true }, "preapproved"],
  ])("approve %s", async (_label, email, facts, reason) => {
    const hooks = accountApprovalHooks({
      configuration: { appAdminEmails: ADMINS },
      lookups: lookups(facts).fake,
      notifier: notifier().fake,
      logger: logger(),
    });

    await expect(hooks.create?.before?.(newUser(email), null)).resolves.toMatchObject({
      data: { accountStatus: "approved", accountStatusReason: reason },
    });
  });

  it("tell the notifier about a held row once it is written, and about nobody else", async () => {
    const recorded = notifier();
    const hooks = accountApprovalHooks({
      configuration: { appAdminEmails: ADMINS },
      lookups: lookups().fake,
      notifier: recorded.fake,
      logger: logger(),
    });

    await hooks.create?.after?.(
      { ...newUser("priya@contractor.dev"), accountStatus: "pending" },
      null,
    );
    await hooks.create?.after?.(
      { ...newUser("lee@acme-robotics.dev"), accountStatus: "approved" },
      null,
    );

    expect(recorded.held).toEqual(["priya@contractor.dev"]);
  });

  it("keep the GitHub login fixed on update", async () => {
    const hooks = accountApprovalHooks({
      configuration: { appAdminEmails: ADMINS },
      lookups: lookups().fake,
      notifier: notifier().fake,
      logger: logger(),
    });

    expect(hooks.update?.before).toBe(keepGithubLoginFixed);
    await expect(keepGithubLoginFixed({ name: "New name" }, null)).resolves.toBeUndefined();
    await expect(
      keepGithubLoginFixed({ name: "New name", githubLogin: "someone-else" }, null),
    ).resolves.toEqual({ data: { name: "New name", githubLogin: undefined } });
  });
});

/** A pool that answers each statement with the next queued result and records it. */
function fakePool(answers: ({ rowCount: number } | Error)[] = []) {
  const statements: { text: string; values: unknown[] }[] = [];
  const pool = {
    query(text: string, values: unknown[]) {
      statements.push({ text, values });
      const answer = answers.shift() ?? { rowCount: 0 };
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  } as unknown as QueryPool;

  return { pool, statements };
}

describe("the lookups over the pool", () => {
  it("read a pending, unexpired invitation by lower-cased address", async () => {
    const { pool, statements } = fakePool([{ rowCount: 1 }]);

    await expect(poolLookups(pool).hasPendingInvitation("priya@contractor.dev")).resolves.toBe(
      true,
    );
    expect(statements[0].text).toMatch(/from invitation/);
    expect(statements[0].text).toMatch(/"status" = 'pending'/);
    expect(statements[0].text).toMatch(/"expiresAt" > now\(\)/);
    expect(statements[0].values).toEqual(["priya@contractor.dev"]);
  });

  it("read the pre-approved list", async () => {
    const { pool, statements } = fakePool([{ rowCount: 0 }]);

    await expect(poolLookups(pool).isPreapproved("lee@acme-robotics.dev")).resolves.toBe(false);
    expect(statements[0].text).toMatch(/from app_preapproved_emails/);
  });
});

describe("the hold notifier", () => {
  const configuration = {
    appAdminEmails: ["ken@acme-robotics.dev", "maya@acme-robotics.dev"],
    uiUrl: "http://localhost:3000/",
  };
  const priya = {
    id: "u1",
    name: "Priya Raman",
    email: "Priya@contractor.dev",
    githubLogin: "priyaraman",
  };

  it("records a held event and emails every administrator a link to the admin page", async () => {
    const { pool, statements } = fakePool();
    const mailer = new RecordingMailer();

    await holdNotifier({ pool, mailer, configuration, logger: logger() }).held(priya);

    expect(statements[0].text).toMatch(/insert into app_account_events/);
    expect(statements[0].values).toEqual(["u1", "priya@contractor.dev", '{"reason":"held"}']);
    expect(mailer.sent.map((message) => message.to)).toEqual(configuration.appAdminEmails);
    expect(mailer.sent[0].text).toContain("http://localhost:3000/admin/accounts");
    expect(mailer.sent[0].text).toContain("@priyaraman");
  });

  it("sends nothing, and fails nothing, without SMTP", async () => {
    const { pool } = fakePool();
    const mailer = new RecordingMailer("none");

    await expect(
      holdNotifier({ pool, mailer, configuration, logger: logger() }).held(priya),
    ).resolves.toBeUndefined();
    expect(mailer.sent).toEqual([]);
  });

  it("sends nothing where no mailer was wired at all", async () => {
    const { pool, statements } = fakePool();

    await holdNotifier({ pool, configuration, logger: logger() }).held(priya);

    expect(statements).toHaveLength(1);
  });

  it("logs a failed insert and a refused address, and still emails the rest", async () => {
    const { pool } = fakePool([new Error("insert refused")]);
    const mailer = new RecordingMailer();
    const log = logger();
    mailer.failFor("ken@acme-robotics.dev");

    await holdNotifier({ pool, mailer, configuration, logger: log }).held(priya);

    expect(log.warnings).toHaveLength(2);
    expect(mailer.sent.map((message) => message.to)).toEqual(configuration.appAdminEmails);
  });
});
