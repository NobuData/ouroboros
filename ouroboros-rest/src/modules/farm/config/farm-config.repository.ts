/**
 * Every statement the farm's configuration surface issues (BV.5,
 * [#514](https://github.com/NobuData/ouroboros/issues/514)) — time-windowed pool assignments
 * (`runner_pool_windows`, V040) and job hooks (`farm_job_hooks`, V088).
 *
 * Neither table is in `db/schema.ts`, so both are written with `sql` as dispatch already reads the
 * windows; the lookups by name use the typed builder. Every statement is scoped by
 * `organization_id`.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";

/** A pool window as stored, with the names it reads as. */
export interface PoolWindowRow {
  id: string;
  runner_id: string;
  runner: string;
  pool_id: string;
  pool: string;
  days_of_week: number[];
  /** `HH:MM`, UTC. */
  starts_at: string;
  /** `HH:MM`, UTC. */
  ends_at: string;
  enabled: boolean;
  created_by: string | null;
  created_at: Date;
}

/** A new pool window. */
export interface NewPoolWindow {
  organizationId: string;
  runnerId: string;
  poolId: string;
  daysOfWeek: readonly number[];
  startsAt: string;
  endsAt: string;
  createdBy: string | null;
}

/** A job hook as stored, with the names it reads as. */
export interface JobHookRow {
  id: string;
  github_repo_id: string;
  repository: string;
  pool_id: string;
  pool: string;
  event: "merge";
  title_contains: string | null;
  label: string;
  title: string;
  command: string;
  enabled: boolean;
  created_by: string | null;
  created_at: Date;
}

/** A new job hook. */
export interface NewJobHook {
  organizationId: string;
  githubRepoId: string;
  poolId: string;
  titleContains: string | null;
  label: string;
  title: string;
  command: string;
  createdBy: string | null;
}

/** A merged pull request, as a hook needs to see it. */
export interface MergedPullRequest {
  title: string;
  base_branch: string;
  /** The repository by the PR's run, when a loop opened it. */
  run_repo_id: string | null;
  /** The PR's page on the host — `https://github.com/<owner>/<name>/pull/<n>`. */
  external_url: string;
  /** The newest revision's head commit, when the mirror holds one. */
  head_sha: string | null;
}

/** The select list both window reads share. */
const WINDOW_COLUMNS = sql`
  w.id::text as id, w.runner_id::text as runner_id, r.name as runner, w.pool_id::text as pool_id,
  p.name as pool, w.days_of_week, to_char(w.starts_at, 'HH24:MI') as starts_at,
  to_char(w.ends_at, 'HH24:MI') as ends_at, w.enabled, w.created_by, w.created_at`;

/** The select list both hook reads share. */
const HOOK_COLUMNS = sql`
  h.id::text as id, h.github_repo_id::text as github_repo_id,
  (o.login || '/' || g.name) as repository, h.pool_id::text as pool_id, p.name as pool, h.event,
  h.title_contains, h.label, h.title, h.command, h.enabled, h.created_by, h.created_at`;

@Injectable()
export class FarmConfigRepository {
  /** @param database - The pool. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * A runner by name.
   *
   * @param organizationId - The workspace.
   * @param name - The runner's name — `forge-02`.
   * @returns Its id and name, or `undefined`.
   */
  async runnerByName(
    organizationId: string,
    name: string,
  ): Promise<{ id: string; name: string } | undefined> {
    return this.database.db
      .selectFrom("runners")
      .select(["id", "name"])
      .where("organization_id", "=", organizationId)
      .where("name", "=", name)
      .executeTakeFirst();
  }

  /**
   * A pool by name.
   *
   * @param organizationId - The workspace.
   * @param name - The pool's name — `pool-a`.
   * @returns Its id and name, or `undefined`.
   */
  async poolByName(
    organizationId: string,
    name: string,
  ): Promise<{ id: string; name: string } | undefined> {
    return this.database.db
      .selectFrom("runner_pools")
      .select(["id", "name"])
      .where("organization_id", "=", organizationId)
      .where("name", "=", name)
      .executeTakeFirst();
  }

  /**
   * A mirrored repository by `owner/name`, compared lower-cased as dispatch compares it.
   *
   * @param organizationId - The workspace.
   * @param repoRef - `owner/name`.
   * @returns Its id and `owner/name`, or `undefined`.
   */
  async repositoryByRef(
    organizationId: string,
    repoRef: string,
  ): Promise<{ id: string; repository: string } | undefined> {
    const [owner, name] = repoRef.toLowerCase().split("/");
    const row = await this.database.db
      .selectFrom("github_repos")
      .innerJoin("github_orgs", "github_orgs.id", "github_repos.org_id")
      .select(["github_repos.id", "github_orgs.login", "github_repos.name"])
      .where("github_orgs.organization_id", "=", organizationId)
      .where(sql<string>`lower(github_orgs.login)`, "=", owner)
      .where(sql<string>`lower(github_repos.name)`, "=", name)
      .executeTakeFirst();

    return row === undefined ? undefined : { id: row.id, repository: `${row.login}/${row.name}` };
  }

  /**
   * The workspace's pool windows, newest first.
   *
   * @param organizationId - The workspace.
   * @returns The windows.
   */
  async windows(organizationId: string): Promise<PoolWindowRow[]> {
    const { rows } = await sql<PoolWindowRow>`
      select ${WINDOW_COLUMNS}
        from ouroboros.runner_pool_windows w
        join ouroboros.runners r on r.id = w.runner_id
        join ouroboros.runner_pools p on p.id = w.pool_id
       where w.organization_id = ${organizationId}
       order by w.created_at desc, w.id`.execute(this.database.db);

    return rows;
  }

  /**
   * One pool window.
   *
   * @param organizationId - The workspace.
   * @param id - The window.
   * @returns The window, or `undefined` when the workspace has none by that id.
   */
  async window(organizationId: string, id: string): Promise<PoolWindowRow | undefined> {
    const { rows } = await sql<PoolWindowRow>`
      select ${WINDOW_COLUMNS}
        from ouroboros.runner_pool_windows w
        join ouroboros.runners r on r.id = w.runner_id
        join ouroboros.runner_pools p on p.id = w.pool_id
       where w.organization_id = ${organizationId} and w.id = ${id}::uuid`.execute(
      this.database.db,
    );

    return rows[0];
  }

  /**
   * Add a pool window — or find the one already there with the same runner, pool and times
   * (V040's `runner_pool_windows_unique`), so a retried apply is one window.
   *
   * @param window - The window.
   * @returns Its id, and whether this call created it.
   */
  async insertWindow(window: NewPoolWindow): Promise<{ id: string; created: boolean }> {
    const inserted = await sql<{ id: string }>`
      insert into ouroboros.runner_pool_windows
        (organization_id, runner_id, pool_id, days_of_week, starts_at, ends_at, created_by)
      values (${window.organizationId}, ${window.runnerId}::uuid, ${window.poolId}::uuid,
              ${JSON.stringify(window.daysOfWeek)}::jsonb, ${window.startsAt}::time,
              ${window.endsAt}::time, ${window.createdBy})
      on conflict (runner_id, pool_id, starts_at, ends_at) do nothing
      returning id::text as id`.execute(this.database.db);

    if (inserted.rows.length > 0) {
      return { id: inserted.rows[0].id, created: true };
    }

    const { rows } = await sql<{ id: string }>`
      select id::text as id from ouroboros.runner_pool_windows
       where organization_id = ${window.organizationId} and runner_id = ${window.runnerId}::uuid
         and pool_id = ${window.poolId}::uuid and starts_at = ${window.startsAt}::time
         and ends_at = ${window.endsAt}::time`.execute(this.database.db);

    return { id: rows[0].id, created: false };
  }

  /**
   * Delete a pool window.
   *
   * @param organizationId - The workspace.
   * @param id - The window.
   * @returns Whether a row went.
   */
  async deleteWindow(organizationId: string, id: string): Promise<boolean> {
    const { numAffectedRows } = await sql`
      delete from ouroboros.runner_pool_windows
       where organization_id = ${organizationId} and id = ${id}::uuid`.execute(this.database.db);

    return (numAffectedRows ?? 0n) > 0n;
  }

  /**
   * The workspace's job hooks, newest first.
   *
   * @param organizationId - The workspace.
   * @returns The hooks.
   */
  async hooks(organizationId: string): Promise<JobHookRow[]> {
    const { rows } = await sql<JobHookRow>`
      select ${HOOK_COLUMNS}
        from ouroboros.farm_job_hooks h
        join ouroboros.github_repos g on g.id = h.github_repo_id
        join ouroboros.github_orgs o on o.id = g.org_id
        join ouroboros.runner_pools p on p.id = h.pool_id
       where h.organization_id = ${organizationId}
       order by h.created_at desc, h.id`.execute(this.database.db);

    return rows;
  }

  /**
   * One job hook.
   *
   * @param organizationId - The workspace.
   * @param id - The hook.
   * @returns The hook, or `undefined`.
   */
  async hook(organizationId: string, id: string): Promise<JobHookRow | undefined> {
    const { rows } = await sql<JobHookRow>`
      select ${HOOK_COLUMNS}
        from ouroboros.farm_job_hooks h
        join ouroboros.github_repos g on g.id = h.github_repo_id
        join ouroboros.github_orgs o on o.id = g.org_id
        join ouroboros.runner_pools p on p.id = h.pool_id
       where h.organization_id = ${organizationId} and h.id = ${id}::uuid`.execute(
      this.database.db,
    );

    return rows[0];
  }

  /**
   * The enabled merge hooks of one repository whose title filter the merged title satisfies.
   *
   * @param organizationId - The workspace.
   * @param githubRepoId - The repository merged into.
   * @param title - The merged pull request's title.
   * @returns The hooks to fire.
   */
  async mergeHooks(
    organizationId: string,
    githubRepoId: string,
    title: string,
  ): Promise<JobHookRow[]> {
    const { rows } = await sql<JobHookRow>`
      select ${HOOK_COLUMNS}
        from ouroboros.farm_job_hooks h
        join ouroboros.github_repos g on g.id = h.github_repo_id
        join ouroboros.github_orgs o on o.id = g.org_id
        join ouroboros.runner_pools p on p.id = h.pool_id
       where h.organization_id = ${organizationId} and h.github_repo_id = ${githubRepoId}::uuid
         and h.event = 'merge' and h.enabled
         and (h.title_contains is null
              or strpos(lower(${title}), lower(h.title_contains)) > 0)
       order by h.created_at, h.id`.execute(this.database.db);

    return rows;
  }

  /**
   * Register a job hook — or find the identical one already registered
   * (`farm_job_hooks_identity_idx`), so a retried apply is one hook.
   *
   * @param hook - The hook.
   * @returns Its id, and whether this call created it.
   */
  async insertHook(hook: NewJobHook): Promise<{ id: string; created: boolean }> {
    const inserted = await sql<{ id: string }>`
      insert into ouroboros.farm_job_hooks
        (organization_id, github_repo_id, pool_id, title_contains, label, title, command,
         created_by)
      values (${hook.organizationId}, ${hook.githubRepoId}::uuid, ${hook.poolId}::uuid,
              ${hook.titleContains}, ${hook.label}, ${hook.title}, ${hook.command},
              ${hook.createdBy})
      on conflict (organization_id, github_repo_id, pool_id, event, command,
                   coalesce(title_contains, '')) do nothing
      returning id::text as id`.execute(this.database.db);

    if (inserted.rows.length > 0) {
      return { id: inserted.rows[0].id, created: true };
    }

    const { rows } = await sql<{ id: string }>`
      select id::text as id from ouroboros.farm_job_hooks
       where organization_id = ${hook.organizationId}
         and github_repo_id = ${hook.githubRepoId}::uuid and pool_id = ${hook.poolId}::uuid
         and event = 'merge' and command = ${hook.command}
         and coalesce(title_contains, '') = coalesce(${hook.titleContains}::text, '')`.execute(
      this.database.db,
    );

    return { id: rows[0].id, created: false };
  }

  /**
   * Delete a job hook.
   *
   * @param organizationId - The workspace.
   * @param id - The hook.
   * @returns Whether a row went.
   */
  async deleteHook(organizationId: string, id: string): Promise<boolean> {
    const { numAffectedRows } = await sql`
      delete from ouroboros.farm_job_hooks
       where organization_id = ${organizationId} and id = ${id}::uuid`.execute(this.database.db);

    return (numAffectedRows ?? 0n) > 0n;
  }

  /**
   * A pull request that merged, with what a merge hook needs of it.
   *
   * @param organizationId - The workspace.
   * @param prId - `pull_requests.id`.
   * @returns The PR, or `undefined` when it is not this workspace's or not merged.
   */
  async mergedPullRequest(
    organizationId: string,
    prId: string,
  ): Promise<MergedPullRequest | undefined> {
    const { rows } = await sql<MergedPullRequest>`
      select pr.title, pr.base_branch, r.github_repo_id::text as run_repo_id, pr.external_url,
             (select v.head_sha from ouroboros.pr_revisions v
               where v.pr_id = pr.id order by v.revision_seq desc limit 1) as head_sha
        from ouroboros.pull_requests pr
        left join ouroboros.runs r on r.id = pr.run_id
       where pr.organization_id = ${organizationId} and pr.id = ${prId}::uuid
         and pr.state = 'merged'`.execute(this.database.db);

    return rows[0];
  }

  /**
   * A mirrored repository's `owner/name` by id.
   *
   * @param organizationId - The workspace.
   * @param githubRepoId - The repository.
   * @returns `owner/name`, or `undefined`.
   */
  async repositoryRef(organizationId: string, githubRepoId: string): Promise<string | undefined> {
    const row = await this.database.db
      .selectFrom("github_repos")
      .innerJoin("github_orgs", "github_orgs.id", "github_repos.org_id")
      .select(["github_orgs.login", "github_repos.name"])
      .where("github_orgs.organization_id", "=", organizationId)
      .where("github_repos.id", "=", githubRepoId)
      .executeTakeFirst();

    return row === undefined ? undefined : `${row.login}/${row.name}`;
  }
}
