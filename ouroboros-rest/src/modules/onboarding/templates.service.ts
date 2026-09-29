/**
 * Step 3 of the wizard: the template tiles, and what exists after somebody clicks one
 * ([#386](https://github.com/NobuData/ouroboros/issues/386), BB.3, decision **O4** — the service
 * layer of WF-T.5, #159).
 *
 *   * **Selection instantiates.** The template's definition goes through
 *     `WorkflowsService.createFromTemplate` — the publish gate every studio publish runs, then
 *     create + publish v1 in one transaction — and comes out as a workflow the studio can open,
 *     read and change, carrying `template_slug` + `template_version`. This service holds no
 *     write of its own to `workflows`; there is no wizard door around the gate.
 *   * **A refusal is designed, and leaves nothing behind.** A gated tier the workspace has not
 *     unlocked is `409 onboarding_template_locked` with its progress; a definition the gate
 *     refuses is `422 onboarding_template_invalid` with the gate's findings. Both are raised
 *     before anything is written.
 *   * **Re-selection deletes nothing.** Picking another template switches the wizard's choice
 *     and reports every other live instantiated workflow as `kept`. Picking a template that
 *     already has a live workflow reuses it (`created: false`) rather than copying it again.
 *   * **The lock is a computation**, evaluated by V068's functions against the runs
 *     read-model's merged count, with the operator's `OURO_ONBOARDING_UNLOCK_THRESHOLD` in
 *     force when set.
 */

import { Injectable } from "@nestjs/common";

import { AppConfigService } from "../config/config.service";
import { DomainError } from "../errors/error.envelope";
import type { PublishFinding } from "../workflows/publish.gate";
import { WORKFLOW_ERRORS } from "../workflows/workflows.errors";
import { WorkflowsService } from "../workflows/workflows.service";
import { templateInvalid, templateLocked, templateUnknown } from "./onboarding.errors";
import { OnboardingRepository } from "./onboarding.repository";
import { normaliseRepo, OnboardingService } from "./onboarding.service";
import {
  instantiatedWorkflowResource,
  STUDIO_PATH,
  studioPath,
  tileResource,
  unlockResource,
  type InstantiatedWorkflowResource,
  type TemplateSelectionResource,
  type TemplateTilesResource,
} from "./templates.resources";
import { TemplateTilesRepository, type TemplateTileRow } from "./templates.repository";

@Injectable()
export class TemplateInstantiationService {
  /**
   * @param tiles - The template, merged-count and provenance reads.
   * @param onboarding - The wizard's own row — where the active choice is stored.
   * @param wizard - The wizard's composed surface, returned beside a selection.
   * @param workflows - The workflow lifecycle: the one door a workflow is created through.
   * @param config - The operator's unlock-threshold override.
   */
  constructor(
    private readonly tiles: TemplateTilesRepository,
    private readonly onboarding: OnboardingRepository,
    private readonly wizard: OnboardingService,
    private readonly workflows: WorkflowsService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * The tiles for one repository's wizard.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`; compared case-insensitively.
   * @returns The tiles in order, each with its evaluated gate, its live workflow if any, and
   *   whether it is the repository's active choice.
   */
  async list(organizationId: string, repo: string): Promise<TemplateTilesResource> {
    const ref = normaliseRepo(repo);
    const mergedLoops = await this.tiles.mergedLoops(organizationId);
    const rows = await this.tiles.templates(
      organizationId,
      mergedLoops,
      this.config.onboardingUnlockThreshold,
    );
    const workflows = await this.tiles.instantiatedWorkflows(organizationId);
    const selectedTemplate =
      (await this.onboarding.state(organizationId, ref))?.selected_template ?? null;

    return {
      repo: ref,
      selectedTemplate,
      mergedLoops,
      studioPath: STUDIO_PATH,
      tiles: rows.map((row) => tileResource(row, { mergedLoops, selectedTemplate, workflows })),
    };
  }

  /**
   * Select a template: instantiate it (or reuse its live workflow), make it the repository's
   * active choice, and report what else is kept.
   *
   * @param organizationId - The workspace.
   * @param repo - `owner/name`.
   * @param slug - The template picked.
   * @param userId - Who picked it — recorded as v1's publisher.
   * @returns The workflow behind the choice, the workflows kept, and the wizard.
   * @throws {InvalidRequestError} `onboarding_template_unknown` — a slug the workspace is not
   *   offered; `onboarding_template_invalid` — the gate refused the definition, nothing created.
   * @throws {ConflictError} `onboarding_template_locked` — the tier is still gated;
   *   `workflow_slug_taken` — the suffix flow ran out.
   * @throws {UpstreamError} `engine_unavailable` — the gate's engine could not answer.
   */
  async select(
    organizationId: string,
    repo: string,
    slug: string,
    userId: string,
  ): Promise<TemplateSelectionResource> {
    const ref = normaliseRepo(repo);
    const mergedLoops = await this.tiles.mergedLoops(organizationId);
    const offered = await this.tiles.templates(
      organizationId,
      mergedLoops,
      this.config.onboardingUnlockThreshold,
    );
    const template = offered.find((row) => row.slug === slug);

    if (template === undefined) {
      throw templateUnknown(
        slug,
        offered.map((row) => row.slug),
      );
    }

    const unlock = unlockResource(template, mergedLoops);

    if (unlock?.locked === true) {
      throw templateLocked(slug, unlock);
    }

    const existing = (await this.tiles.instantiatedWorkflows(organizationId)).map(
      instantiatedWorkflowResource,
    );
    const reused = existing.find((workflow) => workflow.templateSlug === slug);
    const workflow = reused ?? (await this.instantiate(organizationId, template, userId));

    await this.onboarding.saveChoices(organizationId, ref, { selected_template: slug });

    return {
      created: reused === undefined,
      workflow,
      kept: existing.filter((candidate) => candidate.id !== workflow.id),
      onboarding: await this.wizard.read(organizationId, ref),
    };
  }

  /**
   * Create and publish a workflow from a template version, through the lifecycle's own gate.
   *
   * @param organizationId - The workspace.
   * @param template - The template version.
   * @param userId - The publisher.
   * @returns The workflow, as a selection reports it.
   * @throws {InvalidRequestError} `onboarding_template_invalid` in place of the gate's
   *   `workflow_definition_invalid`, carrying the same findings.
   */
  private async instantiate(
    organizationId: string,
    template: TemplateTileRow,
    userId: string,
  ): Promise<InstantiatedWorkflowResource> {
    try {
      const { workflow } = await this.workflows.createFromTemplate(
        organizationId,
        {
          slug: template.slug,
          version: template.version,
          name: template.name,
          definition: template.definition,
        },
        userId,
      );

      return {
        id: workflow.id,
        slug: workflow.slug,
        name: workflow.name,
        currentVersion: workflow.currentVersion,
        templateSlug: template.slug,
        templateVersion: template.version,
        studioPath: studioPath(workflow.slug),
      };
    } catch (error) {
      if (error instanceof DomainError && error.code === WORKFLOW_ERRORS.definitionInvalid) {
        const findings = (error.details.findings ?? []) as readonly PublishFinding[];

        throw templateInvalid(template.slug, template.version, findings);
      }

      throw error;
    }
  }
}
