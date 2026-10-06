/**
 * Every statement the detection service issues
 * ([#384](https://github.com/NobuData/ouroboros/issues/384), BB.1), each scoped by
 * `organization_id` — the whole of cross-tenant isolation for this surface.
 *
 * ```
 * reads   sources that might cover the repository (ticket_sources_public — never the credential)
 *         a scan and its rows (latest, or by scan_seq)
 *         the newest completed test run of the repository (test_runs ⋈ runs ⋈ github_repos)
 *         the repository's protected-path policies
 * writes  one transaction per scan: repo_detection_scans + repo_detections + suggested policies
 *         the tests row's detected → measured relabel (the one update V067 grants)
 * ```
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { ProtectedPathSource, RepoDetection, RepoDetectionScan } from "../db/schema";
import type { SyncSource } from "../ticket-sources/ticket-sources.repository";
import { CORE_ROW_KEYS } from "./detection.pack";
import type { MeasuredTests } from "./detection.reconcile";
import type { DetectionRow } from "./detection.scan";

/** A scan to store. */
export interface ScanRecord {
  readonly organizationId: string;
  readonly repo: string;
  readonly durationMs: number;
  readonly packVersions: Readonly<Record<string, string>>;
  readonly probesUsed: number;
  readonly rows: readonly DetectionRow[];
  readonly protectedPaths: readonly string[];
}

/** A stored scan and its rows. */
export interface StoredScan {
  readonly scan: RepoDetectionScan;
  readonly rows: readonly RepoDetection[];
}

/** One protected-path policy of a repository. */
export interface PolicyRow {
  readonly path_glob: string;
  readonly source: ProtectedPathSource;
}

/** The statements, as the service depends on them — so its spec can hand it a fake. */
export interface DetectionStore {
  candidateSources(organizationId: string): Promise<SyncSource[]>;
  recordScan(record: ScanRecord): Promise<number>;
  scan(organizationId: string, repo: string, scanSeq?: number): Promise<StoredScan | undefined>;
  measuredTests(organizationId: string, repo: string): Promise<MeasuredTests | undefined>;
  relabelTests(
    organizationId: string,
    repo: string,
    scanSeq: number,
    row: DetectionRow,
  ): Promise<void>;
  policies(organizationId: string, repo: string): Promise<PolicyRow[]>;
  /**
   * Replace a repository's protected-path list with a person's (#391): every glob kept or added is
   * `edited`, every other is removed, and the wizard state records the edit so no later scan
   * suggests again. One transaction.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @param globs - The list, validated and deduplicated.
   * @returns The list as stored.
   */
  replacePolicies(
    organizationId: string,
    repo: string,
    globs: readonly string[],
  ): Promise<PolicyRow[]>;
}

@Injectable()
export class DetectionRepository implements DetectionStore {
  /**
   * @param database - The pool.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The workspace's sources that are not paused — the ones a scan may ride. Healthy first.
   *
   * Through `ticket_sources_public`, so the sealed credential is never selected here; the service
   * opens it with `TicketSourcesService.withCredentials` for the length of the scan.
   *
   * @param organizationId - The workspace.
   * @returns The sources, active before errored, then oldest first.
   */
  async candidateSources(organizationId: string): Promise<SyncSource[]> {
    const rows = await this.database.db
      .selectFrom("ticket_sources_public")
      .select([
        "id",
        "organization_id",
        "kind",
        "display_name",
        "config",
        "sync_cursor",
        "synced_at",
        "status",
      ])
      .where("organization_id", "=", organizationId)
      .where("status", "!=", "paused")
      .orderBy(sql`case when status = 'active' then 0 else 1 end`)
      .orderBy("created_at", "asc")
      .execute();

    return rows.map((row) => ({
      sourceId: row.id,
      organizationId: row.organization_id,
      kind: row.kind,
      displayName: row.display_name,
      config: row.config,
      cursor: row.sync_cursor,
      syncedAt: row.synced_at,
    }));
  }

  /**
   * Store one scan: the scan row at the next `scan_seq`, its rows, and its protected-path
   * suggestions — in one transaction, so a card never reads a scan without its rows.
   *
   * Suggestions are `insert … on conflict do nothing`: a glob the repository already has — whether
   * suggested by an earlier scan or edited by a person — is left exactly as it is.
   *
   * @param record - The scan.
   * @returns The new `scan_seq`.
   */
  async recordScan(record: ScanRecord): Promise<number> {
    return this.database.transaction(async (trx) => {
      const { organizationId, repo } = record;
      const last = await trx
        .selectFrom("repo_detection_scans")
        .select((eb) => eb.fn.max("scan_seq").as("seq"))
        .where("organization_id", "=", organizationId)
        .where("repo_ref", "=", repo)
        .executeTakeFirst();
      const scanSeq = Number(last?.seq ?? 0) + 1;

      await trx
        .insertInto("repo_detection_scans")
        .values({
          organization_id: organizationId,
          repo_ref: repo,
          scan_seq: scanSeq,
          duration_ms: Math.max(0, Math.round(record.durationMs)),
          pack_versions: JSON.stringify(record.packVersions),
          probe_budget_used: record.probesUsed,
        })
        .execute();

      if (record.rows.length > 0) {
        await trx
          .insertInto("repo_detections")
          .values(
            record.rows.map((row) => ({
              organization_id: organizationId,
              repo_ref: repo,
              scan_seq: scanSeq,
              row_key: row.rowKey,
              verdict: row.verdict,
              value: row.value,
              evidence: JSON.stringify(row.evidence),
              label: row.label,
            })),
          )
          .execute();
      }

      // Once a person has saved the list (V105, #391), a scan suggests nothing: a glob they
      // removed stays removed, and an emptied list stays empty.
      const edited = await trx
        .selectFrom("onboarding_state")
        .select("protected_paths_edited_at")
        .where("organization_id", "=", organizationId)
        .where("repo_ref", "=", repo)
        .executeTakeFirst();

      if (record.protectedPaths.length > 0 && edited?.protected_paths_edited_at == null) {
        await trx
          .insertInto("protected_path_policies")
          .values(
            record.protectedPaths.map((glob) => ({
              organization_id: organizationId,
              repo_ref: repo,
              path_glob: glob,
              source: "suggested" as const,
            })),
          )
          .onConflict((conflict) =>
            conflict.columns(["organization_id", "repo_ref", "path_glob"]).doNothing(),
          )
          .execute();
      }

      return scanSeq;
    });
  }

  /**
   * One scan and its rows, **in card order**: the six core rows as mockup 13 draws them
   * (`CORE_ROW_KEYS`), then any pack's `custom:*` rows by key.
   *
   * The order is the row key's, not the insert's. A scan's rows are written in one statement and
   * share its `created_at`, so ordering by it left the card's order to a random `id`
   * ([#389](https://github.com/NobuData/ouroboros/issues/389)).
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @param scanSeq - The scan; the newest when omitted.
   * @returns The scan, or undefined when there is none.
   */
  async scan(
    organizationId: string,
    repo: string,
    scanSeq?: number,
  ): Promise<StoredScan | undefined> {
    let query = this.database.db
      .selectFrom("repo_detection_scans")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("repo_ref", "=", repo);

    query =
      scanSeq === undefined
        ? query.orderBy("scan_seq", "desc").limit(1)
        : query.where("scan_seq", "=", scanSeq);

    const scan = await query.executeTakeFirst();

    if (scan === undefined) {
      return undefined;
    }

    const rows = await this.database.db
      .selectFrom("repo_detections")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("repo_ref", "=", repo)
      .where("scan_seq", "=", scan.scan_seq)
      // `array_position` is null for a custom row, and nulls sort last ascending.
      .orderBy(sql`array_position(${sql.val([...CORE_ROW_KEYS])}::text[], row_key)`)
      .orderBy("row_key", "asc")
      .execute();

    return { scan, rows };
  }

  /**
   * The newest completed test run of a repository — AS.1's tables, joined through the loop run to
   * the mirrored repository, all inside the workspace.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @returns The measurement, or undefined when the repository has no completed run.
   */
  async measuredTests(organizationId: string, repo: string): Promise<MeasuredTests | undefined> {
    const row = await this.database.db
      .selectFrom("test_runs")
      .innerJoin("runs", (join) =>
        join
          .onRef("runs.id", "=", "test_runs.run_id")
          .onRef("runs.organization_id", "=", "test_runs.organization_id"),
      )
      .innerJoin("github_repos", "github_repos.id", "runs.github_repo_id")
      .innerJoin("github_orgs", "github_orgs.id", "github_repos.org_id")
      .select([
        "test_runs.id as test_run_id",
        "test_runs.run_id as run_id",
        "test_runs.total as total",
        "test_runs.started_at as started_at",
      ])
      .select((eb) =>
        eb
          .selectFrom("test_suites")
          .select(sql<string>`count(distinct test_suites.name)`.as("n"))
          .whereRef("test_suites.test_run_id", "=", "test_runs.id")
          .as("suites"),
      )
      .where("test_runs.organization_id", "=", organizationId)
      .where("github_orgs.organization_id", "=", organizationId)
      .where("test_runs.status", "=", "complete")
      .where(sql`lower(github_orgs.login || '/' || github_repos.name)`, "=", repo)
      .orderBy("test_runs.started_at", "desc")
      .limit(1)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : {
          testRunId: row.test_run_id,
          runId: row.run_id,
          suites: Number(row.suites ?? 0),
          tests: row.total,
          startedAt: row.started_at,
        };
  }

  /**
   * Relabel a stored tests row as measured — V067's one granted update.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @param scanSeq - The scan.
   * @param row - The measured row.
   */
  async relabelTests(
    organizationId: string,
    repo: string,
    scanSeq: number,
    row: DetectionRow,
  ): Promise<void> {
    await this.database.db
      .updateTable("repo_detections")
      .set({
        verdict: row.verdict,
        value: row.value,
        evidence: JSON.stringify(row.evidence),
        label: row.label,
      })
      .where("organization_id", "=", organizationId)
      .where("repo_ref", "=", repo)
      .where("scan_seq", "=", scanSeq)
      .where("row_key", "=", "tests")
      .where("label", "=", "detected")
      .execute();
  }

  /**
   * The repository's protected-path policies — suggested and edited.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @returns The policies, by glob.
   */
  async policies(organizationId: string, repo: string): Promise<PolicyRow[]> {
    return this.database.db
      .selectFrom("protected_path_policies")
      .select(["path_glob", "source"])
      .where("organization_id", "=", organizationId)
      .where("repo_ref", "=", repo)
      .orderBy("path_glob")
      .execute();
  }

  /** @inheritdoc */
  replacePolicies(
    organizationId: string,
    repo: string,
    globs: readonly string[],
  ): Promise<PolicyRow[]> {
    return this.database.transaction(async (trx) => {
      // The database's clock, not this process's: V105 holds the stamp at or after `created_at`,
      // which `now()` set — a process clock a moment behind would be refused.
      await trx
        .insertInto("onboarding_state")
        .values({
          organization_id: organizationId,
          repo_ref: repo,
          protected_paths_edited_at: sql<Date>`now()`,
        })
        .onConflict((conflict) =>
          conflict
            .columns(["organization_id", "repo_ref"])
            .doUpdateSet({ protected_paths_edited_at: sql<Date>`now()` }),
        )
        .execute();

      let removal = trx
        .deleteFrom("protected_path_policies")
        .where("organization_id", "=", organizationId)
        .where("repo_ref", "=", repo);

      if (globs.length > 0) {
        removal = removal.where("path_glob", "not in", [...globs]);
      }

      await removal.execute();

      if (globs.length > 0) {
        await trx
          .insertInto("protected_path_policies")
          .values(
            globs.map((glob) => ({
              organization_id: organizationId,
              repo_ref: repo,
              path_glob: glob,
              source: "edited" as const,
            })),
          )
          .onConflict((conflict) =>
            conflict
              .columns(["organization_id", "repo_ref", "path_glob"])
              .doUpdateSet({ source: "edited" }),
          )
          .execute();
      }

      return trx
        .selectFrom("protected_path_policies")
        .select(["path_glob", "source"])
        .where("organization_id", "=", organizationId)
        .where("repo_ref", "=", repo)
        .orderBy("path_glob")
        .execute();
    });
  }
}
