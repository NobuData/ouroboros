/**
 * What each model stage of a dry run is sent — the alias routing resolved for it and the
 * knowledge context assembly built (CD.4,
 * [#562](https://github.com/NobuData/ouroboros/issues/562)).
 *
 * The harness executes and does not configure (`ouroboros-engine/…/dryrun/contract.py`): which
 * alias a stage routes to is routing's answer (Z.1, #194) and the knowledge it is given is
 * context assembly's (BF.5, #414), so both are resolved here, per model stage, before dispatch.
 *
 * ```
 * routing.pinned_model {alias}   in the registry  → that alias
 *                                not in it        → unresolved, with the warning
 * routing.inherit_task <task>    a route resolves → the chain's primary alias, with its version
 *                                no route / fails → unresolved, with why
 * mode: skill, skill <name>      a skill exists   → skill_resolved
 *                                it does not      → the stage runs without it, and says so
 * ```
 *
 * **An unresolved stage is skipped honestly, not failed** (decision W7): the copilot may propose
 * a stage kind the catalog does not have yet, and the dry run's row says so instead of inventing
 * a model for it.
 */

import { Injectable } from "@nestjs/common";

import { ContextAssemblyService } from "../context-assembly/context-assembly.service";
import type { ContextManifest } from "../context-assembly/context-assembly.resources";
import { ENGINE_DRY_RUN_MAX_MANIFEST, type EngineDryRunStagePlan } from "../engine/engine.dryruns";
import { NotFoundError } from "../errors/error.envelope";
import { ResolutionService } from "../routing/resolution.service";
import { WorkflowCatalogService } from "../workflows/catalog.service";
import type { DslCatalogue } from "../workflows/dsl.references";
import { LlmConfigSchema, type Effort } from "../workflows/dsl.schema";

/** The most warnings one stage is sent — the engine's `StagePlan.warnings` bound. */
const MAX_WARNINGS = 8;

/** What a plan is resolved for. */
export interface PlanSubject {
  /** The workspace. */
  readonly organizationId: string;
  /** The workflow's slug — context assembly's workflow scope. */
  readonly workflowSlug: string;
  /** `owner/name` — context assembly's repository scope. */
  readonly repository: string;
  /** The ticket's facts, for routing's escalation rules. */
  readonly labels: readonly string[];
  readonly effort: Effort | null;
}

/**
 * The knowledge a manifest carries, as the text a stage is given.
 *
 * @param manifest - The assembled manifest.
 * @returns Each skill's body under its name, then the confirmed facts; `""` when it holds
 *   nothing. Cut to the engine's bound.
 */
export function manifestText(manifest: ContextManifest): string {
  const skills = manifest.skillVersions.map(
    (skill) => `## Skill: ${skill.slug} (v${String(skill.version)})\n\n${skill.body.trim()}`,
  );
  const facts =
    manifest.facts.length === 0
      ? []
      : [`## Facts\n\n${manifest.facts.map((fact) => `- ${fact.text}`).join("\n")}`];

  return [...skills, ...facts].join("\n\n").slice(0, ENGINE_DRY_RUN_MAX_MANIFEST);
}

@Injectable()
export class DryRunPlanService {
  /**
   * @param catalog - The names that exist: skills, aliases, task routes (R.3).
   * @param routing - Z.1's resolution.
   * @param assembly - BF.5's manifest.
   */
  constructor(
    private readonly catalog: WorkflowCatalogService,
    private readonly routing: ResolutionService,
    private readonly assembly: ContextAssemblyService,
  ) {}

  /**
   * Resolve every model stage of a definition.
   *
   * @param subject - The workspace, workflow, repository and ticket facts.
   * @param definition - The draft's document — already past the structural pre-check.
   * @returns One plan per `llm` node, by node id.
   */
  async plans(
    subject: PlanSubject,
    definition: unknown,
  ): Promise<Record<string, EngineDryRunStagePlan>> {
    const nodes = (definition as { nodes?: unknown }).nodes;
    const stages = (Array.isArray(nodes) ? nodes : []).filter(
      (node): node is { id: string; config: unknown } =>
        node !== null &&
        typeof node === "object" &&
        (node as { type?: unknown }).type === "llm" &&
        typeof (node as { id?: unknown }).id === "string",
    );
    if (stages.length === 0) return {};

    const [catalogue, manifest] = await Promise.all([
      this.catalog.dslCatalogue(subject.organizationId),
      this.assembly.assemble(
        subject.organizationId,
        { repo: subject.repository, workflow: subject.workflowSlug },
        "run_stage",
      ),
    ]);
    const knowledge = manifestText(manifest);

    const plans: Record<string, EngineDryRunStagePlan> = {};
    for (const stage of stages) {
      plans[stage.id] = await this.plan(subject, stage, catalogue, knowledge);
    }

    return plans;
  }

  /**
   * Resolve one model stage.
   *
   * @param subject - What the plan is for.
   * @param stage - The node.
   * @param stage.id - Its id.
   * @param stage.config - Its config, unvalidated.
   * @param catalogue - The names that exist.
   * @param knowledge - The assembled manifest, as text.
   * @returns The plan.
   */
  private async plan(
    subject: PlanSubject,
    stage: { id: string; config: unknown },
    catalogue: DslCatalogue,
    knowledge: string,
  ): Promise<EngineDryRunStagePlan> {
    const config = LlmConfigSchema.safeParse(stage.config);
    if (!config.success) {
      return {
        alias: null,
        resolutionVersion: null,
        manifest: knowledge,
        skillResolved: false,
        warnings: [`Stage "${stage.id}" has a model configuration that does not parse.`],
      };
    }

    const warnings: string[] = [];
    const { skill, mode, routing } = config.data;
    const skillResolved =
      mode !== "skill" || skill === undefined || (catalogue.skills ?? []).includes(skill);
    if (!skillResolved) {
      warnings.push(`Skill "${skill ?? ""}" does not exist yet — the stage ran without it.`);
    }

    let alias: string | null = null;
    let resolutionVersion: string | null = null;

    if (routing.pinned_model !== undefined) {
      if ((catalogue.aliases ?? []).includes(routing.pinned_model.alias)) {
        alias = routing.pinned_model.alias;
      } else {
        warnings.unshift(
          `Alias "${routing.pinned_model.alias}" is not in the model registry — the stage was skipped.`,
        );
      }
    } else if (routing.inherit_task !== undefined) {
      const routed = await this.route(subject, routing.inherit_task);
      if (routed.alias === null) {
        warnings.unshift(routed.warning);
      } else {
        alias = routed.alias;
        resolutionVersion = routed.resolutionVersion;
      }
    } else {
      warnings.unshift(`Stage "${stage.id}" names no model routing — the stage was skipped.`);
    }

    return {
      alias,
      resolutionVersion,
      manifest: knowledge,
      skillResolved,
      warnings: warnings.slice(0, MAX_WARNINGS),
    };
  }

  /**
   * Resolve a task kind to the alias its chain starts with.
   *
   * @param subject - The workspace and the ticket's facts.
   * @param task - The task kind the stage inherits.
   * @returns The alias and resolution version, or `alias: null` with the warning.
   */
  private async route(
    subject: PlanSubject,
    task: string,
  ): Promise<
    { alias: string; resolutionVersion: string | null } | { alias: null; warning: string }
  > {
    let resolution;
    try {
      resolution = await this.routing.resolve(subject.organizationId, task, {
        labels: subject.labels,
        repo: subject.repository,
        ...(subject.effort === null ? {} : { effort: subject.effort }),
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return {
          alias: null,
          warning: `Task kind "${task}" has no route yet — the stage was skipped.`,
        };
      }
      throw error;
    }

    const primary = resolution.chain.find((hop) => hop.decision === "kept");
    if (resolution.outcome !== "resolved" || primary === undefined) {
      const reason =
        resolution.failure?.explanation ?? "no provider in the chain can serve it right now";

      return {
        alias: null,
        warning: `The "${task}" route did not resolve — ${reason} The stage was skipped.`,
      };
    }

    return { alias: primary.alias, resolutionVersion: resolution.resolutionVersion };
  }
}
