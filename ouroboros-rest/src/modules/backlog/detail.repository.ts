/**
 * The two statements behind `GET /api/v1/backlog/{id}`
 * (M.2, [#111](https://github.com/NobuData/ouroboros/issues/111)) — the issue, and every
 * estimate it has had.
 *
 * ## Both are scoped to one workspace, in the statement
 *
 * `organization_id = $1` leads both reads, exactly as `listing.repository.ts` does it and for
 * the ticket's own criterion: *"404, not 403, across orgs — cross-tenant probing should not
 * confirm that an id exists"*. An id belonging to somebody else matches nothing here, and
 * *nothing* is what `detail.service.ts` answers `404` to. Isolation that held because a service
 * compared afterwards would be one forgotten `if` away from a leak.
 *
 * **The estimates read is scoped too, and that is not redundant.** It could have leaned on the
 * issue read having found a row first — but the two run concurrently, so there is no *first*,
 * and a statement whose safety depends on another statement's result is a statement that is
 * safe only while the call order stays what it is today. `issue_estimates` has no
 * `organization_id` of its own (the issue is its whole tenancy, `on delete cascade`), so the
 * predicate is reached through a join to `github_issues` — which is the same join the write
 * side makes for the same reason.
 *
 * ## Two statements rather than one join
 *
 * A single statement would multiply the issue's columns by its version count — the seeded
 * `#487` has two — so the body, the title and the labels would arrive twice and be reassembled
 * here. Two reads that each answer one question are cheaper to read and cheaper to explain, and
 * the service issues them concurrently: `dashboard.repository.ts`' argument that a round trip
 * costs less than the statement it carries.
 *
 * ## Every version, in one read — including the one in force
 *
 * The panel's estimate and the ticket's *history summary* are built from **the same rows**
 * ({@link BacklogDetailRepository.estimates}), which is what makes them incapable of
 * disagreeing: two reads, one for the latest and one for the list, would eventually answer a
 * trace naming version 3 over a history that ends at 2, because a re-estimation landed between
 * them.
 *
 * That means the superseded rows' `breakdown` documents are read and discarded, and the trade is
 * deliberate. `trace` has to be read for every version regardless — it is where
 * a history entry's `estimator` lives — so the whole extra cost of a full read is one small
 * `jsonb` column per superseded version, against a version count that grows only when somebody
 * asks for a re-estimate. The `left join lateral … limit 1` `listing.repository.ts` uses is the
 * right shape *there*, where the question is asked once per row of a page; here it would buy a
 * column and cost the consistency.
 *
 * ## What this file does not decide
 *
 * The `404`, the mapping and the case of the two `jsonb` documents are `detail.service.ts`'s and
 * `detail.resources.ts`'. This holds statements, which is what lets its spec assert the SQL
 * PostgreSQL would receive — where a missing `where` shows up — without a server.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import type {
  EstimateBreakdownDocument,
  EstimateEffort,
  EstimateRisk,
  EstimateTraceDocument,
  GithubIssueState,
  SizingStatus,
} from "../db/schema";

/** One mirrored issue and its repository, as the panel's statement returns them. */
export interface IssueDetailRow {
  /** `github_issues.id`. */
  readonly id: string;
  readonly number: number;
  readonly title: string;
  /** GitHub's label names. `pg` hands the `jsonb` column back already parsed. */
  readonly labels: string[];
  readonly state: GithubIssueState;
  readonly sizingStatus: SizingStatus;
  readonly githubRepoId: string;
  /** `owner/name`, assembled in the statement from `github_orgs.login` and `github_repos.name`. */
  readonly repository: string;
  /** GitHub's description, raw and in full. `null` for an issue opened without one. */
  readonly body: string | null;
  /** GitHub's login, unfolded. `null` when GitHub's author is. */
  readonly authorLogin: string | null;
  /** When GitHub says it was opened. */
  readonly ghCreatedAt: Date;
  /** The issue on GitHub. */
  readonly ghUrl: string;
}

/** One version of an estimate, in full — the panel's, and the history's. */
export interface IssueEstimateRow {
  readonly version: number;
  readonly effort: EstimateEffort;
  readonly confidence: number;
  readonly suggestedWorkflow: string;
  readonly routedModel: string;
  /** `issue_estimates.breakdown`, parsed by the driver. Keys are the database's `snake_case`. */
  readonly breakdown: EstimateBreakdownDocument;
  readonly risk: EstimateRisk;
  readonly riskNote: string;
  /** `issue_estimates.trace`, parsed by the driver. Keys are the database's `snake_case`. */
  readonly trace: EstimateTraceDocument;
  /** When the row was written — not `trace.sized_at`. See `db/schema.ts`. */
  readonly createdAt: Date;
}

@Injectable()
export class BacklogDetailRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's lifecycle
   *   belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * One issue of this workspace, with everything the panel's head and excerpt need.
   *
   * @param organizationId - The workspace, established by the tenant guard.
   * @param issueId - `github_issues.id`, already validated as a uuid by the pipe.
   * @returns The issue, or `undefined` when this workspace has no such row — which is both *no
   *   such issue* and *somebody else's issue*, deliberately one answer.
   */
  async issue(organizationId: string, issueId: string): Promise<IssueDetailRow | undefined> {
    return this.database.db
      .selectFrom("github_issues")
      .innerJoin("github_repos", "github_repos.id", "github_issues.github_repo_id")
      .innerJoin("github_orgs", "github_orgs.id", "github_repos.org_id")
      .where("github_issues.organization_id", "=", organizationId)
      .where("github_issues.id", "=", issueId)
      .select([
        "github_issues.id as id",
        "github_issues.number as number",
        "github_issues.title as title",
        "github_issues.labels as labels",
        "github_issues.state as state",
        "github_issues.sizing_status as sizingStatus",
        "github_issues.github_repo_id as githubRepoId",
        "github_issues.body as body",
        "github_issues.author_login as authorLogin",
        "github_issues.gh_created_at as ghCreatedAt",
        "github_issues.gh_url as ghUrl",
        // `owner/name` in the statement rather than in TypeScript, for `listing.repository.ts`'s
        // reason: the read stays one round trip and the assembly has nowhere else to live.
        sql<string>`${sql.ref("github_orgs.login")} || '/' || ${sql.ref("github_repos.name")}`.as(
          "repository",
        ),
      ])
      .executeTakeFirst();
  }

  /**
   * Every estimate of one issue of this workspace, oldest first.
   *
   * The list the ticket's *history summary* is built from **and** the row the panel's estimate
   * comes from — see this file's header on why those are one read rather than two.
   *
   * Ordered by `version` rather than by `created_at`, and the two are not the same key: version
   * is what decision **K4** makes latest-wins turn on, and it is unique within the issue by
   * `issue_estimates_issue_version_key` where two rows written in the same millisecond are not.
   * The order is therefore total, which is what lets the answer be an equality in a test.
   *
   * @param organizationId - The workspace, established by the tenant guard.
   * @param issueId - `github_issues.id`.
   * @returns Every version, ascending. Empty for an issue that has never been sized, and empty
   *   for an issue belonging to another workspace — the join is what makes the second true.
   */
  async estimates(organizationId: string, issueId: string): Promise<IssueEstimateRow[]> {
    return this.database.db
      .selectFrom("issue_estimates")
      .innerJoin("github_issues", "github_issues.id", "issue_estimates.github_issue_id")
      .where("github_issues.organization_id", "=", organizationId)
      .where("issue_estimates.github_issue_id", "=", issueId)
      .select([
        "issue_estimates.version as version",
        "issue_estimates.effort as effort",
        "issue_estimates.confidence as confidence",
        "issue_estimates.suggested_workflow as suggestedWorkflow",
        "issue_estimates.routed_model as routedModel",
        "issue_estimates.breakdown as breakdown",
        "issue_estimates.risk as risk",
        "issue_estimates.risk_note as riskNote",
        "issue_estimates.trace as trace",
        "issue_estimates.created_at as createdAt",
      ])
      .orderBy("issue_estimates.version", "asc")
      .execute();
  }
}
