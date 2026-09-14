/**
 * `WorkflowCodeService` — the code view's reads and its save. U.3
 * ([#167](https://github.com/NobuData/ouroboros/issues/167)), with W.2's diagnostics and Loop
 * Checks ([#178](https://github.com/NobuData/ouroboros/issues/178)).
 *
 * ```
 * read    the draft, or a published version, as a file — when the file would be the document
 *           └ with its span map, and its findings on the lines of the stages they are about
 * checks  the same file's Loop Checks rows
 * save    parse ─▶ check the slug ─▶ the shared guarded write
 *           └ refused whole, before anything is opened, when the file does not read
 * tree    the explorer, from the rail's statement
 * config  ouroboros.config.ts, from the same statement
 * ```
 *
 * Five rules, each an acceptance criterion:
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
 *   * **Diagnostics come from this process (W.2).** The findings are `validateWorkflowDocument`'s,
 *     which `schemas/workflow-dsl/fixtures/expected.json` holds in parity with the engine's
 *     `/v0/workflows/validate`, so opening a file costs no engine round trip and cannot fail
 *     because the engine is down. References are checked against the workspace's own suggestions.
 */

import { Injectable } from "@nestjs/common";

import type { Organization, Workflow, WorkflowVersion } from "../db/schema";
import { WorkflowCatalogService } from "./catalog.service";
import { loopCheckRows } from "./code.checks";
import { printWorkflowConfig } from "./code.config";
import { diagnoseDocument, type DocumentDiagnosis } from "./code.diagnostics";
import { parseWorkflowCode, slugRangeOf } from "./code.parser";
import type { PrintedWorkflowCode } from "./code.printer";
import { projectWorkflowCode } from "./code.projection";
import {
  slugMismatch,
  workflowCode,
  workflowCodeChecks,
  workflowCodeConfig,
  workflowCodeTree,
  type ProjectedFile,
  type WorkflowCode,
  type WorkflowCodeChecks,
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

/** A file opened for reading: the workflow, the file, and what checking it established. */
interface OpenedFile {
  /** The workflow row. */
  readonly workflow: Workflow;
  /** The file, as the wire carries it. */
  readonly file: ProjectedFile;
  /** The diagnosis behind `file.diagnostics`, and whether task routes were checked. */
  readonly diagnosis: Diagnosis;
}

/** A diagnosis, and whether the catalogue let it check task routes. */
interface Diagnosis extends DocumentDiagnosis {
  /** Whether the workspace's task kinds were in the catalogue. */
  readonly tasksChecked: boolean;
}

@Injectable()
export class WorkflowCodeService {
  /**
   * @param workflows - The org-scoped workflow read, and the draft and version reads keyed by it.
   * @param registry - The rail's statement, which the explorer and the configuration both list.
   * @param lifecycle - The guarded draft write the canvas saves through.
   * @param catalog - The workspace's skill and task-route names, which references are checked
   *   against.
   */
  constructor(
    private readonly workflows: WorkflowsRepository,
    private readonly registry: WorkflowStatsRepository,
    private readonly lifecycle: WorkflowsService,
    private readonly catalog: WorkflowCatalogService,
  ) {}

  /**
   * One workflow as a file.
   *
   * Without `?version=`, the file is the draft's, and a workflow with no draft opens on the version
   * in force, editable — what the canvas opens on too. With it, the file is that published version,
   * read-only. The draft slot's etag travels either way, and so do the file's span map and
   * diagnostics.
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
    const opened = await this.open(organizationId, slug, version);

    return workflowCode(opened.workflow, opened.file);
  }

  /**
   * The Loop Checks panel of the file {@link read} serves.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param slug - The workflow.
   * @param version - A published version to check instead of the draft.
   * @returns The rows, with the file's path, version and the draft's etag.
   * @throws {NotFoundError} As {@link read}.
   * @throws {ConflictError} As {@link read}: a file that cannot be shown has no checks either.
   */
  async checks(
    organizationId: string,
    slug: string,
    version?: number,
  ): Promise<WorkflowCodeChecks> {
    const { workflow, file, diagnosis } = await this.open(organizationId, slug, version);

    return workflowCodeChecks(
      workflow,
      file,
      loopCheckRows({
        diagnostics: diagnosis.diagnostics,
        tasksChecked: diagnosis.tasksChecked,
        ...(diagnosis.document === undefined ? {} : { document: diagnosis.document }),
      }),
    );
  }

  /**
   * Save a file into the workflow's draft.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param slug - The workflow.
   * @param ifMatch - The `If-Match` header, verbatim, or `undefined` when there was none.
   * @param text - The whole file.
   * @returns The file as it now reads from the stored draft — printed canonically, which may differ
   *   from `text` in formatting and key order, never in meaning — with the draft's new etag, and
   *   the stored document's span map and diagnostics.
   * @throws {NotFoundError} `workflow_not_found`.
   * @throws {BadRequestError} `workflow_draft_etag_required` when there is no `If-Match`.
   * @throws {InvalidRequestError} `workflow_code_invalid` with anchored errors, and the same issues
   *   as diagnostics, when the file does not read or names another workflow. Nothing is opened, so
   *   nothing is written.
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

    // Diagnosed before the write too, so a catalogue that cannot be read leaves the draft as it was.
    const diagnosis = await this.diagnose(organizationId, projected, parsed.document);
    const written = await this.lifecycle.writeGuarded(workflow, ifMatch, parsed.document, "code");

    return workflowCode(workflow, {
      text: projected.text,
      spans: projected.spans,
      diagnostics: diagnosis.diagnostics,
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
   * Open one workflow's file for reading: resolve what to show, print it, and diagnose it.
   *
   * @param organizationId - The workspace.
   * @param slug - The workflow.
   * @param version - A published version to open instead of the draft.
   * @returns The workflow, the file and its diagnosis.
   * @throws {NotFoundError} `workflow_not_found` or `workflow_version_not_found`.
   * @throws {ConflictError} `workflow_code_unprojectable`.
   */
  private async open(
    organizationId: string,
    slug: string,
    version: number | undefined,
  ): Promise<OpenedFile> {
    const workflow = await this.require(organizationId, slug);

    const [draft, requested] = await Promise.all([
      this.workflows.draftOf(workflow.id),
      version === undefined ? undefined : this.workflows.versionAt(workflow.id, version),
    ]);

    if (version !== undefined && requested === undefined) {
      throw versionNotFound(workflow.id, version);
    }

    const shown = requested ?? draft ?? (await this.versionInForce(workflow));
    const printed =
      shown === undefined ? undefined : projectWorkflowCode(workflow.slug, shown.definition);

    if (shown === undefined || printed === undefined) {
      throw codeUnprojectable(
        workflow.slug,
        version ?? null,
        shown === undefined ? [] : validateWorkflowDocument(shown.definition).errors,
      );
    }

    const diagnosis = await this.diagnose(organizationId, printed, shown.definition);

    return {
      workflow,
      diagnosis,
      file: {
        text: printed.text,
        spans: printed.spans,
        diagnostics: diagnosis.diagnostics,
        etag: draftEtag(draft),
        version: shown.version,
        readOnly: version !== undefined,
      },
    };
  }

  /**
   * Diagnose a printed document against the workspace's names.
   *
   * @param organizationId - The workspace whose skills and task routes references must name.
   * @param printed - The file and its span map.
   * @param definition - The document it was printed from.
   * @returns The diagnosis, and whether task routes were among the names checked.
   */
  private async diagnose(
    organizationId: string,
    printed: PrintedWorkflowCode,
    definition: WorkflowVersion["definition"],
  ): Promise<Diagnosis> {
    const catalogue = await this.catalog.dslCatalogue(organizationId);

    return {
      ...diagnoseDocument({
        text: printed.text,
        spans: printed.spans,
        document: definition,
        catalogue,
      }),
      tasksChecked: catalogue.tasks !== undefined,
    };
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
