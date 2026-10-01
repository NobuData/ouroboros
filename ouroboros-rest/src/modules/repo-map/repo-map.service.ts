/**
 * `RepoMapService` — `repo-map`, generated rather than maintained (BF.6,
 * [#415](https://github.com/NobuData/ouroboros/issues/415), decision **K2**).
 *
 * ```
 * generate(org, repo, trigger)
 *   ├─ running already for this repo?  → join it
 *   ├─ detection.readTree  one tree listing + the CODEOWNERS file it holds (≤ 2 host requests)
 *   │     rate_limit / host error / no source → skipped, nothing written
 *   ├─ detection.read      the newest scan's rows (BB.1, #384) — stored, no host request
 *   ├─ renderRepoMap       deterministic markdown (repo-map.render.ts)
 *   ├─ identical to the version in force?  → unchanged — no version, history stays meaningful
 *   └─ otherwise           draft ─▶ publish v(n+1), origin generated, published_at = now
 *   ─▶ audit knowledge.repo_map_generated {outcome, version, trigger} — every run is recorded,
 *      including the ones that found nothing
 * generateAll(now)       nightly: every enabled repository, one at a time; a rate-limit refusal
 *                        skips the rest of that workspace's repositories tonight (#101)
 * ```
 *
 * **Diff-aware, so each version marks a real change.** The body is compared with the body of the
 * version in force; only a difference publishes. A structural change — a new module, a changed
 * CODEOWNERS rule, a new detection — produces exactly one new version, and a night with no change
 * produces none.
 *
 * **The skill is the repository's.** A repository's map is the `generated`, repo-scoped skill whose
 * slug is `repo-map` (the mockup's, when free) or `repo-map-<name>`; the first generation creates
 * it, enabled and not a draft, with V069's typed frontmatter. A person's unpublished edit of it is
 * overwritten by the next change — V069 says so of `generated` skills, and the UI says so because
 * `origin` lets it.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";

import { KNOWLEDGE_REPO_MAP_GENERATED_EVENT } from "../audit/audit.events";
import { AuditService } from "../audit/audit.service";
import { retryAfterSeconds } from "../backlog/debounce";
import { DatabaseService } from "../db/db.service";
import { DETECTION_ERRORS } from "../detection/detection.errors";
import { DetectionService } from "../detection/detection.service";
import { DomainError } from "../errors/error.envelope";
import { describeForLog } from "../errors/failure";
import { SkillsRepository } from "../skills/skills.repository";
import { TicketSourceError } from "../ticket-sources/ticket-source.errors";
import { slugify } from "../workflows/slug";
import { regenerateTooSoon } from "./repo-map.errors";
import {
  REPO_MAP_FRONTMATTER,
  codeownersPath,
  renderRepoMap,
  type RepoMapDocument,
} from "./repo-map.render";
import { REPO_MAP_SLUG, RepoMapRepository, type RepoMapSkill } from "./repo-map.repository";
import type {
  RepoMapReport,
  RepoMapSkipReason,
  RepoMapStatusList,
  RepoMapTrigger,
} from "./repo-map.resources";
import { statusesOf } from "./repo-map.status";

/**
 * The shortest gap between two manual regenerates of one repository — sixty seconds. A generation
 * is at most two host requests, but the button is one somebody presses twice.
 */
export const REGENERATE_INTERVAL_SECONDS = 60;

/** What a generation reads from the repository — `DetectionService`'s two reads. */
export type RepoMapReader = Pick<DetectionService, "readTree" | "read">;

/** What a generation writes the skill with — the registry's own statements. */
export type RepoMapSkillWriter = Pick<
  SkillsRepository,
  "create" | "lock" | "draftOf" | "insertDraft" | "writeDraft" | "publish"
>;

@Injectable()
export class RepoMapService {
  /** Where a generation that failed outright is reported. */
  private readonly logger = new Logger(RepoMapService.name);

  /** The generation running for each `(workspace, repository)` in this process. */
  private readonly running = new Map<string, Promise<RepoMapReport>>();

  /** When each `(workspace, repository)` was last regenerated on request, in this process. */
  private readonly requested = new Map<string, Date>();

  /**
   * @param store - The repositories to map and each one's skill.
   * @param reader - The tree, CODEOWNERS and detections.
   * @param skills - The skill writes.
   * @param database - The transaction a publish runs in.
   * @param audit - Where every generation is recorded.
   */
  constructor(
    private readonly store: RepoMapRepository,
    @Inject(DetectionService) private readonly reader: RepoMapReader,
    @Inject(SkillsRepository) private readonly skills: RepoMapSkillWriter,
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The manual regenerate — the skills table's action. Debounced per repository.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`.
   * @param actorId - Who pressed it.
   * @param now - The clock.
   * @returns The report — `unchanged` when nothing changed.
   * @throws {ConflictError} `repo_map_regenerate_too_soon` inside the debounce window.
   */
  async regenerate(
    organizationId: string,
    repo: string,
    actorId: string,
    now: Date = new Date(),
  ): Promise<RepoMapReport> {
    const key = keyOf(organizationId, repo.toLowerCase());
    const wait = retryAfterSeconds(this.requested.get(key), now, REGENERATE_INTERVAL_SECONDS);

    if (wait !== undefined && !this.running.has(key)) throw regenerateTooSoon(wait);

    this.requested.set(key, now);

    return this.generate(organizationId, repo, "manual", actorId, now);
  }

  /**
   * Where each enabled repository's map stands — generated, pending its first generation, or
   * failed at it (BG.6, [#422](https://github.com/NobuData/ouroboros/issues/422)). Reads only:
   * no host request is made, so asking never spends the repository's rate limit.
   *
   * @param organizationId - The workspace.
   * @returns One status per enabled repository, by name.
   */
  async status(organizationId: string): Promise<RepoMapStatusList> {
    const [repos, skills, generations] = await Promise.all([
      this.store.enabledRepos(organizationId),
      this.store.mapSkills(organizationId),
      this.store.lastGenerations(organizationId),
    ]);

    return {
      items: statusesOf(
        repos.map((one) => one.repo),
        skills,
        generations,
      ),
    };
  }

  /**
   * One nightly pass: every enabled repository, one at a time.
   *
   * @param now - The pass's instant.
   * @returns One report per repository; a failure is logged and skips only its repository.
   */
  async generateAll(now: Date = new Date()): Promise<RepoMapReport[]> {
    const reports: RepoMapReport[] = [];
    const limited = new Set<string>();

    for (const { organizationId, repo } of await this.store.enabledRepos()) {
      if (limited.has(organizationId)) {
        reports.push(skipped(repo, "nightly", "rate_limit", now, null));
        continue;
      }

      try {
        const report = await this.generate(organizationId, repo, "nightly", null, now);

        if (report.reason === "rate_limit") limited.add(organizationId);
        reports.push(report);
      } catch (error) {
        this.logger.error(
          `repo-map generation failed for ${repo}; retrying next night.`,
          describeForLog(error),
        );
      }
    }

    return reports;
  }

  /**
   * Generate one repository's map, or join the generation already running for it.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`; compared lower-case.
   * @param trigger - Who asked.
   * @param actorId - The person, or null for the nightly job.
   * @param now - The generation instant.
   * @returns The report.
   */
  async generate(
    organizationId: string,
    repo: string,
    trigger: RepoMapTrigger,
    actorId: string | null,
    now: Date = new Date(),
  ): Promise<RepoMapReport> {
    const ref = repo.toLowerCase();
    const key = keyOf(organizationId, ref);
    const existing = this.running.get(key);

    if (existing !== undefined) return existing;

    const run = this.execute(organizationId, ref, trigger, actorId, now).finally(() => {
      this.running.delete(key);
    });

    this.running.set(key, run);

    return run;
  }

  /**
   * The generation itself.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @param trigger - Who asked.
   * @param actorId - The person, or null.
   * @param now - The instant.
   * @returns The report, recorded in the audit trail.
   */
  private async execute(
    organizationId: string,
    repo: string,
    trigger: RepoMapTrigger,
    actorId: string | null,
    now: Date,
  ): Promise<RepoMapReport> {
    const [document, skill] = await Promise.all([
      this.render(organizationId, repo),
      this.store.skillFor(organizationId, repo),
    ]);

    let report: RepoMapReport;

    if ("reason" in document) {
      report = skipped(repo, trigger, document.reason, now, skill ?? null);
    } else if (skill?.body === document.body) {
      report = {
        ...base(repo, trigger, now, document),
        outcome: "unchanged",
        skill: skill.slug,
        version: skill.currentVersion,
      };
    } else {
      const published = await this.publish(
        organizationId,
        repo,
        skill,
        document,
        trigger,
        actorId,
        now,
      );

      report = {
        ...base(repo, trigger, now, document),
        outcome: "published",
        skill: published.slug,
        version: published.version,
      };
    }

    await this.audit.record({
      organizationId,
      actorId,
      action: KNOWLEDGE_REPO_MAP_GENERATED_EVENT,
      subjectType: "repository",
      subjectId: repo,
      at: now,
      detail: {
        repo,
        trigger,
        outcome: report.outcome,
        skill: report.skill,
        version: report.version,
        reason: report.reason,
        modules: report.modules,
        truncated: report.truncated,
      },
    });

    return report;
  }

  /**
   * Read the repository and render its map.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @returns The document, or why the repository could not be read.
   */
  private async render(
    organizationId: string,
    repo: string,
  ): Promise<RepoMapDocument | { reason: RepoMapSkipReason }> {
    let listing: Awaited<ReturnType<RepoMapReader["readTree"]>>;

    try {
      listing = await this.reader.readTree(organizationId, repo, (tree) => {
        const path = codeownersPath(tree);
        return path === undefined ? [] : [path];
      });
    } catch (error) {
      if (TicketSourceError.is(error)) {
        return { reason: error.errorClass === "rate_limit" ? "rate_limit" : "host_error" };
      }
      if (error instanceof DomainError && error.code === DETECTION_ERRORS.sourceMissing) {
        return { reason: "no_source" };
      }
      throw error;
    }

    const [path, file] = [...listing.files.entries()][0] ?? [];
    const detections = await this.reader.read(organizationId, repo);

    return renderRepoMap({
      repo,
      tree: listing.tree,
      codeowners:
        path === undefined || file === null || file === undefined
          ? null
          : { path, content: file.content },
      detections: detections.rows,
    });
  }

  /**
   * Publish the document as the skill's next version — creating the skill on the first generation.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @param skill - The existing map skill, if any.
   * @param document - The rendered map.
   * @param trigger - Who asked, for the change note.
   * @param actorId - Who pressed it, or null.
   * @param now - `published_at` — the generation timestamp.
   * @returns The slug and the new version.
   */
  private async publish(
    organizationId: string,
    repo: string,
    skill: RepoMapSkill | undefined,
    document: RepoMapDocument,
    trigger: RepoMapTrigger,
    actorId: string | null,
    now: Date,
  ): Promise<{ slug: string; version: number }> {
    const slug = skill?.slug ?? (await this.freeSlug(organizationId, repo));

    return this.database.transaction(async (trx) => {
      let skillId = skill?.id;

      if (skillId === undefined) {
        skillId = await this.skills.create(
          organizationId,
          {
            slug,
            name: REPO_MAP_FRONTMATTER.name,
            description: REPO_MAP_FRONTMATTER.description,
            scope: "repo",
            repoRef: repo,
            workflowId: null,
            origin: "generated",
            draft: false,
            frontmatter: REPO_MAP_FRONTMATTER,
            body: document.body,
          },
          trx,
        );
      } else {
        await this.skills.lock(organizationId, slug, trx);

        const current = await this.skills.draftOf(skillId, trx, true);

        if (current === undefined) {
          await this.skills.insertDraft(skillId, REPO_MAP_FRONTMATTER, document.body, trx);
        } else {
          await this.skills.writeDraft(current.id, REPO_MAP_FRONTMATTER, document.body, trx);
        }
      }

      const draft = await this.skills.draftOf(skillId, trx, true);

      if (draft === undefined) throw new Error(`The repo-map draft of ${slug} vanished.`);

      const version = await this.skills.publish(
        skillId,
        draft.id,
        {
          changeNote: `${trigger === "nightly" ? "Nightly rebuild" : "Regenerated on request"} — ${String(document.modules)} modules`,
          publishedBy: actorId,
          publishedAt: now,
          name: REPO_MAP_FRONTMATTER.name,
          description: REPO_MAP_FRONTMATTER.description,
        },
        trx,
      );

      return { slug, version: version.version ?? 0 };
    });
  }

  /**
   * The slug a repository's first map takes: `repo-map` when free, else `repo-map-<name>`, else
   * `repo-map-<owner>-<name>`.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`, lower-case.
   * @returns A free slug.
   */
  private async freeSlug(organizationId: string, repo: string): Promise<string> {
    const [owner, ...rest] = repo.split("/");
    const name = rest.join("-");
    const candidates = [
      REPO_MAP_SLUG,
      slugify(`${REPO_MAP_SLUG}-${name}`),
      slugify(`${REPO_MAP_SLUG}-${owner}-${name}`),
    ].filter((candidate): candidate is string => candidate !== undefined);
    const taken = new Set(await this.store.takenSlugs(organizationId, candidates));
    const free = candidates.find((candidate) => !taken.has(candidate));

    // Every candidate taken by a hand-made skill: the last, and the unique key says so if it is.
    return free ?? candidates[candidates.length - 1];
  }
}

/**
 * @param organizationId - The workspace.
 * @param repo - `owner/name`, lower-case.
 * @returns The in-memory key.
 */
function keyOf(organizationId: string, repo: string): string {
  return `${organizationId}\u001f${repo}`;
}

/**
 * The fields every non-skipped report shares.
 *
 * @param repo - The repository.
 * @param trigger - Who asked.
 * @param now - The instant.
 * @param document - The render.
 * @returns The shared fields.
 */
function base(repo: string, trigger: RepoMapTrigger, now: Date, document: RepoMapDocument) {
  return {
    repo,
    trigger,
    generatedAt: now.toISOString(),
    reason: null,
    modules: document.modules,
    truncated: document.truncated,
  };
}

/**
 * A skipped generation's report.
 *
 * @param repo - The repository.
 * @param trigger - Who asked.
 * @param reason - Why.
 * @param now - The instant.
 * @param skill - The existing map, if any — its version stays in force.
 * @returns The report.
 */
function skipped(
  repo: string,
  trigger: RepoMapTrigger,
  reason: RepoMapSkipReason,
  now: Date,
  skill: RepoMapSkill | null,
): RepoMapReport {
  return {
    repo,
    outcome: "skipped",
    skill: skill?.slug ?? null,
    version: skill?.currentVersion ?? null,
    generatedAt: now.toISOString(),
    trigger,
    reason,
    modules: 0,
    truncated: false,
  };
}
