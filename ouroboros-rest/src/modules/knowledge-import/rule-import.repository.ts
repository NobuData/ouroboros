/**
 * The rule-file import's reads (BF.4, [#413](https://github.com/NobuData/ouroboros/issues/413)).
 *
 * The writes are the registries' own — `SkillsRepository.create` / `insertDraft` / `writeDraft`
 * and `FactsRepository.insert` — so an imported row is written by exactly the statements a
 * hand-made one is. This file reads what a plan dedupes against, and serializes applies.
 */

import { Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database } from "../db/schema";
import { queryOn } from "../tenancy/queries";
import { normalizeFactText } from "./rule-import.parse";
import type { ImportBaseline, PriorImportedSkill } from "./rule-import.plan";

/** What `RuleImportService` reads through this repository — a seam its suite fakes. */
export interface RuleImportStore {
  baseline(
    organizationId: string,
    repo: string,
    trx?: Transaction<Database>,
  ): Promise<ImportBaseline>;
  lockRepo(organizationId: string, repo: string, trx: Transaction<Database>): Promise<void>;
}

@Injectable()
export class RuleImportRepository implements RuleImportStore {
  /** @param database - The pool. */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Everything a plan dedupes against.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @param trx - The apply's transaction, so the plan it checks is the one it writes.
   * @returns The workspace's slugs, its imported skills with every version's provenance and
   *   body, and the normalized text of every fact of the repository or the whole workspace —
   *   rejected and expired ones too, so a rule somebody turned down is not proposed again.
   */
  async baseline(
    organizationId: string,
    repo: string,
    trx?: Transaction<Database>,
  ): Promise<ImportBaseline> {
    const db = queryOn(this.database, trx);
    const [slugs, versions, facts] = await Promise.all([
      db
        .selectFrom("skills")
        .select("slug")
        .where("organization_id", "=", organizationId)
        .execute(),
      db
        .selectFrom("skills")
        .innerJoin("skill_versions", "skill_versions.skill_id", "skills.id")
        .select([
          "skills.id as skillId",
          "skills.slug",
          "skills.repo_ref as repoRef",
          "skill_versions.body",
          sql<string | null>`skill_versions.frontmatter #>> '{provenance,source}'`.as("source"),
          sql<string | null>`skill_versions.frontmatter #>> '{provenance,section}'`.as("section"),
        ])
        .where("skills.organization_id", "=", organizationId)
        .where("skills.origin", "=", "imported")
        .orderBy("skills.slug")
        .orderBy("skill_versions.created_at")
        .execute(),
      db
        .selectFrom("facts")
        .select("text")
        .where("organization_id", "=", organizationId)
        .where((eb) => eb.or([eb("repo_ref", "=", repo), eb("repo_ref", "is", null)]))
        .execute(),
    ]);

    return {
      slugs: new Set(slugs.map((row) => row.slug)),
      importedSkills: groupSkills(versions),
      factTexts: new Set(facts.map((row) => normalizeFactText(row.text))),
    };
  }

  /**
   * Serialize applies to one repository for the rest of a transaction, so two clicks cannot both
   * pass the fingerprint check and write the same drafts twice.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @param trx - The apply's transaction; the lock is released when it ends.
   */
  async lockRepo(organizationId: string, repo: string, trx: Transaction<Database>): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`knowledge_import:${organizationId}:${repo}`}, 0))`.execute(
      trx,
    );
  }
}

/** One imported skill version, as read. */
interface VersionRow {
  readonly skillId: string;
  readonly slug: string;
  readonly repoRef: string | null;
  readonly body: string;
  readonly source: string | null;
  readonly section: string | null;
}

/**
 * Fold version rows into one entry per skill.
 *
 * @param rows - Versions, grouped by skill (the query orders by slug).
 * @returns The skills, each with every provenance and body its versions carry.
 */
function groupSkills(rows: readonly VersionRow[]): PriorImportedSkill[] {
  const skills = new Map<
    string,
    {
      skillId: string;
      slug: string;
      repoRef: string | null;
      provenances: { source: string; section: string | null }[];
      bodies: string[];
    }
  >();

  for (const row of rows) {
    let skill = skills.get(row.skillId);

    if (skill === undefined) {
      skill = {
        skillId: row.skillId,
        slug: row.slug,
        repoRef: row.repoRef,
        provenances: [],
        bodies: [],
      };
      skills.set(row.skillId, skill);
    }

    skill.bodies.push(row.body);

    if (
      row.source !== null &&
      !skill.provenances.some((p) => p.source === row.source && p.section === row.section)
    ) {
      skill.provenances.push({ source: row.source, section: row.section });
    }
  }

  return [...skills.values()];
}
