/**
 * An in-memory workspace for `RuleImportService`'s suite
 * ([#413](https://github.com/NobuData/ouroboros/issues/413)): the baseline reads, the registries'
 * writes, a transaction that commits or discards them together, a repository reader and an audit.
 */

import type { AuditRecord } from "../audit/audit.events";
import type { DatabaseService } from "../db/db.service";
import type { FactProposer, FactStatus, SkillOrigin, SkillScope } from "../db/schema";
import type { FactsRepository, NewFactInput } from "../facts/facts.repository";
import type { FactProvenance } from "../facts/facts.resources";
import type { NewSkillInput, SkillsRepository } from "../skills/skills.repository";
import type { RepoFile } from "../ticket-sources/ticket-source.probe";
import { normalizeFactText } from "./rule-import.parse";
import type { ImportBaseline } from "./rule-import.plan";
import type { RuleImportStore } from "./rule-import.repository";
import type { RuleFileReader, RuleImportAudit } from "./rule-import.service";

/** The workspace the suite imports into. */
export const IMPORT_WORKSPACE = "0a000000-0000-4000-8000-000000000413";

/** The person applying. */
export const IMPORT_ACTOR = "user-admin";

/** One stored skill version. */
export interface StoredVersion {
  id: string;
  /** `null` for the draft. */
  version: number | null;
  body: string;
  frontmatter: Record<string, unknown>;
}

/** One stored skill. */
export interface StoredSkill {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  description: string;
  scope: SkillScope;
  repoRef: string | null;
  origin: SkillOrigin;
  enabled: boolean;
  draft: boolean;
  versions: StoredVersion[];
}

/** One stored fact. */
export interface StoredFact {
  id: string;
  organizationId: string;
  repoRef: string | null;
  text: string;
  status: FactStatus;
  proposer: FactProposer;
  provenance: FactProvenance;
  actorId: string | null;
}

/** The world's tables. */
interface Tables {
  skills: StoredSkill[];
  facts: StoredFact[];
}

/** A workspace in memory, whose writes land only when their transaction commits. */
export class ImportWorld {
  /** What is committed. */
  tables: Tables = { skills: [], facts: [] };
  /** The applies' locks taken, as `org:repo`. */
  readonly locks: string[] = [];
  /** When set, the n-th fact insert throws — a failure mid-apply. */
  failFactInsertAt: number | undefined;

  /** The transaction's working copy, while one is open. */
  private working: Tables | undefined;
  private nextId = 1;
  private factInserts = 0;

  /** @returns The tables a statement sees: the transaction's, or the committed ones. */
  private get view(): Tables {
    return this.working ?? this.tables;
  }

  /** @returns A fresh id. */
  private id(prefix: string): string {
    const id = `${prefix}-${String(this.nextId)}`;

    this.nextId += 1;

    return id;
  }

  /** @returns The pool, as far as the service reaches it. */
  database(): DatabaseService {
    return {
      transaction: async <T>(work: (trx: unknown) => Promise<T>): Promise<T> => {
        this.working = structuredClone(this.tables);

        try {
          const result = await work({ trx: true });

          this.tables = this.working;

          return result;
        } finally {
          this.working = undefined;
        }
      },
    } as unknown as DatabaseService;
  }

  /** @returns The baseline reads and the lock. */
  store(): RuleImportStore {
    return {
      baseline: (organizationId, repo) => Promise.resolve(this.baseline(organizationId, repo)),
      lockRepo: (organizationId, repo) => {
        this.locks.push(`${organizationId}:${repo}`);

        return Promise.resolve();
      },
    };
  }

  /** @returns The skills registry's writes. */
  skills(): SkillsRepository {
    return {
      create: (organizationId: string, input: NewSkillInput) => {
        if (
          this.view.skills.some((s) => s.organizationId === organizationId && s.slug === input.slug)
        ) {
          return Promise.reject(
            Object.assign(new Error("duplicate slug"), {
              code: "23505",
              constraint: "skills_organization_slug_key",
            }),
          );
        }

        const id = this.id("skill");

        this.view.skills.push({
          id,
          organizationId,
          slug: input.slug,
          name: input.name,
          description: input.description,
          scope: input.scope,
          repoRef: input.repoRef,
          origin: input.origin,
          enabled: true,
          draft: input.draft,
          versions: [
            {
              id: this.id("version"),
              version: null,
              body: input.body,
              frontmatter: input.frontmatter as Record<string, unknown>,
            },
          ],
        });

        return Promise.resolve(id);
      },
      draftOf: (skillId: string) => {
        const draft = this.skill(skillId).versions.find((v) => v.version === null);

        return Promise.resolve(draft === undefined ? undefined : { id: draft.id });
      },
      insertDraft: (skillId: string, frontmatter: unknown, body: string) => {
        const version = {
          id: this.id("version"),
          version: null,
          body,
          frontmatter: frontmatter as Record<string, unknown>,
        };

        this.skill(skillId).versions.push(version);

        return Promise.resolve(version);
      },
      writeDraft: (draftId: string, frontmatter: unknown, body: string) => {
        const draft = this.view.skills
          .flatMap((skill) => skill.versions)
          .find((version) => version.id === draftId);

        if (draft === undefined) throw new Error(`no draft ${draftId}`);
        draft.body = body;
        draft.frontmatter = frontmatter as Record<string, unknown>;

        return Promise.resolve(draft);
      },
    } as unknown as SkillsRepository;
  }

  /** @returns The fact lifecycle's insert. */
  facts(): FactsRepository {
    return {
      insert: (organizationId: string, input: NewFactInput) => {
        this.factInserts += 1;

        if (this.factInserts === this.failFactInsertAt) {
          return Promise.reject(new Error("the connection dropped"));
        }

        const id = this.id("fact");

        this.view.facts.push({
          id,
          organizationId,
          repoRef: input.repoRef,
          text: input.text,
          status: "proposed",
          proposer: input.proposer,
          provenance: input.provenance,
          actorId: input.actorId,
        });

        return Promise.resolve(id);
      },
    } as unknown as FactsRepository;
  }

  /**
   * Add a published, authored skill.
   *
   * @param slug - Its slug.
   */
  addSkill(slug: string): void {
    this.tables.skills.push({
      id: this.id("skill"),
      organizationId: IMPORT_WORKSPACE,
      slug,
      name: slug,
      description: slug,
      scope: "org",
      repoRef: null,
      origin: "authored",
      enabled: true,
      draft: false,
      versions: [{ id: this.id("version"), version: 1, body: slug, frontmatter: {} }],
    });
  }

  /**
   * Add a fact.
   *
   * @param text - Its text.
   * @param repoRef - Its repository, or null for the workspace.
   * @param status - Its status.
   */
  addFact(text: string, repoRef: string | null, status: FactStatus = "confirmed"): void {
    this.tables.facts.push({
      id: this.id("fact"),
      organizationId: IMPORT_WORKSPACE,
      repoRef,
      text,
      status,
      proposer: "manual",
      provenance: { line: "added by hand", refs: [] },
      actorId: null,
    });
  }

  /**
   * The baseline, as `RuleImportRepository.baseline` reads it.
   *
   * @param organizationId - The workspace.
   * @param repo - The repository.
   * @returns The baseline.
   */
  private baseline(organizationId: string, repo: string): ImportBaseline {
    const skills = this.view.skills.filter((skill) => skill.organizationId === organizationId);

    return {
      slugs: new Set(skills.map((skill) => skill.slug)),
      importedSkills: skills
        .filter((skill) => skill.origin === "imported")
        .map((skill) => ({
          skillId: skill.id,
          slug: skill.slug,
          repoRef: skill.repoRef,
          provenances: skill.versions.map((version) => {
            const provenance = version.frontmatter.provenance as
              { source: string; section?: string } | undefined;

            return { source: provenance?.source ?? "", section: provenance?.section ?? null };
          }),
          bodies: skill.versions.map((version) => version.body),
        })),
      factTexts: new Set(
        this.view.facts
          .filter(
            (fact) =>
              fact.organizationId === organizationId &&
              (fact.repoRef === repo || fact.repoRef === null),
          )
          .map((fact) => normalizeFactText(fact.text)),
      ),
    };
  }

  /**
   * @param skillId - A skill's id.
   * @returns The skill, in the view.
   */
  private skill(skillId: string): StoredSkill {
    const skill = this.view.skills.find((candidate) => candidate.id === skillId);

    if (skill === undefined) throw new Error(`no skill ${skillId}`);

    return skill;
  }
}

/** A reader answering from a map of files, counting its reads. */
export class FixtureReader implements RuleFileReader {
  /** The `(repo, paths)` of every read. */
  readonly reads: { repo: string; paths: readonly string[] }[] = [];
  /** When set, every read throws it. */
  failure: Error | undefined;

  /** @param files - Contents by path; edit between calls to change the repository. */
  constructor(public files: Record<string, string> = {}) {}

  readFiles(
    _organizationId: string,
    repo: string,
    paths: readonly string[],
  ): Promise<Map<string, RepoFile | null>> {
    this.reads.push({ repo, paths });

    if (this.failure !== undefined) return Promise.reject(this.failure);

    return Promise.resolve(
      new Map(
        paths.map((path) => {
          const content = this.files[path];

          return [
            path,
            content === undefined ? null : { path, content, size: Buffer.byteLength(content) },
          ];
        }),
      ),
    );
  }
}

/** An audit that keeps what it was given. */
export class RecordingAudit implements RuleImportAudit {
  readonly events: AuditRecord[] = [];

  record(event: AuditRecord): Promise<string> {
    this.events.push(event);

    return Promise.resolve(`audit-${String(this.events.length)}`);
  }
}
