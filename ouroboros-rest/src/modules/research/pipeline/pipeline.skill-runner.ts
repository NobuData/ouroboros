/**
 * One run of one pipeline skill (CM.5, [#624](https://github.com/NobuData/ouroboros/issues/624)):
 * the workspace's version of the skill, the alias routing gives research work, the engine's
 * execution, and a refusal turned into this plane's own.
 *
 * Both pipeline steps go through here, so there is one place a skill is resolved, one place a
 * model is chosen and one sentence for *"the skill could not be run"*.
 */

import { Injectable } from "@nestjs/common";

import { EngineClient } from "../../engine/engine.client";
import type { EngineSkillRunResult } from "../../engine/engine.skills";
import { DomainError } from "../../errors/error.envelope";
import { ResolutionService } from "../../routing/resolution.service";
import { ROUTING_ERRORS } from "../../routing/routing.errors";
import { noResearcher, skillFailed } from "./pipeline.errors";
import {
  PipelineSkillRegistry,
  type ResolvedSkill,
  type SkillSource,
} from "./pipeline.skill-registry";
import type { PipelineSkillSlug } from "./pipeline.skills";

/** The task kind whose route picks the model — the investigation loop's own. */
export const RESEARCH_TASK_KIND = "research";

/** What a run answered, with the skill version that ran. */
export interface SkillRun {
  readonly skill: ResolvedSkill;
  readonly result: EngineSkillRunResult;
}

/** What the pipeline's services ask of the runner. */
export interface SkillRunning {
  /**
   * @param organizationId - The workspace.
   * @param slug - The skill.
   * @returns The version the workspace would run now.
   */
  current(organizationId: string, slug: PipelineSkillSlug): Promise<ResolvedSkill>;
  /**
   * @param organizationId - The workspace.
   * @param request - The skill, the output wanted, its input, and what the calls are attributed to.
   * @returns The validated result and the version that produced it.
   * @throws {ConflictError} `roadmap_no_researcher`, `roadmap_skill_unpublished`.
   * @throws {UpstreamError} `roadmap_skill_failed` when the engine refused the run;
   *   `engine_unavailable` when it could not be reached.
   */
  run(organizationId: string, request: SkillRunRequest): Promise<SkillRun>;
}

/** One run. */
export interface SkillRunRequest {
  readonly slug: PipelineSkillSlug;
  readonly output: "roadmap" | "issue_bodies";
  readonly input: Record<string, unknown>;
  /** The roadmap document's id, or the investigation's before a document exists. */
  readonly run: string;
}

@Injectable()
export class PipelineSkillRunner implements SkillRunning {
  /** The registry, behind its seam. */
  private readonly skills: SkillSource;

  /**
   * @param registry - Resolves the workspace's version of a skill.
   * @param resolution - Z.1's resolution, for the `research` route.
   * @param engine - Runs the skill.
   */
  constructor(
    registry: PipelineSkillRegistry,
    private readonly resolution: ResolutionService,
    private readonly engine: EngineClient,
  ) {
    this.skills = registry;
  }

  /** @inheritdoc */
  current(organizationId: string, slug: PipelineSkillSlug): Promise<ResolvedSkill> {
    return this.skills.resolve(organizationId, slug);
  }

  /** @inheritdoc */
  async run(organizationId: string, request: SkillRunRequest): Promise<SkillRun> {
    const [skill, routed] = await Promise.all([
      this.skills.resolve(organizationId, request.slug),
      this.routed(organizationId),
    ]);

    if (routed === null) throw noResearcher();

    const answer = await this.engine.runSkill({
      run: request.run,
      skill: { slug: skill.slug, version: skill.version, body: skill.body },
      output: request.output,
      input: request.input,
      alias: routed.alias,
      resolutionVersion: routed.resolutionVersion,
      costCapCents: null,
    });

    if (!answer.ok) {
      throw skillFailed(
        skill.slug,
        answer.refusal.reason ?? answer.refusal.code,
        answer.refusal.message,
      );
    }

    return { skill, result: answer.data };
  }

  /**
   * The alias routing resolves research work to.
   *
   * @param organizationId - The workspace.
   * @returns The first kept hop's alias and the resolution's version; null when the workspace has
   *   no route for research or the resolution keeps no hop.
   */
  private async routed(
    organizationId: string,
  ): Promise<{ readonly alias: string; readonly resolutionVersion: string } | null> {
    let resolution;

    try {
      resolution = await this.resolution.resolve(organizationId, RESEARCH_TASK_KIND, {});
    } catch (error) {
      if (error instanceof DomainError && error.code === ROUTING_ERRORS.routeNotFound) return null;
      throw error;
    }

    const hop =
      resolution.outcome === "resolved"
        ? resolution.chain.find((candidate) => candidate.decision === "kept")
        : undefined;

    return hop === undefined
      ? null
      : { alias: hop.alias, resolutionVersion: resolution.resolutionVersion };
  }
}
