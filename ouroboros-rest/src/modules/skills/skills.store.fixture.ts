/**
 * An in-memory `SkillsRepository` for the service's suite (#410).
 *
 * It keeps V069's rules the way the database does — a unique slug per workspace, one draft per
 * skill, dense version numbers, published rows immutable, `required ⇒ enabled` — and refuses a
 * breach with an error carrying the constraint's name, as `pg` would. So the service's own
 * translation of those refusals is exercised, not bypassed.
 *
 * Every method is `async` because the repository's are: a caller awaits a promise either way, and
 * an in-memory stand-in has nothing of its own to await.
 */

/* eslint-disable @typescript-eslint/require-await */

import type { Skill, SkillVersion } from "../db/schema";
import type { PageWindow } from "../tenancy/pagination";
import type {
  CarriedRun,
  NewSkillInput,
  PublishSkillInput,
  SkillChanges,
  UsageRecords,
} from "./skills.repository";
import type { SkillReference, SkillRow, WorkflowRef } from "./skills.resources";
import type { ReachUniverse } from "./skills.scope";

/** The instant the store stamps rows with, advanced by a millisecond per write. */
const EPOCH = Date.parse("2026-09-27T12:00:00Z");

/**
 * An error shaped as `pg` throws a constraint violation.
 *
 * @param constraint - The constraint's name.
 * @returns The error.
 */
function violation(constraint: string): Error {
  return Object.assign(new Error(`violates ${constraint}`), { code: "23505", constraint });
}

export class SkillStore {
  readonly skills: Skill[] = [];
  readonly versions: SkillVersion[] = [];

  /** Published workflows referencing each slug — what `referencingWorkflows` answers. */
  readonly references = new Map<string, SkillReference[]>();

  /** The workspace's workflows, by id. */
  readonly workflows = new Map<string, WorkflowRef>();

  /** The workspace's repositories. */
  repos: string[] = ["acme-robotics/helios-firmware", "acme-robotics/helios-app"];

  /** What `usage` answers. */
  usageRecords: UsageRecords = { runs: [], carried: [], injections: new Map() };

  /** The window `usage` was last asked for. */
  lastUsageWindow: { from: Date; to: Date } | undefined;

  private clock = EPOCH;
  private ids = 0;

  /** @returns The next instant. */
  private tick(): Date {
    this.clock += 1;
    return new Date(this.clock);
  }

  /**
   * @param prefix - What the id is for.
   * @returns A fresh id.
   */
  private id(prefix: string): string {
    this.ids += 1;
    return `${prefix}-${this.ids}`;
  }

  /**
   * @param skill - A stored skill.
   * @returns It as the repository's select returns it.
   */
  private row(skill: Skill): SkillRow {
    const current = this.versions.find(
      (version) => version.skill_id === skill.id && version.version === skill.current_version,
    );

    return {
      ...skill,
      workflow_slug:
        skill.workflow_id === null ? null : (this.workflows.get(skill.workflow_id)?.slug ?? null),
      current_published_at: current?.published_at ?? null,
    };
  }

  /**
   * @param skill - A skill about to be stored.
   * @throws When it breaks `required ⇒ enabled` or `required ⇒ not draft`.
   */
  private check(skill: Skill): void {
    if (skill.required && !skill.enabled) throw violation("skills_required_enabled");
    if (skill.required && skill.draft) throw violation("skills_required_not_draft");
  }

  list = jest.fn(async (organizationId: string): Promise<SkillRow[]> =>
    this.skills
      .filter((skill) => skill.organization_id === organizationId)
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .map((skill) => this.row(skill)),
  );

  findBySlug = jest.fn(
    async (organizationId: string, slug: string): Promise<SkillRow | undefined> => {
      const skill = this.skills.find(
        (candidate) => candidate.organization_id === organizationId && candidate.slug === slug,
      );

      return skill === undefined ? undefined : this.row(skill);
    },
  );

  lock = jest.fn(async (organizationId: string, slug: string): Promise<Skill | undefined> => {
    const skill = this.skills.find(
      (candidate) => candidate.organization_id === organizationId && candidate.slug === slug,
    );

    return skill === undefined ? undefined : { ...skill };
  });

  create = jest.fn(async (organizationId: string, input: NewSkillInput): Promise<string> => {
    if (this.skills.some((s) => s.organization_id === organizationId && s.slug === input.slug)) {
      throw violation("skills_organization_slug_key");
    }

    const now = this.tick();
    const skill: Skill = {
      id: this.id("skill"),
      organization_id: organizationId,
      slug: input.slug,
      name: input.name,
      description: input.description,
      scope: input.scope,
      repo_ref: input.repoRef,
      workflow_id: input.workflowId,
      enabled: true,
      required: false,
      draft: input.draft,
      origin: input.origin,
      current_version: null,
      created_at: now,
      updated_at: now,
    };

    this.skills.push(skill);
    await this.insertDraft(skill.id, input.frontmatter, input.body);

    return skill.id;
  });

  draftOf = jest.fn(async (skillId: string): Promise<SkillVersion | undefined> => {
    const draft = this.versions.find((v) => v.skill_id === skillId && v.version === null);

    return draft === undefined ? undefined : { ...draft };
  });

  insertDraft = jest.fn(
    async (skillId: string, frontmatter: unknown, body: string): Promise<SkillVersion> => {
      if (this.versions.some((v) => v.skill_id === skillId && v.version === null)) {
        throw violation("skill_versions_one_draft_idx");
      }

      const now = this.tick();
      const draft: SkillVersion = {
        id: this.id("version"),
        skill_id: skillId,
        version: null,
        body,
        frontmatter,
        published_at: null,
        published_by: null,
        change_note: null,
        created_at: now,
        updated_at: now,
      };

      this.versions.push(draft);

      return { ...draft };
    },
  );

  writeDraft = jest.fn(
    async (
      draftId: string,
      frontmatter: unknown,
      body: string,
    ): Promise<SkillVersion | undefined> => {
      const draft = this.versions.find((v) => v.id === draftId && v.version === null);

      if (draft === undefined) return undefined;

      Object.assign(draft, { frontmatter, body, updated_at: this.tick() });

      return { ...draft };
    },
  );

  versionAt = jest.fn(async (skillId: string, version: number) => {
    const found = this.versions.find((v) => v.skill_id === skillId && v.version === version);

    return found === undefined ? undefined : { ...found };
  });

  versions_ = (skillId: string) =>
    this.versions
      .filter((v) => v.skill_id === skillId && v.version !== null)
      .sort((a, b) => (b.version as number) - (a.version as number));

  // Named `versions` on the repository; the field above holds the rows.
  versionsPage = jest.fn(async (skillId: string, window: PageWindow) =>
    this.versions_(skillId).slice(window.offset, window.offset + window.limit),
  );

  countVersions = jest.fn(async (skillId: string) => this.versions_(skillId).length);

  publish = jest.fn(
    async (skillId: string, draftId: string, input: PublishSkillInput): Promise<SkillVersion> => {
      const next = (this.versions_(skillId)[0]?.version ?? 0) + 1;
      const draft = this.versions.find((v) => v.id === draftId && v.version === null);

      if (draft === undefined) throw new Error("no such draft");

      Object.assign(draft, {
        version: next,
        published_at: input.publishedAt,
        published_by: input.publishedBy,
        change_note: input.changeNote,
      });

      const skill = this.skills.find((s) => s.id === skillId) as Skill;

      Object.assign(skill, {
        current_version: next,
        name: input.name,
        description: input.description,
        updated_at: this.tick(),
      });

      return { ...draft };
    },
  );

  update = jest.fn(async (skillId: string, changes: SkillChanges): Promise<void> => {
    const skill = this.skills.find((s) => s.id === skillId) as Skill;
    const next = { ...skill, ...changes };

    this.check(next);
    Object.assign(skill, changes, { updated_at: this.tick() });
  });

  delete = jest.fn(async (skillId: string): Promise<void> => {
    this.skills.splice(
      this.skills.findIndex((s) => s.id === skillId),
      1,
    );

    for (let i = this.versions.length - 1; i >= 0; i -= 1) {
      if (this.versions[i].skill_id === skillId) this.versions.splice(i, 1);
    }
  });

  referencingWorkflows = jest.fn(
    async (_organizationId: string, slug: string): Promise<SkillReference[]> =>
      this.references.get(slug) ?? [],
  );

  workflowRef = jest.fn(async (_organizationId: string, workflowId: string) =>
    this.workflows.get(workflowId),
  );

  universe = jest.fn(async (): Promise<ReachUniverse> => ({
    repos: [...this.repos],
    workflows: [...this.workflows.values()],
  }));

  nameClashes = jest.fn(
    async (
      organizationId: string,
      skillId: string,
      name: string,
      target: { scope: string; repoRef: string | null; workflowId: string | null },
    ) =>
      this.skills
        .filter(
          (s) =>
            s.organization_id === organizationId &&
            s.id !== skillId &&
            s.scope === target.scope &&
            s.name.toLowerCase() === name.toLowerCase() &&
            (target.scope !== "repo" || s.repo_ref === target.repoRef) &&
            (target.scope !== "workflow" || s.workflow_id === target.workflowId),
        )
        .map((s) => ({ id: s.id, slug: s.slug, name: s.name })),
  );

  catalogSlugs = jest.fn(async (organizationId: string) =>
    this.skills
      .filter((s) => s.organization_id === organizationId && !s.draft && s.current_version !== null)
      .map((s) => s.slug)
      .sort(),
  );

  usage = jest.fn(async (_organizationId: string, from: Date, to: Date): Promise<UsageRecords> => {
    this.lastUsageWindow = { from, to };
    return this.usageRecords;
  });

  /**
   * The store as a `SkillsRepository`, with `versions` mapped to the page read.
   *
   * @returns The repository-shaped object.
   */
  asRepository(): Record<string, unknown> {
    return {
      list: this.list,
      findBySlug: this.findBySlug,
      lock: this.lock,
      create: this.create,
      draftOf: this.draftOf,
      insertDraft: this.insertDraft,
      writeDraft: this.writeDraft,
      versionAt: this.versionAt,
      versions: this.versionsPage,
      countVersions: this.countVersions,
      publish: this.publish,
      update: this.update,
      delete: this.delete,
      referencingWorkflows: this.referencingWorkflows,
      workflowRef: this.workflowRef,
      universe: this.universe,
      nameClashes: this.nameClashes,
      catalogSlugs: this.catalogSlugs,
      usage: this.usage,
    };
  }
}

/** One `(skill, run)` pair, for `usageRecords`. */
export type { CarriedRun };
