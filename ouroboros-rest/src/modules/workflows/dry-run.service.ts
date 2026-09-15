/**
 * The studio's **Dry run with issue #485** — S.6
 * ([#152](https://github.com/NobuData/ouroboros/issues/152)).
 *
 * ```
 * resolve the workflow (404) ─┬─ its draft, else the version in force (409 when neither)
 *                             └─ the issue, in this workspace (404)
 *                                   └─▶ the engine walks the document for the ticket ─▶ 200
 * ```
 *
 * Three decisions:
 *
 *   * **It walks the stored draft.** The canvas autosaves, and the studio flushes a pending save
 *     before asking, so the stored draft is the picture on the screen; a workflow with no draft
 *     open walks the version in force, which is what would run. Sending the document in the body
 *     instead would let a caller simulate a definition nobody can see.
 *   * **It writes nothing, so it is every member's.** No `@Roles()`, the way the reads are: a dry
 *     run explains a definition a viewer may already read, and makes no model call and no provider
 *     call. Results are not recorded (decision **W4** keeps simulations out of the run read-model).
 *   * **A definition that does not validate is a `200`.** The engine answers it with findings and
 *     an empty walk, and the studio shows those findings where a publish would; only publishing
 *     turns a finding into a refusal.
 */

import { Injectable } from "@nestjs/common";

import { EngineClient } from "../engine/engine.client";
import { WorkflowDryRunRepository } from "./dry-run.repository";
import { dryRunTicket, workflowDryRun, type WorkflowDryRunResource } from "./dry-run.resources";
import type { DryRunWorkflowBody } from "./workflows.dto";
import { draftAbsent, dryRunIssueNotFound, workflowNotFound } from "./workflows.errors";
import { WorkflowsRepository } from "./workflows.repository";

@Injectable()
export class WorkflowDryRunService {
  /**
   * @param workflows - The lifecycle's statements — the org-scoped `find`, the draft, a version.
   * @param issues - The one issue a dry run is about.
   * @param engine - The typed engine client, from the non-global `EngineModule`.
   */
  constructor(
    private readonly workflows: WorkflowsRepository,
    private readonly issues: WorkflowDryRunRepository,
    private readonly engine: EngineClient,
  ) {}

  /**
   * Walk a workflow for one issue.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param id - The workflow.
   * @param body - The issue to walk it for.
   * @returns The walk, with the ticket it tested and any findings.
   * @throws {NotFoundError} `workflow_not_found`, or `workflow_dry_run_issue_not_found` — each
   *   covering *not this workspace's* as well as *absent*.
   * @throws {ConflictError} `workflow_draft_absent` when the workflow has neither a draft nor a
   *   version — nothing to walk.
   * @throws {UpstreamError} `engine_unavailable` when the engine could not answer.
   */
  async dryRun(
    organizationId: string,
    id: string,
    body: DryRunWorkflowBody,
  ): Promise<WorkflowDryRunResource> {
    // Resolved first and alone: the workflow's id is what makes every version statement below
    // this workspace's (see `workflows.repository.ts`).
    const workflow = await this.workflows.find(organizationId, id);

    if (workflow === undefined) throw workflowNotFound(id);

    const [draft, issue] = await Promise.all([
      this.workflows.draftOf(workflow.id),
      this.issues.issue(organizationId, body.issueId),
    ]);

    if (issue === undefined) throw dryRunIssueNotFound(body.issueId);

    const definition =
      draft?.definition ?? (await this.inForce(workflow.id, workflow.current_version));

    if (definition === undefined) throw draftAbsent(id);

    const ticket = dryRunTicket(issue);

    return workflowDryRun(ticket, await this.engine.dryRunWorkflow(definition, ticket));
  }

  /**
   * The document of the version in force, when there is one.
   *
   * @param workflowId - A workflow already resolved through the org-scoped `find`.
   * @param version - `workflows.current_version`, or `null` for a workflow that has published
   *   nothing.
   * @returns The document, or `undefined`.
   */
  private async inForce(workflowId: string, version: number | null): Promise<unknown> {
    if (version === null) return undefined;

    return (await this.workflows.versionAt(workflowId, version))?.definition;
  }
}
