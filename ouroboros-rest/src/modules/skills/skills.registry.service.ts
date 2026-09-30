/**
 * `SkillsRegistryService` — what the workflow studio reads of the skills registry (BF.1,
 * [#410](https://github.com/NobuData/ouroboros/issues/410)).
 *
 * The three surfaces that used to guess about skills read here instead:
 *
 *   * the **stage catalog** (R.3, #145) suggests {@link catalogSlugs} where it read
 *     the retired `OURO_WORKFLOW_SKILL_SUGGESTIONS`;
 *   * the **inspector** (S.4, #150) selects from those suggestions, and P7's unknown-reference
 *     check accepts exactly them — so a warning now means the skill is genuinely absent;
 *   * the **code-view tree** (U.3/X.2, #167/#181) lists {@link codeFiles} under `skills/`.
 *
 * Deliberately narrow, and the only thing `SkillsModule` exports: the workflows module imports
 * this module for these reads, and the skills module never imports the workflows module back
 * (it reads workflow references with its own SQL), so the two cannot form a cycle.
 */

import { Injectable } from "@nestjs/common";

import { SkillsRepository } from "./skills.repository";
import { skillFilePath } from "./skills.resources";

/** One `skills/<slug>.skill.md` file of the code view's explorer. */
export interface SkillCodeFile {
  /** `skills/<slug>.skill.md`. */
  readonly path: string;
  /** The skill's slug — its `GET /api/v1/skills/{slug}/code`. */
  readonly slug: string;
}

@Injectable()
export class SkillsRegistryService {
  /** @param skills - The registry's statements. */
  constructor(private readonly skills: SkillsRepository) {}

  /**
   * The skill names a workflow may reference and expect injected.
   *
   * Drafts are left out, as are skills with nothing published: neither is ever injected, and the
   * catalog never reports a draft as available.
   *
   * @param organizationId - The workspace.
   * @returns The slugs, sorted.
   */
  catalogSlugs(organizationId: string): Promise<string[]> {
    return this.skills.catalogSlugs(organizationId);
  }

  /**
   * Every skill as a file of the code view — drafts included, because a draft is exactly the
   * thing a person opens the editor to finish.
   *
   * @param organizationId - The workspace.
   * @returns One file per skill, by slug.
   */
  async codeFiles(organizationId: string): Promise<SkillCodeFile[]> {
    const rows = await this.skills.list(organizationId);

    return rows.map((row) => ({ path: skillFilePath(row.slug), slug: row.slug }));
  }
}
