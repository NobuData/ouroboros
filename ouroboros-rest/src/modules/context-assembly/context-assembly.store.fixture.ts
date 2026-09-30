/**
 * An in-memory `ContextAssemblyRepository` over several workspaces
 * ([#414](https://github.com/NobuData/ouroboros/issues/414)).
 *
 * Its `record` plays V071's `context_injections_resolves` trigger: an estimate, run or stage of
 * another workspace, a fact that is not a confirmed fact of this one, or a skill version that is
 * not a published version of this workspace's non-draft skill is refused with the trigger's
 * SQLSTATE and constraint name — so the service's mapping is tested against the refusal it will
 * really get.
 */

import type { ContextAssemblyRepository, NewInjection } from "./context-assembly.repository";
import type { CandidateFact, CandidateSkill } from "./context-assembly.resolve";
import type { InjectionResource } from "./context-assembly.resources";

/** One workspace's rows. */
interface WorkspaceRows {
  skills: CandidateSkill[];
  facts: CandidateFact[];
  workflows: Map<string, string>;
  estimates: Set<string>;
  runs: Set<string>;
  /** Stage id → its run. */
  stages: Map<string, string>;
}

/** A stored injection, with its workspace. */
export interface StoredInjection extends InjectionResource {
  readonly organizationId: string;
}

/** The world the fake repository reads and appends to. */
export class AssemblyWorld {
  private readonly workspaces = new Map<string, WorkspaceRows>();

  /** Every injection recorded, in order. */
  readonly injections: StoredInjection[] = [];

  /** How many injections have been appended — for minting ids. */
  private appended = 0;

  /**
   * One workspace's rows, created on first use.
   *
   * @param organizationId - The workspace.
   * @returns Its mutable rows.
   */
  workspace(organizationId: string): WorkspaceRows {
    let rows = this.workspaces.get(organizationId);

    if (rows === undefined) {
      rows = {
        skills: [],
        facts: [],
        workflows: new Map(),
        estimates: new Set(),
        runs: new Set(),
        stages: new Map(),
      };
      this.workspaces.set(organizationId, rows);
    }

    return rows;
  }

  /**
   * The fake repository.
   *
   * @returns An object with the repository's four methods.
   */
  store(): ContextAssemblyRepository {
    return {
      workflowId: async (organizationId: string, slug: string) =>
        Promise.resolve(this.workspace(organizationId).workflows.get(slug)),
      // The real reads' `where` clauses: non-draft skills, confirmed facts.
      skills: async (organizationId: string) =>
        Promise.resolve(this.workspace(organizationId).skills.filter((skill) => !skill.draft)),
      facts: async (organizationId: string) =>
        Promise.resolve(
          this.workspace(organizationId).facts.filter((fact) => fact.status === "confirmed"),
        ),
      record: async (organizationId: string, injection: NewInjection) =>
        this.append(organizationId, injection),
    } as unknown as ContextAssemblyRepository;
  }

  /**
   * V071's append, trigger included.
   *
   * @param organizationId - The workspace.
   * @param injection - The record.
   * @returns The stored row.
   */
  private async append(
    organizationId: string,
    injection: NewInjection,
  ): Promise<InjectionResource> {
    const rows = this.workspace(organizationId);
    const refuse = (): Promise<never> =>
      Promise.reject(
        Object.assign(new Error("context_injections_resolves"), {
          code: "23503",
          constraint: "context_injections_resolves",
        }),
      );

    if (injection.estimateId !== null && !rows.estimates.has(injection.estimateId)) {
      return refuse();
    }
    if (injection.runId !== null && !rows.runs.has(injection.runId)) {
      return refuse();
    }
    if (
      injection.runStageId !== null &&
      rows.stages.get(injection.runStageId) !== injection.runId
    ) {
      return refuse();
    }
    if (
      injection.factIds.some(
        (id) => !rows.facts.some((fact) => fact.id === id && fact.status === "confirmed"),
      )
    ) {
      return refuse();
    }
    if (
      injection.skillVersionIds.some(
        (id) => !rows.skills.some((skill) => skill.versionId === id && !skill.draft),
      )
    ) {
      return refuse();
    }

    this.appended += 1;
    const stored: StoredInjection = {
      organizationId,
      id: `5eed0048-0000-4000-8000-${this.appended.toString(16).padStart(12, "0")}`,
      consumer: injection.consumer,
      estimateId: injection.estimateId,
      runStageId: injection.runStageId,
      runId: injection.runId,
      skillVersionIds: [...injection.skillVersionIds],
      factIds: [...injection.factIds],
      manifestHash: injection.manifestHash,
      injectedAt: "2026-09-29T12:00:00.000Z",
    };
    this.injections.push(stored);

    const { organizationId: _workspace, ...resource } = stored;
    return Promise.resolve(resource);
  }
}
