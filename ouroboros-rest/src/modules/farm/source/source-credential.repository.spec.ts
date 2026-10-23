import { recordingDatabase, type RecordingDatabase } from "../../db/database.fixture";
import { SourceCredentialRepository } from "./source-credential.repository";

/**
 * The ticket ledger's statements (#991), compiled: the mint upserts over an unredeemed row only,
 * the read joins the job and its repository, and the redemption is one statement that sets
 * `redeemed_at` where it is still null — the single-use rule, decided by the database.
 */

const JOB = "0199a1f2-6b3c-7d4e-8f50-61a2b3c4d5e6";
const ORG = "acme-robotics-id";
const HASH = "a".repeat(64);
const NOW = new Date("2026-10-16T12:00:00.000Z");

describe("the source-credential ledger", () => {
  let database: RecordingDatabase;
  let repository: SourceCredentialRepository;

  beforeEach(() => {
    database = recordingDatabase();
    repository = new SourceCredentialRepository(database.service);
  });

  /** The one statement issued. */
  function only(): { sql: string; parameters: readonly unknown[] } {
    expect(database.statements).toHaveLength(1);

    return database.statements[0];
  }

  it("mints over an unredeemed row, and over nothing once the ticket was redeemed", async () => {
    database.answers({ rows: [{ build_job_id: JOB }] });

    await expect(
      repository.mint(ORG, JOB, HASH, NOW, new Date(NOW.getTime() + 60_000)),
    ).resolves.toBe(true);

    const { sql, parameters } = only();
    expect(sql).toContain('insert into "ouroboros"."build_job_source_credentials"');
    expect(sql).toContain('on conflict ("build_job_id") do update set');
    expect(sql).toContain('"build_job_source_credentials"."redeemed_at" is null');
    expect(parameters).toContain(HASH);
    expect(parameters).toContain(ORG);
  });

  it("answers false when the upsert wrote nothing", async () => {
    await expect(
      repository.mint(ORG, JOB, HASH, NOW, new Date(NOW.getTime() + 60_000)),
    ).resolves.toBe(false);
  });

  it("reads the ledger with the job's phase and its repository, by the job alone", async () => {
    database.answers({
      rows: [
        {
          build_job_id: JOB,
          organization_id: ORG,
          token_hash: HASH,
          expires_at: NOW,
          redeemed_at: null,
          status: "offered",
          runner_id: null,
          login: "acme-robotics",
          name: "helios-firmware",
        },
      ],
    });

    await expect(repository.ledger(JOB)).resolves.toEqual({
      jobId: JOB,
      organizationId: ORG,
      tokenHash: HASH,
      expiresAt: NOW,
      redeemedAt: null,
      phase: "offered",
      repository: "acme-robotics/helios-firmware",
    });

    const { sql, parameters } = only();
    expect(sql).toContain('inner join "ouroboros"."build_jobs" as "j"');
    expect(sql).toContain('inner join "ouroboros"."github_repos" as "r"');
    expect(sql).toContain('"j"."organization_id" = "c"."organization_id"');
    expect(parameters).toEqual([JOB]);
  });

  it("reads a queued job with a runner as accepted, and one without as waiting (#1818)", async () => {
    const row = {
      build_job_id: JOB,
      organization_id: ORG,
      token_hash: HASH,
      expires_at: NOW,
      redeemed_at: null,
      status: "queued",
      login: "acme-robotics",
      name: "helios-firmware",
    };
    database.answers({ rows: [{ ...row, runner_id: "runner-1" }] });
    await expect(repository.ledger(JOB)).resolves.toMatchObject({ phase: "accepted" });

    database.answers({ rows: [{ ...row, runner_id: null }] });
    await expect(repository.ledger(JOB)).resolves.toMatchObject({ phase: "waiting" });
  });

  it("answers undefined for a job with no ledger", async () => {
    await expect(repository.ledger(JOB)).resolves.toBeUndefined();
  });

  it("redeems in one statement, only where the ticket is still the ledger's and unredeemed", async () => {
    database.answers({ rows: [{ build_job_id: JOB }] });

    await expect(repository.redeem(JOB, HASH, NOW)).resolves.toBe(true);

    const { sql, parameters } = only();
    expect(sql).toContain(
      'update "ouroboros"."build_job_source_credentials" set "redeemed_at" = $1',
    );
    expect(sql).toContain('"token_hash" = $');
    expect(sql).toContain('"redeemed_at" is null');
    expect(parameters).toEqual([NOW, JOB, HASH]);
  });

  it("answers false when nothing was redeemed — already redeemed, or re-minted since", async () => {
    await expect(repository.redeem(JOB, HASH, NOW)).resolves.toBe(false);
  });
});
