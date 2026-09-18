import { recordingDatabase, type RecordingDatabase } from "../db/database.fixture";
import { FarmRepository } from "./farm.repository";
import {
  authority,
  certificate,
  runner,
  FIXTURE_NOW,
  FIXTURE_ORGANIZATION,
  FIXTURE_SEALED,
} from "./farm.fixture";

/**
 * The statements, over a real Kysely and a driver that writes them down.
 *
 * Two questions are asked of every method: **is it scoped to the workspace**, and **does the
 * transactional one do all of its writes or none of them**. Both are properties of the SQL
 * rather than of a mocked method, which is why this suite goes a level below the service.
 *
 * `tokenById` is the one read that is deliberately *not* workspace-scoped, and it gets a test
 * saying so — an assertion that a `where` is absent is worth as much as one that it is
 * present, because the next person to read that method will wonder.
 */

describe("the farm repository", () => {
  let database: RecordingDatabase;
  let farm: FarmRepository;

  beforeEach(() => {
    database = recordingDatabase();
    farm = new FarmRepository(database.service);
  });

  describe("every tenant-scoped read", () => {
    it("filters a pool lookup by workspace", async () => {
      database.answers({ rows: [] });
      await farm.poolByName(FIXTURE_ORGANIZATION, "pool-a");

      expect(database.sql()[0]).toContain('"organization_id" = $1');
      expect(database.statements[0]?.parameters).toEqual([FIXTURE_ORGANIZATION, "pool-a"]);
    });

    it("filters a token list by workspace and orders it newest first", async () => {
      database.answers({ rows: [] });
      await farm.tokensOf(FIXTURE_ORGANIZATION);

      expect(database.sql()[0]).toContain('"organization_id" = $1');
      expect(database.sql()[0]).toContain('order by "created_at" desc');
    });

    it("filters a certificate lookup by workspace and serial", async () => {
      database.answers({ rows: [] });
      await farm.certificateBySerial(FIXTURE_ORGANIZATION, "4a110e97");

      // `(organization_id, serial)` is the unique key, which is what makes this the handshake's
      // lookup rather than a scan.
      expect(database.statements[0]?.parameters).toEqual([FIXTURE_ORGANIZATION, "4a110e97"]);
    });

    it("asks for the one live certificate, by the index's own predicate", async () => {
      database.answers({ rows: [] });
      await farm.liveCertificate(FIXTURE_ORGANIZATION, runner().id);

      expect(database.sql()[0]).toContain('"revoked" = $3');
      expect(database.sql()[0]).toContain('"superseded_at" is null');
    });

    it("reads the fallback setting through the effective view, not the table", async () => {
      // V011's rule: the default is resolved in the database, so a workspace that has never
      // answered reads `false` from the same place an opinionated one reads `true`.
      database.answers({ rows: [] });
      await farm.bearerFallbackPermitted(FIXTURE_ORGANIZATION);

      expect(database.sql()[0]).toContain("workspace_settings_effective");
    });

    it("answers false for a workspace the view has no row for", async () => {
      database.answers({ rows: [] });

      expect(await farm.bearerFallbackPermitted(FIXTURE_ORGANIZATION)).toBe(false);
    });
  });

  describe("the one read that is not scoped", () => {
    it("finds a token by its own id, across every workspace", async () => {
      // It cannot be scoped: an enrolling agent holds no session and no workspace, and the
      // token it presents is what establishes both. Every caller reads the workspace *out of*
      // the row rather than comparing one against it.
      database.answers({ rows: [] });
      await farm.tokenById("7f3a9c1e-4b0d-4e2a-8f6b-5c3d1e0f2a4b");

      expect(database.sql()[0]).not.toContain("organization_id");
    });
  });

  describe("revocation", () => {
    it("is idempotent by where-not-revoked, so a second call writes nothing", async () => {
      // Which is what lets the service tell *already revoked* from *no such token* without a
      // second read on the common path.
      database.answers({ rows: [] });
      await farm.revokeToken(
        FIXTURE_ORGANIZATION,
        "7f3a9c1e-4b0d-4e2a-8f6b-5c3d1e0f2a4b",
        FIXTURE_NOW,
      );

      expect(database.sql()[0]).toContain('"revoked" = $');
      expect(database.sql()[0]).toMatch(/where .*"revoked" = \$/s);
    });

    it("does not clear the runner's serial when a certificate is revoked", async () => {
      // The column says which certificate was issued, and a runner whose identity was revoked
      // is one whose serial an operator still needs to look up. What changes is the answer the
      // handshake gets.
      database.answers({ rows: [] });
      await farm.revokeCertificate(FIXTURE_ORGANIZATION, "id", FIXTURE_NOW, "user_ken", "operator");

      expect(database.sql().join(" ")).not.toContain("cert_serial");
    });
  });

  describe("enrolling", () => {
    it("spends the token, creates the runner and the certificate in one transaction", async () => {
      // `begin` and `commit` are recorded without consuming a queued answer — see
      // `database.fixture.ts` — so the queue is the three real statements.
      database.answers({ rows: [{ id: "token" }] }, { rows: [runner()] }, { rows: [] });

      const issued = certificate(authority());

      await farm.enrol({
        tokenId: "token",
        runner: {
          organization_id: FIXTURE_ORGANIZATION,
          pool_id: "pool",
          name: "forge-01",
          arch: "linux/arm64",
        },
        certificate: {
          organization_id: FIXTURE_ORGANIZATION,
          runner_id: runner().id,
          serial: issued.serial,
          fingerprint: issued.row.fingerprint,
          issued_for: "enrollment",
          not_before: issued.row.not_before,
          not_after: issued.row.not_after,
        },
      });

      expect(database.sql()[0]).toBe("begin");
      expect(database.sql().at(-1)).toBe("commit");
      expect(database.sql().join(" ")).toContain("enrollment_tokens");
      expect(database.sql().join(" ")).toContain("runner_certificates");
    });

    it("guards the use count IN THE STATEMENT, not in the service", async () => {
      // Two agents presenting the last use of the same token concurrently both pass a
      // check-then-write, and exactly one of them updates a row. This is what makes "a second
      // use of a single-use token fails" a property of the database.
      database.answers({ rows: [] });

      await farm.enrol({
        tokenId: "token",
        runner: {
          organization_id: FIXTURE_ORGANIZATION,
          pool_id: "pool",
          name: "x",
          arch: "linux/arm64",
        },
      });

      expect(database.sql()[1]).toContain('"uses" < "max_uses"');
      expect(database.sql()[1]).toContain('"uses" + $');
    });

    it("writes nothing else when the token had no use left", async () => {
      database.answers({ rows: [] });

      const created = await farm.enrol({
        tokenId: "token",
        runner: {
          organization_id: FIXTURE_ORGANIZATION,
          pool_id: "pool",
          name: "x",
          arch: "linux/arm64",
        },
      });

      expect(created).toBeUndefined();
      expect(database.sql().join(" ")).not.toContain("insert into");
    });
  });

  describe("renewing", () => {
    it("supersedes and issues inside one transaction", async () => {
      // `runner_certificates_live_idx` refuses the moment both are live, so a renewal that is
      // not atomic fails half the time under concurrency rather than leaving two identities.
      const issued = certificate(authority());
      database.answers({}, { rows: [issued.row] }, {});

      await farm.renew(
        {
          supersededId: "old",
          certificate: {
            organization_id: FIXTURE_ORGANIZATION,
            runner_id: runner().id,
            serial: issued.serial,
            fingerprint: issued.row.fingerprint,
            issued_for: "renewal",
            not_before: issued.row.not_before,
            not_after: issued.row.not_after,
          },
        },
        FIXTURE_NOW,
      );

      expect(database.sql()[0]).toBe("begin");
      expect(database.sql()[1]).toContain("superseded_at");
      expect(database.sql()[2]).toContain("insert into");
      expect(database.sql()[3]).toContain("cert_serial");
      expect(database.sql().at(-1)).toBe("commit");
    });
  });

  describe("the authority", () => {
    it("creates one without throwing when a simultaneous enrollment got there first", async () => {
      // Two agents enrolling into a fresh workspace at the same moment is an ordinary race, and
      // the loser should get the winner's CA rather than a 500.
      const existing = authority();
      database.answers({}, { rows: [existing.row] });

      expect(await farm.insertAuthority({ ...existing.row, key_sealed: FIXTURE_SEALED })).toEqual(
        existing.row,
      );
      expect(database.sql()[0]).toContain("on conflict");
      expect(database.sql()[0]).toContain("do nothing");
    });
  });
});
