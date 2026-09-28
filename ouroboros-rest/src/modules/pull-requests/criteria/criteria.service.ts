/**
 * The criteria & evidence service — mockup 12's *Does the PR do what the ticket says?* matrix as
 * an API. AX.3 ([#359](https://github.com/NobuData/ouroboros/issues/359)), decisions **V6** and
 * **V9**, option **4-A**.
 *
 * ```
 * GET    /api/v1/pull-requests/:id/criteria                                   the matrix
 * POST   /api/v1/pull-requests/:id/criteria                                   author a claim (manual)
 * POST   /api/v1/pull-requests/:id/criteria/import                            import the plan's (plan)
 * PUT    /api/v1/pull-requests/:id/criteria/order                             reorder the rows
 * PATCH  /api/v1/pull-requests/:id/criteria/:criterionId                      reword a claim
 * DELETE /api/v1/pull-requests/:id/criteria/:criterionId                      remove a claim
 * POST   /api/v1/pull-requests/:id/criteria/:criterionId/evidence             cite a typed reference
 * DELETE /api/v1/pull-requests/:id/criteria/:criterionId/evidence/:evidenceId remove a citation
 * POST   /api/v1/pull-requests/:id/criteria/:criterionId/verify               → verified (needs evidence)
 * POST   /api/v1/pull-requests/:id/criteria/:criterionId/unverify             → unverified
 * POST   /api/v1/pull-requests/:id/criteria/:criterionId/waive                → waived + host annotation
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Evidence is a typed reference, resolved before insert** (V6). Each kind is looked up in its
 * own table, held to the PR's run (or, for a hunk or note, its revisions), and refused as
 * `evidence_unresolved` when it does not resolve — a hunk whose path the revision never changed is
 * `hunk_outside_snapshot`. V057's foreign keys and trigger check again at insert, and a refusal
 * there (a case re-parsed away in between) is the same `422`, not a `500`.
 *
 * **Verification needs evidence.** `verify` refuses a criterion with none, before V057's
 * `pr_criteria_verified_has_evidence` would; `unverify` moves it back. A waived criterion does
 * neither — its annotation already told the host PR it was waived, so it moves only by being
 * waived again (with a new reason) or deleted.
 *
 * **Waivers leave the building** (V9). `waive` writes the AS.4 waiver and the criterion's status in
 * one transaction, *then* posts the annotation through AX.1's idempotent comment surface: the
 * decision is never lost to a host that is down, and a refusal is recorded on the waiver as
 * `failed` and answered, not thrown — waiving again is the retry, and edits the same comment.
 *
 * **Criteria are authored or imported, never extracted** (option 4-A). `manual` is what a person
 * writes; `plan` is what the import reads from the ticket's plan draft (#277); `extracted` is
 * AZ.2's (#372) and refused. No path here verifies a claim on its own.
 *
 * **Every status change is audited with the person as the actor** — `pr_criterion.verified`,
 * `pr_criterion.unverified` and `pr_criterion.waived`.
 */

import { Injectable, Logger } from "@nestjs/common";

import {
  PR_CRITERION_UNVERIFIED_EVENT,
  PR_CRITERION_VERIFIED_EVENT,
  PR_CRITERION_WAIVED_EVENT,
  type AuditAction,
} from "../../audit/audit.events";
import { AuditService } from "../../audit/audit.service";
import type { NewPrCriterionEvidence, PrCriterion, PrWaiver } from "../../db/schema";
import { DomainError } from "../../errors/error.envelope";
import {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  isDatabaseFailure,
} from "../../tenancy/constraints";
import { TicketSourceError, statusReasonFor } from "../../ticket-sources/ticket-source.errors";
import type { PrCommentResult } from "../../ticket-sources/ticket-source.pr";
import { PrSyncService } from "../pr-sync.service";
import { waiverAnnotationBody, waiverAnnotationKey } from "./criteria.annotation";
import {
  analysisNoteLine,
  artifactLine,
  hunkLine,
  measurementLine,
  testCaseLine,
} from "./criteria.display";
import type {
  AttachEvidenceDto,
  CreateCriterionDto,
  ReorderCriteriaDto,
  UpdateCriterionDto,
  WaiveCriterionDto,
} from "./criteria.dto";
import {
  criteriaOrderInvalid,
  criterionEvidenceRequired,
  criterionNotFound,
  criterionSourceInvalid,
  criterionWaived,
  criterionWaiverNeedsRun,
  evidenceNotFound,
  evidenceUnresolved,
  hunkOutsideSnapshot,
  planContextMissing,
  planCriteriaMissing,
  pullRequestNotFound,
} from "./criteria.errors";
import { planCriteria } from "./criteria.plan";
import {
  CriteriaRepository,
  type CriteriaPrRow,
  type ResolvedRevision,
} from "./criteria.repository";
import {
  criteriaCounts,
  criterionResource,
  type AnnotationOutcomeResource,
  type CriteriaImportResource,
  type CriteriaMatrixResource,
  type CriterionResource,
  type CriterionWaivedResource,
} from "./criteria.resources";

/** Who is acting: the signed-in person. */
export interface CriteriaActor {
  /** `"user"."id"` — the audit row's actor and the rows' author. */
  readonly id: string;
  /** The display name the host annotation is signed with. */
  readonly name: string;
}

/** An evidence row, before its criterion is known. */
type ResolvedEvidence = Omit<NewPrCriterionEvidence, "criterion_id">;

@Injectable()
export class CriteriaService {
  private readonly logger = new Logger(CriteriaService.name);

  /**
   * @param store - Every statement this service issues.
   * @param host - AX.1's PR surface, for the waiver annotation.
   * @param audit - AD.4's trail.
   */
  constructor(
    private readonly store: CriteriaRepository,
    private readonly host: PrSyncService,
    private readonly audit: AuditService,
  ) {}

  // --- reads -------------------------------------------------------------------------------

  /**
   * The matrix: every criterion with its evidence lines, status and waiver.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @returns The matrix, in its order.
   * @throws {NotFoundError} `pull_request_not_found`.
   */
  async matrix(organizationId: string, prId: string): Promise<CriteriaMatrixResource> {
    const pr = await this.prOrThrow(organizationId, prId);

    const [criteria, draft] = await Promise.all([
      this.store.criteria(prId).then((rows) => this.resources(rows)),
      pr.ticket_id === null ? undefined : this.store.planDraft(organizationId, pr.ticket_id),
    ]);

    return {
      prId,
      planContext: draft !== undefined,
      counts: criteriaCounts(criteria),
      criteria,
    };
  }

  // --- authoring ---------------------------------------------------------------------------

  /**
   * Author a claim — `manual`, the only provenance authoring writes.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @param actor - Who wrote it.
   * @param request - The claim.
   * @returns The criterion, last in the matrix.
   * @throws {InvalidRequestError} `criterion_source_invalid` for `extracted` or `plan`.
   */
  async create(
    organizationId: string,
    prId: string,
    actor: CriteriaActor,
    request: CreateCriterionDto,
  ): Promise<CriterionResource> {
    const source = request.source ?? "manual";

    if (source !== "manual") {
      throw criterionSourceInvalid(source);
    }

    await this.prOrThrow(organizationId, prId);

    const [row] = await this.store.insertCriteria(prId, [
      { claim: request.claim, source, createdBy: actor.id },
    ]);

    return criterionResource(row, [], undefined);
  }

  /**
   * Import the acceptance criteria the ticket's plan states, as `plan` rows. Repeatable: a claim
   * the PR already has, word for word, is skipped.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @param actor - Who imported them — the rows' `created_by`, confirming them.
   * @returns What was written and what was not.
   * @throws {ConflictError} `plan_context_missing` when the PR's ticket has no plan draft with a
   *   body; `plan_criteria_missing` when the draft states no acceptance-criteria section.
   */
  async importPlan(
    organizationId: string,
    prId: string,
    actor: CriteriaActor,
  ): Promise<CriteriaImportResource> {
    const pr = await this.prOrThrow(organizationId, prId);
    const draft =
      pr.ticket_id === null ? undefined : await this.store.planDraft(organizationId, pr.ticket_id);

    if (draft === undefined) {
      throw planContextMissing(prId, pr.ticket_id);
    }

    const plan = planCriteria(draft.body);

    if (!plan.found) {
      throw planCriteriaMissing(prId, draft.id);
    }

    const existing = new Set((await this.store.criteria(prId)).map((row) => row.claim));
    const fresh = plan.claims.filter((claim) => !existing.has(claim));
    const written =
      fresh.length === 0
        ? []
        : await this.store.insertCriteria(
            prId,
            fresh.map((claim) => ({ claim, source: "plan" as const, createdBy: actor.id })),
          );

    return {
      draftId: draft.id,
      imported: written.map((row) => criterionResource(row, [], undefined)),
      alreadyPresent: plan.claims.filter((claim) => existing.has(claim)),
      tooLong: plan.tooLong,
    };
  }

  /**
   * Reword a claim. Its evidence and status stay: the citations were of the work, not the words.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @param criterionId - The criterion.
   * @param request - The new wording.
   * @returns The criterion.
   */
  async update(
    organizationId: string,
    prId: string,
    criterionId: string,
    request: UpdateCriterionDto,
  ): Promise<CriterionResource> {
    await this.criterionOrThrow(organizationId, prId, criterionId);

    return this.resource(await this.store.updateClaim(criterionId, request.claim));
  }

  /**
   * Put the matrix in a new order.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @param request - Every criterion of the PR, each once.
   * @returns The matrix, in its new order.
   * @throws {InvalidRequestError} `criteria_order_invalid` for anything but a permutation.
   */
  async reorder(
    organizationId: string,
    prId: string,
    request: ReorderCriteriaDto,
  ): Promise<CriteriaMatrixResource> {
    await this.prOrThrow(organizationId, prId);

    const current = new Set((await this.store.criteria(prId)).map((row) => row.id));
    const seen = new Set<string>();
    const unknown = request.criterionIds.filter((id) => {
      const repeat = seen.has(id);

      seen.add(id);

      return repeat || !current.has(id);
    });
    const missing = [...current].filter((id) => !seen.has(id));

    if (unknown.length > 0 || missing.length > 0) {
      throw criteriaOrderInvalid(missing, unknown);
    }

    await this.store.reorder(prId, request.criterionIds);

    return this.matrix(organizationId, prId);
  }

  /**
   * Remove a claim. Its evidence goes with it; its waiver stays, append-only (V055).
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @param criterionId - The criterion.
   */
  async remove(organizationId: string, prId: string, criterionId: string): Promise<void> {
    await this.criterionOrThrow(organizationId, prId, criterionId);
    await this.store.deleteCriterion(criterionId);
  }

  // --- evidence ----------------------------------------------------------------------------

  /**
   * Cite a typed reference, resolved against its table before insert (V6).
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @param criterionId - The criterion.
   * @param request - The kind and its reference.
   * @returns The criterion, with the new line.
   * @throws {InvalidRequestError} `evidence_unresolved` for a reference that does not resolve;
   *   `hunk_outside_snapshot` for a hunk the revision never changed.
   */
  async attach(
    organizationId: string,
    prId: string,
    criterionId: string,
    request: AttachEvidenceDto,
  ): Promise<CriterionResource> {
    const { pr, criterion } = await this.criterionOrThrow(organizationId, prId, criterionId);
    const resolved = await this.resolve(pr, request);

    try {
      await this.store.insertEvidence({ ...resolved, criterion_id: criterionId });
    } catch (error) {
      throw this.refusedAtInsert(error, request) ?? error;
    }

    return this.resource(criterion);
  }

  /**
   * Remove a citation. V057 demotes a verified criterion whose last evidence goes.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @param criterionId - The criterion.
   * @param evidenceId - The evidence.
   * @returns The criterion, as it now stands.
   * @throws {NotFoundError} `evidence_not_found`.
   */
  async detach(
    organizationId: string,
    prId: string,
    criterionId: string,
    evidenceId: string,
  ): Promise<CriterionResource> {
    await this.criterionOrThrow(organizationId, prId, criterionId);

    if (!(await this.store.deleteEvidence(criterionId, evidenceId))) {
      throw evidenceNotFound(criterionId, evidenceId);
    }

    // Re-read: the demotion trigger may have moved the status.
    const { criterion } = await this.criterionOrThrow(organizationId, prId, criterionId);

    return this.resource(criterion);
  }

  // --- status ------------------------------------------------------------------------------

  /**
   * Mark a criterion verified — only with at least one evidence row. Audited.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @param criterionId - The criterion.
   * @param actor - Who decided.
   * @returns The criterion. Already verified is answered as it is, with no second audit row.
   * @throws {ConflictError} `criterion_evidence_required`; `criterion_waived`.
   */
  async verify(
    organizationId: string,
    prId: string,
    criterionId: string,
    actor: CriteriaActor,
  ): Promise<CriterionResource> {
    return this.transition(organizationId, prId, criterionId, actor, "verified");
  }

  /**
   * Move a verified criterion back to unverified. Audited.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @param criterionId - The criterion.
   * @param actor - Who decided.
   * @returns The criterion. Already unverified is answered as it is, with no audit row.
   * @throws {ConflictError} `criterion_waived`.
   */
  async unverify(
    organizationId: string,
    prId: string,
    criterionId: string,
    actor: CriteriaActor,
  ): Promise<CriterionResource> {
    return this.transition(organizationId, prId, criterionId, actor, "unverified");
  }

  /**
   * Waive a criterion (V9): the AS.4 waiver and `waived`, then the host PR annotation. Audited.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @param criterionId - The criterion.
   * @param actor - Who waived — the waiver's author and the annotation's signature.
   * @param request - The reason.
   * @returns The criterion with its waiver, and how the annotation landed — `failed` with the
   *   host's reason when it refused, never thrown: the waiver is recorded either way.
   * @throws {ConflictError} `criterion_waiver_needs_run` for a PR no loop opened.
   */
  async waive(
    organizationId: string,
    prId: string,
    criterionId: string,
    actor: CriteriaActor,
    request: WaiveCriterionDto,
  ): Promise<CriterionWaivedResource> {
    const { pr, criterion } = await this.criterionOrThrow(organizationId, prId, criterionId);

    if (pr.run_id === null) {
      throw criterionWaiverNeedsRun(prId);
    }

    const written = await this.store.waive(
      organizationId,
      pr.run_id,
      criterionId,
      actor.id,
      request.reason,
    );
    const { waiver, annotation } = await this.annotate(pr, criterionId, written.waiver, {
      claim: criterion.claim,
      reason: request.reason,
      author: actor.name,
    });

    await this.record(PR_CRITERION_WAIVED_EVENT, organizationId, actor, written.criterion, {
      pr_id: prId,
      from: written.previous,
      waiver_id: waiver.id,
      annotation: annotation.state,
    });

    return { criterion: await this.resource(written.criterion, waiver), annotation };
  }

  // --- the pieces --------------------------------------------------------------------------

  /**
   * Move a criterion between `unverified` and `verified`.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @param criterionId - The criterion.
   * @param actor - Who decided.
   * @param to - Where to.
   * @returns The criterion.
   */
  private async transition(
    organizationId: string,
    prId: string,
    criterionId: string,
    actor: CriteriaActor,
    to: "verified" | "unverified",
  ): Promise<CriterionResource> {
    const { criterion } = await this.criterionOrThrow(organizationId, prId, criterionId);

    if (criterion.status === "waived") {
      throw criterionWaived(criterionId);
    }

    if (criterion.status === to) {
      return this.resource(criterion);
    }

    const evidence = await this.store.evidence([criterionId]);

    if (to === "verified" && evidence.length === 0) {
      throw criterionEvidenceRequired(criterionId);
    }

    let moved: PrCriterion | undefined;

    try {
      moved = await this.store.setStatus(criterionId, criterion.status, to);
    } catch (error) {
      // The last citation went between the count and the update — V057 said no.
      if (isDatabaseFailure(error) && error.code === CHECK_VIOLATION) {
        throw criterionEvidenceRequired(criterionId);
      }

      throw error;
    }

    if (moved === undefined) {
      // Somebody else moved it first; answer with where it stands, and audit nothing we did not do.
      const { criterion: now } = await this.criterionOrThrow(organizationId, prId, criterionId);

      if (now.status === "waived") {
        throw criterionWaived(criterionId);
      }

      return this.resource(now);
    }

    await this.record(
      to === "verified" ? PR_CRITERION_VERIFIED_EVENT : PR_CRITERION_UNVERIFIED_EVENT,
      organizationId,
      actor,
      moved,
      { pr_id: prId, from: criterion.status, evidence: evidence.length },
    );

    return this.resource(moved);
  }

  /**
   * Resolve a typed reference against its table (V6), and compose its line.
   *
   * @param pr - The criterion's PR.
   * @param request - The kind and its reference.
   * @returns The row to insert, less its criterion.
   * @throws {InvalidRequestError} `evidence_unresolved`, `hunk_outside_snapshot`.
   */
  private async resolve(pr: CriteriaPrRow, request: AttachEvidenceDto): Promise<ResolvedEvidence> {
    const note = request.note ?? null;

    switch (request.kind) {
      case "test_case": {
        const caseKey = request.caseKey ?? "";
        const reference = { caseKey, testRunId: request.testRunId ?? null };
        const found =
          pr.run_id === null
            ? undefined
            : await this.store.caseByKey(
                pr.organization_id,
                pr.run_id,
                caseKey,
                request.testRunId ?? null,
              );

        if (found === undefined) {
          throw evidenceUnresolved(
            "test_case",
            reference,
            "No attempt of this PR's run has a test case with that key.",
          );
        }

        if (found.status === "skipped") {
          throw evidenceUnresolved(
            "test_case",
            reference,
            `The case was skipped in build ${String(found.attempt_seq)} — a case that did not run shows nothing.`,
          );
        }

        return {
          kind: "test_case",
          test_case_id: found.id,
          display_text: testCaseLine(found, note),
        };
      }

      case "hil_measurement": {
        const id = request.hilMeasurementId ?? "";
        const found =
          pr.run_id === null
            ? undefined
            : await this.store.measurement(pr.organization_id, pr.run_id, id);

        if (found === undefined) {
          throw evidenceUnresolved(
            "hil_measurement",
            { hilMeasurementId: id },
            "No case of this PR's run has a HIL measurement with that id.",
          );
        }

        return {
          kind: "hil_measurement",
          hil_measurement_id: found.id,
          display_text: measurementLine(found, note),
        };
      }

      case "build_artifact": {
        const id = request.testArtifactId ?? "";
        const found =
          pr.run_id === null
            ? undefined
            : await this.store.artifact(pr.organization_id, pr.run_id, id);

        if (found === undefined || found.expired_at !== null) {
          throw evidenceUnresolved(
            "build_artifact",
            { testArtifactId: id },
            found === undefined
              ? "No attempt of this PR's run uploaded an artifact with that id."
              : "That artifact has expired — its bytes are gone, so it cannot be cited.",
          );
        }

        return {
          kind: "build_artifact",
          test_artifact_id: found.id,
          display_text: artifactLine(found.name, note),
        };
      }

      case "hunk": {
        const path = request.path ?? "";
        const lineStart = request.lineStart ?? 0;
        const lineEnd = request.lineEnd ?? 0;
        const reference = { revisionId: request.revisionId ?? null, path, lineStart, lineEnd };

        if (lineEnd < lineStart) {
          throw evidenceUnresolved(
            "hunk",
            reference,
            "A hunk ends at or after the line it starts on.",
          );
        }

        const revision = await this.revisionOrThrow(pr, "hunk", reference, request.revisionId);

        if (!revision.files.some((file) => file.path === path)) {
          throw hunkOutsideSnapshot(revision.id, path);
        }

        return {
          kind: "hunk",
          revision_id: revision.id,
          hunk_path: path,
          hunk_line_start: lineStart,
          hunk_line_end: lineEnd,
          display_text: hunkLine({ path, lineStart, lineEnd }, null),
        };
      }

      case "analysis_note": {
        const reference = { revisionId: request.revisionId ?? null };
        const revision = await this.revisionOrThrow(
          pr,
          "analysis_note",
          reference,
          request.revisionId,
        );

        return {
          kind: "analysis_note",
          revision_id: revision.id,
          display_text: analysisNoteLine(note ?? ""),
        };
      }
    }
  }

  /**
   * A revision of the PR for a hunk or a note — the one named, or the latest.
   *
   * @param pr - The PR.
   * @param kind - The evidence kind, for the refusal.
   * @param reference - What was cited, for the refusal.
   * @param revisionId - The revision named, if any.
   * @returns The revision.
   * @throws {InvalidRequestError} `evidence_unresolved`.
   */
  private async revisionOrThrow(
    pr: CriteriaPrRow,
    kind: "hunk" | "analysis_note",
    reference: Record<string, string | number | null>,
    revisionId: string | undefined,
  ): Promise<ResolvedRevision> {
    const revision = await this.store.revision(pr.id, revisionId ?? null);

    if (revision === undefined) {
      throw evidenceUnresolved(
        kind,
        reference,
        revisionId === undefined
          ? "This PR has no revision yet — nothing to cite."
          : "That is not a revision of this PR.",
      );
    }

    return revision;
  }

  /**
   * What V057 refusing a resolved reference at insert means — the target went in between.
   *
   * @param error - What the insert threw.
   * @param request - What was cited.
   * @returns The `422`, or undefined for anything else.
   */
  private refusedAtInsert(error: unknown, request: AttachEvidenceDto): DomainError | undefined {
    if (
      !isDatabaseFailure(error) ||
      (error.code !== FOREIGN_KEY_VIOLATION && error.code !== CHECK_VIOLATION)
    ) {
      return undefined;
    }

    return evidenceUnresolved(
      request.kind,
      {},
      "The cited row changed while it was being cited — it no longer resolves in this PR.",
    );
  }

  /**
   * Post the waiver to the host PR, and record where it landed. Never throws for the host.
   *
   * @param pr - The PR.
   * @param criterionId - The criterion — the comment's key, so a re-waive edits it.
   * @param waiver - The waiver just written.
   * @param content - The claim, reason and author.
   * @returns The waiver as recorded, and the outcome.
   */
  private async annotate(
    pr: CriteriaPrRow,
    criterionId: string,
    waiver: PrWaiver,
    content: { claim: string; reason: string; author: string },
  ): Promise<{ waiver: PrWaiver; annotation: AnnotationOutcomeResource }> {
    let posted: PrCommentResult;

    try {
      posted = await this.host.comment(pr.organization_id, pr.source_id, pr.external_number, {
        key: waiverAnnotationKey(criterionId),
        body: waiverAnnotationBody(content),
      });
    } catch (error) {
      const refusal = annotationError(error);

      if (refusal.code === "annotation_failed") {
        this.logger.error(`waiver ${waiver.id}'s annotation failed unexpectedly`, error);
      }

      return {
        waiver: await this.store.markAnnotationFailed(waiver.id),
        annotation: { state: "failed", mode: null, error: refusal },
      };
    }

    return {
      waiver: await this.store.markAnnotated(waiver.id, posted.commentId, posted.url, new Date()),
      annotation: { state: "annotated", mode: posted.mode, error: null },
    };
  }

  /**
   * Append a status change to the trail.
   *
   * @param action - Which change.
   * @param organizationId - The workspace.
   * @param actor - Who.
   * @param criterion - The criterion, as it now is.
   * @param detail - The rest.
   */
  private async record(
    action: AuditAction,
    organizationId: string,
    actor: CriteriaActor,
    criterion: PrCriterion,
    detail: Record<string, string | number>,
  ): Promise<void> {
    await this.audit.record({
      organizationId,
      actorId: actor.id,
      action,
      subjectType: "pr_criterion",
      subjectId: criterion.id,
      at: criterion.updated_at,
      detail,
    });
  }

  /**
   * A PR of the workspace, or its `404`.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @returns The PR.
   */
  private async prOrThrow(organizationId: string, prId: string): Promise<CriteriaPrRow> {
    const pr = await this.store.pr(organizationId, prId);

    if (pr === undefined) {
      throw pullRequestNotFound(prId);
    }

    return pr;
  }

  /**
   * A criterion of a PR of the workspace, or its `404`.
   *
   * @param organizationId - The workspace.
   * @param prId - The PR.
   * @param criterionId - The criterion.
   * @returns The PR and the criterion.
   */
  private async criterionOrThrow(
    organizationId: string,
    prId: string,
    criterionId: string,
  ): Promise<{ pr: CriteriaPrRow; criterion: PrCriterion }> {
    const pr = await this.prOrThrow(organizationId, prId);
    const criterion = await this.store.criterion(prId, criterionId);

    if (criterion === undefined) {
      throw criterionNotFound(prId, criterionId);
    }

    return { pr, criterion };
  }

  /**
   * One criterion with its evidence and waiver.
   *
   * @param criterion - The row.
   * @param waiver - Its waiver, when already in hand.
   * @returns The resource.
   */
  private async resource(criterion: PrCriterion, waiver?: PrWaiver): Promise<CriterionResource> {
    const [row] = await this.resources([criterion], waiver);

    return row;
  }

  /**
   * Criteria with their evidence and waivers, in two reads rather than one per row.
   *
   * @param criteria - The rows, in order.
   * @param known - A waiver already in hand, which is not read again.
   * @returns The resources, in the same order.
   */
  private async resources(
    criteria: readonly PrCriterion[],
    known?: PrWaiver,
  ): Promise<CriterionResource[]> {
    const wanted = criteria
      .map((row) => row.waiver_ref)
      .filter((id): id is string => id !== null && id !== known?.id);
    const [evidence, waivers] = await Promise.all([
      this.store.evidence(criteria.map((row) => row.id)),
      this.store.waivers(wanted),
    ]);
    const byId = new Map(waivers.map((waiver) => [waiver.id, waiver]));

    if (known !== undefined) {
      byId.set(known.id, known);
    }

    return criteria.map((row) =>
      criterionResource(
        row,
        evidence.filter((line) => line.criterion_id === row.id),
        row.waiver_ref === null ? undefined : byId.get(row.waiver_ref),
      ),
    );
  }
}

/**
 * What a refused annotation tells the caller — a stable code and a sentence fit for a page.
 *
 * @param error - What the host surface threw.
 * @returns `host_<class>` with the SPI's own phrase for a host refusal, the domain code for a
 *   source that cannot post, and `annotation_failed` for anything else.
 */
export function annotationError(error: unknown): { code: string; message: string } {
  if (TicketSourceError.is(error)) {
    return { code: `host_${error.errorClass}`, message: statusReasonFor(error) };
  }

  if (error instanceof DomainError) {
    return { code: error.code, message: error.envelope().message };
  }

  return { code: "annotation_failed", message: "The annotation could not be posted." };
}
