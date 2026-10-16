/**
 * The ticket ledger's statements (AG.7, #991) — `build_job_source_credentials`, V150.
 *
 * Two writes and one read. The mint upserts over an unredeemed row, so a job offered again
 * carries a fresh ticket and the runner that did not take it holds a dead one. The redemption
 * is **one statement**: it sets `redeemed_at` where it is still null and returns the row, so
 * two runners presenting the same ticket at the same instant get one credential and one
 * refusal — the database decides, not a read followed by a write.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../../db/db.service";
import type { BuildJobStatus } from "../../db/schema";

/** What the redemption reads beside the ledger: whose job this is, and whether it is running. */
export interface SourceLedger {
  readonly jobId: string;
  readonly organizationId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly redeemedAt: Date | null;
  readonly status: BuildJobStatus;
  /** `owner/name`, for the audit trail. */
  readonly repository: string;
}

@Injectable()
export class SourceCredentialRepository {
  /** @param database - The typed connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Mint a ticket over a job's ledger row — fresh, or re-minted over an unredeemed one.
   *
   * @param organizationId - The workspace.
   * @param jobId - The build job.
   * @param tokenHash - The ticket's SHA-256.
   * @param mintedAt - Now.
   * @param expiresAt - When the ticket stops being honoured.
   * @returns Whether a row was written — `false` once the job's ticket has been redeemed,
   *   which freezes the row.
   */
  async mint(
    organizationId: string,
    jobId: string,
    tokenHash: string,
    mintedAt: Date,
    expiresAt: Date,
  ): Promise<boolean> {
    const row = await this.database.db
      .insertInto("build_job_source_credentials")
      .values({
        build_job_id: jobId,
        organization_id: organizationId,
        token_hash: tokenHash,
        minted_at: mintedAt,
        expires_at: expiresAt,
      })
      .onConflict((conflict) =>
        conflict
          .column("build_job_id")
          .doUpdateSet({ token_hash: tokenHash, minted_at: mintedAt, expires_at: expiresAt })
          .where("build_job_source_credentials.redeemed_at", "is", null),
      )
      .returning("build_job_id")
      .executeTakeFirst();

    return row !== undefined;
  }

  /**
   * A job's ledger, with the facts the redemption judges.
   *
   * @param jobId - The build job.
   * @returns The ledger, or `undefined` when the job has none.
   */
  async ledger(jobId: string): Promise<SourceLedger | undefined> {
    const row = await this.database.db
      .selectFrom("build_job_source_credentials as c")
      .innerJoin("build_jobs as j", (join) =>
        join
          .onRef("j.id", "=", "c.build_job_id")
          .onRef("j.organization_id", "=", "c.organization_id"),
      )
      .innerJoin("github_repos as r", "r.id", "j.github_repo_id")
      .innerJoin("github_orgs as o", "o.id", "r.org_id")
      .select([
        "c.build_job_id",
        "c.organization_id",
        "c.token_hash",
        "c.expires_at",
        "c.redeemed_at",
        "j.status",
        "o.login",
        "r.name",
      ])
      .where("c.build_job_id", "=", jobId)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          jobId: row.build_job_id,
          organizationId: row.organization_id,
          tokenHash: row.token_hash,
          expiresAt: row.expires_at,
          redeemedAt: row.redeemed_at,
          status: row.status,
          repository: `${row.login}/${row.name}`,
        };
  }

  /**
   * Redeem a job's ticket — once. The statement itself is the single-use rule.
   *
   * @param jobId - The build job.
   * @param tokenHash - The ticket's SHA-256, matched again in the statement so a ticket that
   *   was re-minted between the read and this write redeems nothing.
   * @param at - Now.
   * @returns Whether this call redeemed it. `false` when it was already redeemed, or re-minted.
   */
  async redeem(jobId: string, tokenHash: string, at: Date): Promise<boolean> {
    const row = await this.database.db
      .updateTable("build_job_source_credentials")
      .set({ redeemed_at: at })
      .where("build_job_id", "=", jobId)
      .where("token_hash", "=", tokenHash)
      .where("redeemed_at", "is", null)
      .returning("build_job_id")
      .executeTakeFirst();

    return row !== undefined;
  }
}
