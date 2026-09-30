/**
 * `RuleImportService` — **Import CLAUDE.md / .cursorrules** (BF.4,
 * [#413](https://github.com/NobuData/ouroboros/issues/413)).
 *
 * ```
 * preview(org, repo)
 *   probe CLAUDE.md · AGENTS.md · .cursorrules · .github/copilot-instructions.md   (#384's machinery)
 *   ─▶ planImport(files, baseline) ─▶ counts + samples + fingerprint               (nothing written)
 *
 * apply(org, repo, fingerprint, actor)
 *   probe again ─▶ transaction { lock repo · re-read baseline · planImport
 *                                fingerprint ≠ preview's → 409 knowledge_import_preview_stale
 *                                write: skills draft, origin imported · facts proposed, proposer import }
 *   ─▶ audit knowledge.imported (actor, what was written)
 * ```
 *
 * **Everything lands gated.** A created skill is `draft: true` — never injected (V069) — and an
 * updated one gets only a new *draft version*, which nothing injects until a person publishes it.
 * A fact is inserted `proposed` — never injected (V071). So an apply cannot change how any run
 * behaves; it fills the review queues. `rule-import.service.spec.ts` asserts every write.
 *
 * **Probing happens outside the transaction** — a host request must not hold a lock — and the
 * fingerprint check inside it is what ties the two together: whatever changed in between, the
 * write is either exactly the preview or nothing.
 */

import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import { KNOWLEDGE_IMPORTED_EVENT, type AuditRecord } from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import { DatabaseService } from "../db/db.service";
import type { Database } from "../db/schema";
import { DetectionService } from "../detection/detection.service";
import { FactsRepository } from "../facts/facts.repository";
import { SKILL_CONSTRAINTS, violates } from "../skills/skills.errors";
import { SkillsRepository } from "../skills/skills.repository";
import { TicketSourceError } from "../ticket-sources/ticket-source.errors";
import { MAX_PROBE_FILE_BYTES, type RepoFile } from "../ticket-sources/ticket-source.probe";
import {
  MAX_IMPORT_FACTS,
  MAX_IMPORT_SKILLS,
  previewStale,
  rateLimited,
  sourceFailed,
  tooLarge,
} from "./rule-import.errors";
import { planImport, RULE_FILES, type ImportPlan, type ProbedRuleFile } from "./rule-import.plan";
import { RuleImportRepository, type RuleImportStore } from "./rule-import.repository";
import {
  importedFrontmatter,
  importedProvenance,
  plannedCounts,
  previewOf,
  type RuleImportPreview,
  type RuleImportResult,
} from "./rule-import.resources";

/** What reads a repository's files — `DetectionService.readFiles`. */
export interface RuleFileReader {
  /**
   * @param organizationId - The workspace.
   * @param repo - `owner/name`.
   * @param paths - The files.
   * @returns Each path's file, or `null` where there is none.
   */
  readFiles(
    organizationId: string,
    repo: string,
    paths: readonly string[],
  ): Promise<Map<string, RepoFile | null>>;
}

/** Where the apply is audited — `AuditService`. */
export interface RuleImportAudit {
  /**
   * @param event - The event.
   * @returns Its id.
   */
  record(event: AuditRecord): Promise<string>;
}

/** The writes {@link RuleImportService.apply} makes, in plan order. */
type Created = RuleImportResult["created"];

@Injectable()
export class RuleImportService {
  /**
   * @param store - The baseline reads and the apply lock.
   * @param skills - The skills registry's statements — the writes a hand-made skill uses.
   * @param facts - The fact lifecycle's statements — the insert a hand-proposed fact uses.
   * @param database - The pool, for the apply's transaction.
   * @param reader - What reads the repository's files.
   * @param audit - Where the apply is recorded.
   */
  constructor(
    @Inject(RuleImportRepository) private readonly store: RuleImportStore,
    private readonly skills: SkillsRepository,
    private readonly facts: FactsRepository,
    private readonly database: DatabaseService,
    @Inject(DetectionService) private readonly reader: RuleFileReader,
    @Inject(AuditService) private readonly audit: RuleImportAudit,
  ) {}

  /**
   * What an apply would write, and the fingerprint it must match. Writes nothing.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`; compared lower-case.
   * @returns The preview. A repository with no rules file is an empty preview, not an error.
   * @throws {ConflictError} `detection_source_missing` when nothing connected can probe it.
   * @throws {InvalidRequestError} `knowledge_import_too_large`.
   * @throws {TooManyRequestsError} `knowledge_import_rate_limited`.
   * @throws {UpstreamError} `knowledge_import_source_failed`.
   */
  async preview(organizationId: string, repo: string): Promise<RuleImportPreview> {
    const ref = repo.toLowerCase();
    const probed = await this.probe(organizationId, ref);
    const plan = planImport(ref, probed, await this.store.baseline(organizationId, ref));

    refuseOversized(plan);

    return previewOf(plan);
  }

  /**
   * Write exactly what the preview with this fingerprint showed, and audit it.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`; compared lower-case.
   * @param fingerprint - The preview's.
   * @param actorId - The person applying — the audit's actor and each fact's proposer of record.
   * @param now - The clock, for the audit row.
   * @returns The preview it matched, and every row written.
   * @throws {ConflictError} `knowledge_import_preview_stale` when anything changed since the
   *   preview — nothing written; and as {@link RuleImportService.preview}.
   */
  async apply(
    organizationId: string,
    repo: string,
    fingerprint: string,
    actorId: string,
    now: Date = new Date(),
  ): Promise<RuleImportResult> {
    const ref = repo.toLowerCase();
    const probed = await this.probe(organizationId, ref);

    const { plan, created } = await this.database
      .transaction(async (trx) => {
        await this.store.lockRepo(organizationId, ref, trx);
        const current = planImport(
          ref,
          probed,
          await this.store.baseline(organizationId, ref, trx),
        );

        if (current.fingerprint !== fingerprint) {
          throw previewStale(ref, fingerprint, current.fingerprint);
        }

        refuseOversized(current);

        return { plan: current, created: await this.write(organizationId, current, actorId, trx) };
      })
      .catch((error: unknown) => {
        // A slug a hand-made skill took after the baseline was read: the plan is stale.
        if (violates(error, SKILL_CONSTRAINTS.slugUnique)) {
          throw previewStale(ref, fingerprint, "slug_taken");
        }

        throw error;
      });

    const preview = previewOf(plan);

    await this.audit.record({
      organizationId,
      actorId,
      action: KNOWLEDGE_IMPORTED_EVENT,
      subjectType: "repository",
      subjectId: ref,
      at: now,
      detail: {
        repo: ref,
        fingerprint,
        files_found: preview.totals.filesFound,
        skill_drafts: preview.totals.skillDrafts,
        skill_updates: preview.totals.skillUpdates,
        fact_candidates: preview.totals.factCandidates,
        deduped_skills: preview.totals.dedupedSkills,
        deduped_facts: preview.totals.dedupedFacts,
        skill_slugs: created.skills.map((skill) => skill.slug).join(","),
      },
    });

    return { ...preview, created };
  }

  /**
   * Read the four rules files.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @returns Each file, in {@link RULE_FILES} order.
   * @throws The host's refusal, as this API's error.
   */
  private async probe(organizationId: string, repo: string): Promise<ProbedRuleFile[]> {
    let files: Map<string, RepoFile | null>;

    try {
      files = await this.reader.readFiles(organizationId, repo, RULE_FILES);
    } catch (error) {
      if (TicketSourceError.is(error)) {
        throw error.errorClass === "rate_limit"
          ? rateLimited(repo)
          : sourceFailed(repo, error.errorClass);
      }

      throw error;
    }

    return RULE_FILES.map((path) => {
      const file = files.get(path) ?? null;

      return {
        path,
        content: file?.content ?? null,
        size: file?.size ?? 0,
        truncated: file !== null && file.size > MAX_PROBE_FILE_BYTES,
      };
    });
  }

  /**
   * Write a plan — every skill a draft, every fact proposed.
   *
   * @param organizationId - The workspace.
   * @param plan - The plan the fingerprint matched.
   * @param actorId - The person applying.
   * @param trx - The apply's transaction.
   * @returns What was written.
   */
  private async write(
    organizationId: string,
    plan: ImportPlan,
    actorId: string,
    trx: Transaction<Database>,
  ): Promise<Created> {
    const skills: Created["skills"][number][] = [];
    const facts: Created["facts"][number][] = [];

    for (const file of plan.files) {
      for (const skill of file.skills) {
        const frontmatter = importedFrontmatter(skill);

        if (skill.action === "create") {
          await this.skills.create(
            organizationId,
            {
              slug: skill.slug,
              name: skill.name,
              description: skill.description,
              scope: "repo",
              repoRef: plan.repo,
              workflowId: null,
              origin: "imported",
              draft: true,
              frontmatter,
              body: skill.body,
            },
            trx,
          );
        } else {
          // `skillId` is set for every update — the prior import it updates.
          const skillId = skill.skillId as string;
          const draft = await this.skills.draftOf(skillId, trx, true);

          if (draft === undefined) {
            await this.skills.insertDraft(skillId, frontmatter, skill.body, trx);
          } else {
            await this.skills.writeDraft(draft.id, frontmatter, skill.body, trx);
          }
        }

        skills.push({ slug: skill.slug, action: skill.action });
      }

      for (const fact of file.facts) {
        const id = await this.facts.insert(
          organizationId,
          {
            repoRef: plan.repo,
            text: fact.text,
            proposer: "import",
            provenance: importedProvenance(fact),
            actorId,
            relearnedFromFactId: null,
          },
          trx,
        );

        facts.push({ id, text: fact.text });
      }
    }

    return { skills, facts };
  }
}

/**
 * Refuse a plan past the per-import caps.
 *
 * @param plan - The plan.
 * @throws {InvalidRequestError} `knowledge_import_too_large`.
 */
function refuseOversized(plan: ImportPlan): void {
  const counts = plannedCounts(plan);

  if (counts.skills > MAX_IMPORT_SKILLS || counts.facts > MAX_IMPORT_FACTS) {
    throw tooLarge(plan.repo, counts.skills, counts.facts);
  }
}
