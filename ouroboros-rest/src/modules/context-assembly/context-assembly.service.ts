/**
 * `ContextAssemblyService` — scoped knowledge into the manifest every consumer injects, and the
 * injection records that make every usage number counted truth (BF.5,
 * [#414](https://github.com/NobuData/ouroboros/issues/414), decisions **K8** and **K9**).
 *
 * ```
 * assemble({repo?, workflow?}, consumer, {overrides?, budgetTokens?})
 *   ─▶ read the workspace's skills (version in force) and confirmed facts
 *   ─▶ resolveManifest()  — context-assembly.resolve.ts, the one implementation of K8
 *   ─▶ manifest {skillVersions, facts, estTokens, trimmed, excluded, refusedOverrides, hash}
 * record(injection)       ─▶ context_injections (V071) — what the consumer actually injected
 * ```
 *
 * **Assembling records nothing.** `assemble` is a read; `preview` is `assemble` served over HTTP
 * unchanged, which is why the two answer byte for byte the same. A consumer records what it
 * *actually injected* with {@link ContextAssemblyService.record} — usually exactly
 * {@link injectionOf} the manifest, but a subset when it sent less — and that record is where
 * `used 48×`, `61% of runs` and the ladder's counts come from (#406, BF.1's stats, BF.2's card).
 *
 * The rules, the trim policy and the hash are documented once, in `context-assembly.resolve.ts`'s
 * header, beside the code that applies them.
 *
 * ---------------------------------------------------------------------------
 * ## Consumers
 *
 * **Wired now — the estimator (INTAKE-L.1, #105).** `estimation.knowledge.ts` assembles
 * `{repo: <the issue's repository>}` for `estimator`, sends the manifest's facts as
 * `EstimationContext.facts`, and — once the estimate row is stored — records
 * `{consumer: estimator, estimateId, factIds, manifestHash}`.
 *
 * **Documented for AR.1 (#315) — execution.** One manifest **per stage**, assembled when the stage
 * starts, from that stage's skill configuration:
 *
 *   * scope `{repo: <the run's repository>, workflow: <the run's workflow slug>}`;
 *   * consumer `run_stage`;
 *   * overrides: the stage node's `skill:` reference is resolved like any skill — it must be in
 *     scope to be injected; a playbook launch adds the playbook's `skill_overrides` (V072) as the
 *     `{enable, disable}` delta and records as `playbook` against the launched run instead;
 *   * the stage injects `skillVersions[].body` (honouring each entry's `load`/`triggers` against
 *     its own task text) and `facts[].text`, then records
 *     `{consumer: run_stage, runStageId, runId, skillVersionIds, factIds, manifestHash}` — the ids
 *     of what it injected, which is `injectionOf(manifest)` unless it skipped an `on_trigger` skill.
 *
 * **Optional — the dry-run simulator (R.2, #144; #560).** A dry-run stage is an ordinary consumer:
 * it assembles as a stage would, and previews need no recording.
 */

import { Injectable } from "@nestjs/common";

import { FOREIGN_KEY_VIOLATION, isDatabaseFailure } from "../tenancy/constraints";
import {
  consumerReference,
  overridesOverlap,
  unresolved,
  workflowNotFound,
} from "./context-assembly.errors";
import { budgetFor } from "./context-assembly.profiles";
import { ContextAssemblyRepository } from "./context-assembly.repository";
import { NO_OVERRIDES, resolveManifest, type SkillOverrides } from "./context-assembly.resolve";
import type {
  ContextConsumer,
  ContextManifest,
  InjectionResource,
} from "./context-assembly.resources";

/** Where to assemble for. */
export interface AssemblyScope {
  /** `owner/name`; omitted or null for a workspace-wide manifest. */
  readonly repo?: string | null;
  /** A workflow's slug; omitted or null when no workflow is in scope. */
  readonly workflow?: string | null;
}

/** How to assemble. */
export interface AssemblyOptions {
  /** V072's delta of skill ids, applied after resolution. */
  readonly overrides?: Partial<SkillOverrides>;
  /** A budget lower than the consumer's; a higher one is not granted. */
  readonly budgetTokens?: number;
}

/** What a consumer records. */
export interface InjectionInput {
  readonly consumer: ContextConsumer;
  readonly estimateId?: string | null;
  readonly runStageId?: string | null;
  readonly runId?: string | null;
  readonly skillVersionIds: readonly string[];
  readonly factIds: readonly string[];
  readonly manifestHash: string;
}

/**
 * The ids a manifest carries — what a consumer that injected all of it records.
 *
 * @param manifest - The assembled manifest.
 * @returns Its skill version ids, fact ids and hash.
 */
export function injectionOf(
  manifest: ContextManifest,
): Pick<InjectionInput, "skillVersionIds" | "factIds" | "manifestHash"> {
  return {
    skillVersionIds: manifest.skillVersions.map((skill) => skill.versionId),
    factIds: manifest.facts.map((fact) => fact.id),
    manifestHash: manifest.manifestHash,
  };
}

@Injectable()
export class ContextAssemblyService {
  /** @param store - The workspace's skills, facts and workflows; the injection append. */
  constructor(private readonly store: ContextAssemblyRepository) {}

  /**
   * Assemble one manifest. Records nothing.
   *
   * @param organizationId - The workspace — the only one whose rows are read.
   * @param scope - The repository and workflow in scope.
   * @param consumer - Who the manifest is for; decides what it holds and its budget.
   * @param options - Overrides and a tighter budget.
   * @returns The manifest.
   * @throws `404 context_workflow_not_found` when the scope's workflow is not this workspace's;
   *   `422 context_overrides_overlap` when a skill is both enabled and disabled.
   */
  async assemble(
    organizationId: string,
    scope: AssemblyScope,
    consumer: ContextConsumer,
    options: AssemblyOptions = {},
  ): Promise<ContextManifest> {
    const overrides: SkillOverrides = {
      enable: options.overrides?.enable ?? NO_OVERRIDES.enable,
      disable: options.overrides?.disable ?? NO_OVERRIDES.disable,
    };
    const overlap = overrides.enable.filter((id) => overrides.disable.includes(id));

    if (overlap.length > 0) {
      throw overridesOverlap(overlap);
    }

    const repo = scope.repo ?? null;
    const workflow = scope.workflow ?? null;
    const [workflowId, skills, facts] = await Promise.all([
      workflow === null ? Promise.resolve(null) : this.store.workflowId(organizationId, workflow),
      this.store.skills(organizationId),
      this.store.facts(organizationId),
    ]);

    if (workflowId === undefined) {
      throw workflowNotFound(workflow ?? "");
    }

    return resolveManifest({
      consumer,
      repo,
      workflow,
      workflowId,
      skills,
      facts,
      overrides,
      budgetTokens: budgetFor(consumer, options.budgetTokens),
    });
  }

  /**
   * Record what a consumer actually injected.
   *
   * @param organizationId - The workspace.
   * @param injection - The consumer, its reference, the ids it injected and the manifest's hash.
   * @returns The stored record.
   * @throws `422 context_injection_consumer_reference` when the references do not fit the
   *   consumer; `422 context_injection_unresolved` when V071 refuses an id.
   */
  async record(organizationId: string, injection: InjectionInput): Promise<InjectionResource> {
    const estimateId = injection.estimateId ?? null;
    const runStageId = injection.runStageId ?? null;
    const runId = injection.runId ?? null;

    if (!fitsConsumer(injection.consumer, estimateId, runStageId, runId)) {
      throw consumerReference(injection.consumer);
    }

    try {
      return await this.store.record(organizationId, {
        consumer: injection.consumer,
        estimateId,
        runStageId,
        runId,
        skillVersionIds: injection.skillVersionIds,
        factIds: injection.factIds,
        manifestHash: injection.manifestHash,
      });
    } catch (error) {
      if (isDatabaseFailure(error) && error.code === FOREIGN_KEY_VIOLATION) {
        throw unresolved();
      }
      throw error;
    }
  }
}

/**
 * V071's `context_injections_consumer_ref`, checked before the write so the refusal names itself.
 *
 * @param consumer - The consumer.
 * @param estimateId - The estimate, if any.
 * @param runStageId - The stage, if any.
 * @param runId - The run, if any.
 * @returns Whether the references fit the consumer.
 */
export function fitsConsumer(
  consumer: ContextConsumer,
  estimateId: string | null,
  runStageId: string | null,
  runId: string | null,
): boolean {
  switch (consumer) {
    case "estimator":
      return estimateId !== null && runStageId === null && runId === null;
    case "run_stage":
      return runStageId !== null && runId !== null && estimateId === null;
    case "playbook":
      return runId !== null && estimateId === null && runStageId === null;
  }
}
