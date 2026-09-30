/**
 * The statements the repo-map generator issues (BF.6,
 * [#415](https://github.com/NobuData/ouroboros/issues/415)) that the skills registry's own
 * repository does not: which repositories to map, and which skill is a repository's map.
 *
 * Writing the skill — create, draft, publish — goes through `SkillsRepository`, the registry's own
 * statements, so a generated version is stored exactly as a published one is.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";

/** The slug a repository's map takes when it is free — the mockup's `repo-map`. */
export const REPO_MAP_SLUG = "repo-map";

/** One repository the nightly job maps. */
export interface MappedRepo {
  readonly organizationId: string;
  /** `owner/name`, lower-case. */
  readonly repo: string;
}

/** A repository's generated map skill, and the body of the version in force. */
export interface RepoMapSkill {
  readonly id: string;
  readonly slug: string;
  readonly currentVersion: number | null;
  /** The body of the version in force; null before a first publish. */
  readonly body: string | null;
}

@Injectable()
export class RepoMapRepository {
  /** @param database - The pool. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Every repository Ouroboros may poll — enabled, under an enabled GitHub org, as the backlog sync
   * reads them — grouped by workspace.
   *
   * @returns The repositories, by workspace then name.
   */
  async enabledRepos(): Promise<MappedRepo[]> {
    return this.database.db
      .selectFrom("github_repos as gr")
      .innerJoin("github_orgs as go", "go.id", "gr.org_id")
      .select([
        "go.organization_id as organizationId",
        sql<string>`lower(go.login || '/' || gr.name)`.as("repo"),
      ])
      .where("gr.enabled", "=", true)
      .where("go.enabled", "=", true)
      .orderBy("go.organization_id")
      .orderBy("repo")
      .execute();
  }

  /**
   * The repository's generated map: the `generated` skill scoped to it whose slug is `repo-map` or
   * `repo-map-…`.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @returns The skill and its current body, or `undefined` when none was generated yet.
   */
  async skillFor(organizationId: string, repo: string): Promise<RepoMapSkill | undefined> {
    return this.database.db
      .selectFrom("skills as s")
      .leftJoin("skill_versions as sv", (join) =>
        join.onRef("sv.skill_id", "=", "s.id").onRef("sv.version", "=", "s.current_version"),
      )
      .select([
        "s.id as id",
        "s.slug as slug",
        "s.current_version as currentVersion",
        "sv.body as body",
      ])
      .where("s.organization_id", "=", organizationId)
      .where("s.origin", "=", "generated")
      .where("s.scope", "=", "repo")
      .where(sql<string>`lower(s.repo_ref)`, "=", repo)
      .where((eb) =>
        eb.or([eb("s.slug", "=", REPO_MAP_SLUG), eb("s.slug", "like", `${REPO_MAP_SLUG}-%`)]),
      )
      .orderBy("s.slug")
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * Which of these slugs the workspace already uses.
   *
   * @param organizationId - The workspace.
   * @param slugs - Candidates.
   * @returns The taken ones.
   */
  async takenSlugs(organizationId: string, slugs: readonly string[]): Promise<string[]> {
    const rows = await this.database.db
      .selectFrom("skills")
      .select("slug")
      .where("organization_id", "=", organizationId)
      .where("slug", "in", [...slugs])
      .execute();

    return rows.map((row) => row.slug);
  }
}
