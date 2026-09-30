/**
 * Context assembly's statements (BF.5, [#414](https://github.com/NobuData/ouroboros/issues/414)).
 *
 * Three reads and one append, every one scoped by the workspace — which is the whole of the
 * cross-tenant rule: a manifest is resolved from these rows only, so no other workspace's skill or
 * fact can reach one, and an override naming one is simply not resolved.
 *
 * The reads fetch **candidates**, not answers. Scope, drafts, closest-wins, the required lock and
 * the fact lifecycle are `context-assembly.resolve.ts`'s — the one implementation (K8) — and the
 * `where` clauses here only keep the rows small (a fact that is not confirmed can never be an
 * answer, so it is not fetched; the resolver checks again anyway).
 *
 * The append is V071's `context_injections`, whose `context_injections_resolves` trigger holds
 * every id to this workspace, every fact to `confirmed` and every skill version to a published
 * version of a non-draft skill. This file does not re-check what that trigger checks; the service
 * maps its refusal.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { CandidateFact, CandidateSkill } from "./context-assembly.resolve";
import type { ContextConsumer, InjectionResource } from "./context-assembly.resources";

/** What {@link ContextAssemblyRepository.record} appends. */
export interface NewInjection {
  readonly consumer: ContextConsumer;
  readonly estimateId: string | null;
  readonly runStageId: string | null;
  readonly runId: string | null;
  readonly skillVersionIds: readonly string[];
  readonly factIds: readonly string[];
  readonly manifestHash: string;
}

@Injectable()
export class ContextAssemblyRepository {
  /** @param database - The pool. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * A workflow's id, by the slug a scope names it with.
   *
   * @param organizationId - The workspace.
   * @param slug - The workflow's slug.
   * @returns The id, or `undefined` — absent and another workspace's alike.
   */
  async workflowId(organizationId: string, slug: string): Promise<string | undefined> {
    const row = await this.database.db
      .selectFrom("workflows")
      .select("id")
      .where("organization_id", "=", organizationId)
      .where("slug", "=", slug)
      .executeTakeFirst();

    return row?.id;
  }

  /**
   * Every non-draft skill of the workspace, with its version in force.
   *
   * @param organizationId - The workspace.
   * @returns The candidates, by slug. A skill with no published version carries null version
   *   columns; the resolver leaves it out.
   */
  async skills(organizationId: string): Promise<CandidateSkill[]> {
    const rows = await this.database.db
      .selectFrom("skills")
      .leftJoin("skill_versions as current", (join) =>
        join
          .onRef("current.skill_id", "=", "skills.id")
          .onRef("current.version", "=", "skills.current_version"),
      )
      .select([
        "skills.id",
        "skills.slug",
        "skills.name",
        "skills.scope",
        "skills.repo_ref",
        "skills.workflow_id",
        "skills.enabled",
        "skills.required",
        "skills.draft",
        "current.id as version_id",
        "current.version",
        "current.body",
        "current.frontmatter",
      ])
      .where("skills.organization_id", "=", organizationId)
      .where("skills.draft", "=", false)
      .orderBy("skills.slug")
      .execute();

    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      scope: row.scope,
      repoRef: row.repo_ref,
      workflowId: row.workflow_id,
      enabled: row.enabled,
      required: row.required,
      draft: row.draft,
      versionId: row.version_id,
      version: row.version,
      body: row.body,
      frontmatter: row.frontmatter,
    }));
  }

  /**
   * Every confirmed fact of the workspace.
   *
   * @param organizationId - The workspace.
   * @returns The candidates, by id. Scope is the resolver's.
   */
  async facts(organizationId: string): Promise<CandidateFact[]> {
    const rows = await this.database.db
      .selectFrom("facts")
      .select(["id", "text", "repo_ref", "status"])
      .where("organization_id", "=", organizationId)
      .where("status", "=", "confirmed")
      .orderBy("id")
      .execute();

    return rows.map((row) => ({
      id: row.id,
      text: row.text,
      repoRef: row.repo_ref,
      status: row.status,
    }));
  }

  /**
   * Append one injection record.
   *
   * @param organizationId - The workspace.
   * @param injection - What the consumer injected.
   * @returns The row as stored.
   * @throws V071's refusals, untouched — `context_injections_resolves` (23503) above all.
   */
  async record(organizationId: string, injection: NewInjection): Promise<InjectionResource> {
    const row = await this.database.db
      .insertInto("context_injections")
      .values({
        organization_id: organizationId,
        consumer: injection.consumer,
        estimate_id: injection.estimateId,
        run_stage_id: injection.runStageId,
        run_id: injection.runId,
        skill_version_ids: [...injection.skillVersionIds],
        fact_ids: [...injection.factIds],
        manifest_hash: injection.manifestHash,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return {
      id: row.id,
      consumer: row.consumer,
      estimateId: row.estimate_id,
      runStageId: row.run_stage_id,
      runId: row.run_id,
      skillVersionIds: row.skill_version_ids,
      factIds: row.fact_ids,
      manifestHash: row.manifest_hash,
      injectedAt: row.injected_at.toISOString(),
    };
  }
}
