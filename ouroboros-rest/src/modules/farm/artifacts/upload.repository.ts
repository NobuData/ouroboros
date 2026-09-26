/**
 * Every statement the job-scoped artifact upload issues (#330): minting the token's ledger with an
 * offer, reading it back for a request, the workspace's quota usage, the attempt an upload fills,
 * and the one transaction that closes the upload.
 *
 * ## Closing is the single-use step
 *
 * The ledger row is locked `for update` and must still be open **and** still hold the hash of the
 * token being closed with. Two requests racing with one token serialise on that lock: the first
 * closes, and the second finds nothing open and is answered as a replay. The artifact rows, the
 * receipt and the attempt's status are written in the same transaction, so a closed upload always
 * has its rows and an open one never does.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type { TestArtifactKind } from "../../db/schema";
import type { ReceiptEntry, UploadWarning } from "./upload.manifest";

/** An upload ledger, with what the request needs to know about its job. */
export interface UploadLedger {
  readonly jobId: string;
  readonly organizationId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly closedAt: Date | null;
  /** The loop run the job is attributed to — null for a build nobody attributed. */
  readonly runId: string | null;
  readonly commitSha: string | null;
}

/** One `test_artifacts` row to register. */
export interface ArtifactRow {
  readonly name: string;
  readonly kind: TestArtifactKind;
  readonly sizeBytes: number;
  readonly storageRef: { readonly driver: string; readonly key: string };
  readonly checksum: string;
  readonly retainedUntil: Date;
  /** Present exactly when the agent truncated the file. */
  readonly truncationNote: string | null;
  /** Present exactly on a coverage artifact. */
  readonly coverage: { readonly linesCovered: number; readonly linesTotal: number } | null;
}

/** Everything the closing transaction writes. */
export interface UploadClose {
  readonly organizationId: string;
  readonly jobId: string;
  readonly tokenHash: string;
  readonly testRunId: string;
  readonly at: Date;
  readonly artifacts: readonly ArtifactRow[];
  readonly storedBytes: number;
  /**
   * The receipt, built once the rows exist.
   *
   * @param ids - Each registered artifact's id, by name.
   * @returns The manifest and the warnings to store.
   */
  readonly receipt: (ids: ReadonlyMap<string, string>) => {
    manifest: ReceiptEntry[];
    warnings: UploadWarning[];
  };
}

/** What a close wrote — or undefined when the upload was no longer open to close. */
export interface ClosedUpload {
  readonly manifest: ReceiptEntry[];
  readonly warnings: UploadWarning[];
}

/** The PostgreSQL statements. */
@Injectable()
export class UploadRepository {
  /**
   * @param database - The pool.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Mint — or, for a job offered again, re-mint — the job's upload ledger.
   *
   * @param organizationId - The workspace.
   * @param jobId - The build job.
   * @param tokenHash - The new token's hash.
   * @param mintedAt - Now.
   * @param expiresAt - When the token stops being honoured.
   * @returns False when the job's upload has already closed, in which case nothing is minted.
   */
  async mint(
    organizationId: string,
    jobId: string,
    tokenHash: string,
    mintedAt: Date,
    expiresAt: Date,
  ): Promise<boolean> {
    const row = await this.database.db
      .insertInto("build_job_artifact_uploads")
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
          .where("build_job_artifact_uploads.closed_at", "is", null),
      )
      .returning("build_job_id")
      .executeTakeFirst();

    return row !== undefined;
  }

  /**
   * A job's ledger, by the job's id alone — the caller holds no session and names no workspace;
   * the token it presents is checked against what this returns.
   *
   * @param jobId - The build job's uuid.
   * @returns The ledger, or undefined when the job has none.
   */
  async ledger(jobId: string): Promise<UploadLedger | undefined> {
    const row = await this.database.db
      .selectFrom("build_job_artifact_uploads as u")
      .innerJoin("build_jobs as j", (join) =>
        join
          .onRef("j.id", "=", "u.build_job_id")
          .onRef("j.organization_id", "=", "u.organization_id"),
      )
      .select([
        "u.build_job_id",
        "u.organization_id",
        "u.token_hash",
        "u.expires_at",
        "u.closed_at",
        "j.run_id",
        "j.commit_sha",
      ])
      .where("u.build_job_id", "=", jobId)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          jobId: row.build_job_id,
          organizationId: row.organization_id,
          tokenHash: row.token_hash,
          expiresAt: row.expires_at,
          closedAt: row.closed_at,
          runId: row.run_id,
          commitSha: row.commit_sha,
        };
  }

  /**
   * The bytes of live artifacts the workspace keeps — what its quota is measured against. An
   * expired artifact's bytes are gone, so it does not count.
   *
   * @param organizationId - The workspace.
   * @returns Bytes.
   */
  async usage(organizationId: string): Promise<number> {
    const row = await this.database.db
      .selectFrom("test_artifacts")
      .select(sql<string>`coalesce(sum(size_bytes), 0)`.as("bytes"))
      .where("organization_id", "=", organizationId)
      .where("expired_at", "is", null)
      .executeTakeFirstOrThrow();

    return Number(row.bytes);
  }

  /**
   * The attempt a job's upload fills: the one that already names the job, or the run's next.
   *
   * The run's row is locked while the next `attempt_seq` is chosen, so two jobs of one run
   * uploading at once take consecutive numbers rather than colliding on `(run_id, attempt_seq)`.
   *
   * @param organizationId - The workspace.
   * @param jobId - The build job.
   * @param runId - Its run.
   * @param commitSha - Its commit, recorded on the attempt.
   * @returns `test_runs.id`.
   */
  attempt(
    organizationId: string,
    jobId: string,
    runId: string,
    commitSha: string | null,
  ): Promise<string> {
    return this.database.transaction(async (trx) => {
      const existing = await trx
        .selectFrom("test_runs")
        .select("id")
        .where("organization_id", "=", organizationId)
        .where("build_job_id", "=", jobId)
        .executeTakeFirst();
      if (existing) return existing.id;

      await trx
        .selectFrom("runs")
        .select("id")
        .where("id", "=", runId)
        .where("organization_id", "=", organizationId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      const { next } = await trx
        .selectFrom("test_runs")
        .select(sql<number>`coalesce(max(attempt_seq), 0) + 1`.as("next"))
        .where("run_id", "=", runId)
        .executeTakeFirstOrThrow();

      const { id } = await trx
        .insertInto("test_runs")
        .values({
          organization_id: organizationId,
          run_id: runId,
          build_job_id: jobId,
          attempt_seq: Number(next),
          commit_sha: commitSha,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      return id;
    });
  }

  /**
   * Close the upload: register its artifacts, write the receipt, and mark the attempt complete —
   * one transaction, and only while the ledger is still open under this token.
   *
   * @param close - What to write.
   * @returns The receipt, or undefined when the upload was already closed (a replay or a race).
   */
  close(close: UploadClose): Promise<ClosedUpload | undefined> {
    return this.database.transaction(async (trx) => {
      const open = await trx
        .selectFrom("build_job_artifact_uploads")
        .select("build_job_id")
        .where("build_job_id", "=", close.jobId)
        .where("organization_id", "=", close.organizationId)
        .where("token_hash", "=", close.tokenHash)
        .where("closed_at", "is", null)
        .forUpdate()
        .executeTakeFirst();
      if (!open) return undefined;

      const ids = new Map<string, string>();
      if (close.artifacts.length > 0) {
        const rows = await trx
          .insertInto("test_artifacts")
          .values(
            close.artifacts.map((artifact) => ({
              organization_id: close.organizationId,
              test_run_id: close.testRunId,
              name: artifact.name,
              kind: artifact.kind,
              size_bytes: artifact.sizeBytes,
              storage_ref: JSON.stringify(artifact.storageRef),
              checksum: artifact.checksum,
              retained_until: artifact.retainedUntil,
              truncated: artifact.truncationNote !== null,
              truncation_note: artifact.truncationNote,
              lines_covered: artifact.coverage?.linesCovered ?? null,
              lines_total: artifact.coverage?.linesTotal ?? null,
            })),
          )
          .returning(["id", "name"])
          .execute();
        for (const row of rows) ids.set(row.name, row.id);
      }

      const receipt = close.receipt(ids);

      await trx
        .updateTable("build_job_artifact_uploads")
        .set({
          closed_at: close.at,
          test_run_id: close.testRunId,
          manifest: JSON.stringify(receipt.manifest),
          warnings: JSON.stringify(receipt.warnings),
          stored_bytes: close.storedBytes,
        })
        .where("build_job_id", "=", close.jobId)
        .execute();

      await trx
        .updateTable("test_runs")
        .set({ status: "complete" })
        .where("id", "=", close.testRunId)
        .where("status", "<>", "complete")
        .execute();

      return receipt;
    });
  }
}
