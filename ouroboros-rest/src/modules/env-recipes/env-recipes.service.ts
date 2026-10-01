/**
 * `EnvRecipesService` — mockup 14's Environment block, read and saved (BE.4's table, V073; served
 * for BG.4, [#420](https://github.com/NobuData/ouroboros/issues/420), decision **K7**).
 *
 * ```
 * read(org, repo)          the version in force, or 404 — a repository with none is a state
 * save(org, actor, body)   the next version, source `edited`, audited knowledge.env_recipe_saved
 * ```
 *
 * **An edit is a new version, never a rewrite.** The service computes the next number from the
 * version in force and V073's trigger holds it to exactly that; two editors racing both compute
 * the same number, the unique key lets one commit, and the other is answered `409
 * env_recipe_version_conflict` with the number that was taken — re-read, and edit again. Nothing
 * here ever updates a row.
 *
 * **What the block is consumed by is V073's contract**, not this file's: the farm's container-pool
 * setup, the prebuild tier (BD.4, #399) and execution workspace prep read `env_recipes_current`
 * and run the commands in order. Saving here is what changes what they run next.
 */

import { Inject, Injectable } from "@nestjs/common";

import { KNOWLEDGE_ENV_RECIPE_SAVED_EVENT } from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import { violatesConstraint } from "../tenancy/constraints";
import type { SaveEnvRecipeBody } from "./env-recipes.dto";
import {
  ENV_RECIPE_CONSTRAINTS,
  envRecipeCommandsInvalid,
  envRecipeNotFound,
  envRecipeVersionConflict,
} from "./env-recipes.errors";
import { EnvRecipesRepository, type EnvRecipeStore } from "./env-recipes.repository";
import { envRecipeResource, type EnvRecipeResource } from "./env-recipes.resources";

/** The audit trail, as a save writes to it. */
export type EnvRecipeAudit = Pick<AuditService, "record">;

/**
 * The stored form of the commands: the closed-key objects V073's check admits, a comment present
 * only when one was given.
 *
 * @param body - The request's commands.
 * @returns The JSON text the column takes.
 */
export function storedCommands(body: SaveEnvRecipeBody["commands"]): string {
  return JSON.stringify(
    body.map((entry) =>
      entry.comment === undefined
        ? { command: entry.command }
        : { command: entry.command, comment: entry.comment },
    ),
  );
}

/**
 * The repository as V067's domain stores it — lower-case, so `Acme-Robotics/Helios` and
 * `acme-robotics/helios` are one repository here as they are on the host.
 *
 * @param repo - What the request named.
 * @returns The key.
 */
export function repoKey(repo: string): string {
  return repo.toLowerCase();
}

@Injectable()
export class EnvRecipesService {
  /**
   * @param store - The statements.
   * @param audit - The audit trail (#225).
   */
  constructor(
    @Inject(EnvRecipesRepository) private readonly store: EnvRecipeStore,
    @Inject(AuditService) private readonly audit: EnvRecipeAudit,
  ) {}

  /**
   * The version in force.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`.
   * @returns The recipe.
   * @throws {NotFoundError} `env_recipe_not_found` — the repository has none.
   */
  async read(organizationId: string, repo: string): Promise<EnvRecipeResource> {
    const key = repoKey(repo);
    const row = await this.store.current(organizationId, key);

    if (row === undefined) throw envRecipeNotFound(key);

    return envRecipeResource(row);
  }

  /**
   * Save the block as the repository's next version, in the signed-in person's name.
   *
   * @param organizationId - The workspace.
   * @param actorId - Who — `"user".id`.
   * @param body - The repository and the commands.
   * @returns The version now in force — the one just written.
   * @throws {ConflictError} `env_recipe_version_conflict` — another editor saved first.
   * @throws {InvalidRequestError} `env_recipe_commands_invalid` — V073 refused the shape.
   * @throws Whatever the audit threw — an unaudited save is not answered as a success.
   */
  async save(
    organizationId: string,
    actorId: string,
    body: SaveEnvRecipeBody,
  ): Promise<EnvRecipeResource> {
    const key = repoKey(body.repo);
    const previous = await this.store.current(organizationId, key);
    const version = (previous?.version ?? 0) + 1;

    let written;
    try {
      written = await this.store.insert(
        organizationId,
        key,
        version,
        storedCommands(body.commands),
        actorId,
      );
    } catch (error) {
      if (
        violatesConstraint(error, ENV_RECIPE_CONSTRAINTS.nextVersion) ||
        violatesConstraint(error, ENV_RECIPE_CONSTRAINTS.versionKey)
      ) {
        throw envRecipeVersionConflict(key, version);
      }
      if (violatesConstraint(error, ENV_RECIPE_CONSTRAINTS.commandsTyped)) {
        throw envRecipeCommandsInvalid(key);
      }

      throw error;
    }

    const row = await this.store.current(organizationId, key);
    if (row === undefined || row.version !== written.version) {
      // The version just written is not the one in force: a later save landed between the
      // insert and this read. Answer the conflict rather than the other editor's recipe.
      throw envRecipeVersionConflict(key, written.version);
    }

    await this.audit.record({
      organizationId,
      actorId,
      action: KNOWLEDGE_ENV_RECIPE_SAVED_EVENT,
      subjectType: "repository",
      subjectId: key,
      at: row.updated_at,
      detail: {
        version: written.version,
        previous_version: previous?.version ?? 0,
        commands: body.commands.length,
        source: "edited",
      },
    });

    return envRecipeResource(row);
  }
}
