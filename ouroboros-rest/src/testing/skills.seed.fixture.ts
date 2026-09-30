/**
 * Skills in a workspace's registry, for integration suites (BF.1,
 * [#410](https://github.com/NobuData/ouroboros/issues/410)).
 *
 * The stage catalog, the inspector's suggestions and P7's unknown-skill warning all read the
 * registry since #410 — so a suite that used to configure `OURO_WORKFLOW_SKILL_SUGGESTIONS` seeds
 * the skills it expects instead. Each is an org-scoped, enabled, non-draft skill with a published
 * v1: exactly what `SkillsRepository.catalogSlugs` lists.
 *
 * It is a `.fixture.ts`: type-checked with the code it exercises and left out of the image by
 * `tsconfig.build.json`.
 */

import { SCHEMA_NAME } from "../modules/db/schema";
import type { ApiHarness } from "./harness.fixture";

/**
 * Give a workspace published skills.
 *
 * @param api - The harness, for its SQL connection.
 * @param organizationId - The workspace.
 * @param slugs - The skills, each named and described after its slug.
 */
export async function seedPublishedSkills(
  api: Pick<ApiHarness, "sql">,
  organizationId: string,
  slugs: readonly string[],
): Promise<void> {
  for (const slug of slugs) {
    const skill = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.skills (organization_id, slug, name, description, scope)
       values ($1, $2, $2, $3, 'org')
       returning id`,
      [organizationId, slug, `The ${slug} skill.`],
    );
    const skillId = skill.rows[0].id;

    await api.sql.query(
      `insert into ${SCHEMA_NAME}.skill_versions (skill_id, version, body, frontmatter, published_at)
       values ($1, 1, $2, $3, now())`,
      [skillId, `# ${slug}`, JSON.stringify({ name: slug, description: `The ${slug} skill.` })],
    );
    await api.sql.query(`update ${SCHEMA_NAME}.skills set current_version = 1 where id = $1`, [
      skillId,
    ]);
  }
}
