import type { AuditService } from "../audit/audit.service";
import type { VaultService } from "../vault/vault.service";
import { accountRow, SA_ADMIN, SA_ORG } from "./service-accounts.fixture";
import type {
  NewServiceAccountRow,
  NewServiceTokenRow,
  ServiceAccountRow,
  ServiceAccountsRepository,
} from "./service-accounts.repository";
import { ServiceAccountsService } from "./service-accounts.service";
import { hashServiceToken } from "./service.tokens";

/**
 * Create, list, rotate and revoke (#485) — on an in-memory store that behaves like V091: one live
 * token per account, lookups filtered on `revoked_at is null`.
 */

/** A store holding accounts and tokens in memory. */
class MemoryAccounts {
  readonly accounts = new Map<
    string,
    NewServiceAccountRow & { id: string; disabled_at: Date | null }
  >();
  readonly tokens: (NewServiceTokenRow & { revoked_at: Date | null })[] = [];

  transaction<T>(work: (trx: never) => Promise<T>): Promise<T> {
    return work(undefined as never);
  }

  nameTaken(_org: string, name: string): Promise<boolean> {
    return Promise.resolve([...this.accounts.values()].some((account) => account.name === name));
  }

  insertAccount(_trx: unknown, account: NewServiceAccountRow): Promise<string> {
    const id = `5eed0091-0000-4000-8000-00000000000${this.accounts.size + 1}`;
    this.accounts.set(id, { ...account, id, disabled_at: null });
    return Promise.resolve(id);
  }

  insertToken(_trx: unknown, token: NewServiceTokenRow): Promise<void> {
    if (
      this.tokens.some(
        (row) => row.service_account_id === token.service_account_id && row.revoked_at === null,
      )
    ) {
      throw new Error("service_tokens_one_live_idx");
    }
    this.tokens.push({ ...token, revoked_at: null });
    return Promise.resolve();
  }

  revokeLive(_trx: unknown, accountId: string, at: Date): Promise<number> {
    const live = this.tokens.filter(
      (row) => row.service_account_id === accountId && row.revoked_at === null,
    );
    for (const row of live) row.revoked_at = at;
    return Promise.resolve(live.length);
  }

  disable(_trx: unknown, accountId: string, at: Date): Promise<void> {
    const account = this.accounts.get(accountId);
    if (account) account.disabled_at = at;
    return Promise.resolve();
  }

  find(_org: string, id: string): Promise<ServiceAccountRow | undefined> {
    const account = this.accounts.get(id);
    if (account === undefined) return Promise.resolve(undefined);
    const live = this.tokens.find(
      (row) => row.service_account_id === id && row.revoked_at === null,
    );

    return Promise.resolve(
      accountRow({
        id,
        name: account.name,
        scopes: [...account.scopes],
        disabled_at: account.disabled_at,
        token_id: live?.id ?? null,
        token_hint_sealed: live?.hint_sealed ?? null,
        token_created_at: live?.created_at ?? null,
      }),
    );
  }

  async list(org: string): Promise<ServiceAccountRow[]> {
    const rows = await Promise.all([...this.accounts.keys()].map((id) => this.find(org, id)));
    return rows.filter((row): row is ServiceAccountRow => row !== undefined);
  }

  /** Which live token, if any, a presented value would authenticate as. */
  authenticates(token: string): boolean {
    const hash = hashServiceToken(token);
    return this.tokens.some(
      (row) =>
        row.token_hash === hash &&
        row.revoked_at === null &&
        this.accounts.get(row.service_account_id)?.disabled_at === null,
    );
  }
}

/** A vault that "seals" by wrapping, so a test can see what was sealed. */
function vault(): jest.Mocked<VaultService> {
  return {
    encryptText: jest.fn((_org: string, record: string, text: string) =>
      Promise.resolve(`ouro.v1.1.${record}.${text}`),
    ),
    decryptText: jest.fn((_org: string, _record: string, envelope: string) =>
      Promise.resolve(envelope.split(".").slice(4).join(".")),
    ),
  } as unknown as jest.Mocked<VaultService>;
}

/** The service over fresh fakes. */
function setup() {
  const store = new MemoryAccounts();
  const sealing = vault();
  const audit = {
    record: jest.fn().mockResolvedValue("event"),
  } as unknown as jest.Mocked<AuditService>;
  const service = new ServiceAccountsService(
    store as unknown as ServiceAccountsRepository,
    sealing,
    audit,
  );

  return { store, sealing, audit, service };
}

const REQUEST = {
  name: "devops-bot",
  scopes: ["api.read", "farm.submit"] as ("api.read" | "farm.submit")[],
};

describe("creating a service account", () => {
  it("returns the token once, and stores only its hash and a sealed hint", async () => {
    const { store, sealing, service } = setup();
    const created = await service.create(SA_ORG, SA_ADMIN, REQUEST);

    expect(created.token).toMatch(/^orb_svc_/);
    expect(store.tokens).toHaveLength(1);
    expect(store.tokens[0].token_hash).toBe(hashServiceToken(created.token));
    expect(JSON.stringify(store.tokens[0])).not.toContain(created.token.slice(8));
    // What the vault was asked to seal is the masked hint, not the token.
    expect(sealing.encryptText).toHaveBeenCalledWith(
      SA_ORG,
      store.tokens[0].id,
      created.account.token?.hint,
    );
    expect(created.account.token?.hint).toMatch(/^orb_svc_•{4}/);
    expect(store.authenticates(created.token)).toBe(true);
  });

  it("audits the creation without the token or its hint", async () => {
    const { audit, service } = setup();
    const created = await service.create(SA_ORG, SA_ADMIN, REQUEST);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "service_account.created",
        subjectType: "service_account",
        subjectId: created.account.id,
        actorId: SA_ADMIN,
        detail: { name: "devops-bot", scopes: "api.read,farm.submit" },
      }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(created.token.slice(8));
  });

  it("refuses a name the workspace already has", async () => {
    const { service } = setup();

    await service.create(SA_ORG, SA_ADMIN, REQUEST);

    await expect(service.create(SA_ORG, SA_ADMIN, REQUEST)).rejects.toMatchObject({
      code: "service_account_name_taken",
    });
  });
});

describe("rotating", () => {
  it("kills the old token and returns a new one, once", async () => {
    const { store, service, audit } = setup();
    const created = await service.create(SA_ORG, SA_ADMIN, REQUEST);
    const rotated = await service.rotate(SA_ORG, SA_ADMIN, created.account.id);

    expect(rotated.token).not.toBe(created.token);
    expect(store.authenticates(created.token)).toBe(false);
    expect(store.authenticates(rotated.token)).toBe(true);
    expect(store.tokens.filter((row) => row.revoked_at === null)).toHaveLength(1);
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "service_account.rotated" }),
    );
  });

  it("refuses an unknown account and a revoked one", async () => {
    const { service } = setup();

    await expect(service.rotate(SA_ORG, SA_ADMIN, "nope")).rejects.toMatchObject({
      code: "service_account_not_found",
    });

    const created = await service.create(SA_ORG, SA_ADMIN, REQUEST);

    await service.revoke(SA_ORG, SA_ADMIN, created.account.id);
    await expect(service.rotate(SA_ORG, SA_ADMIN, created.account.id)).rejects.toMatchObject({
      code: "service_account_disabled",
    });
  });
});

describe("revoking", () => {
  it("kills the token and disables the account", async () => {
    const { store, service } = setup();
    const created = await service.create(SA_ORG, SA_ADMIN, REQUEST);
    const revoked = await service.revoke(SA_ORG, SA_ADMIN, created.account.id);

    expect(revoked.disabledAt).not.toBeNull();
    expect(revoked.token).toBeNull();
    expect(store.authenticates(created.token)).toBe(false);
  });

  it("is idempotent, and records only the first", async () => {
    const { service, audit } = setup();
    const created = await service.create(SA_ORG, SA_ADMIN, REQUEST);

    await service.revoke(SA_ORG, SA_ADMIN, created.account.id);
    await service.revoke(SA_ORG, SA_ADMIN, created.account.id);

    expect(
      audit.record.mock.calls.filter(([event]) => event.action === "service_account.revoked"),
    ).toHaveLength(1);
  });
});

describe("listing", () => {
  it("opens each live token's hint and never returns a token", async () => {
    const { service } = setup();
    const created = await service.create(SA_ORG, SA_ADMIN, REQUEST);
    const list = await service.list(SA_ORG);

    expect(list.items).toHaveLength(1);
    expect(list.items[0].token?.hint).toBe(created.account.token?.hint);
    expect(JSON.stringify(list)).not.toContain(created.token.slice(8));
    expect(list.scopes.map((scope) => scope.scope)).toEqual(["api.read", "farm.submit"]);
  });
});
