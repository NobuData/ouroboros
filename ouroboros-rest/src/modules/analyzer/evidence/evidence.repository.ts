/**
 * What a finding's evidence references name (BW.2, [#517](https://github.com/NobuData/ouroboros/issues/517);
 * shared since BW.3, [#518](https://github.com/NobuData/ouroboros/issues/518)) — one resolving read
 * for every surface that shows evidence: the duration chart's change-point sheet and the
 * suggestion cards' Details sheet.
 *
 * **Every statement is scoped by the workspace.** A finding's evidence references are not foreign
 * keys (V081: retention may remove a build without rewriting the finding), so a reference is
 * resolved only among this workspace's rows — one that names nothing here resolves to nothing.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";

/** A build an evidence reference names. */
export interface BuildEvidence {
  id: string;
  /** The job's number within the workspace — `#412`. */
  number: number;
  /** The job's label — `zephyr build`. */
  label: string;
}

/** A merged commit an evidence reference names. */
export interface MergeEvidence {
  /** The sha as the reference wrote it. */
  sha: string;
  /** The title of the first build of that commit, or null when no build recorded it. */
  title: string | null;
  /** The mirrored PR whose merge produced the commit, or null when the mirror has none. */
  pull_request_id: string | null;
}

/** A workflow version an evidence reference names. */
export interface WorkflowVersionEvidence {
  id: string;
  slug: string;
  /** Null on a draft that was never published. */
  version: number | null;
}

/** A runner pool or a runner an evidence reference names. */
export interface NamedEvidence {
  id: string;
  name: string;
}

/** A test run — one build attempt of a loop — an evidence reference names. */
export interface TestRunEvidence {
  id: string;
  /** The loop the attempt belongs to. */
  run_id: string;
  /** The attempt's ordinal within its loop — the `3` of *Build 3*. */
  attempt_seq: number;
}

/** A test case an evidence reference names, with where it ran. */
export interface TestCaseEvidence {
  id: string;
  run_id: string;
  attempt_seq: number;
  /** The suite's name — what the test-results page selects it by. */
  suite: string;
  /** The case's name — likewise. */
  name: string;
}

/** A verification waiver an evidence reference names. */
export interface WaiverEvidence {
  id: string;
  /** The loop the waiver was recorded on. */
  run_id: string;
  /** The reason, as its author wrote it. */
  reason: string;
  /** The mirrored PR that loop opened, or null when the mirror has none. */
  pull_request_id: string | null;
}

/** What the references of a set of findings resolve to, by kind. */
export interface ResolvedEvidence {
  builds: BuildEvidence[];
  merges: MergeEvidence[];
  workflowVersions: WorkflowVersionEvidence[];
  runnerPools: NamedEvidence[];
  runners: NamedEvidence[];
  testRuns: TestRunEvidence[];
  testCases: TestCaseEvidence[];
  waivers: WaiverEvidence[];
}

/** The ids to resolve, by kind. */
export interface EvidenceIds {
  builds: string[];
  merges: string[];
  workflowVersions: string[];
  runnerPools: string[];
  runners: string[];
  testRuns: string[];
  testCases: string[];
  waivers: string[];
}

@Injectable()
export class EvidenceRepository {
  /** @param database - The typed connection. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * What a set of evidence references names in this workspace.
   *
   * @param organizationId - The workspace.
   * @param ids - The references, by kind.
   * @returns Each kind's rows that still exist; a reference retention has removed is absent.
   */
  async resolve(organizationId: string, ids: EvidenceIds): Promise<ResolvedEvidence> {
    const [builds, merges, workflowVersions, runnerPools, runners, testRuns, testCases, waivers] =
      await Promise.all([
        this.builds(organizationId, ids.builds),
        this.merges(organizationId, ids.merges),
        this.workflowVersions(organizationId, ids.workflowVersions),
        this.named(organizationId, "runner_pools", ids.runnerPools),
        this.named(organizationId, "runners", ids.runners),
        this.testRuns(organizationId, ids.testRuns),
        this.testCases(organizationId, ids.testCases),
        this.waivers(organizationId, ids.waivers),
      ]);

    return {
      builds,
      merges,
      workflowVersions,
      runnerPools,
      runners,
      testRuns,
      testCases,
      waivers,
    };
  }

  /**
   * @param organizationId - The workspace.
   * @param ids - Build job ids.
   * @returns The builds that exist.
   */
  private async builds(organizationId: string, ids: string[]): Promise<BuildEvidence[]> {
    if (ids.length === 0) {
      return [];
    }

    const { rows } = await sql<BuildEvidence>`
      select b.id::text as id, b.number, b.label
        from ouroboros.build_jobs b
       where b.organization_id = ${organizationId}
         and b.id = any(${ids}::uuid[])`.execute(this.database.db);

    return rows;
  }

  /**
   * A merge is a commit, cited by a sha either side may have abbreviated (V081's rule). Its title
   * is the first build's that recorded it, and its PR the mirrored one whose merge plan produced
   * it — the newest, should two plans name one commit.
   *
   * @param organizationId - The workspace.
   * @param shas - Commit shas, 7–40 hex.
   * @returns One row per sha, with whatever of the two was found.
   */
  private async merges(organizationId: string, shas: string[]): Promise<MergeEvidence[]> {
    if (shas.length === 0) {
      return [];
    }

    const { rows } = await sql<MergeEvidence>`
      select s.sha,
             (select b.title
                from ouroboros.build_jobs b
               where b.organization_id = ${organizationId}
                 and b.commit_sha is not null
                 and (starts_with(b.commit_sha, s.sha) or starts_with(s.sha, b.commit_sha))
               order by b.queued_at, b.number
               limit 1) as title,
             (select p.id::text
                from ouroboros.pr_merge_plans m
                join ouroboros.pull_requests p on p.id = m.pr_id
               where p.organization_id = ${organizationId}
                 and m.merged_result ->> 'sha' is not null
                 and (starts_with(m.merged_result ->> 'sha', s.sha)
                      or starts_with(s.sha, m.merged_result ->> 'sha'))
               order by p.merged_at desc nulls last, p.id
               limit 1) as pull_request_id
        from unnest(${shas}::text[]) as s (sha)`.execute(this.database.db);

    return rows;
  }

  /**
   * @param organizationId - The workspace.
   * @param ids - Workflow version ids.
   * @returns The versions that exist, with their workflow's slug.
   */
  private async workflowVersions(
    organizationId: string,
    ids: string[],
  ): Promise<WorkflowVersionEvidence[]> {
    if (ids.length === 0) {
      return [];
    }

    const { rows } = await sql<WorkflowVersionEvidence>`
      select v.id::text as id, w.slug, v.version
        from ouroboros.workflow_versions v
        join ouroboros.workflows w on w.id = v.workflow_id
       where w.organization_id = ${organizationId}
         and v.id = any(${ids}::uuid[])`.execute(this.database.db);

    return rows;
  }

  /**
   * @param organizationId - The workspace.
   * @param table - `runner_pools` or `runners` — both are named by `name`.
   * @param ids - The rows' ids.
   * @returns The rows that exist.
   */
  private async named(
    organizationId: string,
    table: "runner_pools" | "runners",
    ids: string[],
  ): Promise<NamedEvidence[]> {
    if (ids.length === 0) {
      return [];
    }

    return this.database.db
      .selectFrom(table)
      .select([sql<string>`id::text`.as("id"), "name"])
      .where("organization_id", "=", organizationId)
      .where("id", "in", ids)
      .execute();
  }

  /**
   * @param organizationId - The workspace.
   * @param ids - Test run ids.
   * @returns The attempts that exist, with the loop each belongs to.
   */
  private async testRuns(organizationId: string, ids: string[]): Promise<TestRunEvidence[]> {
    if (ids.length === 0) {
      return [];
    }

    const { rows } = await sql<TestRunEvidence>`
      select t.id::text as id, t.run_id::text as run_id, t.attempt_seq
        from ouroboros.test_runs t
       where t.organization_id = ${organizationId}
         and t.id = any(${ids}::uuid[])`.execute(this.database.db);

    return rows;
  }

  /**
   * @param organizationId - The workspace.
   * @param ids - Test case ids.
   * @returns The cases that exist, with their suite and the attempt they ran in.
   */
  private async testCases(organizationId: string, ids: string[]): Promise<TestCaseEvidence[]> {
    if (ids.length === 0) {
      return [];
    }

    const { rows } = await sql<TestCaseEvidence>`
      select c.id::text as id, t.run_id::text as run_id, t.attempt_seq, s.name as suite, c.name
        from ouroboros.test_cases c
        join ouroboros.test_suites s on s.id = c.test_suite_id
        join ouroboros.test_runs t on t.id = s.test_run_id
       where c.organization_id = ${organizationId}
         and c.id = any(${ids}::uuid[])`.execute(this.database.db);

    return rows;
  }

  /**
   * A waiver is recorded on a loop; the PR that loop opened is where it is read as a waived
   * criterion — the newest mirrored one, should the mirror hold two for one loop.
   *
   * @param organizationId - The workspace.
   * @param ids - Waiver ids.
   * @returns The waivers that exist, each with its loop and that loop's mirrored PR, if any.
   */
  private async waivers(organizationId: string, ids: string[]): Promise<WaiverEvidence[]> {
    if (ids.length === 0) {
      return [];
    }

    const { rows } = await sql<WaiverEvidence>`
      select w.id::text as id, w.run_id::text as run_id, w.reason,
             (select p.id::text
                from ouroboros.pull_requests p
               where p.organization_id = ${organizationId}
                 and p.run_id = w.run_id
               order by p.created_at desc, p.id
               limit 1) as pull_request_id
        from ouroboros.pr_waivers w
       where w.organization_id = ${organizationId}
         and w.id = any(${ids}::uuid[])`.execute(this.database.db);

    return rows;
  }
}
