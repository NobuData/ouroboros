import type { VaultService } from "../vault/vault.service";
import type { EnrollmentToken, RunnerPool } from "../db/schema";
import { EnrollmentService } from "./enrollment.service";
import { FarmAudit } from "./farm.audit";
import type { FarmRepository } from "./farm.repository";
import { DEFAULT_TOKEN_TTL_MS } from "./farm.policy";
import { parseToken, TOKEN_PREFIX } from "./farm.tokens";
import { FIXTURE_NOW, FIXTURE_ORGANIZATION, FIXTURE_SEALED, installerStub } from "./farm.fixture";
import type { AuditService } from "../audit/audit.service";
import type { AuditRecord } from "../audit/audit.events";

/**
 * Minting, listing and revoking — and the criterion the first of them exists to keep:
 * **the full token value is returned exactly once, at mint**.
 */

const POOL: RunnerPool = {
  id: "5eed0024-0000-4000-8000-000000000001",
  organization_id: FIXTURE_ORGANIZATION,
  name: "pool-a",
  executor: "container",
  image: "img:0.17",
  description: null,
  env_allowlist: [],
  max_concurrency: 1,
  enabled: true,
  autoscale_pref: {},
  tags: [],
  default_command: null,
  artifact_globs: [],
  created_at: FIXTURE_NOW,
  updated_at: FIXTURE_NOW,
};

/** Everything the service is constructed with, with the writes recorded. */
function subject(overrides: Partial<Record<string, unknown>> = {}): {
  service: EnrollmentService;
  inserted: EnrollmentToken[];
  sealed: string[];
  written: AuditRecord[];
  farm: FarmRepository;
  vault: VaultService;
} {
  const inserted: EnrollmentToken[] = [];
  const sealed: string[] = [];
  const written: AuditRecord[] = [];

  const farm = {
    poolByName: jest.fn(() => Promise.resolve(POOL)),
    insertToken: jest.fn((row: Record<string, unknown>) => {
      const stored = {
        max_uses: 1,
        uses: 0,
        revoked: false,
        revoked_at: null,
        created_at: FIXTURE_NOW,
        ...row,
      } as EnrollmentToken;
      inserted.push(stored);

      return Promise.resolve(stored);
    }),
    tokensOf: jest.fn(() => Promise.resolve(inserted)),
    revokeToken: jest.fn(() => Promise.resolve(undefined)),
    ...overrides,
  } as unknown as FarmRepository;

  const vault = {
    encryptText: jest.fn((_organization: string, _record: string, plaintext: string) => {
      sealed.push(plaintext);

      return Promise.resolve(FIXTURE_SEALED);
    }),
  } as unknown as VaultService;

  const auditService = {
    record: jest.fn((event: AuditRecord) => {
      written.push(event);

      return Promise.resolve("event");
    }),
  } as unknown as AuditService;

  return {
    // The installer is the enroll command's (AH.6); minting itself never reaches it, and a
    // stub that would throw if it did is what says so.
    service: new EnrollmentService(
      farm,
      vault,
      new FarmAudit(auditService),
      installerStub(),
      () => FIXTURE_NOW,
    ),
    inserted,
    sealed,
    written,
    farm,
    vault,
  };
}

describe("minting", () => {
  it("returns the full value, and stores only an envelope", async () => {
    // The criterion, in one assertion pair. What goes back to the operator is the plaintext;
    // what goes into the column is the sealed form, and nothing writes the plaintext anywhere.
    const { service, inserted, sealed } = subject();

    const minted = await service.mint(FIXTURE_ORGANIZATION, "user_ken", { pool: "pool-a" });

    expect(minted.token).toMatch(new RegExp(`^${TOKEN_PREFIX}`));
    expect(inserted[0]?.token_sealed).toBe(FIXTURE_SEALED);
    expect(JSON.stringify(inserted)).not.toContain(parseToken(minted.token)?.secret);
    expect(sealed[0]).toBe(parseToken(minted.token)?.secret);
  });

  it("names its own row in the value, so nothing has to be searched for", async () => {
    const { service, inserted } = subject();

    const minted = await service.mint(FIXTURE_ORGANIZATION, "user_ken", { pool: "pool-a" });

    expect(parseToken(minted.token)?.id).toBe(inserted[0]?.id);
  });

  it("seals against the workspace and the row's own id, so a value cannot be lifted", async () => {
    // The AAD binds both: a sealed value pasted into another workspace's row, or another row of
    // the same workspace, fails authentication rather than decrypting into somebody else's.
    const { service, vault } = subject();

    const minted = await service.mint(FIXTURE_ORGANIZATION, "user_ken", { pool: "pool-a" });

    expect(vault.encryptText).toHaveBeenCalledWith(
      FIXTURE_ORGANIZATION,
      parseToken(minted.token)?.id,
      parseToken(minted.token)?.secret,
    );
  });

  it("defaults to the mockup's ttl 24h and one use", async () => {
    const { service, inserted } = subject();

    await service.mint(FIXTURE_ORGANIZATION, "user_ken", { pool: "pool-a" });

    expect(inserted[0]?.expires_at.getTime()).toBe(FIXTURE_NOW.getTime() + DEFAULT_TOKEN_TTL_MS);
    expect(inserted[0]?.max_uses).toBe(1);
  });

  it("honours a TTL and a use count when it is given them", async () => {
    const { service, inserted } = subject();

    await service.mint(FIXTURE_ORGANIZATION, "user_ken", {
      pool: "pool-a",
      ttlSeconds: 3600,
      maxUses: 5,
    });

    expect(inserted[0]?.expires_at.getTime()).toBe(FIXTURE_NOW.getTime() + 3_600_000);
    expect(inserted[0]?.max_uses).toBe(5);
  });

  it("scopes the token to a pool of THIS workspace", async () => {
    const { service, farm, inserted } = subject();

    await service.mint(FIXTURE_ORGANIZATION, "user_ken", { pool: "pool-a" });

    expect(farm.poolByName).toHaveBeenCalledWith(FIXTURE_ORGANIZATION, "pool-a");
    expect(inserted[0]?.pool_id).toBe(POOL.id);
    expect(inserted[0]?.organization_id).toBe(FIXTURE_ORGANIZATION);
  });

  it("mints nothing when the pool does not exist", async () => {
    // Thrown before anything is generated, so a typo mints nothing — not a row, not a secret.
    const { service, inserted } = subject({
      poolByName: jest.fn(() => Promise.resolve(undefined)),
    });

    await expect(service.mint(FIXTURE_ORGANIZATION, "user_ken", { pool: "typo" })).rejects.toThrow(
      /No pool named typo/,
    );
    expect(inserted).toHaveLength(0);
  });

  it("audits the mint without recording the value", async () => {
    const { service, written } = subject();

    const minted = await service.mint(FIXTURE_ORGANIZATION, "user_ken", { pool: "pool-a" });

    expect(written[0]?.action).toBe("runner.token_minted");
    expect(written[0]?.actorId).toBe("user_ken");
    expect(JSON.stringify(written)).not.toContain(minted.token);
  });
});

describe("listing", () => {
  it("masks every one of them", async () => {
    const { service } = subject();

    await service.mint(FIXTURE_ORGANIZATION, "user_ken", { pool: "pool-a" });
    await service.mint(FIXTURE_ORGANIZATION, "user_ken", { pool: "pool-a" });

    const listed = await service.list(FIXTURE_ORGANIZATION);

    expect(listed).toHaveLength(2);
    for (const token of listed) expect(token.masked).toContain("•");
    expect(JSON.stringify(listed)).not.toContain("ouro.v1.");
  });

  it("gives two tokens two distinguishable masks", async () => {
    const { service } = subject();

    await service.mint(FIXTURE_ORGANIZATION, "user_ken", { pool: "pool-a" });
    await service.mint(FIXTURE_ORGANIZATION, "user_ken", { pool: "pool-a" });

    const [first, second] = await service.list(FIXTURE_ORGANIZATION);

    expect(first?.masked).not.toBe(second?.masked);
  });
});

describe("revoking", () => {
  const revoked = {
    id: "7f3a9c1e-4b0d-4e2a-8f6b-5c3d1e0f2a4b",
    organization_id: FIXTURE_ORGANIZATION,
    pool_id: POOL.id,
    token_sealed: FIXTURE_SEALED,
    expires_at: FIXTURE_NOW,
    max_uses: 5,
    uses: 4,
    revoked: true,
    revoked_at: FIXTURE_NOW,
    created_by: "user_ken",
    created_at: FIXTURE_NOW,
  } satisfies EnrollmentToken;

  it("answers the token as it now stands, with the use count", async () => {
    const { service, written } = subject({
      revokeToken: jest.fn(() => Promise.resolve(revoked)),
    });

    const answer = await service.revoke(FIXTURE_ORGANIZATION, "user_ken", revoked.id);

    expect(answer.revoked).toBe(true);
    expect(answer.uses).toBe(4);
    expect(written[0]?.action).toBe("runner.token_revoked");
    expect(written[0]?.detail?.usesAtRevocation).toBe(4);
  });

  it("is idempotent — a second revoke answers the token rather than a 404", async () => {
    // The caller asked for it to be dead and it is. A 404 here means *no such token*, which is
    // a different fact the panel renders differently.
    const { service } = subject({
      revokeToken: jest.fn(() => Promise.resolve(undefined)),
      tokensOf: jest.fn(() => Promise.resolve([revoked])),
    });

    await expect(
      service.revoke(FIXTURE_ORGANIZATION, "user_ken", revoked.id),
    ).resolves.toMatchObject({ revoked: true });
  });

  it("writes no second audit row for a repeat revoke", async () => {
    const { service, written } = subject({
      revokeToken: jest.fn(() => Promise.resolve(undefined)),
      tokensOf: jest.fn(() => Promise.resolve([revoked])),
    });

    await service.revoke(FIXTURE_ORGANIZATION, "user_ken", revoked.id);

    expect(written).toHaveLength(0);
  });

  it("refuses a token this workspace does not have", async () => {
    const { service } = subject({
      revokeToken: jest.fn(() => Promise.resolve(undefined)),
      tokensOf: jest.fn(() => Promise.resolve([])),
    });

    await expect(service.revoke(FIXTURE_ORGANIZATION, "user_ken", revoked.id)).rejects.toThrow(
      /No such enrollment token/,
    );
  });
});
