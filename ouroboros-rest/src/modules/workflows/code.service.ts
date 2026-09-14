/**
 * `WorkflowCodeService` — the code view's reads and its save. U.3
 * ([#167](https://github.com/NobuData/ouroboros/issues/167)).
 *
 * ```
 * read    the draft, or a published version, as a file — when the file would be the document
 * save    parse ─▶ check the slug ─▶ the shared guarded write
 *           └ refused whole, before anything is opened, when the file does not read
 * tree    the explorer, from the rail's statement
 * config  ouroboros.config.ts, from the same statement
 * ```
 *
 * Four rules, each an acceptance criterion:
 *
 *   * **One draft, two editors (C3).** A save goes through `WorkflowsService.writeGuarded`, the
 *     guard the canvas's autosave uses: the same row, the same etag, the same lock. Nothing here
 *     writes `workflow_versions` itself.
 *   * **An unparseable file leaves the draft untouched (C4).** The text is parsed, and its slug
 *     checked, before the guard's transaction is opened. A `422` has nothing to roll back: no
 *     statement that could change the draft ran, so the stored draft is byte-identical.
 *   * **A stale save names the other editor's change.** The guard's `409` names the editor the
 *     draft row records.
 *   * **Absence is `404`, and so is another workspace's slug**, because every workflow is resolved
 *     through `WorkflowsRepository.findBySlug`, which is org-scoped.
 */

import { Injectable } from "@nestjs/common";

import type { Organization, Workflow } from "../db/schema";
import { printWorkflowConfig } from "./code.config";
import { parseWorkflowCode, slugRangeOf } from "./code.parser";
import { projectWorkflowCode } from "./code.projection";
import {
  slugMismatch,
  workflowCode,
  workflowCodeConfig,
  workflowCodeTree,
  type WorkflowCode,
  type WorkflowCodeConfig,
  type WorkflowCodeTree,
} from "./code.resources";
import { draftEtag } from "./draft.etag";
import { validateWorkflowDocument } from "./dsl.validator";
import { WorkflowStatsRepository } from "./stats.repository";
import {
  codeInvalid,
  codeUnprojectable,
  draftEtagRequired,
  versionNotFound,
  workflowSlugNotFound,
} from "./workflows.errors";
import { WorkflowsRepository } from "./workflows.repository";
import { WorkflowsService } from "./workflows.service";

/** Where a slug refusal is anchored if the file's slug cannot be found again: the file's start. */
const FILE_START = { line: 1, column: 1, endLine: 1, endColumn: 1 } as const;

@Injectable()
export class WorkflowCodeService {
  /**
   * @param workflows - The org-scoped workflow read, and the draft and version reads keyed by it.
   * @param registry - The rail's statement, which the explorer and the configuration both list.
   * @param lifecycle - The guarded draft write the canvas saves through.
   */
  constructor(
    private readonly workflows: WorkflowsRepository,
    private readonly registry: WorkflowStatsRepository,
    private readonly lifecycle: WorkflowsService,
  ) {}

  /**
   * One workflow as a file.
   *
   * Without `?version=`, the file is the draft's, and a workflow with no draft opens on the version
   * in force, editable — what the canvas opens on too. With it, the file is that published version,
   * read-only. The draft slot's etag travels either way.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param slug - The workflow.
   * @param version - A published version to read instead of the draft.
   * @returns The file.
   * @throws {NotFoundError} `workflow_not_found` for a slug this workspace does not have, and
   *   `workflow_version_not_found` for a number that names no version of one it does.
   * @throws {ConflictError} `workflow_code_unprojectable` when the document cannot be shown as code
   *   without changing it — including a workflow with no document at all — with the validator's
   *   findings.
   */
  async read(organizationId: string, slug: string, version?: number): Promise<WorkflowCode> {
    const workflow = await this.require(organizationId, slug);

    const [draft, requested] = await Promise.all([
      this.workflows.draftOf(workflow.id),
      version === undefined ? undefined : this.workflows.versionAt(workflow.id, version),
    ]);

    if (version !== undefined && requested === undefined) {
      throw versionNotFound(workflow.id, version);
    }

    const shown = requested ?? draft ?? (await this.versionInForce(workflow));
    const text =
      shown === undefined ? undefined : projectWorkflowCode(workflow.slug, shown.definition);

    if (shown === undefined || text === undefined) {
      throw codeUnprojectable(
        workflow.slug,
        version ?? null,
        shown === undefined ? [] : validateWorkflowDocument(shown.definition).errors,
      );
    }

    return workflowCode(workflow, {
      text,
      etag: draftEtag(draft),
      version: shown.version,
      readOnly: version !== undefined,
    });
  }

  /**
   * Save a file into the workflow's draft.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param slug - The workflow.
   * @param ifMatch - The `If-Match` header, verbatim, or `undefined` when there was none.
   * @param text - The whole file.
   * @returns The file as it now reads from the stored draft — printed canonically, which may differ
   *   from `text` in formatting and key order, never in meaning — with the draft's new etag.
   * @throws {NotFoundError} `workflow_not_found`.
   * @throws {BadRequestError} `workflow_draft_etag_required` when there is no `If-Match`.
   * @throws {InvalidRequestError} `workflow_code_invalid` with anchored errors, when the file does
   *   not read or names another workflow. Nothing is opened, so nothing is written.
   * @throws {ConflictError} `workflow_draft_conflict` naming the editor whose change the draft
   *   holds, when `If-Match` is stale.
   * @throws {Error} When the parser reads a document the printer cannot give back — a defect in
   *   one of the two, never the request's — before anything is written.
   */
  async save(
    organizationId: string,
    slug: string,
    ifMatch: string | undefined,
    text: string,
  ): Promise<WorkflowCode> {
    const workflow = await this.require(organizationId, slug);

    if (ifMatch === undefined) throw draftEtagRequired();

    const parsed = parseWorkflowCode(text);

    // The parser promises both are present exactly when there are no errors; the check narrows the
    // types rather than guarding a case that can happen.
    if (parsed.errors.length > 0 || parsed.slug === undefined || parsed.document === undefined) {
      throw codeInvalid(parsed.errors);
    }

    if (parsed.slug !== workflow.slug) {
      throw codeInvalid([
        slugMismatch(slugRangeOf(text) ?? FILE_START, parsed.slug, workflow.slug),
      ]);
    }

    // Checked before the write so the next read is guaranteed to show this document: the round
    // trip the read requires is the one this save stores.
    const projected = projectWorkflowCode(workflow.slug, parsed.document);

    if (projected === undefined) {
      throw new Error(
        `The parser read a document for workflow ${workflow.id} that the printer cannot give back ` +
          "unchanged. Nothing was written. See code.projection.ts.",
      );
    }

    const written = await this.lifecycle.writeGuarded(workflow, ifMatch, parsed.document, "code");

    return workflowCode(workflow, {
      text: projected,
      etag: draftEtag(written),
      version: null,
      readOnly: false,
    });
  }

  /**
   * The explorer.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns A file per workflow on the rail, in the rail's order, then `ouroboros.config.ts`.
   */
  async tree(organizationId: string): Promise<WorkflowCodeTree> {
    return workflowCodeTree(await this.registry.registryEntries(organizationId));
  }

  /**
   * `ouroboros.config.ts`.
   *
   * @param workspace - The workspace, from the tenant context — its slug is part of the file.
   * @returns The file, read-only.
   */
  async config(workspace: Organization): Promise<WorkflowCodeConfig> {
    const rail = await this.registry.registryEntries(workspace.id);

    return workflowCodeConfig(printWorkflowConfig(workspace.slug, rail));
  }

  /**
   * The workflow, or the `404` that covers both ways it can be missing.
   *
   * @param organizationId - The workspace.
   * @param slug - The workflow's slug.
   * @returns The row.
   * @throws {NotFoundError} `workflow_not_found`.
   */
  private async require(organizationId: string, slug: string): Promise<Workflow> {
    const workflow = await this.workflows.findBySlug(organizationId, slug);

    if (workflow === undefined) throw workflowSlugNotFound(slug);

    return workflow;
  }

  /**
   * The version in force, for a workflow with no draft.
   *
   * @param workflow - A workflow resolved through {@link require}.
   * @returns The row, or `undefined` when nothing is in force.
   */
  private async versionInForce(workflow: Workflow) {
    return workflow.current_version === null
      ? undefined
      : this.workflows.versionAt(workflow.id, workflow.current_version);
  }
}
