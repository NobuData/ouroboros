/**
 * Which skill version the pipeline runs for a workspace (CM.5,
 * [#624](https://github.com/NobuData/ouroboros/issues/624)).
 *
 * `create-roadmap` and `create-issues` live in the Knowledge registry (BE.1, #405), one row per
 * workspace like every other skill. {@link PipelineSkillRegistry.resolve} answers the workspace's
 * **current published version** — so a workspace that publishes its own procedure changes what
 * the pipeline runs, which is the whole reason these are skills and not code.
 *
 * A workspace that has neither gets the shipped procedure written for it on first use
 * (`origin: generated`, published by nobody), in one transaction. A workspace whose copy exists
 * but was never published is refused: running a draft nobody published would be running words
 * nobody approved.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../../db/db.service";
import { SkillsRepository } from "../../skills/skills.repository";
import { skillUnpublished } from "./pipeline.errors";
import { SHIPPED_CHANGE_NOTE, SHIPPED_SKILLS, type PipelineSkillSlug } from "./pipeline.skills";

/** A skill version, ready to send to the engine. */
export interface ResolvedSkill {
  readonly slug: PipelineSkillSlug;
  /** The published version in force. */
  readonly version: number;
  /** Its procedure. */
  readonly body: string;
}

/** What the pipeline's services ask of the registry. */
export interface SkillSource {
  /**
   * @param organizationId - The workspace.
   * @param slug - The pipeline skill.
   * @returns The workspace's current published version of it, created from the shipped procedure
   *   when the workspace has none.
   * @throws {ConflictError} `roadmap_skill_unpublished` when the skill exists but has no published
   *   version.
   */
  resolve(organizationId: string, slug: PipelineSkillSlug): Promise<ResolvedSkill>;
}

/** PostgreSQL's unique-violation code — two requests creating the same skill at once. */
const UNIQUE_VIOLATION = "23505";

/**
 * How a shipped skill reads in a `generated_by` stamp — `create-roadmap@v3`.
 *
 * @param skill - The version that ran.
 * @returns The stamp.
 */
export function skillStamp(skill: ResolvedSkill): string {
  return `${skill.slug}@v${String(skill.version)}`;
}

@Injectable()
export class PipelineSkillRegistry implements SkillSource {
  /**
   * @param database - The pool, for the transaction a first write takes.
   * @param skills - The registry's own statements.
   */
  constructor(
    private readonly database: DatabaseService,
    private readonly skills: SkillsRepository,
  ) {}

  /** @inheritdoc */
  async resolve(organizationId: string, slug: PipelineSkillSlug): Promise<ResolvedSkill> {
    const existing = await this.current(organizationId, slug);

    if (existing !== undefined) return existing;

    try {
      await this.ship(organizationId, slug);
    } catch (error) {
      // Another request shipped it between the read and the write; theirs is the one to run.
      if ((error as { code?: unknown }).code !== UNIQUE_VIOLATION) throw error;
    }

    const shipped = await this.current(organizationId, slug);

    if (shipped === undefined) throw skillUnpublished(slug);

    return shipped;
  }

  /**
   * The workspace's current published version of a skill.
   *
   * @param organizationId - The workspace.
   * @param slug - The skill.
   * @returns It; undefined when the workspace has no such skill.
   * @throws {ConflictError} `roadmap_skill_unpublished` when the skill has no published version.
   */
  private async current(
    organizationId: string,
    slug: PipelineSkillSlug,
  ): Promise<ResolvedSkill | undefined> {
    const skill = await this.skills.findBySlug(organizationId, slug);

    if (skill === undefined) return undefined;
    if (skill.current_version === null) throw skillUnpublished(slug);

    const version = await this.skills.versionAt(skill.id, skill.current_version);

    if (version === undefined) throw skillUnpublished(slug);

    return { slug, version: skill.current_version, body: version.body };
  }

  /**
   * Write the shipped procedure as the workspace's first version of a skill, and publish it.
   *
   * @param organizationId - The workspace.
   * @param slug - The skill.
   */
  private async ship(organizationId: string, slug: PipelineSkillSlug): Promise<void> {
    const shipped = SHIPPED_SKILLS[slug];
    const frontmatter = {
      name: shipped.slug,
      description: shipped.description,
      scope: "org",
      load: "on_trigger",
      triggers: [...shipped.triggers],
    };

    await this.database.transaction(async (trx) => {
      const skillId = await this.skills.create(
        organizationId,
        {
          slug: shipped.slug,
          name: shipped.slug,
          description: shipped.description,
          scope: "org",
          repoRef: null,
          workflowId: null,
          origin: "generated",
          draft: false,
          frontmatter,
          body: shipped.body,
        },
        trx,
      );
      const draft = await this.skills.draftOf(skillId, trx, true);

      if (draft === undefined) throw new Error(`The first draft of ${slug} vanished.`);

      await this.skills.publish(
        skillId,
        draft.id,
        {
          changeNote: SHIPPED_CHANGE_NOTE,
          publishedBy: null,
          publishedAt: new Date(),
          name: shipped.slug,
          description: shipped.description,
        },
        trx,
      );
    });
  }
}
