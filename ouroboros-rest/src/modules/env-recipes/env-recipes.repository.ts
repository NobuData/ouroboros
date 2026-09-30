/**
 * The environment-recipe statements (V073, served by BG.4,
 * [#420](https://github.com/NobuData/ouroboros/issues/420)) — each takes the workspace first and
 * filters on it, so another workspace's recipe is simply absent.
 *
 * ```
 * current   env_recipes_current ⋈ "user" — the version in force, with its editor's name
 * insert    the next version; V073's trigger holds the number, the unique key settles a race
 * ```
 *
 * There is no update and no delete: a version is immutable (`env_recipes_no_update`), and the
 * service role holds no delete grant.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { EnvRecipeRow } from "./env-recipes.resources";

/** What a saved version returns — enough to re-read it. */
export interface InsertedEnvRecipe {
  readonly id: string;
  readonly version: number;
}

/** The statements, as the service reaches them. */
export interface EnvRecipeStore {
  /**
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @returns The version in force with its editor's name, or undefined for a repository with none.
   */
  current(organizationId: string, repo: string): Promise<EnvRecipeRow | undefined>;
  /**
   * Write one version. The number is the caller's claim; V073's trigger refuses one that is not
   * exactly the next.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @param version - The version to write.
   * @param commands - The typed array, already stringified.
   * @param updatedBy - The person — `"user".id`.
   * @returns The row's id and version.
   */
  insert(
    organizationId: string,
    repo: string,
    version: number,
    commands: string,
    updatedBy: string,
  ): Promise<InsertedEnvRecipe>;
}

@Injectable()
export class EnvRecipesRepository implements EnvRecipeStore {
  /** @param database - The connection. */
  constructor(private readonly database: DatabaseService) {}

  /** @inheritdoc */
  current(organizationId: string, repo: string): Promise<EnvRecipeRow | undefined> {
    return this.database.db
      .selectFrom("env_recipes_current as r")
      .leftJoin("user as u", "u.id", "r.updated_by")
      .select([
        "r.repo_ref",
        "r.version",
        "r.commands",
        "r.source",
        "r.updated_by",
        "r.updated_at",
        "u.name as editor_name",
      ])
      .where("r.organization_id", "=", organizationId)
      .where("r.repo_ref", "=", repo)
      .executeTakeFirst();
  }

  /** @inheritdoc */
  insert(
    organizationId: string,
    repo: string,
    version: number,
    commands: string,
    updatedBy: string,
  ): Promise<InsertedEnvRecipe> {
    return this.database.db
      .insertInto("env_recipes")
      .values({
        organization_id: organizationId,
        repo_ref: repo,
        version,
        commands,
        source: "edited",
        updated_by: updatedBy,
      })
      .returning(["id", "version"])
      .executeTakeFirstOrThrow();
  }
}
