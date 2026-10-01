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

import { KNOWLEDGE_REPO_MAP_GENERATED_EVENT } from "../audit/audit.events";
import { DatabaseService } from "../db/db.service";
import type { MapSkill, RecordedGeneration } from "./repo-map.status";

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
   * @param organizationId - One workspace, to read only its repositories — the status read's
   *   scope (#422). Absent for the nightly pass, which maps every workspace's.
   * @returns The repositories, by workspace then name.
   */
  async enabledRepos(organizationId?: string): Promise<MappedRepo[]> {
    const enabled = this.database.db
      .selectFrom("github_repos as gr")
      .innerJoin("github_orgs as go", "go.id", "gr.org_id")
      .select([
        "go.organization_id as organizationId",
        sql<string>`lower(go.login || '/' || gr.name)`.as("repo"),
      ])
      .where("gr.enabled", "=", true)
      .where("go.enabled", "=", true);
    const scoped =
      organizationId === undefined
        ? enabled
        : enabled.where("go.organization_id", "=", organizationId);

    return scoped.orderBy("go.organization_id").orderBy("repo").execute();
  }

  /**
   * Every map skill of a workspace — the `generated`, repo-scoped skills whose slug is `repo-map`
   * or `repo-map-…` — by slug, so the first for a repository is the one {@link skillFor} chooses
   * (BG.6, [#422](https://github.com/NobuData/ouroboros/issues/422)).
   *
   * @param organizationId - The workspace.
   * @returns Each skill's repository, slug and version in force.
   */
  async mapSkills(organizationId: string): Promise<MapSkill[]> {
    return this.database.db
      .selectFrom("skills as s")
      .select([
        sql<string>`lower(s.repo_ref)`.as("repo"),
        "s.slug as slug",
        "s.current_version as currentVersion",
      ])
      .where("s.organization_id", "=", organizationId)
      .where("s.origin", "=", "generated")
      .where("s.scope", "=", "repo")
      .where("s.repo_ref", "is not", null)
      .where((eb) =>
        eb.or([eb("s.slug", "=", REPO_MAP_SLUG), eb("s.slug", "like", `${REPO_MAP_SLUG}-%`)]),
      )
      .orderBy("s.slug")
      .execute();
  }

  /**
   * The newest recorded generation of each repository of a workspace — the audit trail's
   * `knowledge.repo_map_generated` rows, which `RepoMapService` writes for every generation, the
   * skipped ones included (#422).
   *
   * Scoped by workspace first: an audit row is another workspace's the moment that predicate is
   * missing, whatever the subject says.
   *
   * @param organizationId - The workspace.
   * @returns One row per repository that has a recorded generation.
   */
  async lastGenerations(organizationId: string): Promise<RecordedGeneration[]> {
    const rows = await this.database.db
      .selectFrom("audit_events as ae")
      .distinctOn("ae.subject_id")
      .select(["ae.subject_id as repo", "ae.detail as detail", "ae.occurred_at as occurredAt"])
      .where("ae.organization_id", "=", organizationId)
      .where("ae.action", "=", KNOWLEDGE_REPO_MAP_GENERATED_EVENT)
      .where("ae.subject_type", "=", "repository")
      .where("ae.subject_id", "is not", null)
      .orderBy("ae.subject_id")
      .orderBy("ae.occurred_at", "desc")
      .execute();

    return rows.flatMap((row) =>
      row.repo === null ? [] : [{ repo: row.repo, detail: row.detail, occurredAt: row.occurredAt }],
    );
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
