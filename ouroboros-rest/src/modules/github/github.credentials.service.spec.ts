import {
  GITHUB_TOKEN_CLEARED_EVENT,
  GITHUB_TOKEN_ROTATED_EVENT,
  GITHUB_TOKEN_SET_EVENT,
} from "../audit/audit.events";
import { recordingAudit, type RecordingAudit } from "../audit/audit.fixture";
import { isEnvelope } from "../vault/envelope";
import { inMemoryVault } from "../vault/vault.fixture";
import type { VaultService } from "../vault/vault.service";
import {
  FIXTURE_MASK,
  FIXTURE_ROTATED_TOKEN,
  FIXTURE_TOKEN,
  FIXTURE_WORKSPACE,
  credentialRow,
  fixtureActor,
} from "./github.fixture";
import type { GithubCredentialsRepository } from "./github.credentials.repository";
import { GITHUB_CREDENTIAL_SUBJECT, GithubCredentialsService } from "./github.credentials.service";
import { GITHUB_FAILURES, GithubApiError } from "./github.errors";
import { GithubRateLimiter } from "./github.rate-limit";
import { budgetHeaders } from "./github.fixture";
import { headerReader } from "./github.client";

/**
 * The credential's life, with a **real vault** underneath it.
 *
 * The vault is `inMemoryVault()` rather than a mock, and that is the point: what is asserted
 * below is that what reaches the column is an envelope, that reading it back produces the
 * mask and nothing more, and that a value sealed for one workspace cannot be opened as
 * another's. A mocked `encryptText` returning `"sealed"` would satisfy every one of those
 * assertions while proving none of them.
 *
 * Four claims, and they are the first, third and fourth acceptance criteria:
 *
 *   * set → rotate → clear each do the one thing they say, and the trail says which;
 *   * the *old* token is gone rather than shadowed — nothing caches a decrypted credential;
 *   * a workspace with no token answers a **designed** reason rather than crashing;
 *   * the rate guard's view of the old token's budget does not survive a rotation.
 */

describe("the GitHub credentials service", () => {
  let repository: jest.Mocked<GithubCredentialsRepository>;
  let vault: VaultService;
  let limiter: GithubRateLimiter;
  let audit: RecordingAudit;
  let service: GithubCredentialsService;
  let stored: string | undefined;

  beforeEach(() => {
    stored = undefined;
    vault = inMemoryVault().vault;
    limiter = new GithubRateLimiter();
    audit = recordingAudit();

    repository = {
      find: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(stored === undefined ? undefined : credentialRow(stored)),
        ),
      exists: jest.fn().mockImplementation(() => Promise.resolve(stored !== undefined)),
      upsert: jest.fn().mockImplementation((_workspace: string, envelope: string) => {
        stored = envelope;
        return Promise.resolve(credentialRow(envelope));
      }),
      remove: jest.fn().mockImplementation(() => {
        const had = stored !== undefined;

        stored = undefined;
        return Promise.resolve(had);
      }),
      reseal: jest.fn(),
      configured: jest
        .fn()
        .mockImplementation(() => Promise.resolve(stored === undefined ? [] : [FIXTURE_WORKSPACE])),
    } as unknown as jest.Mocked<GithubCredentialsRepository>;

    service = new GithubCredentialsService(repository, vault, limiter, audit.service);
  });

  describe("storing the first token", () => {
    it("seals it before it reaches the column", async () => {
      await service.set(fixtureActor(), FIXTURE_TOKEN);

      // The column's own CHECK refuses anything else, so this is the service meeting a
      // guarantee rather than making one — and a plaintext here would be a check violation
      // in production, which is a worse place to find out.
      expect(isEnvelope(stored ?? "")).toBe(true);
      expect(stored).not.toContain(FIXTURE_TOKEN);
    });

    it("answers the mask, so the surface needs no second request", async () => {
      await expect(service.set(fixtureActor(), FIXTURE_TOKEN)).resolves.toEqual({
        configured: true,
        masked: FIXTURE_MASK,
        createdAt: expect.any(String) as string,
        updatedAt: expect.any(String) as string,
      });
    });

    it("records that a token was set, attributed to the person who set it", async () => {
      const actor = fixtureActor();

      await service.set(actor, FIXTURE_TOKEN);

      expect(audit.records).toEqual([
        {
          organizationId: FIXTURE_WORKSPACE,
          actorId: actor.actorId,
          action: GITHUB_TOKEN_SET_EVENT,
          subjectType: GITHUB_CREDENTIAL_SUBJECT,
          subjectId: FIXTURE_WORKSPACE,
          at: actor.at,
          detail: { rotated: false, outcome: "success" },
        },
      ]);
    });
  });

  describe("rotating", () => {
    it("replaces the stored value, and the old one is not recoverable from the new", async () => {
      await service.set(fixtureActor(), FIXTURE_TOKEN);
      const first = stored;

      await service.set(fixtureActor(), FIXTURE_ROTATED_TOKEN);

      expect(stored).not.toBe(first);
      await expect(service.tokenFor(FIXTURE_WORKSPACE)).resolves.toBe(FIXTURE_ROTATED_TOKEN);
    });

    it("records a rotation rather than a second set", async () => {
      await service.set(fixtureActor(), FIXTURE_TOKEN);
      await service.set(fixtureActor(), FIXTURE_ROTATED_TOKEN);

      // *"When did this workspace start syncing"* and *"has the token been replaced since"*
      // are different questions, and a trail that spelled both `set` could answer only the
      // first.
      expect(audit.records.map((record) => record.action)).toEqual([
        GITHUB_TOKEN_SET_EVENT,
        GITHUB_TOKEN_ROTATED_EVENT,
      ]);
    });

    it("forgets the old token's rate-limit window", async () => {
      limiter.observe(FIXTURE_WORKSPACE, headerReader(budgetHeaders({ remaining: 0 })));

      await service.set(fixtureActor(), FIXTURE_TOKEN);

      // The numbers described the token that has just been replaced; keeping them would
      // stand a freshly pasted token down for up to an hour.
      expect(limiter.snapshot(FIXTURE_WORKSPACE)).toBeUndefined();
    });
  });

  describe("reading", () => {
    it("answers not-configured for a workspace that has none", async () => {
      await expect(service.read(FIXTURE_WORKSPACE)).resolves.toEqual({
        configured: false,
        masked: null,
        createdAt: null,
        updatedAt: null,
      });
    });

    it("answers the mask, and never any more of the token than that", async () => {
      await service.set(fixtureActor(), FIXTURE_TOKEN);

      const resource = await service.read(FIXTURE_WORKSPACE);

      expect(resource.masked).toBe(FIXTURE_MASK);
      expect(JSON.stringify(resource)).not.toContain(FIXTURE_TOKEN.slice(4, 20));
    });
  });

  describe("clearing", () => {
    it("removes the token and says the workspace has none", async () => {
      await service.set(fixtureActor(), FIXTURE_TOKEN);

      await expect(service.clear(fixtureActor())).resolves.toEqual({
        configured: false,
        masked: null,
        createdAt: null,
        updatedAt: null,
      });
      expect(stored).toBeUndefined();
    });

    it("succeeds on a workspace that had none, because that is the outcome asked for", async () => {
      await expect(service.clear(fixtureActor())).resolves.toMatchObject({ configured: false });
    });

    it("records the press either way, and says whether anything was removed", async () => {
      await service.clear(fixtureActor());
      await service.set(fixtureActor(), FIXTURE_TOKEN);
      await service.clear(fixtureActor());

      expect(audit.records.map((record) => [record.action, record.detail?.removed])).toEqual([
        [GITHUB_TOKEN_CLEARED_EVENT, false],
        [GITHUB_TOKEN_SET_EVENT, undefined],
        [GITHUB_TOKEN_CLEARED_EVENT, true],
      ]);
    });

    it("forgets the budget, so a later token does not inherit a spent window", async () => {
      await service.set(fixtureActor(), FIXTURE_TOKEN);
      limiter.observe(FIXTURE_WORKSPACE, headerReader(budgetHeaders({ remaining: 0 })));

      await service.clear(fixtureActor());

      expect(limiter.snapshot(FIXTURE_WORKSPACE)).toBeUndefined();
    });
  });

  describe("handing the token to a caller", () => {
    it("opens the stored envelope on every call rather than caching one", async () => {
      await service.set(fixtureActor(), FIXTURE_TOKEN);

      await expect(service.tokenFor(FIXTURE_WORKSPACE)).resolves.toBe(FIXTURE_TOKEN);
      await expect(service.tokenFor(FIXTURE_WORKSPACE)).resolves.toBe(FIXTURE_TOKEN);

      // Two reads, not one and a cache — which is what makes "the old token is never used
      // again" structural rather than intended.
      expect(repository.find).toHaveBeenCalledTimes(2);
    });

    it("refuses with a designed reason when the workspace has no token", async () => {
      // *"clear → sync pauses with a designed status (not a crash)"*, at the point the sync
      // would otherwise have discovered it as an undefined.
      await expect(service.tokenFor(FIXTURE_WORKSPACE)).rejects.toMatchObject({
        failure: GITHUB_FAILURES.notConfigured,
      });
      await expect(service.tokenFor(FIXTURE_WORKSPACE)).rejects.toBeInstanceOf(GithubApiError);
    });

    it("says which workspaces have one, without opening any of them (#102)", async () => {
      // The backlog sync's entry point. Two `off` states depend on this being a different
      // question from *what is the token*: no row is `not_configured`, and a row with no
      // enabled repository is `no_repositories`.
      await expect(service.configuredOrganizations()).resolves.toEqual([]);

      await service.set(fixtureActor(), FIXTURE_TOKEN);

      await expect(service.configuredOrganizations()).resolves.toEqual([FIXTURE_WORKSPACE]);
      // No envelope was opened for the question — `find` is what loads one.
      expect(repository.find).not.toHaveBeenCalled();
    });

    it("answers the same question about one workspace, for M.4's status (#113)", async () => {
      // Asked under a tenant context rather than over the whole installation, and it is the
      // first thing a paused sync has to be able to say: *no token*. Derived from the row
      // rather than from a failure, which is what makes it right on a process that has polled
      // nothing yet.
      await expect(service.isConfigured(FIXTURE_WORKSPACE)).resolves.toBe(false);

      await service.set(fixtureActor(), FIXTURE_TOKEN);

      await expect(service.isConfigured(FIXTURE_WORKSPACE)).resolves.toBe(true);

      // Asked about the workspace it was given, and about no other.
      expect(repository.exists).toHaveBeenLastCalledWith(FIXTURE_WORKSPACE);
      // No envelope was opened for the question — `find` is what loads one.
      expect(repository.find).not.toHaveBeenCalled();
    });

    it("cannot be tricked into opening another workspace's token", async () => {
      await service.set(fixtureActor(), FIXTURE_TOKEN);
      const sealed = stored ?? "";

      // The envelope's additional authenticated data binds the workspace, so a ciphertext
      // moved between rows fails authentication rather than decrypting into somebody else's
      // credential. Asserted against the real vault, because it is the vault's guarantee.
      await expect(
        vault.decryptText("org-someone-else", "org-someone-else", sealed),
      ).rejects.toThrow();
    });
  });

  describe("the trail", () => {
    it("writes exactly one event per operation", async () => {
      await service.set(fixtureActor(), FIXTURE_TOKEN);
      await service.set(fixtureActor(), FIXTURE_ROTATED_TOKEN);
      await service.clear(fixtureActor());

      expect(audit.records).toHaveLength(3);
    });

    it("fails the operation loudly when the trail cannot be written", async () => {
      // `connection.audit.ts`'s posture for the success path: a credential change nobody can
      // prove happened is worse than a request that failed, and the `PUT` is idempotent.
      audit.failWith(new Error("audit_events is unavailable"));

      await expect(service.set(fixtureActor(), FIXTURE_TOKEN)).rejects.toThrow(
        "audit_events is unavailable",
      );
    });
  });
});
